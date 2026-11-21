import { z } from 'zod';
import type { ApiConfig, Config, DataCoverage, SearchHit, SearchRequest, Source, SourceName, SourceOperation } from '../types.js';
import { date, decoded, document, endpoint, hit, object, permitted, plain, response, rows, string } from './shared.js';
import type { Row } from './shared.js';
import { describeOperation, reportCoverage, selectOperation } from './operations.js';

const text = z.string().trim().min(1), page = z.number().int().min(1).max(1000).default(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => date(value)?.slice(0, 10) === value, '需要有效日期');

function capability(name: SourceName, config: ApiConfig, requirement: string, operations: SourceOperation[], limitations: string[] = []) {
  return { name, configured: config.enabled !== false, search: true, read: true, requiresLogin: false, loggedIn: true,
    category: 'catalog' as const, accessMethod: 'api' as const, requirement, operations, contentTypes: [...new Set(operations.flatMap(item => item.contentTypes))], limitations };
}

function client(config: ApiConfig, base: string, name: string) {
  return async (path: string, signal: AbortSignal, params: Record<string, string | number | undefined> = {}, body?: unknown): Promise<unknown> => {
    const url = endpoint(config, base, path);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
    const result = await response(url, { signal, headers: { Accept: 'application/json', 'User-Agent': config.userAgent ?? 'SERA specialist research client',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) }, name);
    return result.json();
  };
}

function finish(request: SearchRequest, values: SearchHit[], scope: string, extra: Partial<DataCoverage> = {}) {
  const selected = values.filter(item => permitted(request.domains, new URL(item.url).hostname)
    && (!request.since || !item.publishedAt || item.publishedAt >= request.since)
    && (!request.until || !item.publishedAt || item.publishedAt.slice(0, 10) <= request.until));
  const times = selected.map(item => item.publishedAt).filter((value): value is string => Boolean(value)).sort();
  const limitations = [...(extra.limitations ?? []), ...((request.since || request.until) && selected.some(item => !item.publishedAt) ? ['部分记录缺少精确时间，时间约束尚未逐条核实'] : [])];
  reportCoverage(request, scope, { completeness: 'unknown', ...extra, ...(times.length ? { observed: { since: times[0], until: times.at(-1) } } : {}),
    truncated: selected.length > request.limit || Boolean(extra.truncated), ...(limitations.length ? { limitations } : {}) });
  return selected.slice(0, request.limit);
}

function record(source: SourceName, url: string, title: string, value: unknown, metadata: Row = {}) {
  return document(source, url, title, JSON.stringify(value, null, 2), { contentKind: 'metadata', metadata: { contentScope: 'structured-record', ...metadata } });
}

function idFrom(url: string, hosts: string[], pattern: RegExp, name: string) {
  const parsed = new URL(url), match = hosts.includes(parsed.hostname) ? parsed.pathname.match(pattern) : null;
  if (!match?.[1]) throw new Error(`${name} 读取需要对应记录链接`);
  return match[1];
}

