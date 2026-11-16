import { z } from 'zod';
import type { ApiConfig, Capability, Config, SearchRequest, Source, SourceName, SourceOperation } from '../types.js';
import { date, document, endpoint, hit, json, object, permitted, plain, response, rows, string } from './shared.js';
import type { Row } from './shared.js';
import { describeOperation, reportCoverage, selectOperation } from './operations.js';

const headers = { 'User-Agent': 'SERA research-client', Accept: 'application/json' };
const page = z.number().int().min(1).max(10000).default(1);
const cursor = z.number().int().min(0).default(0);
const identifier = z.string().trim().min(1).max(512);

function capability(name: SourceName, config: ApiConfig, operations: SourceOperation[], limitations: string[], category: Capability['category'] = 'academic'): Capability {
  return { name, search: true, read: true, configured: config.enabled !== false, category, requiresLogin: false, loggedIn: true,
    accessMethod: 'api', platforms: operations.map(item => item.name), operations, contentTypes: [...new Set(operations.flatMap(item => item.contentTypes))], limitations };
}

function selected(request: SearchRequest, operations: SourceOperation[]): string {
  return selectOperation({ ...request, operation: request.operation ?? request.platform }, operations);
}

function accepted(request: SearchRequest, url: string): boolean { return permitted(request.domains, new URL(url).hostname); }
function encodedPath(value: string): string { return value.split('/').map(encodeURIComponent).join('/'); }
function bearer(config: ApiConfig) { return { ...headers, ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }; }
function unsupportedDates(request: SearchRequest, reason: string) {
  if (request.since || request.until) throw Object.assign(new Error(reason), { code: 'UNSUPPORTED_FILTER' });
}
function inWindow(value: string | undefined, request: SearchRequest): boolean {
  return (!request.since || Boolean(value && value.slice(0, 10) >= request.since)) && (!request.until || Boolean(value && value.slice(0, 10) <= request.until));
}
function numericId(value: unknown): string { return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : string(value); }

function semanticScholar(config: ApiConfig): Source {
  const schema = z.strictObject({ offset: cursor, minCitationCount: z.number().int().nonnegative().optional() });
  const operations = [describeOperation('papers', '论文标题、摘要与引用计数检索；日期按论文发表日期筛选', ['paper'], schema)];
  const fields = 'paperId,title,abstract,url,year,publicationDate,authors,citationCount,openAccessPdf,externalIds';
  const auth = { ...headers, ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}) };
  return {
    capability: capability('semantic-scholar', config, operations, ['共享匿名额度可能限流；书目和摘要不等于论文全文。']),
    async search(request) {
      selected(request, operations);
      const params = schema.parse(request.params ?? {}), url = endpoint(config, 'https://api.semanticscholar.org/graph/v1/', 'paper/search');
      url.searchParams.set('query', request.query); url.searchParams.set('limit', String(request.limit)); url.searchParams.set('offset', String(params.offset)); url.searchParams.set('fields', fields);
      if (params.minCitationCount !== undefined) url.searchParams.set('minCitationCount', String(params.minCitationCount));
      if (request.since || request.until) url.searchParams.set('publicationDateOrYear', `${request.since ?? ''}:${request.until ?? ''}`);
      const result = await json(url, { headers: auth, signal: request.signal }, 'Semantic Scholar');
      const values = rows(result.data, 'Semantic Scholar');
      reportCoverage(request, 'semantic-scholar-paper-search', { completeness: 'partial', truncated: typeof result.next === 'number', ...(typeof result.next === 'number' ? { nextCursor: String(result.next) } : {}), limitations: ['结果来自当前论文索引；未返回的记录不能据此判为不存在。'] });
      return values.flatMap(item => {
        const id = string(item.paperId), target = string(item.url) || `https://www.semanticscholar.org/paper/${id}`;
        if (!id || !accepted(request, target)) return [];
        return hit('semantic-scholar', { title: string(item.title), url: target, snippet: string(item.abstract), publishedAt: date(item.publicationDate), locator: { kind: 'record', id }, metadata: { ...item, contentType: 'paper', contentScope: 'bibliography-and-abstract' } });
      });
    },
    async read(url, signal) {
      const parsed = new URL(url);
      const id = ['doi.org', 'dx.doi.org'].includes(parsed.hostname) ? `DOI:${decodeURIComponent(parsed.pathname.slice(1))}`
        : parsed.hostname.replace(/^www\./, '') === 'semanticscholar.org' ? parsed.pathname.split('/').filter(Boolean).at(-1) : undefined;
      if (!id || !(id.startsWith('DOI:') || /^[a-f\d]{40}$/i.test(id))) throw new Error('Semantic Scholar 读取需要论文记录或 DOI 链接');
      const address = endpoint(config, 'https://api.semanticscholar.org/graph/v1/', `paper/${encodeURIComponent(id)}`); address.searchParams.set('fields', fields);
      const value = await json(address, { headers: auth, signal }, 'Semantic Scholar 论文');
      if (!string(value.paperId)) throw new Error('Semantic Scholar 未返回论文记录');
      return document('semantic-scholar', string(value.url) || url, string(value.title), JSON.stringify(value, null, 2), { contentKind: 'metadata', publishedAt: date(value.publicationDate), locator: { kind: 'record', id: string(value.paperId) }, metadata: { contentType: 'paper', contentScope: 'bibliography-and-abstract', openAccessPdf: value.openAccessPdf } });
    },
  };
}

