import type { ApiConfig, Config, Source, Document } from '../types.js';
import { date, decoded, document, endpoint, epoch, hit, json, object, permitted, response, rows, string, textResponse } from './shared.js';

export interface SteamTarget {
  kind: 'store' | 'news-list' | 'news';
  appId?: string;
  newsId?: string;
  idKind?: 'feed' | 'event' | 'announcement';
}

export function steamTarget(value: string): SteamTarget | undefined {
  const url = new URL(value), host = url.hostname.replace(/^www\./, ''), path = url.pathname;
  if (host === 'api.steampowered.com' && /^\/ISteamNews\/GetNewsForApp\/v0*2\/?$/i.test(path) && /^[1-9]\d*$/.test(url.searchParams.get('appid') ?? '')) return { kind: 'news-list', appId: url.searchParams.get('appid')! };
  if (host === 'store.steampowered.com' && /^\/api\/appdetails\/?$/.test(path) && /^[1-9]\d*$/.test(url.searchParams.get('appids') ?? '')) return { kind: 'store', appId: url.searchParams.get('appids')! };
  if (host === 'steamstore-a.akamaihd.net') {
    const match = path.match(/^\/news\/externalpost\/steam_community_announcements\/(\d+)\/?$/);
    return match ? { kind: 'news', newsId: match[1]!, idKind: 'feed' } : undefined;
  }
  if (!['store.steampowered.com', 'steamcommunity.com'].includes(host)) return undefined;
  let match = path.match(/^\/news\/app\/([1-9]\d*)(?:\/view\/(\d+))?\/?$/);
  if (match) return match[2] ? { kind: 'news', appId: match[1]!, newsId: match[2], idKind: 'event' } : { kind: 'news-list', appId: match[1]! };
  match = path.match(/^\/games\/([1-9]\d*)\/announcements(?:\/detail\/(\d+))?\/?$/);
  if (match) return match[2] ? { kind: 'news', appId: match[1]!, newsId: match[2], idKind: 'announcement' } : { kind: 'news-list', appId: match[1]! };
  match = path.match(/^\/app\/([1-9]\d*)\/(?:allnews|news|announcements)\/?$/);
  if (match) return { kind: 'news-list', appId: match[1]! };
  match = host === 'store.steampowered.com' ? path.match(/^\/app\/([1-9]\d*)(?:\/[^/]+)?\/?$/) : null;
  return match ? { kind: 'store', appId: match[1]! } : undefined;
}

export function steamDocumentMatches(url: string, value: Document): boolean {
  const target = steamTarget(url);
  if (!target) return true;
  const metadata = value.metadata ?? {};
  if (target.appId && String(metadata.appId ?? '') !== target.appId) return false;
  if (target.kind !== 'news') return metadata.contentScope === (target.kind === 'store' ? 'store-specification' : 'news-list');
  const field = target.idKind === 'feed' ? 'feedGid' : target.idKind === 'event' ? 'eventGid' : 'announcementGid';
  return metadata.contentScope === 'single-news-record' && String(metadata[field] ?? '') === target.newsId;
}

function steamError(message: string, code: string, fallbackUrl: string) {
  return Object.assign(new Error(message), { code, fallbackUrl });
}

