import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AccessPolicy, Config, Document, ReadOptions, SearchHit, SearchRequest, Source } from '../types.js';
import { createStructuredSource } from '../connectors.js';
import type { ConnectorDefinition, ConnectorOperation, StructuredClient } from '../connectors.js';
import { date, decoded, document, epoch, hit, object, permitted, plain, rows, string } from './shared.js';
import type { Row } from './shared.js';
import { reportCoverage } from './operations.js';

const text = z.string().trim().min(1).max(1024), id = z.string().regex(/^[\w-]+$/), skip = z.number().int().nonnegative().default(0);
const page = z.number().int().min(1).max(10000).default(1), uuid = z.uuid();
const free: AccessPolicy = { authentication: 'none', billing: 'free' };
const key: AccessPolicy = { authentication: 'api-key', billing: 'free' };
const op = (description: string, contentTypes: string[], schema: z.ZodType): ConnectorOperation => ({ description, content_types: contentTypes, input_schema: z.toJSONSchema(schema) });

export const hobbyDefinitions: ConnectorDefinition[] = [
  { id: 'chatarchive', type: 'custom', base_url: 'https://api.chatarchive.tv/', label: 'Twitch 已归档场次与免费聊天回放', access: { ...free, evidence: 'https://chatarchive.tv/pricing' },
    operations: { streams: op('按已收录频道列举场次', ['live-session'], z.strictObject({ channel: z.string().regex(/^[\w]{1,25}$/).optional(), offset: skip })),
      replay: op('读取指定已录制场次的免费聊天回放页，关键词仅筛选当前页', ['live-chat'], z.strictObject({ streamId: z.string().regex(/^\d+$/), offset: skip })) },
    limitations: ['仅有已监控并保留的场次；免费回放不等于全历史关键词搜索；不使用付费 API、导出或全历史搜索。', '当前网页公开读取协议可能变动，权限与可用范围以响应为准。'] },
  { id: 'sakugabooru', type: 'rest', base_url: 'https://www.sakugabooru.com/', label: '动画作画片段、标签与出处', access: { ...free, evidence: 'https://www.sakugabooru.com/help/api' }, limits: { min_interval_ms: 500 },
    operations: { posts: op('按作品、动画师和镜头标签组合检索片段记录', ['animation-clip'], z.strictObject({ page, tags: text.optional() })) }, limitations: ['标签由社区整理；记录元数据不代表视频仍可下载，也不代替作品官方署名。'] },
  { id: 'isthereanydeal', type: 'rest', base_url: 'https://api.isthereanydeal.com/', label: 'PC 游戏跨商店价格', auth: { type: 'api-key', header: 'ITAD-API-Key' }, access: { ...key, quota: '已验证邮箱默认1000次/5分钟窗口；按429和Retry-After节流', evidence: 'https://docs.isthereanydeal.com/' }, limits: { min_interval_ms: 310 },
    operations: { games: op('按标题发现 ITAD 游戏 ID', ['game-metadata'], z.strictObject({})), prices: op('按游戏 ID 和地区读取当前跨商店报价', ['game-price'], z.strictObject({ gameIds: z.array(uuid).min(1).max(20), country: z.string().regex(/^[A-Z]{2}$/).default('US'), resultOffset: skip })),
      'history-lows': op('取得指定游戏和地区的历史最低价，权限以当前 Key 响应为准', ['game-price-history'], z.strictObject({ gameIds: z.array(uuid).min(1).max(20), country: z.string().regex(/^[A-Z]{2}$/).default('US'), resultOffset: skip })),
      history: op('读取指定游戏的价格变更事件；未指定起点时上游默认近三个月', ['game-price-history'], z.strictObject({ gameId: uuid, country: z.string().regex(/^[A-Z]{2}$/).default('US'), shops: z.array(z.number().int().positive()).max(50).optional(), since: z.string().datetime({ offset: true }).optional(), resultOffset: skip })) },
    limitations: ['免费注册应用 Key；部分端点可能另需批准；保留 IsThereAnyDeal 归属及原始商店链接参数。', '价格须结合国家、货币、商店、报价时间核对；此适配器不承诺付费或未批准历史端点。'] },
  { id: 'modrinth', type: 'rest', base_url: 'https://api.modrinth.com/v2/', label: 'Minecraft 模组、版本兼容和依赖', access: { ...free, evidence: 'https://docs.modrinth.com/api/' }, limits: { min_interval_ms: 210 },
    operations: { projects: op('按关键词与 facets 检索项目', ['mod-metadata'], z.strictObject({ offset: skip, facets: z.array(z.array(text).min(1)).max(10).optional() })),
      versions: op('按项目和兼容条件读取版本、文件校验值及依赖', ['mod-version'], z.strictObject({ projectId: id, gameVersions: z.array(text).max(20).optional(), loaders: z.array(text).max(20).optional(), resultOffset: skip })) },
    limitations: ['项目版本号和适用 Minecraft 版本分别保留；依赖 ID 需继续读取对应项目或版本。'] },
  { id: 'speedrun', type: 'rest', base_url: 'https://www.speedrun.com/api/v1/', label: 'Speedrun.com 游戏、类别和排行榜', access: { ...free, nonCommercial: true, evidence: 'https://github.com/speedruncomorg/api' }, limits: { min_interval_ms: 610 },
    operations: { games: op('按游戏名查游戏与规则入口', ['game-metadata'], z.strictObject({ offset: skip })),
      leaderboard: op('按游戏、类别及变量读取排行榜记录', ['speedrun-record'], z.strictObject({ gameId: id, categoryId: id, variables: z.record(z.string().regex(/^[\w]+$/), id).optional(), resultOffset: skip })) },
    limitations: ['数据为 CC BY-NC 4.0；排行榜依赖类别、平台、变量与审核状态，不是所有游玩记录。'] },
  { id: 'boardgamegeek', type: 'custom', base_url: 'https://boardgamegeek.com/xmlapi2/', label: 'BoardGameGeek XML API2 桌游条目', auth: { type: 'bearer' },
    access: { authentication: 'api-key', billing: 'unknown', evidence: 'https://boardgamegeek.com/using_the_xml_api' }, limits: { min_interval_ms: 5000 },
    operations: { games: op('按名称检索桌游资料；API 应用授权条件由当前账号确认', ['boardgame-metadata'], z.strictObject({ exact: z.boolean().default(false), resultOffset: skip })) },
    limitations: ['当前需核对应用注册、Token 与免费权限；未确认前降低调用优先级。', '书目、评分与版本记录不等于规则书或完整论坛讨论。'] },
  { id: 'scryfall', type: 'rest', base_url: 'https://api.scryfall.com/', label: '万智牌卡牌与印次检索', access: { ...free, evidence: 'https://scryfall.com/docs/api' }, limits: { min_interval_ms: 510 },
    operations: { cards: op('按 Scryfall 查询语法检索卡牌与印次', ['card-metadata'], z.strictObject({ page, resultOffset: skip, unique: z.enum(['cards', 'art', 'prints']).default('cards'), order: z.enum(['name', 'set', 'released', 'rarity', 'color', 'usd', 'eur', 'tix', 'cmc', 'power', 'toughness', 'edhrec', 'penny', 'artist', 'review']).default('name') })) },
    limitations: ['保持卡牌图像署名；行情是每日估计，不表示商店即时成交价；免费数据访问不可另设付费墙。'] },
  { id: 'acoustid', type: 'rest', base_url: 'https://api.acoustid.org/', label: '音频指纹识别录音及 MusicBrainz 关联', auth: { type: 'api-key', query: 'client' },
    access: { ...key, nonCommercial: true, quota: '最多3次/秒，免费仅限非商业用途', evidence: 'https://acoustid.org/webservice' }, limits: { min_interval_ms: 340 },
    operations: { fingerprint: op('通过已生成的 Chromaprint 指纹和完整音频时长识别录音', ['recording-match'], z.strictObject({ fingerprint: z.string().min(1).max(100000), duration: z.number().positive().max(86400), resultOffset: skip })) },
    limitations: ['免费仅限非商业用途；需要自行提供应用 Key、Chromaprint 指纹及音频时长，不自动安装或生成指纹。', '匹配分数与候选录音均需保留，不能把最高分自动等同于唯一身份。'] },
  { id: 'setlistfm', type: 'rest', base_url: 'https://api.setlist.fm/rest/1.0/', label: '演唱会曲目与历史修订', auth: { type: 'api-key', header: 'x-api-key' },
    access: { ...key, nonCommercial: true, quota: '需申请应用Key；按当前账号限速和Retry-After响应重试', evidence: 'https://api.setlist.fm/docs/1.0/index.html' }, limits: { min_interval_ms: 510 },
    operations: { setlists: op('按艺人、城市或演出日期发现曲目记录', ['concert-setlist'], z.strictObject({ artistMbid: uuid.optional(), city: text.optional(), country: z.string().regex(/^[A-Z]{2}$/).optional(), date: z.string().regex(/^\d{2}-\d{2}-\d{4}$/).optional(), page, resultOffset: skip })) },
    limitations: ['免费仅非商业；需申请应用 Key，按响应处理额度；社区曲目记录可能有遗漏或修订，保留 versionId。'] },
];

