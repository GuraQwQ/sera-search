import { z } from 'zod';
import { Readable, Transform } from 'node:stream';
import { createGunzip, gunzipSync } from 'node:zlib';
import type { ConnectorDefinition, ConnectorHooks, ConnectorOperation } from '../connectors.js';
import { connectorClient, createStructuredSource } from '../connectors.js';
import { sourceConfig } from '../source-config.js';
import type { AccessPolicy, Config, SearchHit, SearchRequest, Source } from '../types.js';
import { date, document, hit, htmlText, object, permitted, rows, string } from './shared.js';
import type { Row } from './shared.js';
import { reportCoverage } from './operations.js';

const text = z.string().trim().min(1).max(1024);
const page = z.number().int().min(1).max(10000).default(1);
const offset = z.number().int().nonnegative().max(1000000).default(0);
const system = z.enum(['npm', 'pypi', 'cargo', 'go', 'maven', 'nuget', 'rubygems']).default('npm');
const registry = z.string().regex(/^[\w.-]+$/).default('npmjs.org');
const capture = z.string().regex(/^CC-MAIN-\d{4}-\d{2}$/);
const hour = z.string().regex(/^\d{4}-\d{2}-\d{2}-\d{1,2}$/);
const project = z.string().regex(/^[a-z0-9_.-]+$/).default('en.wikipedia.org');
const eventTypes = z.array(z.string().regex(/^[A-Za-z]+Event$/)).min(1).max(32).optional();
const free = (evidence: string, quota?: string): AccessPolicy => ({ authentication: 'none', billing: 'free', ...(quota ? { quota } : {}), evidence });
function op(description: string, content_types: string[], schema: z.ZodType): ConnectorOperation {
  return { description, content_types, input_schema: z.toJSONSchema(schema) };
}

