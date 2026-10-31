import { setTimeout as delay } from 'node:timers/promises';
import type { ApiConfig, Config, Source, SourceName, SearchRequest, SearchHit, CommentRequest, CommentPage } from '../types.js';
import { NotLoggedInError, notLoggedIn } from '../credentials.js';
import { object, rows, string, date, epoch, hit, endpoint, response, json, document, permitted, fetchResponse } from './shared.js';
import type { Row } from './shared.js';

function capability(name: SourceName, config: ApiConfig, platforms: string[]) {
  const loggedIn = Boolean(config.apiKey && (name !== 'twitch' || config.clientId));
  return { name, search: true, read: true, configured: config.enabled !== false && loggedIn,
    category: 'catalog' as const, requiresLogin: true, loggedIn, platforms, requirement: loggedIn ? '已记录；按授权范围查询' : notLoggedIn };
}

function requireKey(config: ApiConfig) { if (!config.apiKey) throw new NotLoggedInError(); }
function filtered(hits: SearchHit[], request: SearchRequest) {
  return hits.filter(item => permitted(request.domains, new URL(item.url).hostname)
    && (!request.since || item.publishedAt && Date.parse(item.publishedAt) >= Date.parse(request.since))).slice(0, request.limit);
}
function id(value: unknown, name: string) {
  const result = string(value);
  if (!/^\d+$/.test(result)) throw new Error(`${name} 需要有效数字 ID`);
  return result;
}

