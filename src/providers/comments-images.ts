import type { ApiConfig, Config, Comment, CommentPage, CommentRequest, ImageRequest, SearchHit, Source, SourceName } from '../types.js';
import { NotLoggedInError, notLoggedIn } from '../credentials.js';
import { object, rows, string, plain, date, epoch, hit, endpoint, response, json, document, permitted, fetchResponse } from './shared.js';
import type { Row } from './shared.js';

const browserHeaders = { 'User-Agent': 'Mozilla/5.0' };
const id = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';

function requireKey(config: ApiConfig) { if (!config.apiKey) throw new NotLoggedInError(); }

function cursorNumber(cursor: string | undefined, fallback: number) {
  const value = cursor === undefined ? fallback : Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('分页游标需要非负整数');
  return value;
}

function youtubeId(url: string) {
  const parsed = new URL(url), parts = parsed.pathname.split('/').filter(Boolean);
  const value = parsed.hostname === 'youtu.be' ? parts[0] : /(^|\.)youtube\.com$/.test(parsed.hostname)
    ? parsed.searchParams.get('v') || (['shorts', 'embed', 'live'].includes(parts[0] ?? '') ? parts[1] : '') : '';
  if (!value || !/^[\w-]{11}$/.test(value)) throw new Error('YouTube 需要有效的视频链接');
  return value;
}

async function youtubeApi(config: ApiConfig, path: string, params: Record<string, string>, signal: AbortSignal) {
  requireKey(config);
  const url = endpoint(config, 'https://www.googleapis.com/youtube/v3/', path);
  for (const [key, value] of Object.entries({ ...params, key: config.apiKey! })) url.searchParams.set(key, value);
  // YouTube 用 HTTP 403 的结构化原因区分关闭评论、配额和认证失败。
  const result = await fetchResponse(url, { signal });
  const data = object(await result.json(), 'YouTube');
  if (data.error || !result.ok) {
    const error = data.error ? object(data.error, 'YouTube 错误') : {};
    const reason = error.errors ? string(rows(error.errors, 'YouTube 错误')[0]?.reason) : '';
    if (result.status === 401 || ['keyInvalid', 'authError', 'invalidCredentials'].includes(reason)) throw new NotLoggedInError();
    const message = reason === 'commentsDisabled' ? '此 YouTube 视频已关闭评论' : ['quotaExceeded', 'dailyLimitExceeded'].includes(reason)
      ? 'YouTube API 配额已用尽' : 'YouTube API 请求失败，请核对接口权限与请求条件';
    throw Object.assign(new Error(message), { code: reason === 'commentsDisabled' ? 'COMMENTS_DISABLED' : ['quotaExceeded', 'dailyLimitExceeded'].includes(reason) ? 'QUOTA_EXCEEDED' : `YOUTUBE_${reason || result.status}` });
  }
  return data;
}

function youtubeComment(item: Row, video: string, parentId?: string): Comment {
  const snippet = object(item.snippet, 'YouTube 评论');
  const commentId = id(item.id);
  return { id: commentId, text: string(snippet.textOriginal) || string(snippet.textDisplay), author: string(snippet.authorDisplayName),
    parentId: parentId || string(snippet.parentId) || undefined, rootId: parentId || string(snippet.parentId) || commentId,
    likes: typeof snippet.likeCount === 'number' ? snippet.likeCount : undefined, publishedAt: date(snippet.publishedAt),
    url: `https://www.youtube.com/watch?v=${video}&lc=${encodeURIComponent(commentId)}` };
}