export const infrastructureDefinitions: ConnectorDefinition[] = [
  { id: 'common-crawl', label: 'Common Crawl URL 索引与归档记录', type: 'custom', base_url: 'https://index.commoncrawl.org/', auth: { type: 'none' },
    access: free('https://commoncrawl.org/access-the-data', '公开索引需合理节流；HTTP 下载无需 AWS 账号'), limits: { min_interval_ms: 1000, max_response_bytes: 4 * 1024 * 1024 },
    operations: { captures: op('指定抓取批次，以 URL 或域名模式查询 CDX；分页只针对该批次索引', ['web-capture'], z.strictObject({ crawl: capture, matchType: z.enum(['exact', 'prefix', 'host', 'domain']).default('exact'), page: z.number().int().nonnegative().default(0), resultOffset: offset, status: z.number().int().min(100).max(599).optional() })) },
    limitations: ['URL 索引不提供任意正文关键词检索；批次收录不完整，原始抓取不等于页面当前状态。'] },
  { id: 'gh-archive', label: 'GH Archive 单小时公开 GitHub 事件', type: 'custom', base_url: 'https://data.gharchive.org/', auth: { type: 'none' },
    access: free('https://www.gharchive.org/'), limits: { min_interval_ms: 500, max_response_bytes: 32 * 1024 * 1024 },
    operations: { events: op('显式指定 UTC 小时与仓库或事件类型，流式筛选 gzip 事件文件；本操作不建立全库索引', ['github-event'], z.strictObject({ hour, repository: text.optional(), eventTypes, skipEvents: offset, maxEvents: z.number().int().min(1).max(1000000).default(100000), maxCompressedBytes: z.number().int().min(1024).max(32 * 1024 * 1024).default(16 * 1024 * 1024), maxExpandedBytes: z.number().int().min(1024).max(128 * 1024 * 1024).default(64 * 1024 * 1024) })) },
    limitations: ['仅检查指定小时档案；2011-02-12 起有归档，2015 年前后的上游事件接口不同。续扫按事件序号重读文件，受相同字节预算限制。'] },
  { id: 'wikimedia-analytics', label: 'Wikimedia 文章与项目阅读量', type: 'rest', base_url: 'https://wikimedia.org/api/rest_v1/', auth: { type: 'none' },
    access: free('https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html', '按客户端身份限流；请求需可识别 User-Agent'), limits: { min_interval_ms: 1000 },
    operations: { pageviews: op('指定文章与 since/until，取得日或月阅读量序列', ['pageview-timeseries'], z.strictObject({ project, article: text.optional(), granularity: z.enum(['daily', 'monthly']).default('daily'), access: z.enum(['all-access', 'desktop', 'mobile-web', 'mobile-app']).default('all-access'), agent: z.enum(['all-agents', 'user', 'spider', 'automated']).default('user') })),
      'project-views': op('指定项目与 since/until，取得项目总阅读量序列', ['pageview-timeseries'], z.strictObject({ project, granularity: z.enum(['daily', 'monthly']).default('daily'), access: z.enum(['all-access', 'desktop', 'mobile-web', 'mobile-app']).default('all-access'), agent: z.enum(['all-agents', 'user', 'spider', 'automated']).default('user') })) },
    limitations: ['阅读量序列自 2015-07-01；最新日期可能尚未入库，缺记录不能直接当成零。阅读次数不是独立读者数。'] },
  { id: 'ecosystems', label: 'Ecosyste.ms 公开软件包记录', type: 'rest', base_url: 'https://packages.ecosyste.ms/api/v1/', auth: { type: 'none' },
    access: free('https://docs.ecosyste.ms/docs/usage/authentication/', '公开匿名池限流；付费专属接口不在本连接器中'), limits: { min_interval_ms: 1000 },
    operations: { package: op('按 registry 与软件包名取得公开元数据', ['package-metadata'], z.strictObject({ registry, package: text.optional() })),
      versions: op('按 registry 与软件包名列出版本，保留分页', ['package-version'], z.strictObject({ registry, package: text.optional(), page })) },
    limitations: ['仅接公开 packages 服务；维护状态和依赖信息反映该服务最近同步结果，不等于本地安装环境。'] },
  { id: 'deps-dev', label: 'Google deps.dev 版本与依赖图', type: 'rest', base_url: 'https://api.deps.dev/v3/', auth: { type: 'none' },
    access: free('https://docs.deps.dev/api/v3/'), limits: { min_interval_ms: 250 },
    operations: { package: op('查询软件包及可用版本', ['package-metadata'], z.strictObject({ system, package: text.optional() })),
      version: op('查询特定版本的许可证、安全公告和来源关系', ['package-version'], z.strictObject({ system, package: text.optional(), version: text })),
      dependencies: op('查询特定版本由 deps.dev 解析的传递依赖图', ['dependency-graph'], z.strictObject({ system, package: text.optional(), version: text })) },
    limitations: ['依赖图由服务端按生态规则解析；不代表用户 lockfile 或运行时。历史版本查询不是任意历史时刻的图快照。'] },
  { id: 'ripestat', label: 'RIPEstat 网络归属与路由历史', type: 'rest', base_url: 'https://stat.ripe.net/data/', auth: { type: 'none' },
    access: free('https://stat.ripe.net/docs/data_api', '请求总量不限，最多 8 并发；长期超过 1000/天请登记 sourceapp 联系信息'), limits: { min_interval_ms: 250 },
    operations: { overview: op('按 ASN、前缀或 IP 读取网络概要', ['network-record'], z.strictObject({ resource: text.optional() })),
      'routing-history': op('按 ASN 或前缀及 since/until 查询路由历史', ['routing-history'], z.strictObject({ resource: text.optional() })) },
    limitations: ['历史范围由所选 endpoint 的 meta/availability 决定；不同观察点看到的 BGP 路由不等于所有网络的可达性。'] },
  { id: 'ooni', label: 'OONI 公开网络测量', type: 'rest', base_url: 'https://api.ooni.io/', auth: { type: 'none' },
    access: free('https://api.ooni.io/', '公开 API 供适度请求，批量消费应使用官方数据集'), limits: { min_interval_ms: 1000 },
    operations: { measurements: op('按域名、国家、ASN、测试及 since/until 查公开测量', ['network-measurement'], z.strictObject({ domain: text.optional(), country: z.string().regex(/^[A-Za-z]{2}$/).optional(), asn: z.string().regex(/^(?:AS)?\d+$/i).optional(), test: z.string().regex(/^[a-z][a-z0-9_]*$/).default('web_connectivity'), anomaly: z.boolean().optional(), confirmed: z.boolean().optional(), offset })) },
    limitations: ['异常、确认干扰与失败分别解释；探针覆盖不均，一次异常不能直接证明封锁。'] },
  { id: 'urlscan', label: 'urlscan 历史公开扫描', type: 'rest', base_url: 'https://urlscan.io/', auth: { type: 'api-key', header: 'api-key' },
    access: { authentication: 'optional', billing: 'free-quota', quota: '匿名小额度与免费账号日额度；以响应头和账户实际状态为准', evidence: 'https://docs.urlscan.io/pages/api-rate-limits' }, limits: { min_interval_ms: 1000 },
    operations: { search: op('仅搜索已有公开历史扫描，不提交新扫描任务', ['website-scan'], z.strictObject({ searchAfter: z.array(z.union([z.string(), z.number()])).length(2).optional() })) },
    limitations: ['仅查询当前身份可见的公开扫描；结果不证明目标当前状态。免费配额用尽后停止，付费独占数据不在本操作范围内。'] },
];