function osv(config: ApiConfig): Source {
  const schema = z.strictObject({ ecosystem: text.optional(), package: text.optional(), version: text.optional(), commit: z.string().regex(/^[a-f\d]{7,64}$/i).optional(), cursor: text.optional(), resultOffset: z.number().int().nonnegative().default(0) });
  const operations = [describeOperation('package', '按软件包、生态和版本或 commit 查询漏洞', ['vulnerability'], schema)];
  const call = client(config, 'https://api.osv.dev/', 'OSV');
  return { capability: capability('osv', config, '软件包版本与 commit 漏洞记录', operations, ['OSV 已聚合 GitHub Advisory 等上游，结果不自动构成独立佐证']),
    async search(request) {
      selectOperation(request, operations); const p = schema.parse(request.params ?? {});
      if (p.commit && (p.version || p.package || p.ecosystem)) throw new Error('commit 查询与软件包版本查询分别使用');
      if (!p.commit && !p.ecosystem) throw new Error('软件包查询需要 params.ecosystem；包名使用 params.package 或 query');
      const data = object(await call('v1/query', request.signal, {}, p.commit ? { commit: p.commit, page_token: p.cursor }
        : { package: { name: p.package ?? request.query, ecosystem: p.ecosystem }, version: p.version, page_token: p.cursor }), 'OSV');
      const items = data.vulns === undefined ? [] : rows(data.vulns, 'OSV');
      const moreOnPage = p.resultOffset + request.limit < items.length;
      const nextCursor = moreOnPage ? JSON.stringify({ cursor: p.cursor, resultOffset: p.resultOffset + request.limit }) : data.next_page_token ? JSON.stringify({ cursor: string(data.next_page_token), resultOffset: 0 }) : undefined;
      return finish(request, items.slice(p.resultOffset, p.resultOffset + request.limit).flatMap(item => hit('osv', { title: string(item.summary) || string(item.id), url: `https://osv.dev/vulnerability/${encodeURIComponent(string(item.id))}`,
        snippet: string(item.details), publishedAt: date(item.published), metadata: { id: item.id, aliases: item.aliases, modifiedAt: item.modified, record: item } })), 'package-vulnerabilities',
      { nextCursor, truncated: Boolean(nextCursor), limitations: ['无命中只表示当前数据库没有匹配公告，不证明软件无漏洞'] });
    },
    async read(url, signal) { const id = idFrom(url, ['osv.dev'], /^\/vulnerability\/([^/]+)\/?$/, 'OSV'); const data = object(await call(`v1/vulns/${encodeURIComponent(decodeURIComponent(id))}`, signal), 'OSV'); return record('osv', url, string(data.summary) || string(data.id), data); },
  };
}