async function youtubeComments(config: ApiConfig, request: CommentRequest): Promise<CommentPage> {
  const video = youtubeId(request.url), params: Record<string, string> = { part: 'snippet', textFormat: 'plainText', maxResults: String(Math.min(request.limit, 100)) };
  if (request.cursor) params.pageToken = request.cursor;
  if (request.parentId) params.parentId = request.parentId;
  else {
    params.videoId = video;
    const order = request.order ?? 'time';
    if (!['time', 'relevance'].includes(order)) throw new Error('YouTube 评论排序支持 time 或 relevance');
    params.order = order;
  }
  const data = await youtubeApi(config, request.parentId ? 'comments' : 'commentThreads', params, request.signal);
  const comments = rows(data.items, 'YouTube 评论').map(item => {
    if (request.parentId) return youtubeComment(item, video, request.parentId);
    const snippet = object(item.snippet, 'YouTube 评论线程');
    return { ...youtubeComment(object(snippet.topLevelComment, 'YouTube 顶层评论'), video), replyCount: typeof snippet.totalReplyCount === 'number' ? snippet.totalReplyCount : undefined };
  });
  const nextCursor = string(data.nextPageToken) || undefined;
  return { url: `https://www.youtube.com/watch?v=${video}`, comments, nextCursor, truncated: Boolean(nextCursor),
    scope: request.parentId ? '指定 YouTube 顶层评论的回复单页' : 'YouTube 视频顶层评论单页；回复通过 parentId 分页',
    metadata: { videoId: video, parentId: request.parentId, order: params.order } };
}

async function bilibiliData(config: ApiConfig, path: string, params: Record<string, string>, signal: AbortSignal) {
  const url = endpoint(config, 'https://api.bilibili.com/', path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const data = await json(url, { headers: { ...browserHeaders, Referer: 'https://www.bilibili.com/' }, signal }, 'B站评论');
  if (data.code === -101) throw new NotLoggedInError();
  if (data.code !== 0) throw Object.assign(new Error(`B站接口返回错误码 ${id(data.code)}`), { code: `BILIBILI_${id(data.code)}` });
  return object(data.data, 'B站评论');
}

export async function bilibiliComments(config: ApiConfig, request: CommentRequest): Promise<CommentPage> {
  let parsed = new URL(request.url);
  if (parsed.hostname === 'b23.tv') parsed = new URL((await response(parsed, { headers: browserHeaders, signal: request.signal }, 'B站短链')).url);
  if (!/(^|\.)bilibili\.com$/.test(parsed.hostname)) throw new Error('B站评论需要视频链接');
  const video = /\/video\/(BV[\w]+|av\d+)/i.exec(parsed.pathname)?.[1];
  if (!video) throw new Error('B站评论链接缺少 BV 或 AV 视频号');
  const oid = /^av/i.test(video) ? video.slice(2) : id((await bilibiliData(config, 'x/web-interface/view', { bvid: video }, request.signal)).aid);
  if (!/^\d+$/.test(oid)) throw new Error('B站视频元数据未返回 AV 号');
  const pageNo = cursorNumber(request.cursor, 1), pageSize = Math.min(request.limit, 49);
  if (pageNo < 1) throw new Error('B站页码从 1 开始');
  const order = request.order ?? 'hot';
  if (!['time', 'hot', 'likes'].includes(order)) throw new Error('B站评论排序支持 time、hot 或 likes');
  if (request.parentId && !/^\d+$/.test(request.parentId)) throw new Error('B站父评论 ID 需要数字');
  const data = await bilibiliData(config, request.parentId ? 'x/v2/reply/reply' : 'x/v2/reply', {
    type: '1', oid, pn: String(pageNo), ps: String(pageSize), ...(request.parentId ? { root: request.parentId } : { sort: order === 'time' ? '0' : order === 'likes' ? '1' : '2' }),
  }, request.signal);
  const comments = (data.replies === null ? [] : rows(data.replies, 'B站评论')).map(item => {
    const commentId = id(item.rpid_str) || id(item.rpid), root = id(item.root_str) || id(item.root), parent = id(item.parent_str) || id(item.parent);
    return { id: commentId, text: string(object(item.content, 'B站评论正文').message), author: string(object(item.member ?? {}, 'B站评论作者').uname),
      rootId: request.parentId || (root && root !== '0' ? root : commentId), parentId: parent && parent !== '0' ? parent : request.parentId,
      likes: typeof item.like === 'number' ? item.like : undefined, replyCount: typeof item.rcount === 'number' ? item.rcount : undefined,
      publishedAt: epoch(item.ctime), url: `https://www.bilibili.com/video/av${oid}#reply${commentId}` };
  });
  const page = object(data.page ?? {}, 'B站评论页');
  const count = typeof page.count === 'number' ? page.count : undefined;
  const actualPageSize = typeof page.size === 'number' && page.size > 0 ? page.size : pageSize;
  const nextCursor = (count !== undefined ? pageNo * actualPageSize < count : comments.length >= actualPageSize) ? String(pageNo + 1) : undefined;
  return { url: `https://www.bilibili.com/video/${video}`, comments, nextCursor, truncated: Boolean(nextCursor),
    scope: request.parentId ? '指定 B站顶层评论的楼中楼单页' : 'B站视频顶层评论单页；楼中楼通过 parentId 分页',
    metadata: { aid: oid, parentId: request.parentId, pageNo, pageSize: actualPageSize, total: count, order } };
}

function songId(url: string) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'music.163.com') throw new Error('网易云需要 music.163.com 歌曲链接');
  const resource = parsed.hash.startsWith('#/') ? new URL(parsed.hash.slice(1), parsed.origin) : parsed;
  const value = resource.searchParams.get('id');
  if (!/^\/song\/?$/.test(resource.pathname) || !value || !/^\d+$/.test(value)) throw new Error('网易云链接需要歌曲 ID');
  return value;
}