const definitions = new Map(infrastructureDefinitions.map(item => [item.id, item]));
function accepted(request: SearchRequest, target: string): boolean { return permitted(request.domains, new URL(target).hostname); }
function valueHit(source: string, url: string, title: string, value: unknown, type: string, id = url): SearchHit[] {
  return hit(source, { url, title, snippet: JSON.stringify(value), locator: { kind: 'record', id }, metadata: { record: value, contentType: type, contentScope: 'structured-record' } });
}
function dated(request: SearchRequest) {
  if (request.since || request.until) throw Object.assign(new Error('此操作不提供任意时间范围过滤；请使用有日期契约的操作'), { code: 'UNSUPPORTED_FILTER' });
}
function requireWindow(request: SearchRequest): [string, string] {
  if (!request.since || !request.until) throw Object.assign(new Error('本操作需要同时提供 since 和 until'), { code: 'BAD_INPUT' });
  if (request.since > request.until) throw new Error('since 不能晚于 until');
  return [request.since, request.until];
}
function captureTime(value: unknown): string | undefined {
  const s = string(value);
  return /^\d{14}$/.test(s) ? date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`) : undefined;
}
async function boundedBytes(result: Response, maximum: number): Promise<Buffer> {
  const reader = result.body?.getReader();
  if (!reader) throw new Error('响应没有可读取的正文');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > maximum) throw Object.assign(new Error('归档响应超过本次字节预算'), { code: 'RESPONSE_BUDGET' });
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function httpPayload(value: Buffer, headers: string): Buffer {
  if (/^Transfer-Encoding:.*chunked/im.test(headers) && /^[\da-f]+(?:;[^\r]*)?\r\n/i.test(value.subarray(0, 128).toString('ascii'))) {
    const chunks: Buffer[] = []; let position = 0;
    while (position < value.length) {
      const end = value.indexOf('\r\n', position), size = end >= 0 ? Number.parseInt(value.subarray(position, end).toString('ascii').split(';')[0]!, 16) : NaN;
      if (!Number.isSafeInteger(size) || size < 0 || end + 2 + size > value.length) throw new Error('WARC 中的 HTTP chunked 正文不完整');
      if (size === 0) break;
      chunks.push(value.subarray(end + 2, end + 2 + size)); position = end + size + 4;
    }
    value = Buffer.concat(chunks);
  }
  if (/^Content-Encoding:.*gzip/im.test(headers) && value[0] === 0x1f && value[1] === 0x8b) value = gunzipSync(value, { maxOutputLength: 16 * 1024 * 1024 });
  return value;
}

function commonCrawl(config: Config): Source {
  const definition = definitions.get('common-crawl')!, archive = connectorClient(sourceConfig(config, definition.id), { ...definition, base_url: 'https://data.commoncrawl.org/' });
  return createStructuredSource(config, definition, { search: { captures: async (request, params, client) => {
    const url = request.query.trim();
    if (!/^https?:\/\//i.test(url) && !/^[\w*.-]+(?::\d+)?(?:\/\S*)?$/.test(url)) throw new Error('Common Crawl 索引需要 URL 或域名模式');
    const from = request.since?.replaceAll('-', ''), to = request.until?.replaceAll('-', '');
    const body = await client(`${params.crawl}-index`, request.signal, { url, output: 'json', matchType: params.matchType, page: params.page, pageSize: 1, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(params.status ? { filter: `status:${params.status}` } : {}) }, undefined, 'text');
    const items = string(body).split(/\r?\n/).filter(Boolean).map(line => object(JSON.parse(line), 'Common Crawl CDX'));
    const selected = items.slice(params.resultOffset, params.resultOffset + request.limit), moreInPage = params.resultOffset + selected.length < items.length;
    reportCoverage(request, 'common-crawl-cdx-batch', { completeness: 'partial', truncated: moreInPage || items.length > 0, ...(items.length ? { nextCursor: JSON.stringify(moreInPage ? { page: params.page, resultOffset: params.resultOffset + selected.length } : { page: params.page + 1, resultOffset: 0 }) } : {}), limitations: definition.limitations });
    return selected.flatMap(item => {
      const filename = string(item.filename), length = Number(item.length), start = Number(item.offset), original = string(item.url);
      if (!filename.startsWith('crawl-data/') || !Number.isSafeInteger(length) || length < 1 || !Number.isSafeInteger(start) || start < 0) return [];
      if (!accepted(request, original)) return [];
      const target = new URL(filename, 'https://data.commoncrawl.org/');
      for (const [key, value] of Object.entries({ offset: start, length, original, timestamp: string(item.timestamp), crawl: params.crawl })) target.searchParams.set(key, String(value));
      return hit('common-crawl', { title: original, url: target.href, snippet: `${item.timestamp} · HTTP ${item.status} · ${item.mime}`, locator: { kind: 'record', id: `${filename}:${start}`, parentUrl: original, occurredAt: captureTime(item.timestamp) }, metadata: { record: item, contentType: 'web-capture', originalUrl: original, captureAt: captureTime(item.timestamp), crawl: params.crawl } });
    });
  } }, read: async (url, signal, options) => {
    const parsed = new URL(url), filename = parsed.pathname.slice(1), start = Number(parsed.searchParams.get('offset')), length = Number(parsed.searchParams.get('length'));
    if (parsed.hostname !== 'data.commoncrawl.org' || !/^crawl-data\/[\w./-]+\.warc\.gz$/.test(filename) || filename.split('/').includes('..') || !parsed.searchParams.has('offset') || !parsed.searchParams.has('length') || !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 1 || length > 8 * 1024 * 1024) throw new Error('Common Crawl 读取需要索引返回的有界 WARC 记录链接');
    const result: Response = await archive(filename, signal, {}, undefined, 'response', { Range: `bytes=${start}-${start + length - 1}`, Accept: 'application/octet-stream' });
    const range = result.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\//);
    if (result.status !== 206 || !range || Number(range[1]) !== start || Number(range[2]) !== start + length - 1) { await result.body?.cancel(); throw Object.assign(new Error('WARC 服务未返回请求的 Range，本次保留索引而不下载整个归档'), { code: 'RANGE_UNSUPPORTED' }); }
    const bytes = gunzipSync(await boundedBytes(result, length), { maxOutputLength: 16 * 1024 * 1024 });
    const separator = Buffer.from('\r\n\r\n'), warcEnd = bytes.indexOf(separator), httpStart = warcEnd + separator.length, httpEnd = bytes.indexOf(separator, httpStart);
    if (warcEnd < 0 || httpEnd < 0 || !bytes.subarray(0, warcEnd).toString().startsWith('WARC/') || !bytes.subarray(httpStart, httpStart + 5).equals(Buffer.from('HTTP/'))) throw new Error('归档记录缺少 WARC／HTTP 响应边界');
    const warcHeaders = bytes.subarray(0, warcEnd).toString('utf8'), httpHeaders = bytes.subarray(httpStart, httpEnd).toString('utf8');
    const original = warcHeaders.match(/^WARC-Target-URI:\s*(.+)$/im)?.[1]?.trim() || parsed.searchParams.get('original') || url;
    const mime = httpHeaders.match(/^Content-Type:\s*([^\r\n]+)/im)?.[1] ?? '', charset = mime.match(/charset=["']?([\w.-]+)/i)?.[1] ?? 'utf-8';
    if (mime && !/text\/|json|xml|javascript/i.test(mime)) throw new Error('WARC 记录为二进制资源，请选择文本或网页记录');
    const payload = httpPayload(bytes.subarray(httpEnd + separator.length), httpHeaders);
    let decoder: TextDecoder; try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder('utf-8'); }
    const raw = decoder.decode(payload).replace(/\r\n$/, '');
    const content = /html/i.test(mime) && !options?.raw ? htmlText(raw, original) : raw;
    const captureAt = date(warcHeaders.match(/^WARC-Date:\s*(.+)$/im)?.[1]);
    return document('common-crawl', url, raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || original, content, { locator: { kind: 'record', id: `${filename}:${start}`, parentUrl: original, occurredAt: captureAt }, metadata: { contentType: 'web-capture', originalUrl: original, captureAt, contentScope: 'archived-http-response', format: options?.raw ? 'warc-html' : 'warc-text', httpStatus: Number(httpHeaders.match(/^HTTP\/\S+\s+(\d+)/)?.[1]), crawl: parsed.searchParams.get('crawl'), offset: start, compressedLength: length } });
  } });
}

interface ScanOptions { skipEvents: number; maxEvents: number; maxCompressedBytes: number; maxExpandedBytes: number }
async function scanEvents(result: Response, signal: AbortSignal, settings: ScanOptions, accept: (item: Row, line: number) => boolean, limit: number) {
  if (!result.body) throw new Error('GH Archive 响应没有事件文件');
  const input = Readable.fromWeb(result.body as import('node:stream/web').ReadableStream<Uint8Array>);
  let compressed = 0, expanded = 0, lineNo = 0, scanned = 0, invalid = 0, pending = '', stopped = false, ended = false;
  const found: { item: Row; line: number }[] = [];
  const budget = () => Object.assign(new Error('已达到本次归档扫描预算'), { code: 'ARCHIVE_BUDGET' });
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) { compressed += chunk.length; callback(compressed > settings.maxCompressedBytes ? budget() : null, chunk); } });
  const unzip = createGunzip();
  input.on('error', error => unzip.destroy(error)); meter.on('error', error => unzip.destroy(error));
  input.pipe(meter).pipe(unzip);
  const decode = new TextDecoder();
  const consume = (line: string) => {
    if (!line.trim()) return;
    lineNo++;
    if (lineNo <= settings.skipEvents) return;
    scanned++;
    try { const item = object(JSON.parse(line), 'GH Archive event'); if (accept(item, lineNo)) found.push({ item, line: lineNo }); }
    catch { invalid++; }
    if (found.length >= limit || scanned >= settings.maxEvents) stopped = true;
  };
  try {
    for await (const chunk of unzip) {
      signal.throwIfAborted();
      const remaining = Math.max(0, settings.maxExpandedBytes - expanded), prefix = chunk.subarray(0, remaining);
      expanded += prefix.length;
      pending += decode.decode(prefix, { stream: true });
      if (pending.length > 4 * 1024 * 1024 && !pending.includes('\n')) { stopped = true; break; }
      let stop: number;
      while ((stop = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, stop); pending = pending.slice(stop + 1); consume(line);
        if (stopped) break;
      }
      if (stopped) break;
      if (prefix.length < chunk.length) { stopped = true; break; }
    }
    if (!stopped) { pending += decode.decode(); if (pending.trim()) consume(pending); ended = !stopped; }
  } catch (error) {
    if (['ARCHIVE_BUDGET', 'RESPONSE_BUDGET'].includes((error as { code?: string }).code ?? '')) stopped = true;
    else throw error;
  } finally { input.destroy(); meter.destroy(); unzip.destroy(); }
  return { found, scanned, invalid, lineNo, compressed, expanded, truncated: !ended };
}
function validHour(value: string): string {
  const parts = value.split('-'), day = parts.slice(0, 3).join('-'), h = Number(parts[3]), at = new Date(`${day}T${String(h).padStart(2, '0')}:00:00Z`);
  if (!Number.isFinite(at.getTime()) || h < 0 || h > 23 || at.toISOString().slice(0, 10) !== day) throw new Error('GH Archive 小时需要有效的 YYYY-MM-DD-H（UTC）');
  return `${day}-${h}`;
}
function ghArchive(config: Config): Source {
  const definition = definitions.get('gh-archive')!, recent = new Map<string, ReturnType<typeof document>>();
  const eventDocument = (url: string, value: Row, line: number, name: string) => document('gh-archive', url, `${string(object(value.repo, 'GH Archive repo').name)} · ${value.type}`, JSON.stringify(value, null, 2), {
    contentKind: 'metadata', publishedAt: date(value.created_at), locator: { kind: 'event', id: string(value.id), occurredAt: date(value.created_at), parentUrl: `https://github.com/${string(object(value.repo, 'GH Archive repo').name)}` }, metadata: { contentType: 'github-event', hour: name, line, contentScope: 'archived-public-event' },
  });
  return createStructuredSource(config, definition, { search: { events: async (request, params, client) => {
    recent.clear();
    const name = validHour(params.hour), repository = params.repository ?? (/^[\w.-]+\/[\w.-]+$/.test(request.query) ? request.query : undefined);
    if (!repository && !params.eventTypes?.length) throw new Error('GH Archive 需要 repository 或 eventTypes，不能全库盲扫');
    const hourDate = name.slice(0, 10);
    if (request.since && hourDate < request.since || request.until && hourDate > request.until) throw new Error('指定小时不在 since/until 范围内');
    const result: Response = await client(`${name}.json.gz`, request.signal, {}, undefined, 'response', { Accept: 'application/gzip' });
    const scanned = await scanEvents(result, request.signal, params as ScanOptions, item => (!repository || string(object(item.repo, 'GH Archive repo').name).toLowerCase() === repository.toLowerCase()) && (!params.eventTypes?.length || params.eventTypes.includes(string(item.type))), request.limit);
    const progressed = scanned.lineNo > params.skipEvents;
    reportCoverage(request, `gh-archive:${name}`, { completeness: scanned.truncated || scanned.invalid ? 'partial' : 'complete', truncated: scanned.truncated, ...(scanned.truncated && progressed ? { nextCursor: String(scanned.lineNo) } : {}), observed: { since: `${hourDate}T${String(Number(name.split('-')[3])).padStart(2, '0')}:00:00Z`, until: `${hourDate}T${String(Number(name.split('-')[3])).padStart(2, '0')}:59:59Z` }, limitations: [...definition.limitations!, `本次读取 ${scanned.compressed} 压缩字节，检查 ${scanned.scanned} 条事件；无效 JSON ${scanned.invalid} 条。`, ...(scanned.truncated && !progressed ? [`本次预算尚未取得下一条完整事件；提高字节预算后，从 skipEvents=${params.skipEvents} 重试。`] : [])] });
    return scanned.found.flatMap(({ item, line }) => {
      const id = string(item.id), repo = string(object(item.repo, 'GH Archive repo').name), target = new URL(`${name}.json.gz`, definition.base_url);
      target.searchParams.set('event', id); target.searchParams.set('line', String(line));
      if (!id || !accepted(request, `https://github.com/${repo}`)) return [];
      recent.set(target.href, eventDocument(target.href, item, line, name));
      return hit('gh-archive', { url: target.href, title: `${repo} · ${item.type}`, snippet: JSON.stringify(item.payload ?? {}), publishedAt: date(item.created_at), locator: { kind: 'event', id, occurredAt: date(item.created_at), parentUrl: `https://github.com/${repo}` }, metadata: { record: item, contentType: 'github-event', hour: name, line, contentScope: 'archived-public-event' } });
    });
  } }, read: async (url, signal, _options, client) => {
    const parsed = new URL(url), name = parsed.pathname.match(/^\/(\d{4}-\d{2}-\d{2}-\d{1,2})\.json\.gz$/)?.[1], id = parsed.searchParams.get('event'), line = Number(parsed.searchParams.get('line'));
    if (parsed.hostname !== 'data.gharchive.org' || !name || !id || !Number.isSafeInteger(line) || line < 1 || line > 1000000) throw new Error('GH Archive 读取需要检索返回的事件归档链接');
    const cached = recent.get(parsed.href);
    if (cached?.locator?.id === id) return cached;
    const result: Response = await client(`${validHour(name)}.json.gz`, signal, {}, undefined, 'response');
    const scanned = await scanEvents(result, signal, { skipEvents: line - 1, maxEvents: 1, maxCompressedBytes: 32 * 1024 * 1024, maxExpandedBytes: 128 * 1024 * 1024 }, item => string(item.id) === id, 1), value = scanned.found[0]?.item;
    if (!value) throw Object.assign(new Error(scanned.truncated ? '事件尚未在读取预算内取得，请保留检索结果并缩小小时范围' : '归档未找到指定事件'), { code: scanned.truncated ? 'ARCHIVE_BUDGET' : 'NOT_FOUND' });
    return eventDocument(url, value, line, name);
  } });
}