function steam(config: ApiConfig = {}): Source {
  const headers = { 'User-Agent': 'SERA', Accept: 'application/json' };
  return {
    capability: { name: 'steam', search: true, read: true, configured: config.enabled !== false, category: 'catalog', platforms: ['steam'], requiresLogin: false, loggedIn: true, requirement: '公开商店作品实体、AppID、商店规格、公告列表及单条公告全文；公告保留各自标识与时间' },
    async search(request) {
      if (!permitted(request.domains, 'store.steampowered.com')) return [];
      if (request.since) throw new Error('Steam 商店实体搜索不支持统一发布日期过滤');
      const url = endpoint(config, 'https://store.steampowered.com/', 'api/storesearch/');
      url.searchParams.set('term', request.query); url.searchParams.set('l', 'english'); url.searchParams.set('cc', 'us');
      const result = await json(url, { headers, signal: request.signal }, 'Steam 商店搜索');
      return rows(result.items, 'Steam 商店实体').filter(item => /^[1-9]\d*$/.test(String(item.id))).slice(0, request.limit).flatMap(item => hit('steam', { title: string(item.name), url: `https://store.steampowered.com/app/${item.id}/`, snippet: 'Steam 商店实体候选；名称与发行商需继续核对', metadata: { appId: item.id, imageUrl: item.tiny_image, contentScope: 'store-entity' } }));
    },
    async read(url, signal) {
      const target = steamTarget(url), address = new URL(url);
      if (!target) throw steamError('Steam 读取需要商品、公告列表或单条公告链接', 'STEAM_URL_UNSUPPORTED', url);
      if (target.kind === 'news') {
        const requested = endpoint(config, address.origin, address.pathname.slice(1) + address.search);
        const result = await response(requested, { headers: { ...headers, Accept: 'text/html' }, signal }, 'Steam 原始公告');
        const decodedPage = await textResponse(result), actualUrl = config.baseUrl ? new URL(new URL(result.url).pathname + new URL(result.url).search, target.idKind === 'feed' ? 'https://steamcommunity.com' : address.origin).href : result.url || url;
        const actual = steamTarget(actualUrl), selector = target.idKind === 'feed' ? actual : target;
        if (!selector || selector.kind !== 'news' || selector.idKind === 'feed') throw steamError('Steam 公告没有返回可核实的实际公告地址', 'STEAM_NEWS_UNAVAILABLE', actualUrl);
        const encoded = decodedPage.text.match(/\bdata-partnereventstore\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
        let events: unknown;
        try { events = encoded ? JSON.parse(decoded(encoded)) : []; } catch { events = []; }
        const event = (Array.isArray(events) ? rows(events, 'Steam 原始公告') : []).find(item => {
          const body = item.announcement_body as Record<string, unknown> | undefined;
          return String(selector.idKind === 'event' ? item.gid : body?.gid) === selector.newsId && (!selector.appId || String(item.appid) === selector.appId);
        });
        if (!event) throw steamError('本次 Steam 公告页面没有目标记录，请读取原公告页面或官方新闻流', 'STEAM_NEWS_UNAVAILABLE', actualUrl);
        const body = object(event.announcement_body, 'Steam 公告正文'), contents = string(body.body);
        if (!contents.trim()) throw steamError('Steam 目标公告没有返回正文', 'CONTENT_EMPTY', actualUrl);
        return document('steam', actualUrl, string(body.headline) || string(event.event_name), contents, { contentKind: 'post', publishedAt: epoch(body.posttime), metadata: { appId: String(event.appid), contentScope: 'single-news-record', eventGid: String(event.gid), announcementGid: String(body.gid), ...(target.idKind === 'feed' ? { feedGid: target.newsId } : {}), ...(actualUrl !== url ? { requestedUrl: url } : {}), extraction: 'steam-embedded-announcement', encoding: decodedPage.encoding } });
      }
      const news = target.kind === 'news-list', requestedCount = Number(address.searchParams.get('count') ?? 100);
      const api = endpoint(config, news ? 'https://api.steampowered.com/' : 'https://store.steampowered.com/', news ? 'ISteamNews/GetNewsForApp/v2/' : 'api/appdetails/');
      api.searchParams.set(news ? 'appid' : 'appids', target.appId!);
      if (news) {
        if (!Number.isSafeInteger(requestedCount) || requestedCount < 1) throw steamError('Steam 公告数量需要正整数', 'INVALID_INPUT', url);
        api.searchParams.set('count', String(Math.min(requestedCount, 100))); api.searchParams.set('maxlength', '0');
        const enddate = address.searchParams.get('enddate');
        if (enddate !== null) { if (!/^\d+$/.test(enddate)) throw steamError('Steam 公告 enddate 需要Unix秒数', 'INVALID_INPUT', url); api.searchParams.set('enddate', enddate); }
      } else {
        api.searchParams.set('l', address.searchParams.get('l') ?? 'english'); api.searchParams.set('cc', address.searchParams.get('cc') ?? 'us');
      }
      const result = await json(api, { headers, signal }, news ? 'Steam 公告列表' : 'Steam 作品规格');
      const record = object(news ? result.appnews : result[target.appId!], news ? 'Steam 公告列表' : 'Steam 作品规格');
      if (!news && record.success !== true) throw steamError('Steam 作品不存在或该区域未返回资料', 'STEAM_APP_UNAVAILABLE', url);
      const data = news ? record : object(record.data, 'Steam 作品规格');
      if (news) {
        if (record.appid !== undefined && String(record.appid) !== target.appId) throw steamError('Steam 公告列表的AppID与请求不符', 'CONTENT_MISMATCH', url);
        const items = rows(record.newsitems, 'Steam 公告列表'), total = typeof record.count === 'number' ? record.count : typeof record.newsitems_count === 'number' ? record.newsitems_count : undefined;
        const truncated = total === undefined ? items.length >= Math.min(requestedCount, 100) : total > items.length;
        const dates = items.map(item => Number(item.date)).filter(value => Number.isSafeInteger(value) && value > 0);
        return document('steam', url, `Steam ${target.appId} 公告`, JSON.stringify(data, null, 2), { contentKind: 'metadata', metadata: { appId: target.appId, contentScope: 'news-list', returned: items.length, ...(total !== undefined ? { total } : {}), truncated, ...(truncated && dates.length ? { nextEndDate: Math.min(...dates) - 1 } : {}), apiUrl: config.baseUrl ? undefined : api.href } });
      }
      if (data.steam_appid !== undefined && String(data.steam_appid) !== target.appId) throw steamError('Steam 作品AppID与请求不符', 'CONTENT_MISMATCH', url);
      return document('steam', url, string(data.name), JSON.stringify(data, null, 2), { contentKind: 'metadata', metadata: { appId: target.appId, contentScope: 'store-specification', language: api.searchParams.get('l'), region: api.searchParams.get('cc'), releaseDateRaw: data.release_date } });
    },
  };
}

function nicovideo(config: ApiConfig = {}): Source {
  return {
    capability: { name: 'nicovideo', search: true, read: true, configured: config.enabled !== false, category: 'catalog', platforms: ['nicovideo'], requiresLogin: false, loggedIn: true, requirement: '公开 Snapshot 检索与视频元数据：上传时间、标题、作者及描述；不包含完整视频、字幕或评论' },
    async search(request) {
      if (!permitted(request.domains, 'www.nicovideo.jp')) return [];
      const url = endpoint(config, 'https://snapshot.search.nicovideo.jp/', 'api/v2/snapshot/video/contents/search');
      for (const [key, value] of Object.entries({ q: request.query, targets: 'title,description,tags', fields: 'contentId,title,description,startTime,viewCounter', _context: 'SERA', _sort: '-viewCounter', _limit: String(request.limit) })) url.searchParams.set(key, value);
      if (request.since) url.searchParams.set('filters[startTime][gte]', request.since + 'T00:00:00+09:00');
      const result = await json(url, { signal: request.signal }, 'Niconico Snapshot');
      return rows(result.data, 'Niconico 视频').flatMap(item => hit('nicovideo', { title: string(item.title), url: `https://www.nicovideo.jp/watch/${item.contentId}`, snippet: string(item.description), publishedAt: date(item.startTime), metadata: { videoId: item.contentId, viewCount: item.viewCounter, contentScope: 'video-metadata' } }));
    },
    async read(url, signal) {
      const parsed = new URL(url), id = /(^|\.)nicovideo\.jp$/.test(parsed.hostname) ? parsed.pathname.match(/^\/watch\/((?:sm|nm|so)\d+)(?:\/|$)/)?.[1] : undefined;
      if (!id) throw new Error('Niconico 读取需要 sm/nm/so 视频链接');
      const target = endpoint(config, 'https://ext.nicovideo.jp/', `api/getthumbinfo/${id}`);
      const xml = (await textResponse(await response(target, { signal }, 'Niconico ThumbInfo'))).text;
      if (!/<nicovideo_thumb_response\b[^>]*status=["']ok["']/i.test(xml)) throw new Error('Niconico 视频未返回公开元数据');
      const field = (name: string) => decoded(xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`))?.[1]?.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1'));
      const record = { videoId: id, title: field('title'), description: field('description'), firstRetrieve: field('first_retrieve'), userId: field('user_id'), userNickname: field('user_nickname'), viewCounter: field('view_counter'), watchUrl: field('watch_url') };
      if (!record.title) throw new Error('Niconico 视频缺少公开标题，未取得有效元数据');
      return document('nicovideo', url, record.title, JSON.stringify(record, null, 2), { contentKind: 'metadata', publishedAt: date(record.firstRetrieve), metadata: { videoId: id, contentScope: 'video-metadata' } });
    },
  };
}

export function createEntitySources(config: Config): Source[] { return [steam(config.steam), nicovideo(config.nicovideo)]; }