function noteValue(content: Row, key: string): unknown {
  const value = content[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row).value : value;
}
function noteTime(note: Row): string | undefined {
  const value = note.cdate ?? note.tcdate;
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : undefined;
}
function openReview(config: ApiConfig): Source {
  const papers = z.strictObject({ offset: cursor, group: identifier.optional() });
  const forum = z.strictObject({ forumId: identifier.optional(), offset: cursor });
  const operations = [describeOperation('papers', '搜索公开论文记录和摘要', ['paper'], papers), describeOperation('forum', '按 forum ID 读取公开评审、作者回复和讨论', ['paper', 'review'], forum)];
  const auth = bearer(config);
  const get = (path: string, params: Record<string, string>, signal: AbortSignal) => {
    const url = endpoint(config, 'https://api2.openreview.net/', path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return json(url, { headers: auth, signal }, 'OpenReview');
  };
  return {
    capability: capability('openreview', config, operations, ['仅返回当前身份可读取的 notes；日期在当前返回页按 note 发布或创建时间过滤。']),
    async search(request) {
      const operation = selected(request, operations), params = operation === 'papers' ? papers.parse(request.params ?? {}) : forum.parse(request.params ?? {});
      const forumId = 'forumId' in params ? params.forumId ?? request.query : undefined;
      const result = await get(operation === 'papers' ? 'notes/search' : 'notes', { ...(operation === 'papers' ? { term: request.query, source: 'forum', ...('group' in params && params.group ? { group: params.group } : {}) } : { forum: forumId! }), limit: String(request.limit), offset: String(params.offset) }, request.signal);
      const values = rows(result.notes, 'OpenReview notes'), total = typeof result.count === 'number' ? result.count : undefined;
      const more = total !== undefined ? params.offset + values.length < total : values.length >= request.limit;
      reportCoverage(request, operation === 'papers' ? 'openreview-public-notes' : 'openreview-public-forum', { completeness: 'partial', truncated: more, ...(more ? { nextCursor: String(params.offset + values.length) } : {}), limitations: ['公开可见范围不代表会议的全部评审；日期筛选只检查当前页。'] });
      return values.filter(item => inWindow(noteTime(item), request)).flatMap(item => {
        const id = string(item.id), content = object(item.content, 'OpenReview note 内容'), target = `https://openreview.net/forum?id=${encodeURIComponent(string(item.forum) || id)}&noteId=${encodeURIComponent(id)}`;
        if (!id || !accepted(request, target)) return [];
        return hit('openreview', { title: string(noteValue(content, 'title')) || string(noteValue(content, 'summary')) || id, url: target,
          snippet: plain(noteValue(content, 'abstract')) || plain(noteValue(content, 'review')) || plain(noteValue(content, 'comment')), publishedAt: noteTime(item), locator: { kind: 'record', id, parentUrl: `https://openreview.net/forum?id=${encodeURIComponent(string(item.forum) || id)}` }, metadata: { noteId: id, forumId: item.forum, replyTo: item.replyto, contentType: item.replyto ? 'review' : 'paper', content: item.content, signatures: item.signatures } });
      });
    },
    async read(url, signal) {
      const parsed = new URL(url), id = parsed.searchParams.get('noteId') ?? parsed.searchParams.get('id');
      if (parsed.hostname.replace(/^www\./, '') !== 'openreview.net' || !id) throw new Error('OpenReview 读取需要带 id 的 note 或 forum 链接');
      const result = await get('notes', { id }, signal), note = rows(result.notes, 'OpenReview note')[0];
      if (!note) throw new Error('OpenReview note 不存在或当前身份不可见');
      const content = object(note.content, 'OpenReview 内容'), forumId = string(note.forum) || id;
      const replies = await get('notes', { forum: forumId, limit: '100', offset: '0' }, signal);
      return document('openreview', url, string(noteValue(content, 'title')) || id, JSON.stringify({ note, forum: replies }, null, 2), { contentKind: 'metadata', publishedAt: noteTime(note), locator: { kind: 'record', id }, metadata: { contentType: note.replyto ? 'review' : 'paper', contentScope: 'note-and-first-100-public-forum-notes', forumId, truncated: typeof replies.count === 'number' ? replies.count > 100 : rows(replies.notes, 'OpenReview forum').length >= 100 } });
    },
  };
}

function huggingFace(config: ApiConfig): Source {
  const schema = z.strictObject({ author: identifier.optional(), filter: identifier.optional(), sort: z.enum(['lastModified', 'likes', 'downloads']).optional(), cursor: identifier.optional() });
  const operations = ['models', 'datasets', 'spaces'].map(name => describeOperation(name, `按名称、作者和标签查询 Hub ${name} 仓库`, [name === 'models' ? 'model' : name === 'datasets' ? 'dataset' : 'space'], schema));
  const auth = bearer(config);
  return {
    capability: capability('huggingface', config, operations, ['仅包含当前可见仓库；文件清单与模型卡声明需要结合版本核对。'], 'catalog'),
    async search(request) {
      const operation = selected(request, operations), params = schema.parse(request.params ?? {});
      unsupportedDates(request, 'Hugging Face 仓库修改时间不是论文或模型发布日期；请使用 sort=lastModified 并核对版本');
      const url = endpoint(config, 'https://huggingface.co/', `api/${operation}`);
      for (const [key, value] of Object.entries({ search: request.query, limit: request.limit, ...params })) if (value !== undefined) url.searchParams.set(key, String(value));
      const result = await response(url, { headers: auth, signal: request.signal }, 'Hugging Face');
      const values = rows(await result.json(), 'Hugging Face 仓库');
      const link = result.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1], next = link ? new URL(link).searchParams.get('cursor') : undefined;
      reportCoverage(request, `huggingface-${operation}`, { completeness: 'partial', truncated: Boolean(next), ...(next ? { nextCursor: next } : {}) });
      return values.flatMap(item => {
        const id = string(item.id) || string(item.modelId), target = `https://huggingface.co/${operation === 'models' ? '' : operation + '/'}${encodedPath(id)}`;
        if (!id || !accepted(request, target)) return [];
        return hit('huggingface', { title: id, url: target, snippet: Array.isArray(item.tags) ? item.tags.map(string).join(' · ') : '', locator: { kind: 'record', id: `${operation}:${id}` }, metadata: { ...item, updatedAt: item.lastModified, contentType: operation === 'models' ? 'model' : operation === 'datasets' ? 'dataset' : 'space' } });
      });
    },
    async read(url, signal) {
      const parsed = new URL(url), parts = parsed.pathname.split('/').filter(Boolean);
      if (parsed.hostname !== 'huggingface.co') throw new Error('Hugging Face 读取需要 Hub 仓库链接');
      const operation = ['datasets', 'spaces'].includes(parts[0] ?? '') ? parts.shift()! : 'models';
      if (parts.length !== 2) throw new Error('Hugging Face 读取需要 owner/repository 根链接');
      const id = parts.map(decodeURIComponent).join('/'), value = await json(endpoint(config, 'https://huggingface.co/', `api/${operation}/${encodedPath(id)}`), { headers: auth, signal }, 'Hugging Face 仓库');
      if (!string(value.id) && !string(value.modelId)) throw new Error('Hugging Face 未返回仓库信息');
      return document('huggingface', url, id, JSON.stringify(value, null, 2), { contentKind: 'metadata', locator: { kind: 'record', id: `${operation}:${id}` }, metadata: { contentType: operation === 'models' ? 'model' : operation === 'datasets' ? 'dataset' : 'space', revision: value.sha, updatedAt: value.lastModified, contentScope: 'repository-metadata-card-and-file-list' } });
    },
  };
}