function wikiAnalytics(config: Config): Source {
  const definition = definitions.get('wikimedia-analytics')!;
  const hooks: ConnectorHooks = { search: {}, read: async (url, signal, _options, client) => {
    const parsed = new URL(url);
    if (parsed.hostname !== 'wikimedia.org' || !/^\/api\/rest_v1\/metrics\/pageviews\/(?:per-article|aggregate)\//.test(parsed.pathname)) throw new Error('Wikimedia Analytics 读取需要本连接器返回的阅读量 API 链接');
    const value = await client(parsed.pathname.slice('/api/rest_v1/'.length), signal);
    return document(definition.id, url, 'Wikimedia 阅读量序列', JSON.stringify(value, null, 2), { contentKind: 'metadata', locator: { kind: 'record', id: parsed.href }, metadata: { contentType: 'pageview-timeseries', contentScope: 'selected-pageview-series' } });
  } };
  for (const operation of ['pageviews', 'project-views']) hooks.search![operation] = async (request, params, client) => {
    const [since, until] = requireWindow(request);
    if (since < '2015-07-01') throw new Error('此阅读量口径自 2015-07-01 起可用，请调整 since');
    const article = params.article ?? request.query;
    const path = `metrics/pageviews/${operation === 'pageviews' ? 'per-article' : 'aggregate'}/${encodeURIComponent(params.project)}/${params.access}/${params.agent}/${operation === 'pageviews' ? encodeURIComponent(article.replaceAll(' ', '_')) + '/' : ''}${params.granularity}/${since.replaceAll('-', '')}00/${until.replaceAll('-', '')}00`;
    const value = await client(path, request.signal), items = rows(object(value, 'Wikimedia').items, 'Wikimedia 时间序列'), target = new URL(path, definition.base_url).href;
    reportCoverage(request, 'wikimedia-selected-time-series', { completeness: 'partial', truncated: false, observed: { since: items.length ? captureTime(string(items[0]!.timestamp).padEnd(14, '0')) : undefined, until: items.length ? captureTime(string(items.at(-1)!.timestamp).padEnd(14, '0')) : undefined }, limitations: definition.limitations });
    return accepted(request, 'https://wikimedia.org/') ? valueHit(definition.id, target, `${params.project} · ${operation === 'pageviews' ? article : '项目阅读量'}`, value, 'pageview-timeseries') : [];
  };
  return createStructuredSource(config, definition, hooks);
}

function ecosystem(config: Config): Source {
  const definition = definitions.get('ecosystems')!, hooks: ConnectorHooks = { search: {}, read: async (url, signal, _options, client) => {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/api\/v1\/registries\/([\w.-]+)\/packages\/([^/]+)(?:\/versions\/([^/]+))?$/);
    if (parsed.hostname !== 'packages.ecosyste.ms' || !match) throw new Error('Ecosyste.ms 读取需要公开 packages API 记录链接');
    const value = await client(parsed.pathname.slice('/api/v1/'.length), signal, Object.fromEntries(parsed.searchParams));
    const version = match[3] ? string(object(value, 'Ecosyste.ms 版本').number) || decodeURIComponent(match[3]) : '';
    return document(definition.id, url, 'Ecosyste.ms 软件包记录', JSON.stringify(value, null, 2), { contentKind: 'metadata', locator: { kind: 'record', id: `${decodeURIComponent(match[1]!)}:${decodeURIComponent(match[2]!)}:${version}` }, metadata: { contentType: match[3] ? 'package-version' : 'package-metadata', contentScope: 'public-package-service' } });
  } };
  for (const operation of ['package', 'versions']) hooks.search![operation] = async (request, params, client) => {
    dated(request); const name = params.package ?? request.query;
    const path = `registries/${encodeURIComponent(params.registry)}/packages/${encodeURIComponent(name)}${operation === 'versions' ? '/versions' : ''}`, query = operation === 'versions' ? { page: params.page, per_page: request.limit } : {};
    const value = await client(path, request.signal, query), values = operation === 'versions' ? rows(value, 'Ecosyste.ms 版本') : [object(value, 'Ecosyste.ms 软件包')];
    reportCoverage(request, `ecosystems:${operation}`, { completeness: 'partial', truncated: operation === 'versions' && values.length >= request.limit, ...(operation === 'versions' && values.length >= request.limit ? { nextCursor: String(params.page + 1) } : {}), limitations: definition.limitations });
    return values.slice(0, request.limit).flatMap(item => {
      const version = string(item.number), target = new URL(path + (operation === 'versions' && version ? '/' + encodeURIComponent(version) : ''), definition.base_url).href;
      if (!accepted(request, target)) return [];
      return valueHit(definition.id, target, `${name}${version ? '@' + version : ''}`, item, operation === 'versions' ? 'package-version' : 'package-metadata', `${params.registry}:${name}:${version}`);
    });
  };
  return createStructuredSource(config, definition, hooks);
}