function twitch(config: ApiConfig): Source {
  const platforms = ['channels', 'categories', 'streams', 'videos', 'clips'];
  const cap = capability('twitch', config, platforms);
  const get = async (path: string, params: Record<string, string>, signal: AbortSignal) => {
    requireKey(config);
    if (!config.clientId) throw new NotLoggedInError();
    const url = endpoint(config, 'https://api.twitch.tv/helix/', path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return json(url, { headers: { Authorization: `Bearer ${config.apiKey}`, 'Client-Id': config.clientId }, signal }, 'Twitch');
  };
  const user = async (login: string, signal: AbortSignal) => {
    if (!/^[a-z0-9_]{1,25}$/i.test(login)) throw new Error('Twitch 频道查询需要登录名');
    const values = rows((await get('users', { login }, signal)).data, 'Twitch 用户');
    if (!values.length) throw new Error('Twitch 未找到该频道');
    return values[0]!;
  };
  return {
    capability: cap,
    channels: async () => platforms.map(platform => ({ source: 'twitch', platform, search: true, read: true, configured: cap.configured, browser: false, status: cap.loggedIn ? '已记录' : notLoggedIn })),
    async search(request) {
      const platform = request.platform ?? config.engine ?? 'channels';
      if (!platforms.includes(platform)) throw new Error('Twitch 支持 channels、categories、streams、videos、clips');
      if (request.since && !['videos', 'clips'].includes(platform)) throw new Error('当前 Twitch 查询对象不支持发布日期过滤');
      let result: Row;
      if (['channels', 'categories'].includes(platform)) result = await get(`search/${platform}`, { query: request.query, first: String(request.limit) }, request.signal);
      else {
        const owner = await user(request.query.replace(/^@/, ''), request.signal);
        const params: Record<string, string> = { first: String(request.limit), [platform === 'videos' ? 'user_id' : platform === 'clips' ? 'broadcaster_id' : 'user_login']: platform === 'streams' ? string(owner.login) : string(owner.id) };
        if (request.since && platform === 'clips') params.started_at = request.since + 'T00:00:00Z';
        result = await get(platform, params, request.signal);
      }
      const cursor = result.pagination && typeof result.pagination === 'object' ? string((result.pagination as Row).cursor) || undefined : undefined;
      return filtered(rows(result.data, 'Twitch').flatMap(item => {
        const name = string(item.display_name) || string(item.broadcaster_name) || string(item.user_name) || string(item.name);
        const title = string(item.title) || name;
        const url = string(item.url) || (platform === 'categories' ? `https://www.twitch.tv/directory/game/${encodeURIComponent(string(item.name))}`
          : `https://www.twitch.tv/${encodeURIComponent(string(item.broadcaster_login) || string(item.user_login) || name)}`);
        return hit('twitch', { title, url, snippet: string(item.description) || [string(item.game_name), string(item.broadcaster_name), string(item.language)].filter(Boolean).join(' · '),
          publishedAt: ['videos', 'clips'].includes(platform) ? date(item.created_at) : undefined,
          metadata: { id: item.id, platform, nextCursor: cursor, isLive: item.is_live, viewerCount: item.viewer_count, contentScope: 'metadata' } });
      }), request);
    },
    async read(url, signal) {
      const parsed = new URL(url), parts = parsed.pathname.split('/').filter(Boolean);
      let result: Row;
      if (parsed.hostname === 'clips.twitch.tv' && parts.length === 1) result = await get('clips', { id: parts[0]! }, signal);
      else if (['twitch.tv', 'www.twitch.tv'].includes(parsed.hostname) && parts[0] === 'videos') result = await get('videos', { id: id(parts[1], 'Twitch 视频') }, signal);
      else if (['twitch.tv', 'www.twitch.tv'].includes(parsed.hostname) && parts[1] === 'clip' && parts[2]) result = await get('clips', { id: parts[2] }, signal);
      else if (['twitch.tv', 'www.twitch.tv'].includes(parsed.hostname) && parts[0] === 'directory' && parts[1] === 'game' && parts[2]) result = await get('games', { name: decodeURIComponent(parts[2]) }, signal);
      else if (['twitch.tv', 'www.twitch.tv'].includes(parsed.hostname) && parts.length === 1) result = { data: [await user(parts[0]!, signal)] };
      else throw new Error('Twitch 读取需要频道、视频、剪辑或分类链接');
      const items = rows(result.data, 'Twitch');
      if (!items.length) throw new Error('Twitch 未返回该对象');
      return document('twitch', url, string(items[0]!.title) || string(items[0]!.display_name) || string(items[0]!.name), JSON.stringify(items, null, 2), { contentKind: 'metadata',
        publishedAt: parts[0] === 'videos' || parsed.hostname === 'clips.twitch.tv' || parts[1] === 'clip' ? date(items[0]!.created_at) : undefined,
        metadata: { contentScope: 'channel-video-clip-metadata' } });
    },
  };
}

function discord(config: ApiConfig): Source {
  const cap = capability('discord', config, ['messages']);
  const get = async (path: string, params: Record<string, string>, signal: AbortSignal) => {
    requireKey(config);
    const url = endpoint(config, 'https://discord.com/api/v10/', path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return response(url, { headers: { Authorization: `Bot ${config.apiKey}`, 'User-Agent': config.userAgent ?? 'SERA social-search' }, signal }, 'Discord');
  };
  return {
    capability: cap,
    async search(request) {
      if (request.platform && request.platform !== 'messages') throw new Error('Discord 当前查询 messages');
      requireKey(config);
      const guild = id(config.guildId, 'Discord guildId');
      if (Array.from(request.query).length > 1024) throw new Error('Discord 查询最多 1024 字符');
      const params: Record<string, string> = { content: request.query, limit: String(Math.min(request.limit, 25)) };
      if (config.channelId) params.channel_id = id(config.channelId, 'Discord channelId');
      if (request.since) params.min_id = (BigInt(Math.max(0, Date.parse(request.since) - 1420070400000)) << 22n).toString();
      let result: Row | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const received = await get(`guilds/${guild}/messages/search`, params, request.signal);
        const data = object(await received.json(), 'Discord');
        if (received.status !== 202) { result = data; break; }
        const retry = typeof data.retry_after === 'number' ? Math.max(0.1, data.retry_after) : 1;
        if (attempt === 2) throw Object.assign(new Error('Discord 搜索索引尚未就绪，请按返回时间重试'), { code: 'INDEX_PENDING', retryAfterSeconds: retry });
        await delay(retry * 1000, undefined, { signal: request.signal });
      }
      if (!Array.isArray(result?.messages)) throw new Error('Discord 未返回消息结果');
      const messages = result.messages.flatMap(group => rows(group, 'Discord 消息组')).filter(message => message.hit !== false);
      return filtered(messages.flatMap(item => {
        const messageId = id(item.id, 'Discord 消息'), channelId = id(item.channel_id, 'Discord 频道');
        const author = item.author && typeof item.author === 'object' ? item.author as Row : {};
        return hit('discord', { title: string(author.global_name) || string(author.username) || messageId,
          url: `https://discord.com/channels/${guild}/${channelId}/${messageId}`, snippet: string(item.content), publishedAt: date(item.timestamp),
          metadata: { messageId, channelId, guildId: guild, editedAt: item.edited_timestamp, reference: item.message_reference, contentAvailable: Boolean(item.content),
            totalResults: result?.total_results, nextOffset: Math.min(request.limit, 25), contentScope: 'authorized-guild-messages' } });
      }), request);
    },
    async read(url, signal) {
      const parsed = new URL(url);
      const match = ['discord.com', 'discordapp.com'].includes(parsed.hostname) ? parsed.pathname.match(/^\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/) : null;
      if (!match) throw new Error('Discord 读取需要服务器频道的完整消息链接');
      const [, guildId, channelId, messageId] = match;
      const value = object(await (await get(`channels/${channelId}/messages/${messageId}`, {}, signal)).json(), 'Discord 消息');
      let context: Row[] = [], contextError: string | undefined;
      try { context = rows(await (await get(`channels/${channelId}/messages`, { around: messageId!, limit: '10' }, signal)).json(), 'Discord 上下文'); }
      catch (error) { if (signal.aborted || error instanceof NotLoggedInError) throw error; contextError = error instanceof Error ? error.message : '上下文未取得'; }
      return document('discord', url, messageId!, JSON.stringify({ message: value, context }, null, 2), { contentKind: 'post', publishedAt: date(value.timestamp),
        metadata: { guildId, channelId, messageId, editedAt: value.edited_timestamp, reference: value.message_reference, contentScope: 'message-and-bounded-context', contentAvailable: Boolean(value.content), ...(contextError ? { contextError } : {}) } });
    },
  };
}

function instagram(config: ApiConfig): Source {
  const platforms = ['users', 'posts', 'hashtag', 'hashtag-top', 'self-media'];
  const cap = { ...capability('instagram', config, platforms), comments: true };
  const get = async (path: string, params: Record<string, string>, signal: AbortSignal) => {
    requireKey(config);
    const url = endpoint(config, 'https://graph.facebook.com/v26.0/', path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const received = await fetchResponse(url, { headers: { Authorization: `Bearer ${config.apiKey}` }, signal });
    if (received.status === 401) throw new NotLoggedInError();
    let data: Row;
    try { data = object(await received.json(), 'Instagram'); } catch { throw new Error(`Instagram 未返回有效 JSON，HTTP ${received.status}`); }
    if (data.error) {
      const error = object(data.error, 'Instagram 错误');
      if (error.code === 190) throw new NotLoggedInError();
      throw Object.assign(new Error(`Instagram 接口错误 ${String(error.code)}，请核对账号权限与请求范围`), { code: `INSTAGRAM_${String(error.code)}` });
    }
    if (!received.ok) throw Object.assign(new Error(`Instagram 请求返回 HTTP ${received.status}`), { code: `HTTP_${received.status}` });
    // Graph 分页链接可能带 Token，保存游标和是否有下一页即可。
    return JSON.parse(JSON.stringify(data, (key, value) => key === 'access_token' ? undefined : key === 'paging' && value
      ? { cursors: value.cursors, hasNext: Boolean(value.next) } : value)) as Row;
  };
  const account = () => id(config.accountId, 'Instagram accountId');
  const mediaFields = 'id,caption,media_type,permalink,timestamp,username,comments_count,like_count';
  const hashtagFields = 'id,caption,media_type,permalink,timestamp,comments_count,like_count';
  const ownerMedia = async (signal: AbortSignal) => rows((await get(`${account()}/media`, { fields: mediaFields, limit: '100' }, signal)).data, 'Instagram 账号媒体');
  const ownMedia = async (url: string, signal: AbortSignal) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'graph.facebook.com') {
      const mediaId = id(parsed.pathname.split('/').filter(Boolean).at(-1), 'Instagram 媒体');
      return get(mediaId, { fields: mediaFields }, signal);
    }
    if (!['instagram.com', 'www.instagram.com'].includes(parsed.hostname) || !/^\/(?:p|reel)\/[^/]+\/?$/.test(parsed.pathname)) throw new Error('Instagram 媒体读取需要作品链接或 Graph 媒体 ID 链接');
    const path = parsed.pathname.replace(/\/$/, '');
    // shortcut: 网页链接在账号首批媒体中解析，更旧作品需 Graph 媒体 ID 链接或增加分页。
    const item = (await ownerMedia(signal)).find(value => string(value.permalink) && new URL(string(value.permalink)).pathname.replace(/\/$/, '') === path);
    if (!item) throw new Error('该媒体不在授权账号本次返回的列表中；请核对权限或使用 Graph 媒体 ID 链接');
    return item;
  };
  const username = (query: string) => {
    const name = query.replace(/^@/, '');
    if (!/^[a-z0-9._]{1,30}$/i.test(name)) throw new Error('Instagram 用户查询需要完整用户名');
    return name;
  };
  const discovery = async (name: string, limit: number, signal: AbortSignal) => object((await get(account(), {
    fields: `business_discovery.username(${name}){id,username,name,biography,followers_count,media_count,media.limit(${limit}){${mediaFields}}}`,
  }, signal)).business_discovery, 'Instagram 专业账号');
  return {
    capability: cap,
    channels: async () => platforms.map(platform => ({ source: 'instagram', platform, search: true, read: true, configured: cap.configured, browser: false, status: cap.loggedIn ? '已记录' : notLoggedIn })),
    async search(request) {
      requireKey(config);
      const platform = request.platform ?? config.engine ?? 'users';
      if (!platforms.includes(platform)) throw new Error('Instagram 支持 users、posts、hashtag、hashtag-top、self-media');
      if (platform === 'users') {
        if (request.since) throw new Error('Instagram 用户资料没有可用的发布日期过滤');
        const name = username(request.query), item = await discovery(name, request.limit, request.signal);
        return filtered(hit('instagram', { title: string(item.name) || name, url: `https://www.instagram.com/${name}/`, snippet: string(item.biography), metadata: { id: item.id, username: name, followersCount: item.followers_count, mediaCount: item.media_count, contentScope: 'professional-account-metadata' } }), request);
      }
      let items: Row[], paging: unknown;
      if (platform === 'posts') {
        const value = await discovery(username(request.query), request.limit, request.signal);
        const media = object(value.media, 'Instagram 媒体');
        items = rows(media.data, 'Instagram'); paging = media.paging;
      } else if (platform === 'self-media') {
        const result = await get(`${account()}/media`, { fields: mediaFields, limit: String(request.limit) }, request.signal);
        items = rows(result.data, 'Instagram'); paging = result.paging;
        items = items.filter(item => string(item.caption).toLowerCase().includes(request.query.toLowerCase()));
      } else {
        const tag = request.query.replace(/^#/, '');
        if (!tag.trim()) throw new Error('Instagram hashtag 需要名称');
        const found = await get('ig_hashtag_search', { user_id: account(), q: tag }, request.signal);
        const hashtagId = Array.isArray(found.data) ? rows(found.data, 'Instagram hashtag')[0]?.id : found.id;
        if (!hashtagId) return [];
        const result = await get(`${id(hashtagId, 'Instagram hashtag')}/${platform === 'hashtag-top' ? 'top_media' : 'recent_media'}`, { user_id: account(), fields: hashtagFields, limit: String(request.limit) }, request.signal);
        items = rows(result.data, 'Instagram'); paging = result.paging;
      }
      return filtered(items.flatMap(item => hit('instagram', { title: string(item.caption).split('\n')[0] || string(item.id), url: string(item.permalink), snippet: string(item.caption), publishedAt: date(item.timestamp) ?? epoch(item.timestamp),
        metadata: { id: item.id, platform, mediaType: item.media_type, commentsCount: item.comments_count, likeCount: item.like_count, paging, contentScope: platform === 'self-media' ? 'authorized-account-media' : 'public-professional-media' } })), request);
    },
    async read(url, signal) {
      const parsed = new URL(url), match = ['instagram.com', 'www.instagram.com'].includes(parsed.hostname) ? parsed.pathname.match(/^\/([a-z0-9._]+)\/?$/i) : null;
      const item = match ? await discovery(username(match[1]!), 20, signal) : await ownMedia(url, signal);
      return document('instagram', url, string(item.name) || string(item.username) || string(item.id), JSON.stringify(item, null, 2), { contentKind: 'metadata', publishedAt: date(item.timestamp), metadata: { id: item.id, contentScope: match ? 'professional-account-and-recent-media' : 'authorized-media-metadata' } });
    },
    async comments(request: CommentRequest): Promise<CommentPage> {
      const media = await ownMedia(request.url, request.signal);
      const params: Record<string, string> = { fields: 'id,text,timestamp,username,like_count', limit: String(Math.min(request.limit, 100)) };
      if (request.cursor) params.after = request.cursor;
      const target = request.parentId ? `${id(request.parentId, 'Instagram 父评论')}/replies` : `${id(media.id, 'Instagram 媒体')}/comments`;
      const result = await get(target, params, request.signal);
      const paging = result.paging && typeof result.paging === 'object' ? result.paging as Row : {};
      const cursors = paging.cursors && typeof paging.cursors === 'object' ? paging.cursors as Row : {};
      return { url: request.url, scope: request.parentId ? 'replies' : 'top-level', nextCursor: paging.hasNext ? string(cursors.after) || undefined : undefined,
        comments: rows(result.data, 'Instagram 评论').map(item => ({ id: id(item.id, 'Instagram 评论'), text: string(item.text), author: string(item.username), publishedAt: date(item.timestamp),
          likes: typeof item.like_count === 'number' ? item.like_count : undefined, ...(request.parentId ? { parentId: request.parentId, rootId: request.parentId } : {}) })),
        metadata: { mediaId: media.id, accountId: config.accountId, contentScope: 'authorized-account-media-comments' } };
    },
  };
}

export function createSocialSources(config: Config): Source[] {
  return [twitch(config.twitch ?? {}), discord(config.discord ?? {}), instagram(config.instagram ?? {})];
}