function bioDoi(value: string): string | undefined {
  const match = value.match(/(?:^|\/)(10\.\d{4,9}\/[^?#\s]+)/i);
  return match?.[1]?.replace(/v\d+(?:\.full(?:\.pdf)?)?$/, '').replace(/\.full(?:\.pdf)?$/, '');
}
function bioRxiv(config: ApiConfig): Source {
  const versions = z.strictObject({ server: z.enum(['biorxiv', 'medrxiv']).default('biorxiv'), doi: identifier.optional(), resultOffset: cursor });
  const recent = z.strictObject({ server: z.enum(['biorxiv', 'medrxiv']).default('biorxiv'), category: identifier.optional(), days: z.number().int().min(1).max(365).default(7), cursor });
  const operations = [describeOperation('versions', '按 DOI 读取预印本各版本，不接受任意关键词检索', ['paper'], versions), describeOperation('recent', '按 since/until 日期范围或最近 days 天列出预印本；query 不作关键词过滤', ['paper'], recent)];
  const get = (path: string, signal: AbortSignal) => json(endpoint(config, 'https://api.biorxiv.org/', path), { headers, signal }, 'bioRxiv');
  return {
    capability: capability('biorxiv', config, operations, ['官方 API 提供 DOI 和日期区间查询，没有通用关键词全文搜索；预印本未必经过同行评审。']),
    async search(request) {
      const operation = selected(request, operations), params = operation === 'versions' ? versions.parse(request.params ?? {}) : recent.parse(request.params ?? {});
      let interval: string;
      if (operation === 'versions') {
        interval = bioDoi('doi' in params && params.doi ? params.doi : request.query) ?? '';
        if (!interval) throw Object.assign(new Error('bioRxiv versions 需要预印本 DOI；时间发现请用 recent 操作'), { code: 'BAD_INPUT' });
      } else {
        if (request.since && !request.until) throw Object.assign(new Error('bioRxiv 日期区间需要同时提供 since 和 until，或改用 days'), { code: 'BAD_INPUT' });
        if (!request.since && request.until) throw Object.assign(new Error('bioRxiv 日期区间需要同时提供 since 和 until'), { code: 'BAD_INPUT' });
        const until = new Date(), since = new Date(until.getTime() - (('days' in params ? params.days : 7) - 1) * 86400000);
        interval = request.since && request.until ? `${request.since}/${request.until}` : `${since.toISOString().slice(0, 10)}/${until.toISOString().slice(0, 10)}`;
      }
      const address = endpoint(config, 'https://api.biorxiv.org/', `details/${params.server}/${interval}/${operation === 'versions' ? 'na' : 'cursor' in params ? params.cursor : 0}/json`);
      if ('category' in params && params.category) address.searchParams.set('category', params.category);
      const result = await json(address, { headers, signal: request.signal }, 'bioRxiv'), values = rows(result.collection, 'bioRxiv collection');
      const message = rows(result.messages, 'bioRxiv messages')[0] ?? {}, offset = 'cursor' in params ? params.cursor : 0;
      if (message.status && message.status !== 'ok') throw Object.assign(new Error(`bioRxiv 未完成查询：${plain(message.status)}`), { code: 'UPSTREAM_QUERY_ERROR' });
      const total = Number(message.total), returned = Math.min(values.length, request.limit), resultOffset = 'resultOffset' in params ? params.resultOffset : 0;
      const matching = values.filter(item => inWindow(date(item.date), request));
      const more = operation === 'recent' && returned > 0 && (Number.isFinite(total) ? offset + returned < total : values.length >= 30 || values.length > returned);
      const remainingVersions = operation === 'versions' && resultOffset + request.limit < matching.length;
      const nextCursor = remainingVersions ? JSON.stringify({ resultOffset: resultOffset + request.limit }) : more ? String(offset + returned) : undefined;
      reportCoverage(request, `biorxiv-${operation}`, { completeness: 'partial', truncated: Boolean(nextCursor), ...(nextCursor ? { nextCursor } : {}), limitations: [operation === 'recent' ? '该操作按时间和类别列举，query 不参与关键词筛选。' : '仅为指定 DOI 的 API 版本记录。'] });
      return matching.slice(resultOffset, resultOffset + request.limit).flatMap(item => {
        const doi = string(item.doi), version = numericId(item.version), target = `https://www.${params.server}.org/content/${doi}${version ? 'v' + version : ''}`;
        if (!doi || !accepted(request, target)) return [];
        return hit('biorxiv', { title: plain(item.title), url: target, snippet: plain(item.abstract), publishedAt: date(item.date), locator: { kind: 'record', id: `${doi}:v${version}` }, metadata: { ...item, contentType: 'paper', server: params.server, contentScope: 'preprint-version-metadata' } });
      });
    },
    async read(url, signal) {
      const parsed = new URL(url), doi = bioDoi(decodeURIComponent(parsed.pathname));
      if (!doi || !['doi.org', 'biorxiv.org', 'www.biorxiv.org', 'medrxiv.org', 'www.medrxiv.org'].includes(parsed.hostname)) throw new Error('bioRxiv 读取需要 bioRxiv/medRxiv 或预印本 DOI 链接');
      let server = parsed.hostname.includes('medrxiv') ? 'medrxiv' : 'biorxiv';
      let values = rows((await get(`details/${server}/${doi}/na/json`, signal)).collection, 'bioRxiv 版本');
      if (!values.length && parsed.hostname === 'doi.org') { server = 'medrxiv'; values = rows((await get(`details/${server}/${doi}/na/json`, signal)).collection, 'medRxiv 版本'); }
      const version = parsed.pathname.match(/v(\d+)(?:\.full(?:\.pdf)?)?$/)?.[1];
      const value = version ? values.find(item => numericId(item.version) === version) : values.at(-1);
      if (!value) throw new Error('bioRxiv 未返回指定预印本版本');
      const actualVersion = numericId(value.version), target = `https://www.${server}.org/content/${doi}v${actualVersion}`;
      return document('biorxiv', target, plain(value.title), JSON.stringify({ record: value, versions: values }, null, 2), { contentKind: 'metadata', publishedAt: date(value.date), locator: { kind: 'record', id: `${doi}:v${actualVersion}` }, metadata: { contentType: 'paper', contentScope: 'preprint-version-metadata', doi, version: actualVersion, jatsXml: value.jatsxml, publishedDoi: value.published } });
    },
  };
}

function europePmc(config: ApiConfig): Source {
  const schema = z.strictObject({ cursor: identifier.default('*'), openAccess: z.boolean().optional() });
  const operations = [describeOperation('papers', '检索论文与预印本；PMC 开放记录可继续读取 JATS XML 全文', ['paper'], schema)];
  const get = (query: string, signal: AbortSignal, limit = 1, next = '*') => {
    const url = endpoint(config, 'https://www.ebi.ac.uk/europepmc/webservices/rest/', 'search');
    for (const [key, value] of Object.entries({ query, format: 'json', resultType: 'core', pageSize: String(limit), cursorMark: next })) url.searchParams.set(key, value);
    return json(url, { headers, signal }, 'Europe PMC');
  };
  return {
    capability: capability('europepmc', config, operations, ['只有可开放读取的 PMC 记录提供全文 XML；其他记录明确保留书目和摘要。']),
    async search(request) {
      selected(request, operations); const params = schema.parse(request.params ?? {});
      let query = `(${request.query})`;
      if (request.since || request.until) query += ` AND FIRST_PDATE:[${request.since ?? '*'} TO ${request.until ?? '*'}]`;
      if (params.openAccess !== undefined) query += ` AND OPEN_ACCESS:${params.openAccess ? 'Y' : 'N'}`;
      const result = await get(query, request.signal, request.limit, params.cursor), values = rows(object(result.resultList, 'Europe PMC resultList').result, 'Europe PMC result');
      const next = string(result.nextCursorMark), more = Boolean(next && next !== params.cursor && values.length >= request.limit);
      reportCoverage(request, 'europepmc-search', { completeness: 'partial', truncated: more, ...(more ? { nextCursor: next } : {}) });
      return values.flatMap(item => {
        const id = string(item.id), source = string(item.source), target = `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
        if (!id || !source || !accepted(request, target)) return [];
        return hit('europepmc', { title: string(item.title), url: target, snippet: plain(item.abstractText), publishedAt: date(item.firstPublicationDate), locator: { kind: 'record', id: `${source}:${id}` }, metadata: { ...item, contentType: 'paper', contentScope: 'bibliography-and-abstract' } });
      });
    },
    async read(url, signal) {
      const parsed = new URL(url), match = parsed.pathname.match(/^\/article\/([a-z]+)\/([\w.-]+)\/?$/i), pmc = parsed.pathname.match(/^\/articles\/(PMC\d+)\/?$/i)?.[1];
      const id = pmc ?? match?.[2], source = pmc ? 'PMC' : match?.[1];
      if (parsed.hostname !== 'europepmc.org' || !id || !source) throw new Error('Europe PMC 读取需要 article/SOURCE/ID 或 articles/PMC 链接');
      const result = await get(source.toUpperCase() === 'PMC' ? `PMCID:${id}` : `EXT_ID:${id} AND SRC:${source}`, signal), value = rows(object(result.resultList, 'Europe PMC resultList').result, 'Europe PMC 记录')[0];
      if (!value) throw new Error('Europe PMC 未找到文献记录');
      const pmcid = string(value.pmcid) || (source.toUpperCase() === 'PMC' ? id : ''), metadata: Row = { contentType: 'paper', doi: value.doi, pmcid: pmcid || undefined, contentScope: 'bibliography-and-abstract' };
      if (pmcid && value.isOpenAccess === 'Y') {
        try {
          const xml = await (await response(endpoint(config, 'https://www.ebi.ac.uk/europepmc/webservices/rest/', `${encodeURIComponent(pmcid)}/fullTextXML`), { headers: { ...headers, Accept: 'application/xml' }, signal }, 'Europe PMC 全文')).text();
          if (!/<article[\s>]/i.test(xml)) throw new Error('Europe PMC 全文响应没有 JATS article');
          return document('europepmc', `https://europepmc.org/articles/${pmcid}`, string(value.title), xml, { publishedAt: date(value.firstPublicationDate), locator: { kind: 'record', id: `${source}:${id}` }, metadata: { ...metadata, contentScope: 'open-full-text', format: 'jats-xml' } });
        } catch (error) {
          if (!['HTTP_403', 'HTTP_404'].includes((error as { code?: string }).code ?? '')) throw error;
          metadata.fullTextUnavailable = (error as { code: string }).code;
        }
      }
      return document('europepmc', url, string(value.title), JSON.stringify(value, null, 2), { contentKind: 'metadata', publishedAt: date(value.firstPublicationDate), locator: { kind: 'record', id: `${source}:${id}` }, metadata });
    },
  };
}

function zenodo(config: ApiConfig): Source {
  const schema = z.strictObject({ page, allVersions: z.boolean().default(false), type: identifier.optional(), community: identifier.optional() });
  const operations = [describeOperation('records', '检索已发布的数据集、研究软件、论文及版本记录', ['research-record', 'dataset'], schema)], auth = bearer(config);
  return {
    capability: capability('zenodo', config, operations, ['记录与附件清单不等于附件全文；受限文件需要相应权限。']),
    async search(request) {
      selected(request, operations); const params = schema.parse(request.params ?? {}), url = endpoint(config, 'https://zenodo.org/api/', 'records');
      const query = `(${request.query})${request.since || request.until ? ` AND publication_date:[${request.since ?? '*'} TO ${request.until ?? '*'}]` : ''}`;
      for (const [key, value] of Object.entries({ q: query, size: request.limit, page: params.page, all_versions: params.allVersions, type: params.type, communities: params.community })) if (value !== undefined) url.searchParams.set(key, String(value));
      const result = await json(url, { headers: auth, signal: request.signal }, 'Zenodo'), values = rows(object(result.hits, 'Zenodo hits').hits, 'Zenodo records');
      const next = result.links && typeof result.links === 'object' ? string((result.links as Row).next) : '';
      reportCoverage(request, 'zenodo-published-records', { completeness: 'partial', truncated: Boolean(next), ...(next ? { nextCursor: String(params.page + 1) } : {}) });
      return values.flatMap(item => {
        const id = numericId(item.id), metadata = object(item.metadata, 'Zenodo metadata'), target = `https://zenodo.org/records/${encodeURIComponent(id)}`;
        if (!id || !accepted(request, target)) return [];
        return hit('zenodo', { title: string(metadata.title), url: target, snippet: plain(metadata.description), publishedAt: date(metadata.publication_date), locator: { kind: 'record', id }, metadata: { ...metadata, files: item.files, conceptrecid: item.conceptrecid, contentType: 'research-record' } });
      });
    },
    async read(url, signal) {
      const parsed = new URL(url), id = parsed.hostname === 'zenodo.org' ? parsed.pathname.match(/^\/(?:records?|api\/records)\/(\d+)\/?$/)?.[1] : undefined;
      if (!id) throw new Error('Zenodo 读取需要数字记录链接');
      const value = await json(endpoint(config, 'https://zenodo.org/api/', `records/${id}`), { headers: auth, signal }, 'Zenodo record'), metadata = object(value.metadata, 'Zenodo metadata');
      return document('zenodo', `https://zenodo.org/records/${id}`, string(metadata.title), JSON.stringify(value, null, 2), { contentKind: 'metadata', publishedAt: date(metadata.publication_date), locator: { kind: 'record', id }, metadata: { contentType: 'research-record', contentScope: 'published-record-and-file-list', doi: metadata.doi, version: metadata.version, conceptrecid: value.conceptrecid, files: value.files } });
    },
  };
}

function studyParts(value: Row) {
  const protocol = object(value.protocolSection, 'ClinicalTrials protocol'), identification = object(protocol.identificationModule, 'ClinicalTrials identification');
  const status = protocol.statusModule && typeof protocol.statusModule === 'object' ? protocol.statusModule as Row : {};
  const description = protocol.descriptionModule && typeof protocol.descriptionModule === 'object' ? protocol.descriptionModule as Row : {};
  const posted = status.studyFirstPostDateStruct && typeof status.studyFirstPostDateStruct === 'object' ? status.studyFirstPostDateStruct as Row : {};
  return { identification, status, description, publishedAt: date(posted.date) };
}
function clinicalTrials(config: ApiConfig): Source {
  const schema = z.strictObject({ condition: identifier.optional(), intervention: identifier.optional(), status: identifier.optional(), pageToken: identifier.optional() });
  const operations = [describeOperation('studies', '查询临床试验注册、阶段、状态和已提交结果；日期按首次公开登记时间', ['clinical-trial'], schema)];
  return {
    capability: capability('clinicaltrials', config, operations, ['试验登记与提交结果不等于疗效已获证实；保留登记和更新时间。']),
    async search(request) {
      selected(request, operations); const params = schema.parse(request.params ?? {}), url = endpoint(config, 'https://clinicaltrials.gov/api/v2/', 'studies');
      const term = `${request.query}${request.since || request.until ? ` AND AREA[StudyFirstPostDate]RANGE[${request.since ?? 'MIN'},${request.until ?? 'MAX'}]` : ''}`;
      for (const [key, value] of Object.entries({ 'query.term': term, 'query.cond': params.condition, 'query.intr': params.intervention, 'filter.overallStatus': params.status, pageToken: params.pageToken, pageSize: request.limit, countTotal: true, format: 'json' })) if (value !== undefined) url.searchParams.set(key, String(value));
      const result = await json(url, { headers, signal: request.signal }, 'ClinicalTrials.gov'), values = rows(result.studies, 'ClinicalTrials studies'), next = string(result.nextPageToken);
      reportCoverage(request, 'clinicaltrials-registered-studies', { completeness: 'partial', truncated: Boolean(next), ...(next ? { nextCursor: next } : {}) });
      return values.flatMap(item => {
        const value = studyParts(item), id = string(value.identification.nctId), target = `https://clinicaltrials.gov/study/${id}`;
        if (!/^NCT\d{8}$/.test(id) || !accepted(request, target)) return [];
        return hit('clinicaltrials', { title: string(value.identification.briefTitle) || string(value.identification.officialTitle), url: target, snippet: string(value.description.briefSummary), publishedAt: value.publishedAt, locator: { kind: 'record', id }, metadata: { contentType: 'clinical-trial', overallStatus: value.status.overallStatus, hasResults: item.hasResults, lastUpdate: value.status.lastUpdatePostDateStruct } });
      });
    },
    async read(url, signal) {
      const parsed = new URL(url), id = parsed.hostname === 'clinicaltrials.gov' ? parsed.pathname.match(/(?:^|\/)(NCT\d{8})\/?$/i)?.[1]?.toUpperCase() : undefined;
      if (!id) throw new Error('ClinicalTrials.gov 读取需要 NCT 注册记录链接');
      const value = await json(endpoint(config, 'https://clinicaltrials.gov/api/v2/', `studies/${id}`), { headers, signal }, 'ClinicalTrials study'), parts = studyParts(value);
      return document('clinicaltrials', `https://clinicaltrials.gov/study/${id}`, string(parts.identification.briefTitle), JSON.stringify(value, null, 2), { contentKind: 'metadata', publishedAt: parts.publishedAt, locator: { kind: 'record', id }, metadata: { contentType: 'clinical-trial', contentScope: 'study-registration-and-submitted-results', hasResults: value.hasResults, overallStatus: parts.status.overallStatus, lastUpdate: parts.status.lastUpdatePostDateStruct } });
    },
  };
}

export function createResearchApiSources(config: Config): Source[] {
  return [semanticScholar(config['semantic-scholar'] ?? {}), openReview(config.openreview ?? {}), huggingFace(config.huggingface ?? {}), bioRxiv(config.biorxiv ?? {}), europePmc(config.europepmc ?? {}), zenodo(config.zenodo ?? {}), clinicalTrials(config.clinicaltrials ?? {})];
}