function depsDev(config: Config): Source {
  const definition = definitions.get('deps-dev')!, hooks: ConnectorHooks = { search: {}, read: async (url, signal, _options, client) => {
    const parsed = new URL(url);
    if (parsed.hostname !== 'api.deps.dev' || !/^\/v3\/systems\/[a-z]+\/packages\/[^/]+(?:\/versions\/[^/]+(?::dependencies)?)?$/.test(parsed.pathname)) throw new Error('deps.dev 读取需要软件包、版本或依赖图 API 链接');
    const value = await client(parsed.pathname.slice('/v3/'.length), signal);
    return document(definition.id, url, 'deps.dev 软件依赖记录', JSON.stringify(value, null, 2), { contentKind: 'metadata', locator: { kind: 'record', id: parsed.href }, metadata: { contentType: parsed.pathname.endsWith(':dependencies') ? 'dependency-graph' : parsed.pathname.includes('/versions/') ? 'package-version' : 'package-metadata', contentScope: 'resolved-package-record' } });
  } };
  for (const operation of ['package', 'version', 'dependencies']) hooks.search![operation] = async (request, params, client) => {
    dated(request); const name = params.package ?? request.query;
    const path = `systems/${params.system}/packages/${encodeURIComponent(name)}${operation === 'package' ? '' : `/versions/${encodeURIComponent(params.version)}${operation === 'dependencies' ? ':dependencies' : ''}`}`;
    const value = await client(path, request.signal), target = new URL(path, definition.base_url).href;
    reportCoverage(request, `deps-dev:${operation}`, { completeness: 'partial', truncated: false, limitations: definition.limitations });
    return accepted(request, target) ? valueHit(definition.id, target, `${params.system}:${name}${params.version ? '@' + params.version : ''} · ${operation}`, value, operation === 'dependencies' ? 'dependency-graph' : operation === 'version' ? 'package-version' : 'package-metadata') : [];
  };
  return createStructuredSource(config, definition, hooks);
}