function advisories(config: ApiConfig): Source {
  const schema = z.strictObject({ ecosystem: z.enum(['rubygems', 'npm', 'pip', 'maven', 'nuget', 'composer', 'go', 'rust', 'erlang', 'actions', 'pub', 'other', 'swift']).optional(),
    package: text.optional(), version: text.optional(), severity: z.enum(['unknown', 'low', 'medium', 'high', 'critical']).optional(), cursor: text.optional(), type: z.enum(['reviewed', 'unreviewed', 'malware']).default('reviewed') });
  const operations = [describeOperation('advisories', '按 CVE、GHSA 或软件包查询公告，可限定生态、版本与级别', ['vulnerability'], schema)];
  const call = client(config, 'https://api.github.com/', 'GitHub Advisory');
  return { capability: capability('github-advisory', config, '公开 GHSA 公告与受影响版本', operations),
    async search(request) {
      selectOperation(request, operations); const p = schema.parse(request.params ?? {}), query = request.query.trim();
      const exact: Record<string, string> = /^CVE-\d{4}-\d+$/i.test(query) ? { cve_id: query } : /^GHSA-[\w-]+$/i.test(query) ? { ghsa_id: query } : {};
      const packageName = p.package ?? (Object.keys(exact).length ? undefined : query);
      const url = endpoint(config, 'https://api.github.com/', 'advisories');
      const filters = { ...exact, ecosystem: p.ecosystem, severity: p.severity, type: p.type, after: p.cursor, per_page: String(request.limit),
        affects: packageName ? `${packageName}${p.version ? '@' + p.version : ''}` : undefined,
        ...(request.since || request.until ? { published: `${request.since ?? '*'}..${request.until ?? '*'}` } : {}) };
      for (const [key, value] of Object.entries(filters)) if (value !== undefined) url.searchParams.set(key, value);
      const result = await response(url, { signal: request.signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': config.userAgent ?? 'SERA advisory client',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) } }, 'GitHub Advisory');
      const items = rows(await result.json(), 'GitHub Advisory'), nextLink = result.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      const nextCursor = nextLink ? new URL(nextLink).searchParams.get('after') ?? undefined : undefined;
      return finish(request, items.flatMap(item => hit('github-advisory', { title: string(item.summary), url: string(item.html_url) || `https://github.com/advisories/${item.ghsa_id}`,
        snippet: string(item.description), publishedAt: date(item.published_at), metadata: { id: item.ghsa_id, cve: item.cve_id, record: item } })), 'advisory-page',
      { truncated: Boolean(nextCursor), nextCursor, limitations: ['默认查询已审核公告；包名和版本采用 GitHub affects 原生条件'] });
    },
    async read(url, signal) { const id = idFrom(url, ['github.com'], /^\/advisories\/(GHSA-[\w-]+)\/?$/, 'GitHub Advisory'); const data = object(await call(`advisories/${id}`, signal), 'GitHub Advisory'); return record('github-advisory', url, string(data.summary), data); },
  };
}

function gdelt(config: ApiConfig): Source {
  const schema = z.strictObject({ language: text.optional(), country: text.optional(), sort: z.enum(['HybridRel', 'DateDesc', 'DateAsc']).default('HybridRel') });
  const operations = [describeOperation('articles', '发现新闻报道原始页面', ['news'], schema), describeOperation('timeline', '取得报道量时间序列', ['news-timeline'], schema)];
  const call = client(config, 'https://api.gdeltproject.org/', 'GDELT');
  return { capability: capability('gdelt', config, 'DOC 文章发现及报道量时间线', operations, ['报道数量是所收录媒体的统计，不能表示事件发生频率']),
    async search(request) {
      const operation = selectOperation(request, operations), p = schema.parse(request.params ?? {});
      const params = { query: `${request.query}${p.language ? ` sourcelang:${p.language}` : ''}${p.country ? ` sourcecountry:${p.country}` : ''}`,
        mode: operation === 'timeline' ? 'timelinevolraw' : 'artlist', format: 'json', maxrecords: request.limit, sort: p.sort,
        ...(request.since ? { startdatetime: request.since.replaceAll('-', '') + '000000' } : {}), ...(request.until ? { enddatetime: request.until.replaceAll('-', '') + '235959' } : {}) };
      const data = object(await call('api/v2/doc/doc', request.signal, params), 'GDELT');
      const limitations = ['文章列表与时间线采用不同检索窗口，历史覆盖以实际接口响应为准', '发现结果需要继续读取发布者原文'];
      if (operation === 'timeline') {
        const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc'); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
        return finish(request, hit('gdelt', { title: `报道时间线：${request.query}`, url: url.href, snippet: JSON.stringify(data.timeline ?? []), metadata: { record: data, contentScope: 'coverage-timeline' } }), 'news-timeline', { limitations });
      }
      const items = rows(data.articles ?? [], 'GDELT');
      return finish(request, items.flatMap(item => hit('gdelt', { title: string(item.title), url: string(item.url), snippet: [item.domain, item.language, item.sourcecountry].filter(Boolean).join(' · '),
        publishedAt: string(item.seendate) ? date(string(item.seendate).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')) : undefined,
        metadata: { record: item, timeKind: 'gdelt-first-seen' } })), 'news-article-list', { truncated: items.length === request.limit, limitations });
    },
    async read(url, signal) { const parsed = new URL(url); if (parsed.hostname !== 'api.gdeltproject.org' || parsed.pathname !== '/api/v2/doc/doc') throw new Error('GDELT 只读取 API 统计记录；报道正文请使用 web 或对应发布者来源');
      return record('gdelt', url, 'GDELT 查询记录', await call('api/v2/doc/doc', signal, Object.fromEntries(parsed.searchParams))); },
  };
}

function openLibrary(config: ApiConfig): Source {
  const schema = z.strictObject({ author: text.optional(), language: text.optional(), page });
  const operations = [describeOperation('books', '查询作品、作者、ISBN 和出版版本线索', ['book-metadata'], schema)];
  const call = client(config, 'https://openlibrary.org/', 'Open Library');
  return { capability: capability('open-library', config, '公开书目与作品／版本记录', operations, ['书目记录不表示已取得书内全文']),
    async search(request) { selectOperation(request, operations); const p = schema.parse(request.params ?? {});
      const data = object(await call('search.json', request.signal, { q: request.query, author: p.author, language: p.language, page: p.page, limit: request.limit,
        fields: 'key,title,author_name,first_publish_year,edition_count,cover_i',
        ...(request.since || request.until ? { first_publish_year: `[${request.since?.slice(0, 4) ?? '*'} TO ${request.until?.slice(0, 4) ?? '*'}]` } : {}) }), 'Open Library');
      const items = rows(data.docs, 'Open Library');
      return finish(request, items.flatMap(item => hit('open-library', { title: string(item.title), url: `https://openlibrary.org${string(item.key)}`, snippet: [Array.isArray(item.author_name) ? item.author_name.join('、') : '', item.first_publish_year].filter(Boolean).join(' · '),
        metadata: { record: item, publicationYear: item.first_publish_year, contentScope: 'bibliography' } })), 'book-catalog', { truncated: Number(data.numFound ?? data.num_found) > p.page * request.limit,
        nextCursor: Number(data.numFound ?? data.num_found) > p.page * request.limit ? String(p.page + 1) : undefined, limitations: ['出版时间过滤精度为年，不代表书内全文检索'] }); },
    async read(url, signal) { const parsed = new URL(url); if (parsed.hostname !== 'openlibrary.org' || !/^\/(?:works|books)\/OL\d+[WM]\/?$/.test(parsed.pathname)) throw new Error('Open Library 读取需要作品或版本记录链接');
      const data = object(await call(`${parsed.pathname.replace(/^\//, '').replace(/\/$/, '')}.json`, signal), 'Open Library'); return record('open-library', url, string(data.title), data, { contentScope: 'bibliography' }); },
  };
}

function weather(config: ApiConfig): Source {
  const schema = z.strictObject({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), variables: z.array(z.enum(['temperature_2m', 'relative_humidity_2m', 'precipitation', 'rain', 'snowfall', 'weather_code', 'wind_speed_10m', 'surface_pressure'])).min(1).max(8).default(['temperature_2m']), startDate: day.optional(), endDate: day.optional() });
  const operations = [describeOperation('historical-weather', '按经纬度与日期获取历史再分析天气', ['weather-timeseries'], schema), describeOperation('forecast', '按经纬度取得逐小时预报', ['weather-timeseries'], schema)];
  return { capability: capability('open-meteo', config, '有时间、单位与坐标的天气序列', operations, ['历史再分析与天气预报分别标注，均不等同于现场实测']),
    async search(request) {
      const op = selectOperation(request, operations), p = schema.parse(request.params ?? {}), start = p.startDate ?? request.since, end = p.endDate ?? request.until;
      if (op === 'historical-weather' && (!start || !end)) throw new Error('历史天气需要 since/until 或 params.startDate/endDate');
      if (start && end && start > end) throw new Error('天气开始日期不能晚于结束日期');
      const url = new URL(op === 'historical-weather' ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast');
      for (const [key, value] of Object.entries({ latitude: p.latitude, longitude: p.longitude, hourly: p.variables.join(','), timezone: 'UTC', ...(start ? { start_date: start } : {}), ...(end ? { end_date: end } : {}) })) url.searchParams.set(key, String(value));
      const call = client(config, url.origin, 'Open-Meteo'), data = object(await call(url.pathname.slice(1), request.signal, Object.fromEntries(url.searchParams)), 'Open-Meteo');
      const coverage = reportCoverage(request, op, { observed: { since: start, until: end }, limitations: ['序列采用 UTC；变量单位由 hourly_units 给出；历史数据为气象再分析'] });
      return hit('open-meteo', { title: `${request.query}：${p.latitude},${p.longitude} 天气`, url: url.href, snippet: JSON.stringify(data.hourly_units ?? {}), metadata: { record: data, coverage, contentScope: op } }).filter(item => permitted(request.domains, new URL(item.url).hostname));
    },
    async read(url, signal) { const parsed = new URL(url); if (!['archive-api.open-meteo.com', 'api.open-meteo.com'].includes(parsed.hostname) || !['/v1/archive', '/v1/forecast'].includes(parsed.pathname)) throw new Error('Open-Meteo 读取需要天气 API 链接');
      const data = await client(config, parsed.origin, 'Open-Meteo')(parsed.pathname.slice(1), signal, Object.fromEntries(parsed.searchParams)); return record('open-meteo', url, 'Open-Meteo 天气序列', data, { contentScope: parsed.pathname.endsWith('archive') ? 'historical-reanalysis' : 'forecast', timezone: 'UTC' }); },
  };
}

function mangaUpdates(config: ApiConfig): Source {
  const schema = z.strictObject({ page, cursor: z.string().regex(/^\d+:\d+$/).optional() });
  const operations = [describeOperation('series', '查询漫画作品及出版／发布元数据', ['manga-metadata'], schema)];
  const call = client(config, 'https://api.mangaupdates.com/v1/', 'MangaUpdates');
  return { capability: capability('mangaupdates', config, 'MangaUpdates 漫画资料，结果保留原站归属', operations),
    async search(request) { selectOperation(request, operations); const p = schema.parse(request.params ?? {}), [apiPage, offset] = p.cursor ? p.cursor.split(':').map(Number) as [number, number] : [p.page, 0];
      if (apiPage < 1 || apiPage > 1000 || offset > 100) throw new Error('MangaUpdates 游标超出当前分页范围');
      const data = object(await call('series/search', request.signal, {}, { search: request.query, page: apiPage, perpage: request.limit }), 'MangaUpdates');
      const entries = rows(data.results, 'MangaUpdates'), perPage = Number(data.per_page) || entries.length, more = Number(data.total_hits) > apiPage * perPage;
      const remaining = offset + request.limit < entries.length, nextCursor = remaining ? `${apiPage}:${offset + request.limit}` : more ? `${apiPage + 1}:0` : undefined;
      return finish(request, entries.slice(offset, offset + request.limit).flatMap(entry => { const item = object(entry.record, 'MangaUpdates 条目'); return hit('mangaupdates', { title: string(item.title), url: string(item.url) || `https://www.mangaupdates.com/series.html?id=${item.series_id}`,
        snippet: plain(item.description), metadata: { id: item.series_id, record: item, attribution: 'MangaUpdates', contentScope: 'series-metadata' } }); }), 'manga-catalog', { truncated: Boolean(nextCursor), nextCursor }); },
    async read(url, signal) { const parsed = new URL(url), slug = parsed.pathname.match(/^\/series\/([a-z\d]+)(?:\/.*)?$/i)?.[1];
      const id = slug ? String(Number.parseInt(slug, 36)) : parsed.pathname === '/series.html' ? parsed.searchParams.get('id') : undefined;
      if (!['www.mangaupdates.com', 'mangaupdates.com'].includes(parsed.hostname) || !id || !/^\d+$/.test(id)) throw new Error('MangaUpdates 读取需要漫画条目链接');
      const data = object(await call(`series/${id}`, signal), 'MangaUpdates'); return record('mangaupdates', url, string(data.title), data, { attribution: 'MangaUpdates' }); },
  };
}

function syosetu(config: ApiConfig): Source {
  const schema = z.strictObject({ author: text.optional(), ncode: z.string().regex(/^n\d+[a-z]+$/i).optional(), page: z.number().int().min(1).max(100).default(1), completed: z.boolean().optional() });
  const operations = [describeOperation('novels', '按关键词、作者或 N-code 取得小说作品资料', ['novel-metadata'], schema)];
  const call = client(config, 'https://api.syosetu.com/', '小説家になろう');
  return { capability: capability('syosetu', config, '小说作品元数据与连载状态', operations, ['作品简介与小说正文分别获取；此 API 不返回小说正文']),
    async search(request) { selectOperation(request, operations); const p = schema.parse(request.params ?? {}), start = (p.page - 1) * request.limit + 1;
      if (start > 2000) throw new Error('なろう API 结果起点上限为 2000，请缩小查询');
      const data = rows(await call('novelapi/api/', request.signal, { out: 'json', lim: request.limit, st: start, ...(p.ncode ? { ncode: p.ncode } : { word: request.query }),
        ...(p.author ? { word: `${request.query} ${p.author}`, wname: '1' } : {}), ...(p.completed === undefined ? {} : { type: p.completed ? 'er' : 'r' }) }), '小説家になろう');
      const count = Number(data[0]?.allcount) || 0, entries = data.filter(item => item.ncode);
      return finish(request, entries.flatMap(item => hit('syosetu', { title: string(item.title), url: `https://ncode.syosetu.com/${string(item.ncode).toLowerCase()}/`, snippet: string(item.story),
        publishedAt: date(string(item.general_firstup).replace(' ', 'T') + '+09:00'), metadata: { id: item.ncode, record: item, contentScope: 'novel-metadata', updatedAt: item.general_lastup } })), 'novel-catalog',
      { truncated: count >= start + entries.length, nextCursor: count >= start + entries.length && start + request.limit <= 2000 ? String(p.page + 1) : undefined }); },
    async read(url, signal) { const ncode = idFrom(url, ['ncode.syosetu.com'], /^\/(n\d+[a-z]+)\/?$/i, 'なろう');
      const entries = rows(await call('novelapi/api/', signal, { out: 'json', ncode, lim: 1 }), 'なろう'), item = entries.find(item => item.ncode);
      if (!item) throw new Error('なろう未返回该作品资料'); return record('syosetu', url, string(item.title), item, { contentScope: 'novel-metadata' }); },
  };
}

function ndl(config: ApiConfig): Source {
  const schema = z.strictObject({ title: text.optional(), creator: text.optional(), page });
  const operations = [describeOperation('catalog', 'NDL OpenSearch 书目及馆藏发现', ['book-metadata'], schema)];
  const field = (xml: string, name: string) => decoded(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]?.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1') ?? '');
  const fetchXml = async (path: string, signal: AbortSignal, params: Record<string, string>) => { const url = endpoint(config, 'https://ndlsearch.ndl.go.jp/', path); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return (await response(url, { signal, headers: { Accept: 'application/xml', 'User-Agent': config.userAgent ?? 'SERA bibliography client' } }, 'NDL')).text(); };
  return { capability: capability('ndl', config, '日本国立国会图书馆书目与馆藏', operations, ['馆藏元数据不表示数字化全文可读；提供机构的使用条件随记录保留']),
    async search(request) { selectOperation(request, operations); const p = schema.parse(request.params ?? {}), xml = await fetchXml('api/opensearch', request.signal, { any: request.query, cnt: String(request.limit), idx: String((p.page - 1) * request.limit + 1),
        ...(p.title ? { title: p.title } : {}), ...(p.creator ? { creator: p.creator } : {}), ...(request.since ? { from: request.since.slice(0, 4) } : {}), ...(request.until ? { until: request.until.slice(0, 4) } : {}) });
      if (!/<rss[\s>]/i.test(xml)) throw new Error('NDL 未返回有效 OpenSearch RSS');
      const entries = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)], total = Number(field(xml, 'openSearch:totalResults') || field(xml, 'opensearch:totalResults'));
      return finish(request, entries.flatMap(match => { const item = match[1]!; return hit('ndl', { title: plain(field(item, 'title')), url: field(item, 'link'), snippet: [field(item, 'dc:creator'), field(item, 'dc:publisher'), field(item, 'dc:date')].filter(Boolean).join(' · '),
        metadata: { recordXml: item, publicationTimeRaw: field(item, 'dc:date'), contentScope: 'bibliography' } }); }), 'ndl-catalog', { truncated: total > p.page * request.limit, nextCursor: total > p.page * request.limit ? String(p.page + 1) : undefined, limitations: ['出版日期过滤精度为年'] }); },
    async read(url, signal) { const id = idFrom(url, ['ndlsearch.ndl.go.jp'], /^\/books\/([a-z\d-]+)\/?$/i, 'NDL'), xml = await fetchXml('api/oaipmh', signal, { verb: 'GetRecord', metadataPrefix: 'dcndl', identifier: `oai:ndlsearch.ndl.go.jp:${id}` });
      if (/<(?:\w+:)?error\b/i.test(xml) || !/<(?:\w+:)?metadata[\s>]/i.test(xml)) throw new Error('NDL 未返回该书目记录');
      return document('ndl', url, plain(field(xml, 'dcterms:title')) || id, xml, { contentKind: 'metadata', metadata: { contentScope: 'bibliography', format: 'dcndl-xml' } }); },
  };
}

function hackernews(config: ApiConfig): Source {
  const schema = z.strictObject({ tags: z.enum(['story', 'comment', 'ask_hn', 'show_hn']).default('story'), page: z.number().int().min(0).max(1000).default(0) });
  const operations = [describeOperation('posts', '查询 Hacker News 帖子或评论原文', ['discussion'], schema)];
  const call = client(config, 'https://hn.algolia.com/api/v1/', 'Hacker News');
  return { capability: capability('hackernews', config, 'Hacker News Algolia 帖子与评论索引', operations),
    async search(request) { selectOperation(request, operations); const p = schema.parse(request.params ?? {}), numericFilters = [request.since ? `created_at_i>=${Math.floor(Date.parse(request.since) / 1000)}` : '', request.until ? `created_at_i<=${Math.floor(Date.parse(request.until + 'T23:59:59Z') / 1000)}` : ''].filter(Boolean).join(',');
      const data = object(await call('search', request.signal, { query: request.query, tags: p.tags, page: p.page, hitsPerPage: request.limit, numericFilters: numericFilters || undefined }), 'Hacker News');
      const entries = rows(data.hits, 'Hacker News'), more = p.page + 1 < Number(data.nbPages);
      return finish(request, entries.flatMap(item => hit('hackernews', { title: string(item.title) || string(item.story_title) || `HN ${item.objectID}`, url: `https://news.ycombinator.com/item?id=${item.objectID}`, snippet: plain(item.comment_text) || string(item.url),
        publishedAt: date(item.created_at), locator: { kind: 'record', id: string(item.objectID) }, metadata: { record: item, originalUrl: item.url, parentId: item.parent_id } })), 'hn-search', { truncated: more, nextCursor: more ? String(p.page + 1) : undefined }); },
    async read(url, signal) { const parsed = new URL(url), id = parsed.hostname === 'news.ycombinator.com' && parsed.pathname === '/item' ? parsed.searchParams.get('id') : undefined; if (!id || !/^\d+$/.test(id)) throw new Error('Hacker News 读取需要 item?id= 链接');
      const data = object(await call(`items/${id}`, signal), 'Hacker News'); return { ...record('hackernews', url, string(data.title) || `HN ${id}`, data, { contentScope: 'discussion-tree', originalUrl: data.url }), locator: { kind: 'record' as const, id: String(data.id ?? id) } }; },
  };
}

function lobsters(config: ApiConfig): Source {
  const schema = z.strictObject({ page, resultOffset: z.number().int().nonnegative().default(0) });
  const operations = [describeOperation('recent', '在最新帖子页内筛选关键词，再读取讨论树', ['discussion'], schema)];
  const call = client(config, 'https://lobste.rs/', 'Lobsters');
  return { capability: capability('lobsters', config, 'Lobsters 最新公开帖子与讨论', operations, ['关键词只筛选当前最新帖子页，不表示全历史站内检索']),
    async search(request) { selectOperation(request, operations); const p = schema.parse(request.params ?? {}), entries = rows(await call('newest.json', request.signal, { page: p.page }), 'Lobsters');
      const query = request.query.toLowerCase(), selected = entries.filter(item => `${item.title ?? ''} ${item.description_plain ?? ''} ${Array.isArray(item.tags) ? item.tags.join(' ') : ''}`.toLowerCase().includes(query));
      const remainder = p.resultOffset + request.limit < selected.length;
      const nextCursor = remainder ? JSON.stringify({ page: p.page, resultOffset: p.resultOffset + request.limit }) : entries.length && p.page < 1000 ? JSON.stringify({ page: p.page + 1, resultOffset: 0 }) : undefined;
      return finish(request, selected.slice(p.resultOffset, p.resultOffset + request.limit).flatMap(item => hit('lobsters', { title: string(item.title), url: string(item.comments_url) || string(item.short_id_url), snippet: string(item.description_plain) || string(item.url), publishedAt: date(item.created_at),
        locator: { kind: 'record', id: string(item.short_id) }, metadata: { originalUrl: item.url, record: item } })), 'recent-page', { completeness: 'partial', truncated: Boolean(nextCursor), nextCursor,
        limitations: ['只过滤当前最新帖子页，空结果不表示历史上没有该话题'] }); },
    async read(url, signal) { const id = idFrom(url, ['lobste.rs'], /^\/s\/([a-z\d]+)(?:\/[^/]*)?\/?$/i, 'Lobsters'), data = object(await call(`s/${id}.json`, signal), 'Lobsters'); return { ...record('lobsters', url, string(data.title), data, { contentScope: 'discussion-tree', originalUrl: data.url }), locator: { kind: 'record' as const, id: string(data.short_id) || id } }; },
  };
}

export function createSpecialistApiSources(config: Config): Source[] {
  return [osv(config.osv ?? {}), advisories(config['github-advisory'] ?? {}), gdelt(config.gdelt ?? {}), openLibrary(config['open-library'] ?? {}), weather(config['open-meteo'] ?? {}),
    mangaUpdates(config.mangaupdates ?? {}), syosetu(config.syosetu ?? {}), ndl(config.ndl ?? {}), hackernews(config.hackernews ?? {}), lobsters(config.lobsters ?? {})];
}
