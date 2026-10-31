import type { ApiConfig, Config, SearchRequest, Source } from '../types.js';
import { date, document, endpoint, hit, htmlText, textResponse, json, object, permitted, plain, response, rows, string } from './shared.js';
import type { Row } from './shared.js';

function captureAt(timestamp: string): string {
  if (!/^\d{14}$/.test(timestamp)) throw new Error('Wayback 返回了无效的捕获时间');
  const value = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`;
  const parsed = date(value);
  if (!parsed || parsed.replace(/[-:T]/g, '').slice(0, 14) !== timestamp) throw new Error('Wayback 返回了无效的捕获时间');
  return parsed;
}

function targetTime(value: string): string {
  if (/^(?:\d{8}|\d{14})$/.test(value)) { captureAt(value.padEnd(14, '0')); return value; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const timestamp = value.replace(/-/g, '');
    captureAt(timestamp.padEnd(14, '0'));
    return timestamp;
  }
  throw new Error('档案时间需要有效的 YYYYMMDD 或 YYYYMMDDhhmmss');
}

function snapshot(url: string) {
  const parsed = new URL(url), match = parsed.pathname.match(/^\/web\/(\d{14})(?:[a-z]{1,3}_)?\/(https?:\/\/.+)$/i);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname !== 'web.archive.org' || !match) throw new Error('Wayback 读取需要含捕获时间的 web.archive.org 快照链接');
  const originalUrl = match[2]! + parsed.search;
  if (!['http:', 'https:'].includes(new URL(originalUrl).protocol)) throw new Error('Wayback 返回了无效的原始链接');
  return { timestamp: match[1]!, captureAt: captureAt(match[1]!), originalUrl, url: `https://web.archive.org/web/${match[1]}/${originalUrl}` };
}

function unavailable(message: string, code = 'WAYBACK_UNAVAILABLE') {
  return Object.assign(new Error(message), { code, terminal: true });
}