async function neteaseApi(config: ApiConfig, path: string, params: Record<string, string>, signal: AbortSignal) {
  if (!config.baseUrl) throw new Error('网易云需要配置用户自建 api-enhanced 的 baseUrl');
  const url = endpoint(config, config.baseUrl, path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const data = await json(url, { signal }, '网易云');
  if ([301, 401].includes(Number(data.code))) throw new NotLoggedInError();
  if (data.code !== 200) throw Object.assign(new Error(`网易云接口返回错误码 ${id(data.code)}`), { code: `NETEASE_${id(data.code)}` });
  return data;
}

function neteaseComment(item: Row, song: string, parentId?: string): Comment {
  const commentId = id(item.commentId), user = object(item.user ?? {}, '网易云评论作者');
  const replied = Array.isArray(item.beReplied) ? rows(item.beReplied, '网易云回复')[0] : undefined;
  return { id: commentId, text: string(item.content), author: string(user.nickname), parentId: id(replied?.beRepliedCommentId) || parentId,
    rootId: parentId || commentId, likes: typeof item.likedCount === 'number' ? item.likedCount : undefined,
    replyCount: typeof item.replyCount === 'number' ? item.replyCount : undefined,
    publishedAt: typeof item.time === 'number' ? epoch(item.time / 1000) : undefined, url: `https://music.163.com/song?id=${song}` };
}

async function neteaseComments(config: ApiConfig, request: CommentRequest): Promise<CommentPage> {
  const song = songId(request.url), params: Record<string, string> = { id: song, limit: String(request.limit) };
  let path = 'comment/music', offset = 0, pageNo = 1;
  const order = request.order ?? 'time';
  if (!['time', 'hot', 'recommend'].includes(order)) throw new Error('网易云评论排序支持 time、hot 或 recommend');
  if (request.parentId) {
    if (!/^\d+$/.test(request.parentId)) throw new Error('网易云父评论 ID 需要数字');
    path = 'comment/floor'; params.type = '0'; params.parentCommentId = request.parentId;
    if (request.cursor) params.time = String(cursorNumber(request.cursor, 0));
  } else if (order !== 'time' || request.cursor?.startsWith('{')) {
    path = 'comment/new'; params.type = '0'; params.pageSize = String(request.limit); params.sortType = order === 'hot' ? '2' : order === 'recommend' ? '1' : '3';
    if (request.cursor) {
      const saved = object(JSON.parse(request.cursor), '网易云评论游标');
      pageNo = cursorNumber(id(saved.pageNo), 1);
      if (saved.cursor !== undefined) params.cursor = id(saved.cursor);
    }
    params.pageNo = String(pageNo);
  } else { offset = cursorNumber(request.cursor, 0); params.offset = String(offset); }
  const responseData = await neteaseApi(config, path, params, request.signal);
  const data = path === 'comment/music' ? responseData : object(responseData.data, '网易云评论');
  const items = rows(data.comments, '网易云评论');
  const comments = items.map(item => neteaseComment(item, song, request.parentId));
  const more = data.more === true || data.hasMore === true;
  let nextCursor: string | undefined;
  if (more) {
    if (path === 'comment/music') { if (comments.length) nextCursor = String(offset + comments.length); }
    else if (path === 'comment/floor') nextCursor = id(data.time) || id(data.cursor) || id(items.at(-1)?.time) || undefined;
    else nextCursor = JSON.stringify({ pageNo: pageNo + 1, ...(data.cursor !== undefined ? { cursor: data.cursor } : {}) });
  }
  return { url: `https://music.163.com/song?id=${song}`, comments, nextCursor, truncated: more,
    scope: request.parentId ? '指定网易云歌曲评论的楼层回复单页' : '网易云歌曲顶层评论单页；回复通过 parentId 分页',
    metadata: { songId: song, parentId: request.parentId, endpoint: path, total: data.total ?? data.totalCount, order,
      ...(more && !nextCursor ? { paginationUnavailable: true } : {}) } };
}

function imageInput(request: ImageRequest, mode: 'keyword' | 'reverse') {
  if (mode === 'keyword') {
    if (request.imageUrl) throw Object.assign(new Error('此来源提供关键词图片搜索，请选择反向识图来源'), { code: 'UNSUPPORTED_ACTION' });
    if (!request.query?.trim()) throw new Error('图片搜索需要关键词');
    return request.query.trim();
  }
  if (!request.imageUrl) throw new Error('反向识图需要图片 URL');
  const url = new URL(request.imageUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('图片 URL 需要 HTTP 或 HTTPS');
  return url.toString();
}

function imageHit(source: SourceName, title: string, pageUrl: unknown, imageUrl: unknown, thumbnail: unknown, metadata: Row = {}): SearchHit[] {
  const image = string(imageUrl);
  try { if (!['http:', 'https:'].includes(new URL(image).protocol)) return []; } catch { return []; }
  return hit(source, { title, url: string(pageUrl), snippet: plain(title), metadata: { imageUrl: image, thumbnail: string(thumbnail) || undefined, ...metadata } });
}

export async function serpImages(config: ApiConfig, request: ImageRequest): Promise<SearchHit[]> {
  requireKey(config);
  const url = endpoint(config, 'https://serpapi.com/', 'search.json');
  url.searchParams.set('api_key', config.apiKey!);
  let engine = 'google_lens';
  if (request.imageUrl) url.searchParams.set('url', imageInput(request, 'reverse'));
  else {
    const selected = request.platform ?? config.engine ?? 'google';
    if (!['google', 'bing', 'google_images', 'bing_images'].includes(selected)) throw new Error('关键词图片引擎需要 google 或 bing');
    engine = selected.startsWith('bing') ? 'bing_images' : 'google_images';
    url.searchParams.set('q', imageInput(request, 'keyword'));
  }
  url.searchParams.set('engine', engine);
  const data = await json(url, { signal: request.signal }, 'SerpAPI 图片');
  if (data.error) {
    if (/invalid api key|no valid api key|api key.*(?:invalid|missing)/i.test(string(data.error))) throw new NotLoggedInError();
    throw new Error('SerpAPI 图片请求失败，请核对服务状态和额度');
  }
  const items = request.imageUrl ? data.visual_matches ?? data.exact_matches ?? [] : data.images_results ?? [];
  return rows(items, 'SerpAPI 图片').flatMap(item => imageHit('serpapi', string(item.title), item.link, item.original ?? item.image ?? item.thumbnail, item.thumbnail,
    { matchType: request.imageUrl ? 'visual' : 'keyword', searchEngine: engine, imageSource: item.source, similarity: item.similarity })).slice(0, request.limit);
}

export async function braveImages(config: ApiConfig, request: ImageRequest): Promise<SearchHit[]> {
  requireKey(config);
  const url = endpoint(config, 'https://api.search.brave.com/', 'res/v1/images/search');
  url.searchParams.set('q', imageInput(request, 'keyword')); url.searchParams.set('count', String(request.limit));
  const data = await json(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': config.apiKey! }, signal: request.signal }, 'Brave 图片');
  return rows(data.results, 'Brave 图片').flatMap(item => {
    const properties = object(item.properties ?? {}, 'Brave 图片属性'), thumbnail = object(item.thumbnail ?? {}, 'Brave 缩略图');
    return imageHit('brave', string(item.title), item.url, properties.url, thumbnail.src, { matchType: 'keyword', imageSource: item.source });
  }).slice(0, request.limit);
}

function baiduUrl(value: unknown) {
  const text = string(value);
  if (/^https?:\/\//.test(text)) return text;
  const keys = 'wkv1ju2it3hs4g5rq6fp7eo8dn9cm0bl', values = 'abcdefghijklmnopqrstuvw123456789';
  const table = Object.fromEntries([...keys].map((key, i) => [key, values[i]!]));
  return text.replace(/_z2C\$q/g, ':').replace(/_z&e3B/g, '.').replace(/AzdH3F/g, '/').replace(/[a-z0-9]/g, key => table[key] ?? key);
}

async function baiduImages(config: ApiConfig, request: ImageRequest) {
  const url = endpoint(config, 'https://image.baidu.com/', 'search/acjson');
  for (const [key, value] of Object.entries({ tn: 'resultjson_com', ipn: 'rj', word: imageInput(request, 'keyword'), pn: '0', rn: String(request.limit) })) url.searchParams.set(key, value);
  const data = await json(url, { headers: { ...browserHeaders, Referer: 'https://image.baidu.com/' }, signal: request.signal }, '百度图片');
  return rows(data.data, '百度图片').flatMap(item => {
    const replacement = Array.isArray(item.replaceUrl) ? rows(item.replaceUrl, '百度图片链接')[0] : undefined;
    return imageHit('baidu-images', string(item.fromPageTitleEnc) || string(item.fromPageTitle), replacement?.FromURL ?? replacement?.FromUrl ?? baiduUrl(item.fromURL),
      replacement?.ObjURL ?? replacement?.ObjUrl ?? baiduUrl(item.objURL), item.thumbURL, { matchType: 'keyword', retrievalMethod: 'search/acjson', width: item.width, height: item.height, imageSource: item.fromURLHost });
  }).slice(0, request.limit);
}

async function sogouImages(config: ApiConfig, request: ImageRequest) {
  const query = imageInput(request, 'keyword'), url = endpoint(config, 'https://pic.sogou.com/', 'napi/pc/searchList');
  for (const [key, value] of Object.entries({ mode: '1', start: '0', xml_len: String(request.limit), query, rawQuery: query })) url.searchParams.set(key, value);
  const headers = { ...browserHeaders, Referer: 'https://pic.sogou.com/' };
  const data = await json(url, { headers, signal: request.signal }, '搜狗图片');
  let items: Row[], retrievalMethod = 'napi/pc/searchList';
  if (data.status === 0) {
    const payload = object(data.data, '搜狗图片');
    items = rows(payload.items ?? payload.searchList, '搜狗图片');
  } else if (data.info === 'forbid') {
    const page = endpoint(config, 'https://pic.sogou.com/', 'pics'); page.searchParams.set('query', query);
    const text = await (await response(page, { headers, signal: request.signal }, '搜狗图片页面')).text();
    const match = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/.exec(text);
    if (!match) throw Object.assign(new Error('搜狗图片请求被拦截'), { code: 'PLATFORM_BLOCKED' });
    const state = object(JSON.parse(match[1]!), '搜狗页面初始数据');
    items = rows(object(state.searchList, '搜狗搜索状态').searchList, '搜狗图片'); retrievalMethod = 'pics-initial-state';
  } else throw Object.assign(new Error(`搜狗图片接口返回状态 ${id(data.status)}`), { code: 'SOGOU_API_ERROR' });
  return items.flatMap(item => imageHit('sogou-images', string(item.title), item.url, item.oriPicUrl ?? item.picUrl, item.thumbUrl ?? item.locImageLink,
    { matchType: 'keyword', retrievalMethod, width: item.width, height: item.height, imageSource: item.ch_site_name })).slice(0, request.limit);
}

async function traceImages(config: ApiConfig, request: ImageRequest) {
  const url = endpoint(config, 'https://api.trace.moe/', 'search');
  url.searchParams.set('url', imageInput(request, 'reverse')); url.searchParams.set('anilistInfo', '');
  const data = await json(url, { signal: request.signal }, 'trace.moe');
  if (data.error) throw new Error('trace.moe 无法匹配此图片，请核对图片访问和接口额度');
  return rows(data.result, 'trace.moe').flatMap(item => {
    const anime = typeof item.anilist === 'object' && item.anilist ? object(item.anilist, 'trace.moe 动画') : { id: item.anilist };
    const titles = object(anime.title ?? {}, 'trace.moe 动画标题'), animeId = id(anime.id);
    if (!/^\d+$/.test(animeId)) return [];
    return imageHit('trace-moe', string(titles.native) || string(titles.romaji) || string(item.filename), `https://anilist.co/anime/${animeId}`,
      item.image, item.image, { matchType: 'animation-frame', similarity: item.similarity, similarityScale: '0..1', anilistId: animeId, episode: item.episode, from: item.from, to: item.to, filename: item.filename });
  }).slice(0, request.limit);
}

async function sauceImages(config: ApiConfig, request: ImageRequest) {
  requireKey(config);
  const url = endpoint(config, 'https://saucenao.com/', 'search.php');
  for (const [key, value] of Object.entries({ output_type: '2', api_key: config.apiKey!, url: imageInput(request, 'reverse'), numres: String(request.limit) })) url.searchParams.set(key, value);
  const data = await json(url, { signal: request.signal }, 'SauceNAO'), header = object(data.header, 'SauceNAO 状态');
  if (Number(header.status) < 0) {
    if (/api.?key|access key|not registered|invalid key/i.test(string(header.message))) throw new NotLoggedInError();
    throw Object.assign(new Error(`SauceNAO 返回错误状态 ${id(header.status)}`), { code: 'SAUCENAO_API_ERROR' });
  }
  return rows(data.results, 'SauceNAO').flatMap(item => {
    const detail = object(item.data, 'SauceNAO 匹配'), resultHeader = object(item.header, 'SauceNAO 匹配信息');
    const urls = Array.isArray(detail.ext_urls) ? detail.ext_urls.filter((url): url is string => typeof url === 'string') : [];
    return urls.slice(0, 1).flatMap(page => imageHit('saucenao', string(detail.title) || string(detail.source) || string(resultHeader.index_name), page, detail.image ?? resultHeader.thumbnail, resultHeader.thumbnail,
      { matchType: 'illustration-source', similarity: Number.parseFloat(string(resultHeader.similarity)), similarityScale: '0..100', indexId: resultHeader.index_id,
        sourceUrls: urls, creator: detail.creator ?? detail.member_name, imageKind: detail.image ? 'original' : 'match-thumbnail' }));
  }).slice(0, request.limit);
}

function capability(name: SourceName, config: ApiConfig, requirement: string, category: 'catalog' | 'images', key = false) {
  const loggedIn = key && Boolean(config.apiKey);
  return { name, search: category === 'catalog', read: category === 'catalog', images: category === 'images', comments: category === 'catalog',
    configured: config.enabled !== false && (key ? loggedIn : name === 'netease' ? Boolean(config.baseUrl) : true),
    requiresLogin: key, loggedIn, category, platforms: [name], requirement: key && !loggedIn ? notLoggedIn : requirement };
}

export function createActionSources(config: Config): Source[] {
  const youtube = config.youtube ?? {}, netease = config.netease ?? {}, baidu = config['baidu-images'] ?? {}, sogou = config['sogou-images'] ?? {}, trace = config['trace-moe'] ?? {}, sauce = config.saucenao ?? {};
  return [
    { capability: capability('youtube', youtube, 'YouTube Data API Key；视频元数据与公开评论分页', 'catalog', true),
      comments: request => youtubeComments(youtube, request),
      async search(request) {
        if (!permitted(request.domains, 'www.youtube.com')) return [];
        const data = await youtubeApi(youtube, 'search', { part: 'snippet', type: 'video', q: request.query, maxResults: String(request.limit), ...(request.since ? { publishedAfter: request.since + 'T00:00:00Z' } : {}) }, request.signal);
        return rows(data.items, 'YouTube 搜索').flatMap(item => { const snippet = object(item.snippet, 'YouTube 视频'), video = string(object(item.id, 'YouTube 视频 ID').videoId);
          return hit('youtube', { title: string(snippet.title), url: `https://www.youtube.com/watch?v=${video}`, snippet: string(snippet.description), publishedAt: date(snippet.publishedAt), metadata: { videoId: video, channelId: snippet.channelId, contentKind: 'metadata' } }); }).slice(0, request.limit);
      },
      async read(url, signal) {
        const video = youtubeId(url), data = await youtubeApi(youtube, 'videos', { part: 'snippet,contentDetails,statistics', id: video }, signal);
        const item = rows(data.items, 'YouTube 视频')[0]; if (!item) throw new Error('YouTube 未返回该视频的元数据');
        const snippet = object(item.snippet, 'YouTube 视频');
        return document('youtube', `https://www.youtube.com/watch?v=${video}`, string(snippet.title), JSON.stringify(item, null, 2), { contentKind: 'metadata', publishedAt: date(snippet.publishedAt) });
      } },
    { capability: capability('netease', netease, '需要用户自建 api-enhanced 的 baseUrl；公开歌曲和评论', 'catalog'),
      comments: request => neteaseComments(netease, request),
      async search(request) {
        if (!permitted(request.domains, 'music.163.com')) return [];
        if (request.since) throw Object.assign(new Error('网易云歌曲搜索未提供发布日期过滤'), { code: 'UNSUPPORTED_FILTER' });
        const data = await neteaseApi(netease, 'search', { keywords: request.query, type: '1', limit: String(request.limit) }, request.signal);
        const result = object(data.result, '网易云搜索');
        return (result.songs === undefined && result.songCount === 0 ? [] : rows(result.songs, '网易云歌曲')).flatMap(item => hit('netease', { title: string(item.name), url: `https://music.163.com/song?id=${id(item.id)}`,
          snippet: Array.isArray(item.artists) ? rows(item.artists, '网易云艺人').map(artist => string(artist.name)).join('、') : '', metadata: { songId: id(item.id), album: item.album, contentKind: 'metadata' } })).slice(0, request.limit);
      },
      async read(url, signal) {
        const song = songId(url), data = await neteaseApi(netease, 'song/detail', { ids: song }, signal), item = rows(data.songs, '网易云歌曲')[0];
        if (!item) throw new Error('网易云未返回该歌曲的元数据');
        return document('netease', `https://music.163.com/song?id=${song}`, string(item.name), JSON.stringify(item, null, 2), { contentKind: 'metadata' });
      } },
    { capability: capability('baidu-images', baidu, '公开关键词图片搜索；使用百度图片站内部接口', 'images'), images: request => baiduImages(baidu, request) },
    { capability: capability('sogou-images', sogou, '公开关键词图片搜索；使用搜狗图片站内部接口或页面初始数据', 'images'), images: request => sogouImages(sogou, request) },
    { capability: capability('trace-moe', trace, '公开动画帧匹配；图片 URL 需可由服务访问', 'images'), images: request => traceImages(trace, request) },
    { capability: capability('saucenao', sauce, 'SauceNAO API Key；插画等作品来源匹配', 'images', true), images: request => sauceImages(sauce, request) },
  ];
}
