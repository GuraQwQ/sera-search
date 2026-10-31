import type { ApiConfig, Config, Source } from '../types.js';
import { date, decoded, document, endpoint, epoch, hit, json, object, permitted, response, rows, string, textResponse } from './shared.js';

function steam(config: ApiConfig = {}): Source {
  const headers = { 'User-Agent': 'SERA', Accept: 'application/json' };
  return {
    capability: { name: 'steam', search: true, read: true, configured: config.enabled !== false, category: 'catalog', platforms: ['steam'], requiresLogin: false, loggedIn: true, requirement: '公开商店作品实体、AppID、商店规格及公告；不推断游戏内所有语言或 DLC 文件内容' },
    async search(request) {
      if (!permitted(request.domains, 'store.steampowered.com')) return [];
      if (request.since) throw new Error('Steam 商店实体搜索不支持统一发布日期过滤');
      const url = endpoint(config, 'https://store.steampowered.com/', 'api/storesearch/');
      url.searchParams.set('term', request.query); url.searchParams.set('l', 'english'); url.searchParams.set('cc', 'us');
      const result = await json(url, { headers, signal: request.signal }, 'Steam 商店搜索');
      return rows(result.items, 'Steam 商店实体').filter(item => /^[1-9]\d*$/.test(String(item.id))).slice(0, request.limit).flatMap(item => hit('steam', { title: string(item.name), url: `https://store.steampowered.com/app/${item.id}/`, snippet: 'Steam 商店实体候选；名称与发行商需继续核对', metadata: { appId: item.id, imageUrl: item.tiny_image, contentScope: 'store-entity' } }));
    },
    async read(url, signal) {
      const parsed = new URL(url);
      const appId = ['store.steampowered.com', 'steamcommunity.com'].includes(parsed.hostname) ? parsed.pathname.match(/^\/(?:app|games|news\/app)\/([1-9]\d*)(?:\/|$)/)?.[1] : undefined;
      if (!appId) throw new Error('Steam 读取需要包含数字 AppID 的商店或社区链接');
      const news = /\/(?:news|announcements)(?:\/|$)/.test(parsed.pathname), newsId = parsed.pathname.match(/\/(?:view|detail)\/(\d+)(?:\/|$)/)?.[1];
      const target = endpoint(config, news ? 'https://api.steampowered.com/' : 'https://store.steampowered.com/', news ? 'ISteamNews/GetNewsForApp/v2/' : 'api/appdetails/');
      target.searchParams.set(news ? 'appid' : 'appids', appId);
      target.searchParams.set(news ? 'count' : 'l', news ? '10' : 'english');
      if (!news) target.searchParams.set('cc', 'us');
      const result = await json(target, { headers, signal }, 'Steam 作品读取');
      const record = news ? object(result.appnews, 'Steam 公告') : object(result[appId], 'Steam 作品');
      if (!news && record.success !== true) throw new Error('Steam 作品不存在或该区域未返回资料');
      const data = newsId ? rows(record.newsitems, 'Steam 公告').find(item => String(item.gid) === newsId) : news ? record : object(record.data, 'Steam 作品规格');
      if (!data) throw new Error('本次 Steam 公告列表没有目标记录，请读取原公告页面');
      return document('steam', url, newsId ? string(data.title) : news ? `Steam ${appId} 公告` : string(data.name), JSON.stringify(data, null, 2), { contentKind: 'metadata', ...(newsId ? { publishedAt: epoch(data.date) } : {}), metadata: { appId, contentScope: newsId ? 'single-news-record' : news ? 'news-first-10' : 'store-specification', language: 'english', region: 'us', releaseDateRaw: news ? undefined : data.release_date } });
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