function ripeStat(config: Config): Source {
  const definition = definitions.get('ripestat')!, hooks: ConnectorHooks = { search: {}, read: async (url, signal, _options, client) => {
    const parsed = new URL(url);
    if (parsed.hostname !== 'stat.ripe.net' || !/^\/data\/(?:as-overview|prefix-overview|network-info|routing-history)\/data\.json$/.test(parsed.pathname)) throw new Error('RIPEstat 读取需要概要或路由历史 API 链接');
    const value = await client(parsed.pathname.slice('/data/'.length), signal, Object.fromEntries(parsed.searchParams));
    if (value.status !== 'ok') throw new Error(`RIPEstat 查询失败：${JSON.stringify(value.messages ?? value.status)}`);
    return document(definition.id, url, `RIPEstat ${parsed.searchParams.get('resource')}`, JSON.stringify(value, null, 2), { contentKind: 'metadata', locator: { kind: 'record', id: parsed.href }, metadata: { contentType: parsed.pathname.includes('routing-history') ? 'routing-history' : 'network-record', contentScope: 'observed-network-data', dataVersion: value.version, queryTime: value.query_time } });
  } };
  for (const operation of ['overview', 'routing-history']) hooks.search![operation] = async (request, params, client) => {
    const resource = params.resource ?? request.query;
    if (!/^(?:AS\d+|[a-f\d:.]+(?:\/\d{1,3})?)$/i.test(resource)) throw new Error('RIPEstat 需要 ASN、IP 或网络前缀');
    if (operation === 'overview') dated(request);
    const endpoint = operation === 'routing-history' ? operation : /^AS\d+$/i.test(resource) ? 'as-overview' : resource.includes('/') ? 'prefix-overview' : 'network-info';
    const query = { resource, sourceapp: 'sera-search', ...(request.since ? { starttime: request.since + 'T00:00:00' } : {}), ...(request.until ? { endtime: request.until + 'T23:59:59' } : {}) };
    const value = await client(`${endpoint}/data.json`, request.signal, query);
    if (value.status !== 'ok') throw new Error(`RIPEstat 查询失败：${JSON.stringify(value.messages ?? value.status)}`);
    const target = new URL(`${endpoint}/data.json`, definition.base_url); for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
    reportCoverage(request, `ripestat:${endpoint}`, { completeness: 'partial', truncated: false, limitations: definition.limitations });
    return accepted(request, target.href) ? valueHit(definition.id, target.href, `${resource} · ${endpoint}`, value, operation === 'routing-history' ? 'routing-history' : 'network-record') : [];
  };
  return createStructuredSource(config, definition, hooks);
}