function wayback(config: ApiConfig): Source {
  const headers = { 'User-Agent': config.userAgent ?? 'SERA archive client', Accept: 'application/json' };
  const platforms = ['availability', 'cdx'];
  const configured = config.enabled !== false;
  return {
    capability: { name: 'wayback', search: true, read: true, configured, category: 'catalog', requiresLogin: false, loggedIn: true, platforms,
      requirement: '公开 URL／域名档案；availability 查最近可用快照，CDX 提供捕获索引' },
    async channels() {
      return platforms.map(platform => ({ source: 'wayback' as const, platform, search: true, read: true, configured,
        description: platform === 'availability' ? '查目标时间附近的可用快照' : '按月折叠的捕获索引，读取时检查快照访问状态' }));
    },
    async search(request) {
      const platform = request.platform ?? config.engine ?? 'availability';
      if (!platforms.includes(platform)) throw new Error('Wayback 支持 availability、cdx 平台');
      if (!permitted(request.domains, 'web.archive.org')) return [];
      const query = request.query.trim();
      let target: URL;
      try { target = new URL(/^https?:\/\//i.test(query) ? query : `https://${query.replace(/^\*\./, '')}`); }
      catch { throw new Error('Wayback 查询需要目标 URL 或域名'); }
      if (!target.hostname.includes('.') || !['http:', 'https:'].includes(target.protocol) || /\s/.test(query)) throw new Error('Wayback 查询需要目标 URL 或域名');
      if (platform === 'availability' && query.includes('*')) throw new Error('通配 URL 请使用 Wayback cdx 平台');
      const at = request.at ? targetTime(request.at) : undefined;
      const since = request.since ? targetTime(request.since) : undefined;
      if (platform === 'availability') {
        const url = endpoint(config, 'https://archive.org/', 'wayback/available');
        url.searchParams.set('url', query);
        if (at) url.searchParams.set('timestamp', at);
        const data = await json(url, { headers, signal: request.signal }, 'Wayback availability');
        const closest = object(data.archived_snapshots, 'Wayback availability').closest;
        if (!closest) throw unavailable('Wayback 当前未提供可用快照；目标可能未收录或暂时不可访问');
        const item = object(closest, 'Wayback 最近快照');
        if (item.available !== true || String(item.status) !== '200') throw unavailable('Wayback 报告该快照当前不可访问');
        const found = snapshot(string(item.url));
        if (found.timestamp !== string(item.timestamp)) throw new Error('Wayback 快照链接与捕获时间不一致');
        if (since && found.timestamp < since.padEnd(14, '0')) return [];
        return hit('wayback', { title: found.originalUrl, url: found.url, snippet: `捕获时间 ${found.captureAt}`,
          metadata: { ...found, platform, status: item.status, availabilityReported: true, snapshotVerified: false, ...(at ? { requestedTimestamp: at } : {}) } });
      }
      const url = endpoint(config, 'https://web.archive.org/', 'cdx/search/cdx');
      for (const [key, value] of Object.entries({ url: query, output: 'json', fl: 'timestamp,original,mimetype,statuscode,digest', filter: 'statuscode:200', collapse: 'timestamp:6', limit: String(Math.min(request.limit, 100)) })) url.searchParams.set(key, value);
      if (since) url.searchParams.set('from', since);
      if (at) url.searchParams.set('to', at);
      const result = await response(url, { headers, signal: request.signal }, 'Wayback CDX');
      const values: unknown = await result.json();
      if (!Array.isArray(values)) throw new Error('Wayback CDX 响应缺少索引列表');
      if (!values.length) return [];
      const fields: unknown = values[0];
      if (!Array.isArray(fields) || !['timestamp', 'original', 'mimetype', 'statuscode', 'digest'].every(field => fields.includes(field))) throw new Error('Wayback CDX 响应缺少索引字段');
      return values.slice(1, request.limit + 1).flatMap(value => {
        if (!Array.isArray(value) || value.length !== fields.length) throw new Error('Wayback CDX 返回了无效的索引行');
        const item: Row = Object.fromEntries(fields.map((field, index) => [String(field), value[index]]));
        const found = snapshot(`https://web.archive.org/web/${string(item.timestamp)}/${string(item.original)}`);
        return hit('wayback', { title: found.originalUrl, url: found.url, snippet: `捕获时间 ${found.captureAt} · ${string(item.mimetype)} · HTTP ${String(item.statuscode)}`,
          metadata: { ...found, platform, mimetype: item.mimetype, status: item.statuscode, digest: item.digest, snapshotVerified: false, collapse: 'timestamp:6', ...(at ? { requestedTimestamp: at } : {}) } });
      });
    },
    async read(url, signal) {
      const requested = snapshot(url);
      const replay = endpoint(config, 'https://web.archive.org/', `web/${requested.timestamp}id_/${requested.originalUrl}`);
      let result: Response;
      try { result = await response(replay, { signal, headers: { ...headers, Accept: 'text/html,text/plain,application/json,application/xml' } }, 'Wayback 快照'); }
      catch (error) { if (error instanceof Error) Object.assign(error, { terminal: true }); throw error; }
      const type = (result.headers.get('content-type') ?? '').toLowerCase();
      if (!/^(?:text\/|application\/(?:json|xml|xhtml\+xml|javascript)(?:;|$))/.test(type)) {
        await result.body?.cancel();
        throw unavailable(`Wayback 快照内容类型为 ${type || '未知'}，需要对应媒体读取来源`, 'UNSUPPORTED_CONTENT');
      }
      const decoded = await textResponse(result), text = decoded.text;
      const title = type.includes('html') ? text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '' : '';
      if (/^(?:Wayback Machine|Internet Archive)$/i.test(plain(title)) && /This URL has been excluded|The Wayback Machine has not archived that URL|This snapshot cannot be displayed|This page is not available on the web/i.test(text)) throw unavailable('Wayback 返回了快照不可访问或受限页面');
      const found = !config.baseUrl && result.url ? snapshot(result.url) : requested;
      const captured = date(result.headers.get('memento-datetime')) ?? found.captureAt;
      const content = type.includes('html') ? htmlText(text, found.originalUrl) : text;
      if (!content.trim()) throw unavailable('Wayback 快照未返回正文', 'CONTENT_EMPTY');
      return document('wayback', found.url, title || found.originalUrl, content,
        { metadata: { ...found, captureAt: captured, requestedCaptureAt: requested.captureAt, snapshotVerified: true, contentType: type,
          extraction: type.includes('html') ? 'html-source-text' : 'direct-text', contentScope: 'archived-server-text', renderedScripts: false, encoding: decoded.encoding } });
    },
  };
}

function metadataText(value: unknown): string { return Array.isArray(value) ? value.map(plain).filter(Boolean).join('；') : plain(value); }
function itemDate(value: unknown): string | undefined { const text = string(value); return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text) ? date(text) : undefined; }

function archive(config: ApiConfig): Source {
  const headers = { 'User-Agent': config.userAgent ?? 'SERA archive metadata client', Accept: 'application/json' };
  const platforms = ['archive', 'all', 'movies', 'audio', 'texts', 'software', 'image', 'web', 'data', 'collection', 'etree', 'other'];
  return {
    capability: { name: 'archive', search: true, read: true, configured: config.enabled !== false, category: 'catalog', requiresLogin: false, loggedIn: true, platforms,
      requirement: '公开馆藏检索、元数据、文件目录与访问条件；媒体内容需继续核验' },
    async channels() {
      return platforms.map(platform => ({ source: 'archive' as const, platform, search: true, read: true, configured: config.enabled !== false,
        description: ['archive', 'all'].includes(platform) ? 'Internet Archive 馆藏目录' : `Internet Archive ${platform} 馆藏目录` }));
    },
    async search(request: SearchRequest) {
      const platform = request.platform ?? config.engine ?? 'all';
      if (!platforms.includes(platform)) throw new Error(`Internet Archive 支持的平台：${platforms.join('、')}`);
      if (!permitted(request.domains, 'archive.org')) return [];
      if (request.at) throw new Error('Internet Archive 馆藏检索不支持历史时间，请使用 Wayback 快照或查询 date 字段');
      const url = endpoint(config, 'https://archive.org/', 'advancedsearch.php');
      url.searchParams.set('q', `(${request.query})${['archive', 'all'].includes(platform) ? '' : ` AND mediatype:${platform}`}${request.since ? ` AND date:[${request.since}T00:00:00Z TO *]` : ''}`);
      for (const field of ['identifier', 'title', 'creator', 'date', 'description', 'mediatype', 'collection', 'rights', 'licenseurl', 'access-restricted-item']) url.searchParams.append('fl[]', field);
      for (const [key, value] of Object.entries({ output: 'json', rows: String(Math.min(request.limit, 100)), page: '1' })) url.searchParams.set(key, value);
      const data = await json(url, { headers, signal: request.signal }, 'Internet Archive 搜索');
      if (data.error) throw unavailable(`Internet Archive 搜索失败：${metadataText(data.error)}`, 'ARCHIVE_API_ERROR');
      const docs = object(data.response, 'Internet Archive 搜索').docs;
      const items = rows(docs, 'Internet Archive 搜索');
      if (Array.isArray(docs) && items.length !== docs.length) throw new Error('Internet Archive 搜索返回了无效的馆藏记录');
      return items.slice(0, request.limit).flatMap(item => {
        const id = string(item.identifier);
        if (!id) throw new Error('Internet Archive 搜索结果缺少馆藏标识');
        return hit('archive', { title: metadataText(item.title) || id, url: `https://archive.org/details/${encodeURIComponent(id)}`,
          snippet: [metadataText(item.creator), string(item.mediatype), metadataText(item.description)].filter(Boolean).join(' · '), publishedAt: itemDate(item.date),
          metadata: { id, platform, record: item, contentScope: 'item-catalog', fullContentVerified: false } });
      });
    },
    async read(url, signal) {
      const parsed = new URL(url), match = parsed.pathname.match(/^\/details\/([^/]+)(?:\/.*)?$/);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname !== 'archive.org' || !match) throw new Error('Internet Archive 读取需要 archive.org/details/ 馆藏链接');
      const id = decodeURIComponent(match[1]!);
      const api = endpoint(config, 'https://archive.org/', `metadata/${encodeURIComponent(id)}`);
      api.searchParams.set('extended_err', '1');
      let result: Response;
      try { result = await response(api, { headers, signal }, 'Internet Archive 馆藏'); }
      catch (error) { if (error instanceof Error) Object.assign(error, { terminal: true }); throw error; }
      const value: unknown = await result.json();
      if (Array.isArray(value) && !value.length) throw unavailable('Internet Archive 未返回该馆藏记录', 'ARCHIVE_ITEM_UNAVAILABLE');
      const data = object(value, 'Internet Archive 馆藏');
      if (data.error) throw unavailable(`Internet Archive 馆藏暂不可读取：${metadataText(data.error)}`, typeof data.errcode === 'number' ? `ARCHIVE_${data.errcode}` : 'ARCHIVE_API_ERROR');
      const item = object(data.metadata, 'Internet Archive 馆藏元数据');
      if (string(item.identifier) && item.identifier !== id) throw new Error('Internet Archive 返回的馆藏标识与请求不一致');
      const files = data.files === undefined ? undefined : rows(data.files, 'Internet Archive 文件目录');
      const accessConditions = { isDark: data.is_dark, accessRestricted: item['access-restricted-item'], rights: item.rights, licenseUrl: item.licenseurl,
        collection: item.collection, lending: data.lending };
      return document('archive', `https://archive.org/details/${encodeURIComponent(id)}`, metadataText(item.title) || id, JSON.stringify(data, null, 2), {
        contentKind: 'metadata', publishedAt: itemDate(item.date), metadata: { id, format: 'archive-json', contentScope: 'item-metadata-and-file-list', accessConditions,
          filesReturned: files?.length, filesTotal: data.files_count, filesComplete: Array.isArray(files) && typeof data.files_count === 'number' ? files.length === data.files_count : undefined,
          filesDownloaded: 0, fullContentVerified: false, itemLastUpdated: data.item_last_updated },
      });
    },
  };
}

export function createArchiveSources(config: Config): Source[] { return [wayback(config.wayback ?? {}), archive(config.archive ?? {})]; }