function record(source: string, url: string, title: string, value: unknown, identity?: string, metadata: Row = {}): Document {
  return document(source, url, title, JSON.stringify(value, null, 2), { contentKind: 'metadata', ...(identity ? { locator: { kind: 'record', id: identity } } : {}), metadata: { contentScope: 'structured-record', attribution: source, ...metadata } });
}
function finish(request: SearchRequest, values: SearchHit[], scope: string, nextCursor?: string, limitations?: string[]) {
  reportCoverage(request, scope, { completeness: 'partial', truncated: Boolean(nextCursor), ...(nextCursor ? { nextCursor } : {}), limitations });
  return values.filter(item => permitted(request.domains, new URL(item.url).hostname)
    && (!request.since || !item.publishedAt || item.publishedAt.slice(0, 10) >= request.since)
    && (!request.until || !item.publishedAt || item.publishedAt.slice(0, 10) <= request.until)).slice(0, request.limit);
}
function pageOf(values: Row[], offset: number, request: SearchRequest, params: Row, more?: Row) {
  return { values: values.slice(offset, offset + request.limit), next: offset + request.limit < values.length ? JSON.stringify({ ...params, resultOffset: offset + request.limit }) : more ? JSON.stringify(more) : undefined };
}
function xmlText(xml: string, tag: string): string { return decoded(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1') ?? ''); }
function attr(xml: string, name: string): string { return decoded(xml.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1]); }
function mismatch() { return Object.assign(new Error('来源返回内容与所请求记录不匹配'), { code: 'CONTENT_MISMATCH' }); }
function queryId(url: string, hosts: string[], pattern: RegExp): string {
  const address = new URL(url), value = hosts.includes(address.hostname) ? address.pathname.match(pattern)?.[1] : undefined;
  if (!value) throw new Error('读取需要对应来源的记录链接'); return decodeURIComponent(value);
}

function createChatArchive(config: Config, definition: ConnectorDefinition): Source {
  const stream = (item: Row) => hit(definition.id, { title: string(item.title) || `直播场次 ${item.stream_id}`, url: `https://chatarchive.tv/preview.html?stream_id=${encodeURIComponent(String(item.stream_id))}`,
    snippet: `${item.channel ?? ''} · ${item.category_name ?? ''}`, publishedAt: date(item.started_at_utc), locator: { kind: 'record', id: String(item.stream_id) }, metadata: { record: item, contentType: 'live-session' } });
  const messageId = (item: Row) => createHash('sha256').update(JSON.stringify([item.stream_id, item.sent_at, item.username, item.message])).digest('hex');
  const chat = (item: Row, offset: number, count: number) => hit(definition.id, { title: `${item.display_name ?? item.username ?? ''} · ${item.sent_at ?? ''}`, url: `https://chatarchive.tv/preview.html?stream_id=${encodeURIComponent(String(item.stream_id))}&offset=${offset}&count=${count}`,
    snippet: string(item.message), publishedAt: date(item.sent_at), locator: { kind: 'event', id: messageId(item), occurredAt: date(item.sent_at) }, metadata: { record: item, contentType: 'live-chat' } });
  return createStructuredSource(config, definition, { search: {
    streams: async (request, params, client) => { const values = rows(await client('twitch_streams', request.signal, { select: 'stream_id,channel,title,category_name,started_at_utc,ended_at_utc', order: 'started_at_utc.desc', limit: request.limit, offset: params.offset,
      ...(params.channel ? { channel: `eq.${params.channel}` } : {}), ...(request.since ? { started_at_utc: `gte.${request.since}` } : {}) }), 'ChatArchive 场次');
      return finish(request, values.flatMap(stream), 'chatarchive:recorded-streams', values.length >= request.limit ? JSON.stringify({ ...params, offset: params.offset + values.length }) : undefined, definition.limitations); },
    replay: async (request, params, client) => { const values = rows(await client('chat_with_segments', request.signal, { select: 'stream_id,display_name,username,message,sent_at,segment_title,segment_category', stream_id: `eq.${params.streamId}`, order: 'sent_at.desc', limit: request.limit, offset: params.offset }), 'ChatArchive 回放');
      const selected = values.filter(item => !request.query || request.query === '*' || string(item.message).toLowerCase().includes(request.query.toLowerCase()));
      return finish(request, selected.flatMap(item => chat(item, params.offset, request.limit)), 'chatarchive:free-replay-page', values.length >= request.limit ? JSON.stringify({ ...params, offset: params.offset + values.length }) : undefined, definition.limitations); },
  }, read: async (url, signal, options, client) => {
    const parsed = new URL(url), streamId = parsed.hostname === 'chatarchive.tv' ? parsed.searchParams.get('stream_id') : undefined;
    if (!streamId || !/^\d+$/.test(streamId)) throw new Error('ChatArchive 读取需要带 stream_id 的场次链接');
    if (options?.locator?.kind === 'event') {
      const offset = z.coerce.number().int().nonnegative().parse(parsed.searchParams.get('offset') ?? '0'), count = z.coerce.number().int().min(1).max(200).parse(parsed.searchParams.get('count') ?? '20');
      const items = rows(await client('chat_with_segments', signal, { select: 'stream_id,display_name,username,message,sent_at,segment_title,segment_category', stream_id: `eq.${streamId}`, order: 'sent_at.desc', offset, limit: count }), 'ChatArchive 回放');
      const item = items.find(item => messageId(item) === options.locator!.id); if (!item) throw mismatch();
      return document(definition.id, url, `${item.display_name ?? item.username ?? ''} · ${item.sent_at}`, string(item.message), { contentKind: 'post', publishedAt: date(item.sent_at), locator: { kind: 'event', id: messageId(item), occurredAt: date(item.sent_at) }, metadata: { record: item, contentScope: 'free-replay-event', limitations: definition.limitations } });
    }
    const values = rows(await client('twitch_streams', signal, { stream_id: `eq.${streamId}`, limit: 1 }), 'ChatArchive 场次');
    if (!values[0]) throw Object.assign(new Error('ChatArchive 未返回该场次'), { code: 'NOT_FOUND' });
    return record(definition.id, url, string(values[0].title), values[0], streamId, { limitations: definition.limitations });
  } });
}

function createSakuga(config: Config, definition: ConnectorDefinition): Source {
  return createStructuredSource(config, definition, { search: { posts: async (request, params, client) => {
    const values = rows(await client('post.json', request.signal, { tags: params.tags ?? request.query, page: params.page, limit: request.limit }), 'Sakugabooru');
    return finish(request, values.flatMap(item => hit(definition.id, { title: `作画片段 ${item.id} · ${item.tags ?? ''}`, url: `https://www.sakugabooru.com/post/show/${item.id}`, snippet: string(item.tags),
      publishedAt: epoch(item.created_at), locator: { kind: 'record', id: String(item.id) }, metadata: { record: item, fileUrl: item.file_url, sampleUrl: item.sample_url, sourceUrl: item.source } })), 'sakugabooru:posts', values.length >= request.limit ? JSON.stringify({ ...params, page: params.page + 1 }) : undefined, definition.limitations);
  } }, read: async (url, signal, _options, client) => { const identity = queryId(url, ['www.sakugabooru.com', 'sakugabooru.com'], /^\/post\/show\/(\d+)/);
    const values = rows(await client('post.json', signal, { tags: `id:${identity}`, limit: 1 }), 'Sakugabooru'), item = values.find(item => String(item.id) === identity);
    if (!item) throw mismatch(); return record(definition.id, url, `作画片段 ${identity}`, item, identity, { contentScope: 'clip-metadata-and-tags' }); } });
}

function createItad(config: Config, definition: ConnectorDefinition): Source {
  const link = (identity: string, country?: string) => `https://api.isthereanydeal.com/games/${country ? 'prices/v3' : 'info/v2'}?id=${identity}${country ? `&country=${country}` : ''}`;
  const historyId = (game: string, country: string, item: Row) => createHash('sha256').update(JSON.stringify([game, country, item])).digest('hex');
  return createStructuredSource(config, definition, { search: {
    games: async (request, _params, client) => { const values = rows(await client('games/search/v1', request.signal, { title: request.query, results: request.limit }), 'ITAD 游戏');
      return finish(request, values.flatMap(item => hit(definition.id, { title: string(item.title), url: link(String(item.id)), snippet: string(item.type), locator: { kind: 'record', id: String(item.id) }, metadata: { record: item, attribution: 'IsThereAnyDeal' } })), 'itad:games', undefined, definition.limitations); },
    prices: async (request, params, client) => { const values = rows(await client('games/prices/v3', request.signal, { country: params.country }, params.gameIds), 'ITAD 报价'), page = pageOf(values, params.resultOffset, request, params);
      return finish(request, page.values.flatMap(item => hit(definition.id, { title: `游戏报价 ${item.id}`, url: link(String(item.id), params.country), snippet: JSON.stringify(item.deals ?? []), locator: { kind: 'record', id: String(item.id) }, metadata: { record: item, country: params.country, attribution: 'IsThereAnyDeal' } })), 'itad:current-prices', page.next, definition.limitations); },
    'history-lows': async (request, params, client) => { const values = rows(await client('games/historylow/v1', request.signal, { country: params.country }, params.gameIds), 'ITAD 历史最低价'), page = pageOf(values, params.resultOffset, request, params);
      return finish(request, page.values.flatMap(item => hit(definition.id, { title: `历史最低价 ${item.id}`, url: `https://api.isthereanydeal.com/games/historylow/v1?id=${item.id}&country=${params.country}`, snippet: JSON.stringify(item.low),
        publishedAt: item.low ? date(object(item.low, 'ITAD 历史最低价').timestamp) : undefined, locator: { kind: 'record', id: `low:${item.id}:${params.country}` }, metadata: { record: item, country: params.country, attribution: 'IsThereAnyDeal' } })), 'itad:historical-low', page.next, definition.limitations); },
    history: async (request, params, client) => { const since = params.since ?? (request.since ? `${request.since}T00:00:00Z` : undefined), query = { id: params.gameId, country: params.country, shops: params.shops?.join(','), since };
      const items = rows(await client('games/history/v2', request.signal, query), 'ITAD 价格历史'), filtered = items.filter(item => (!request.until || !date(item.timestamp) || date(item.timestamp)!.slice(0, 10) <= request.until));
      const value = pageOf(filtered, params.resultOffset, request, params), url = new URL('https://api.isthereanydeal.com/games/history/v2');
      for (const [key, item] of Object.entries(query)) if (item !== undefined) url.searchParams.set(key, String(item));
      return finish(request, value.values.flatMap(item => hit(definition.id, { title: `价格变更 ${item.timestamp} · ${item.shop ? object(item.shop, 'ITAD 商店').name : ''}`, url: url.href, snippet: JSON.stringify(item.deal), publishedAt: date(item.timestamp),
        locator: { kind: 'event', id: historyId(params.gameId, params.country, item), occurredAt: date(item.timestamp) }, metadata: { record: item, gameId: params.gameId, country: params.country, attribution: 'IsThereAnyDeal', dealEnded: item.deal === null } })), 'itad:price-change-events', value.next, [...definition.limitations!, '未指定 since 时上游默认只返回近三个月；当前 Key 的额外审批与可访问范围以实际响应为准。']); },
  }, read: async (url, signal, options, client) => { const parsed = new URL(url), identity = options?.locator?.id ?? parsed.searchParams.get('id');
    if (parsed.hostname === 'api.isthereanydeal.com' && parsed.pathname === '/games/history/v2') {
      const game = uuid.parse(parsed.searchParams.get('id')), country = z.string().regex(/^[A-Z]{2}$/).parse(parsed.searchParams.get('country') ?? 'US');
      const values = rows(await client('games/history/v2', signal, Object.fromEntries(parsed.searchParams)), 'ITAD 价格历史');
      const item = options?.locator ? values.find(item => historyId(game, country, item) === options.locator!.id) : undefined;
      if (options?.locator && !item) throw mismatch();
      return document(definition.id, url, item ? `价格变更 ${item.timestamp}` : `游戏 ${game} 价格历史`, JSON.stringify(item ?? values, null, 2), { contentKind: 'metadata',
        ...(item ? { locator: { kind: 'event', id: historyId(game, country, item), occurredAt: date(item.timestamp) } } : {}), metadata: { country, gameId: game, attribution: 'IsThereAnyDeal', contentScope: 'price-change-events' } });
    }
    if (parsed.hostname === 'api.isthereanydeal.com' && parsed.pathname === '/games/historylow/v1') {
      const game = uuid.parse(parsed.searchParams.get('id')), country = z.string().regex(/^[A-Z]{2}$/).parse(parsed.searchParams.get('country') ?? 'US');
      const item = rows(await client('games/historylow/v1', signal, { country }, [game]), 'ITAD 历史最低价').find(item => item.id === game);
      if (!item) throw mismatch(); return record(definition.id, url, `历史最低价 ${game}`, item, `low:${game}:${country}`, { attribution: 'IsThereAnyDeal', country, contentScope: 'historical-low' });
    }
    if (!identity || !['api.isthereanydeal.com', 'isthereanydeal.com'].includes(parsed.hostname)) throw new Error('ITAD 读取需要游戏 ID 或检索命中的记录链接'); uuid.parse(identity);
    const prices = parsed.pathname.includes('prices'), value = prices ? rows(await client('games/prices/v3', signal, { country: parsed.searchParams.get('country') ?? 'US' }, [identity]), 'ITAD 报价').find(item => item.id === identity)
      : object(await client('games/info/v2', signal, { id: identity }), 'ITAD 游戏');
    if (!value || value.id !== identity) throw mismatch(); return record(definition.id, url, string(value.title) || `ITAD ${identity}`, value, identity, { attribution: 'IsThereAnyDeal', contentScope: prices ? 'current-store-prices' : 'game-metadata' }); } });
}

function createModrinth(config: Config, definition: ConnectorDefinition): Source {
  return createStructuredSource(config, definition, { search: {
    projects: async (request, params, client) => { const result = object(await client('search', request.signal, { query: request.query, limit: request.limit, offset: params.offset, facets: params.facets ? JSON.stringify(params.facets) : undefined }), 'Modrinth');
      const values = rows(result.hits, 'Modrinth 项目'), more = params.offset + values.length < Number(result.total_hits);
      return finish(request, values.flatMap(item => hit(definition.id, { title: string(item.title), url: `https://modrinth.com/${['mod', 'modpack', 'plugin', 'resourcepack', 'shader', 'datapack'].includes(string(item.project_type)) ? item.project_type : 'mod'}/${item.slug ?? item.project_id}`, snippet: string(item.description), publishedAt: date(item.date_created), locator: { kind: 'record', id: String(item.project_id) }, metadata: { record: item, contentType: 'mod-metadata' } })), 'modrinth:projects', more ? JSON.stringify({ ...params, offset: params.offset + values.length }) : undefined, definition.limitations); },
    versions: async (request, params, client) => { const items = rows(await client(`project/${encodeURIComponent(params.projectId)}/version`, request.signal, { game_versions: params.gameVersions ? JSON.stringify(params.gameVersions) : undefined, loaders: params.loaders ? JSON.stringify(params.loaders) : undefined }), 'Modrinth 版本');
      const value = pageOf(items, params.resultOffset, request, params);
      return finish(request, value.values.flatMap(item => hit(definition.id, { title: string(item.name) || string(item.version_number), url: `https://modrinth.com/mod/${item.project_id}/version/${item.id}`, snippet: plain(item.changelog), publishedAt: date(item.date_published), locator: { kind: 'record', id: String(item.id) }, metadata: { record: item, contentType: 'mod-version' } })), 'modrinth:versions', value.next, definition.limitations); },
  }, read: async (url, signal, options, client) => { const parsed = new URL(url), parts = parsed.pathname.split('/').filter(Boolean);
    if (parsed.hostname !== 'modrinth.com' || parts.length < 2) throw new Error('Modrinth 读取需要项目或版本链接');
    const isVersion = parts[2] === 'version', identity = options?.locator?.id ?? (isVersion ? parts[3] : parts[1]);
    if (!identity) throw new Error('Modrinth 链接缺少 ID'); const value = object(await client(`${isVersion ? 'version' : 'project'}/${encodeURIComponent(identity)}`, signal), 'Modrinth 记录');
    if (options?.locator && value.id !== identity) throw mismatch(); return record(definition.id, url, string(value.title) || string(value.name), value, String(value.id), { contentScope: isVersion ? 'version-files-and-dependencies' : 'project-metadata' }); } });
}

function createSpeedrun(config: Config, definition: ConnectorDefinition): Source {
  return createStructuredSource(config, definition, { search: {
    games: async (request, params, client) => { const result = object(await client('games', request.signal, { name: request.query, max: request.limit, offset: params.offset }), 'Speedrun');
      const values = rows(result.data, 'Speedrun 游戏'), next = result.pagination ? rows(object(result.pagination, 'Speedrun 分页').links ?? [], 'Speedrun 分页').some(item => item.rel === 'next') : values.length >= request.limit;
      return finish(request, values.flatMap(item => hit(definition.id, { title: string(object(item.names, 'Speedrun 游戏名称').international), url: string(item.weblink), snippet: string(item.abbreviation), publishedAt: date(item['release-date']), locator: { kind: 'record', id: `game:${item.id}` }, metadata: { record: item } })), 'speedrun:games', next ? JSON.stringify({ offset: params.offset + values.length }) : undefined, definition.limitations); },
    leaderboard: async (request, params, client) => { const result = object(await client(`leaderboards/${params.gameId}/category/${params.categoryId}`, request.signal, { top: Math.min(200, params.resultOffset + request.limit), ...Object.fromEntries(Object.entries(params.variables ?? {}).map(([key, value]) => [`var-${key}`, value])) }), 'Speedrun 排行榜');
      const list = rows(object(result.data, 'Speedrun 排行榜').runs, 'Speedrun 记录'), value = pageOf(list, params.resultOffset, request, params);
      return finish(request, value.values.flatMap(entry => { const item = object(entry.run, 'Speedrun run'); return hit(definition.id, { title: `第 ${entry.place} 名 · ${item.id}`, url: string(item.weblink), snippet: JSON.stringify(item.times), publishedAt: date(item.date), locator: { kind: 'record', id: `run:${item.id}` }, metadata: { place: entry.place, record: item, contentType: 'speedrun-record' } }); }), 'speedrun:leaderboard', list.length >= Math.min(200, params.resultOffset + request.limit) && params.resultOffset + request.limit < 200 ? JSON.stringify({ ...params, resultOffset: params.resultOffset + request.limit }) : value.next, definition.limitations); },
  }, read: async (url, signal, options, client) => { const parsed = new URL(url); if (!['www.speedrun.com', 'speedrun.com'].includes(parsed.hostname)) throw new Error('Speedrun 读取需要本站记录链接');
    const match = options?.locator?.id.match(/^(game|run):([\w-]+)$/), runId = parsed.pathname.match(/^\/runs?\/([\w-]+)/)?.[1], kind = match?.[1] ?? (runId ? 'run' : 'game');
    const identity = match?.[2] ?? runId ?? parsed.pathname.split('/').filter(Boolean)[0]; if (!identity) throw new Error('Speedrun 链接缺少记录标识');
    const value = object(object(await client(`${kind === 'run' ? 'runs' : 'games'}/${encodeURIComponent(identity)}`, signal), 'Speedrun').data, 'Speedrun 记录');
    if (match && value.id !== identity) throw mismatch(); return record(definition.id, url, kind === 'game' ? string(object(value.names, 'Speedrun 名称').international) : `速通 ${value.id}`, value, `${kind}:${value.id}`); } });
}

function createBgg(config: Config, definition: ConnectorDefinition): Source {
  const entries = (xml: string) => [...xml.matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/gi)].map(match => ({ id: attr(match[1]!, 'id'), xml: match[2]! }));
  return createStructuredSource(config, definition, { search: { games: async (request, params, client) => {
    const xml = String(await client('search', request.signal, { query: request.query, type: 'boardgame', exact: params.exact ? 1 : 0 }, undefined, 'text'));
    if (!/<items\b/i.test(xml)) throw new Error('BGG 未返回有效 XML API2 数据'); const items = entries(xml), value = pageOf(items, params.resultOffset, request, params);
    return finish(request, value.values.flatMap(item => hit(definition.id, { title: attr(string(item.xml).match(/<name\b[^>]*>/)?.[0] ?? '', 'value'), url: `https://boardgamegeek.com/boardgame/${item.id}`,
      snippet: `出版年 ${attr(string(item.xml).match(/<yearpublished\b[^>]*>/)?.[0] ?? '', 'value')}`, locator: { kind: 'record', id: String(item.id) }, metadata: { recordXml: item.xml } })), 'bgg:boardgame-search', value.next, definition.limitations);
  } }, read: async (url, signal, _options, client) => { const identity = queryId(url, ['boardgamegeek.com', 'www.boardgamegeek.com'], /^\/boardgame\/(\d+)/), xml = String(await client('thing', signal, { id: identity, stats: 1 }, undefined, 'text'));
    const item = entries(xml).find(item => item.id === identity); if (!item) throw mismatch();
    return document(definition.id, url, attr(item.xml.match(/<name\b[^>]*type=["']primary["'][^>]*>/)?.[0] ?? '', 'value') || `桌游 ${identity}`, xml,
      { contentKind: 'metadata', locator: { kind: 'record', id: identity }, metadata: { format: 'xml-api2', contentScope: 'boardgame-metadata-and-ratings' } }); } });
}

function createScryfall(config: Config, definition: ConnectorDefinition): Source {
  return createStructuredSource(config, definition, { search: { cards: async (request, params, client) => {
    const result = object(await client('cards/search', request.signal, { q: request.query, page: params.page, unique: params.unique, order: params.order }), 'Scryfall'), items = rows(result.data, 'Scryfall 卡牌');
    const value = pageOf(items, params.resultOffset, request, params, result.has_more ? { ...params, page: params.page + 1, resultOffset: 0 } : undefined);
    return finish(request, value.values.flatMap(item => hit(definition.id, { title: string(item.name), url: string(item.scryfall_uri), snippet: string(item.oracle_text) || JSON.stringify(item.card_faces ?? []), publishedAt: date(item.released_at), locator: { kind: 'record', id: String(item.id) }, metadata: { record: item, contentType: 'card-metadata' } })), 'scryfall:cards', value.next, definition.limitations);
  } }, read: async (url, signal, options, client) => { const parsed = new URL(url), identity = options?.locator?.id;
    if (!['scryfall.com', 'api.scryfall.com'].includes(parsed.hostname)) throw new Error('Scryfall 读取需要卡牌链接');
    const match = parsed.pathname.match(/^\/card\/([\w]+)\/([\w-]+)/), apiId = parsed.pathname.match(/^\/cards\/([\w-]+)$/)?.[1];
    const path = identity ? `cards/${uuid.parse(identity)}` : apiId ? `cards/${uuid.parse(apiId)}` : match ? `cards/${match[1]}/${match[2]}` : undefined;
    if (!path) throw new Error('Scryfall 链接缺少卡牌 ID 或版本/收藏编号'); const value = object(await client(path, signal), 'Scryfall 卡牌');
    if (identity && value.id !== identity) throw mismatch(); return record(definition.id, url, string(value.name), value, String(value.id), { contentScope: 'card-printing-and-rules' }); } });
}

function createAcoustid(config: Config, definition: ConnectorDefinition): Source {
  const results = (value: unknown) => { const result = object(value, 'AcoustID'); if (result.status !== 'ok') throw new Error(`AcoustID 未完成识别：${JSON.stringify(result.error ?? result.status)}`); return rows(result.results, 'AcoustID 匹配'); };
  return createStructuredSource(config, definition, { search: { fingerprint: async (request, params, client) => { const body = new URLSearchParams({ duration: String(params.duration), fingerprint: params.fingerprint, meta: 'recordings+releasegroups' });
    const items = results(await client('v2/lookup', request.signal, {}, body.toString(), 'json', { 'Content-Type': 'application/x-www-form-urlencoded' }));
    const value = pageOf(items, params.resultOffset, request, params);
    return finish(request, value.values.flatMap(item => hit(definition.id, { title: `录音候选 ${item.id} · 匹配 ${item.score}`, url: `https://acoustid.org/track/${item.id}`, snippet: JSON.stringify(item.recordings ?? []), locator: { kind: 'record', id: String(item.id) }, metadata: { record: item, score: item.score, contentType: 'recording-match' } })), 'acoustid:fingerprint-matches', value.next, definition.limitations);
  } }, read: async (url, signal, _options, client) => { const identity = uuid.parse(queryId(url, ['acoustid.org'], /^\/track\/([\w-]+)/)), items = results(await client('v2/lookup', signal, { trackid: identity, meta: 'recordings+releasegroups' })), item = items.find(item => item.id === identity);
    if (!item) throw mismatch(); return record(definition.id, url, `AcoustID ${identity}`, item, identity, { contentScope: 'fingerprint-linked-recordings' }); } });
}

function createSetlist(config: Config, definition: ConnectorDefinition): Source {
  const identity = (item: Row) => string(item.versionId) ? `version:${item.versionId}` : `setlist:${item.id}`;
  return createStructuredSource(config, definition, { search: { setlists: async (request, params, client) => {
    const result = object(await client('search/setlists', request.signal, { artistName: params.artistMbid ? undefined : request.query, artistMbid: params.artistMbid, cityName: params.city, countryCode: params.country, date: params.date, p: params.page }), 'setlist.fm');
    const items = rows(result.setlist, 'setlist.fm 曲目'), more = params.page * Number(result.itemsPerPage) < Number(result.total), value = pageOf(items, params.resultOffset, request, params, more ? { ...params, page: params.page + 1, resultOffset: 0 } : undefined);
    return finish(request, value.values.flatMap(item => { const artist = item.artist ? object(item.artist, 'setlist.fm 艺人') : {}; return hit(definition.id, { title: `${artist.name ?? ''} · ${item.eventDate ?? ''}`, url: string(item.url), snippet: JSON.stringify(item.sets ?? {}), locator: { kind: 'record', id: identity(item) }, metadata: { record: item, eventDate: item.eventDate, versionId: item.versionId } }); }), 'setlistfm:concerts', value.next, definition.limitations);
  } }, read: async (url, signal, options, client) => { const parsed = new URL(url); if (!['www.setlist.fm', 'setlist.fm'].includes(parsed.hostname)) throw new Error('setlist.fm 读取需要演出曲目链接');
    const version = options?.locator?.id.match(/^version:([\w-]+)$/)?.[1], identityFromUrl = parsed.pathname.match(/-([a-f\d]+)\.html$/i)?.[1];
    if (!version && !identityFromUrl) throw new Error('setlist.fm 链接缺少曲目 ID');
    const value = object(await client(version ? `setlist/version/${version}` : `setlist/${identityFromUrl}`, signal), 'setlist.fm 曲目');
    if (options?.locator && identity(value) !== options.locator.id) throw mismatch(); return record(definition.id, url, `${object(value.artist, 'setlist.fm 艺人').name} · ${value.eventDate}`, value, identity(value), { contentScope: 'concert-setlist-version', versionId: value.versionId }); } });
}

export function createHobbySources(config: Config): Source[] {
  const factories: Record<string, (config: Config, definition: ConnectorDefinition) => Source> = { chatarchive: createChatArchive, sakugabooru: createSakuga, isthereanydeal: createItad, modrinth: createModrinth, speedrun: createSpeedrun, boardgamegeek: createBgg, scryfall: createScryfall, acoustid: createAcoustid, setlistfm: createSetlist };
  return hobbyDefinitions.map(definition => factories[definition.id]!(config, definition));
}