function ooni(config: Config): Source {
  const definition = definitions.get('ooni')!;
  return createStructuredSource(config, definition, { search: { measurements: async (request, params, client) => {
    const domain = params.domain ?? (/^https?:\/\//i.test(request.query) ? new URL(request.query).hostname : /^[\w.-]+\.[a-z]{2,}$/i.test(request.query) ? request.query : undefined);
    if (!domain && !params.country && !params.asn) throw new Error('OONI 需要域名、国家或 ASN；query 可以直接填域名');
    const query = { domain, probe_cc: params.country?.toUpperCase(), probe_asn: params.asn ? `AS${String(params.asn).replace(/^AS/i, '')}` : undefined, test_name: params.test, anomaly: params.anomaly, confirmed: params.confirmed, offset: params.offset, limit: request.limit, since: request.since ? request.since + 'T00:00:00Z' : undefined, until: request.until ? request.until + 'T23:59:59Z' : undefined };
    const value = await client('api/v1/measurements', request.signal, query), items = rows(value.results, 'OONI measurements'), metadata = value.metadata && typeof value.metadata === 'object' ? value.metadata as Row : {};
    const more = Boolean(metadata.next_url) || items.length >= request.limit;
    reportCoverage(request, 'ooni-public-measurements', { completeness: 'partial', truncated: more, ...(more ? { nextCursor: String(params.offset + items.length) } : {}), limitations: definition.limitations });
    return items.flatMap(item => {
      const id = string(item.measurement_uid), target = `https://api.ooni.io/api/v1/measurement/${encodeURIComponent(id)}`;
      if (!id || !accepted(request, target)) return [];
      return hit(definition.id, { url: target, title: `${string(item.input) || domain || params.country} · ${item.test_name}`, snippet: JSON.stringify({ anomaly: item.anomaly, confirmed: item.confirmed, failure: item.failure, country: item.probe_cc, asn: item.probe_asn }), publishedAt: date(item.measurement_start_time), locator: { kind: 'event', id, occurredAt: date(item.measurement_start_time) }, metadata: { record: item, contentType: 'network-measurement', contentScope: 'public-probe-measurement' } });
    });
  } }, read: async (url, signal, _options, client) => {
    const parsed = new URL(url), id = parsed.pathname.match(/^\/api\/v1\/measurement\/([^/]+)\/?$/)?.[1];
    if (parsed.hostname !== 'api.ooni.io' || !id) throw new Error('OONI 读取需要 measurement UID API 链接');
    const value = await client(`api/v1/measurement/${id}`, signal);
    return document(definition.id, url, `OONI ${decodeURIComponent(id)}`, JSON.stringify(value, null, 2), { contentKind: 'metadata', publishedAt: date(value.measurement_start_time), locator: { kind: 'event', id: decodeURIComponent(id), occurredAt: date(value.measurement_start_time) }, metadata: { contentType: 'network-measurement', contentScope: 'raw-network-measurement', testName: value.test_name, country: value.probe_cc, asn: value.probe_asn } });
  } });
}

function urlScan(config: Config): Source {
  const definition = definitions.get('urlscan')!;
  return createStructuredSource(config, definition, { search: { search: async (request, params, client) => {
    const query = `${request.query}${request.since || request.until ? ` AND date:[${request.since ?? '*'} TO ${request.until ? request.until + 'T23:59:59Z' : '*'}]` : ''}`;
    const value = await client('api/v1/search/', request.signal, { q: query, size: request.limit, ...(params.searchAfter ? { search_after: params.searchAfter.join(',') } : {}) });
    const items = rows(value.results, 'urlscan 搜索'), sort = items.at(-1)?.sort, more = value.has_more === true;
    reportCoverage(request, 'urlscan-public-historical-scans', { completeness: 'partial', truncated: more, ...(more && Array.isArray(sort) ? { nextCursor: JSON.stringify(sort) } : {}), limitations: definition.limitations });
    return items.flatMap(item => {
      const task = object(item.task, 'urlscan task'), page = item.page && typeof item.page === 'object' ? item.page as Row : {}, id = string(item._id) || string(task.uuid), target = `https://urlscan.io/result/${encodeURIComponent(id)}/`;
      if (!id || !accepted(request, string(page.url) || string(task.url) || target)) return [];
      return hit(definition.id, { url: target, title: string(page.title) || string(task.url) || id, snippet: JSON.stringify({ page, stats: item.stats }), publishedAt: date(task.time), locator: { kind: 'record', id, parentUrl: string(task.url) || undefined }, metadata: { record: item, contentType: 'website-scan', originalUrl: task.url, contentScope: 'historical-public-scan' } });
    });
  } }, read: async (url, signal, _options, client) => {
    const parsed = new URL(url), id = parsed.pathname.match(/^\/(?:result|api\/v1\/result)\/([\da-f-]{36})\/?$/i)?.[1];
    if (parsed.hostname !== 'urlscan.io' || !id) throw new Error('urlscan 读取需要公开结果 UUID 链接');
    const value = await client(`api/v1/result/${id}/`, signal), task = object(value.task, 'urlscan task');
    return document(definition.id, `https://urlscan.io/result/${id}/`, string(task.url) || id, JSON.stringify(value, null, 2), { contentKind: 'metadata', publishedAt: date(task.time), locator: { kind: 'record', id, parentUrl: string(task.url) || undefined }, metadata: { contentType: 'website-scan', originalUrl: task.url, contentScope: 'historical-public-scan' } });
  } });
}

export function createInfrastructureSources(config: Config): Source[] {
  return [commonCrawl(config), ghArchive(config), wikiAnalytics(config), ecosystem(config), depsDev(config), ripeStat(config), ooni(config), urlScan(config)];
}
