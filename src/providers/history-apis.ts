import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { ApiConfig, Capability, Config, ReadOptions, SearchHit, SearchRequest, Source, SourceName } from '../types.js';
import { describeOperation, reportCoverage, selectOperation } from './operations.js';
import { date, document, endpoint, epoch, hit, object, permitted, response, rows, string } from './shared.js';
import type { Row } from './shared.js';

const uid = z.string().regex(/^[1-9]\d{0,19}$/), channelId = z.string().regex(/^UC[\w-]{22}$/), videoId = z.string().regex(/^[\w-]{11}$/);
const page = z.number().int().min(1).optional(), offset = z.number().int().min(0).optional();
const aicuLimitations = ['第三方采集记录不保证完整；评论和视频弹幕更新不实时，直播采集曾中断。', '视频弹幕的用户匹配可能不准确；无结果不能证明未发生。'];
const danmakusLimitations = ['维护方公告 2026-01-24 之前的历史弹幕丢失；仅覆盖有人录制的直播间。', '匿名全文查询最多 7 天；更大范围和高级条件需要 Token，服务端仍可能排队或拒绝。'];

function capability(name: SourceName, config: ApiConfig, operations: Capability['operations'], contentTypes: string[], requirement: string, limitations: string[], requiresLogin = false): Capability {
  return { name, search: true, read: true, configured: config.enabled !== false && (!requiresLogin || Boolean(config.apiKey)),
    category: 'platform', requiresLogin, loggedIn: !requiresLogin || Boolean(config.apiKey), accessMethod: 'api', operations, contentTypes, requirement, limitations };
}

function api(config: ApiConfig, fallback: string, name: string, keyHeader?: string) {
  return async (path: string, signal: AbortSignal, params: Row = {}, body?: Row): Promise<unknown> => {
    const url = endpoint(config, fallback, path);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
    const result = await response(url, { signal, method: body ? 'POST' : 'GET', headers: { Accept: 'application/json',
      ...(config.apiKey && keyHeader ? { [keyHeader]: config.apiKey } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }, name);
    return result.json();
  };
}

function checkEnvelope(value: unknown, name: string, codes = [0, 200]): Row {
  const envelope = object(value, name);
  if (!codes.includes(Number(envelope.code))) throw Object.assign(new Error(`${name}：${string(envelope.message) || `返回代码 ${envelope.code}`}`), { code: `${name.toUpperCase()}_${envelope.code}` });
  return object(envelope.data, name);
}

function timestamp(value: unknown): string | undefined {
  return typeof value === 'number' ? value > 1e11 ? Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : undefined : epoch(value) : date(value);
}

function boundary(value: string | undefined, end = false): number | undefined {
  return value ? Date.parse(value) + (end && /^\d{4}-\d{2}-\d{2}$/.test(value) ? 86_399_999 : 0) : undefined;
}

function filtered(request: SearchRequest, values: SearchHit[]): SearchHit[] {
  return values.filter(value => permitted(request.domains, new URL(value.url).hostname)
    && (!request.since || Boolean(value.publishedAt && Date.parse(value.publishedAt) >= boundary(request.since)!))
    && (!request.until || Boolean(value.publishedAt && Date.parse(value.publishedAt) <= boundary(request.until, true)!))).slice(0, request.limit);
}

function nextPage(values: SearchHit[], request: SearchRequest, skip = 0): { hits: SearchHit[]; remainder: boolean } {
  const matches = filtered({ ...request, limit: Number.MAX_SAFE_INTEGER }, values);
  return { hits: matches.slice(skip, skip + request.limit), remainder: matches.length > skip + request.limit };
}

function observed(values: SearchHit[]) {
  const dates = values.map(value => value.publishedAt).filter((value): value is string => Boolean(value)).sort();
  return dates.length ? { since: dates[0], until: dates.at(-1) } : undefined;
}

async function aicuTicket(config: ApiConfig, signal: AbortSignal): Promise<string> {
  const base = 'https://api.aicu.cc/';
  const enqueue = await response(endpoint(config, base, 'api/v4/queue/enqueue'), { method: 'POST', signal,
    headers: config.apiKey ? { Cookie: config.apiKey } : {} }, 'Aicu');
  const data = checkEnvelope(await enqueue.json(), 'Aicu'), ticket = z.string().min(1).parse(data.ticket);
  if (data.status === 'ready') return ticket;
  const url = endpoint(config, base, 'api/v4/queue/stream'); url.searchParams.set('ticket', ticket);
  let ready = false;
  try {
    const stream = await response(url, { signal, headers: { Accept: 'text/event-stream', ...(config.apiKey ? { Cookie: config.apiKey } : {}) } }, 'Aicu');
    if (!stream.body) throw new Error('Aicu 排队响应缺少事件流');
    const reader = stream.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (/^event:\s*ready\s*$/m.test(event)) { ready = true; return ticket; }
          if (/^event:\s*(?:expired|error)\s*$/m.test(event)) throw new Error('Aicu 排队未完成，请稍后重试');
        }
      }
      throw new Error('Aicu 排队连接已关闭');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } finally {
    if (!ready) {
      const cancel = endpoint(config, base, 'api/v4/queue/cancel'); cancel.searchParams.set('ticket', ticket);
      await response(cancel, { method: 'POST', signal: AbortSignal.timeout(1500), headers: config.apiKey ? { Cookie: config.apiKey } : {} }, 'Aicu').catch(() => {});
    }
  }
}

function aicu(config: ApiConfig): Source {
  const schema = z.strictObject({ uid, page, pageSize: z.number().int().min(1).max(100).optional(), resultOffset: offset, ticket: z.string().min(1).optional() });
  const definitions = [
    ['comments', '按 UID、关键词和发送时间检索已收录评论', 'getreply', 'reply', 'comment'],
    ['video-danmaku', '按 UID、关键词和发送时间检索已收录视频弹幕', 'getvideodm', 'videodanmu', 'video-danmaku'],
    ['live-danmaku', '按发言 UID、关键词和发送时间检索已收录直播弹幕', 'getlivedm', 'livedanmu', 'live-danmaku'],
    ['room-danmaku', '按主播 UID、关键词和发送时间检索直播间收录弹幕', 'getlivebyup', 'livedanmu', 'live-danmaku'],
  ] as const;
  const operations = definitions.map(([name, description, , , type]) => describeOperation(name, description, [type], schema));
  const get = api(config, 'https://api.aicu.cc/', 'Aicu', 'Cookie');
  const query = async (request: SearchRequest) => {
    const name = selectOperation(request, operations), definition = definitions.find(item => item[0] === name)!;
    const params = schema.parse(request.params ?? {}), pn = params.page ?? 1, ps = params.pageSize ?? Math.min(request.limit, 100);
    const pageUrl = new URL(`https://www.aicu.cc/${definition[3]}`);
    const fields = { uid: params.uid, pn, ps, keyword: request.query, stime: request.since ? Math.floor(boundary(request.since)! / 1000) : undefined,
      etime: request.until ? Math.floor(boundary(request.until, true)! / 1000) : undefined, ...(name === 'comments' ? { mode: 0 } : name === 'room-danmaku' ? { upuid: params.uid } : {}) };
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) pageUrl.searchParams.set(key, String(value));
    if (name === 'room-danmaku') pageUrl.searchParams.set('mode', 'up');
    const data = checkEnvelope(await get(`api/v4/search/${definition[2]}`, request.signal, { ...fields, need_count: true, ticket: params.ticket ?? await aicuTicket(config, request.signal) }), 'Aicu');
    const list: Row[] = name === 'comments' ? rows(data.replies, 'Aicu 评论') : name === 'video-danmaku' ? rows(data.videodmlist, 'Aicu 视频弹幕')
      : rows(data.list, 'Aicu 直播弹幕').flatMap(group => rows(group.danmu, 'Aicu 直播弹幕').map(event => ({ ...event, roominfo: group.roominfo })));
    const values = list.flatMap(item => {
      const room = item.roominfo ? object(item.roominfo, 'Aicu 直播间') : {}, dyn = item.dyn ? object(item.dyn, 'Aicu 评论出处') : {};
      const text = string(item.message ?? item.content ?? item.text), publishedAt = timestamp(item.time ?? item.ctime ?? item.ts);
      const id = String(item.rpid ?? item.id ?? createHash('sha256').update(JSON.stringify(item)).digest('hex'));
      const parentUrl = name === 'comments' ? Number(dyn.type) === 1 ? `https://www.bilibili.com/video/av${dyn.oid}` : `https://t.bilibili.com/${dyn.oid}`
        : name === 'video-danmaku' ? `https://www.bilibili.com/video/av${item.oid}` : `https://live.bilibili.com/${room.roomid}`;
      return hit('aicu', { title: `${definition[1]} · ${publishedAt ?? id}`, url: pageUrl.href, snippet: text, publishedAt,
        locator: { kind: 'event', id: `${name}:${id}`, parentUrl, occurredAt: publishedAt, ...(typeof item.progress === 'number' ? { startSeconds: item.progress / 1000 } : {}) },
        metadata: { record: item, contentType: definition[4], coverageLimitations: aicuLimitations } });
    });
    const cursor = data.cursor ? object(data.cursor, 'Aicu 分页') : {}, more = cursor.is_end === false || (typeof cursor.all_count === 'number' ? pn * ps < cursor.all_count : list.length >= ps);
    const { hits: selected, remainder } = nextPage(values, request, params.resultOffset);
    reportCoverage(request, `aicu:${name}`, { completeness: 'partial', observed: observed(selected), truncated: more || values.length > selected.length,
      ...(remainder || more ? { nextCursor: JSON.stringify({ page: remainder ? pn : pn + 1, pageSize: ps, resultOffset: remainder ? (params.resultOffset ?? 0) + selected.length : 0 }) } : {}), limitations: aicuLimitations });
    return selected;
  };
  return { capability: capability('aicu', config, operations, ['comment', 'video-danmaku', 'live-danmaku'], 'Aicu 公开查询；排队或浏览器验证可能影响访问，可选 Cookie', aicuLimitations), search: query,
    async read(url, signal, options) {
      const parsed = new URL(url); if (!['www.aicu.cc', 'aicu.cc'].includes(parsed.hostname)) throw new Error('Aicu 读取需要该站查询链接');
      const definition = definitions.find(item => `/${item[3]}` === parsed.pathname && (item[0] === 'room-danmaku') === (parsed.searchParams.get('mode') === 'up'));
      if (!definition) throw new Error('Aicu 读取需要评论或弹幕查询链接');
      const values = await query({ query: parsed.searchParams.get('keyword') ?? '', operation: definition[0], limit: Number.MAX_SAFE_INTEGER, signal,
        params: { uid: parsed.searchParams.get('uid'), page: Number(parsed.searchParams.get('pn') ?? 1), pageSize: Number(parsed.searchParams.get('ps') ?? 100) },
        since: parsed.searchParams.has('stime') ? epoch(Number(parsed.searchParams.get('stime'))) : undefined,
        until: parsed.searchParams.has('etime') ? epoch(Number(parsed.searchParams.get('etime'))) : undefined });
      const selected = options?.locator ? values.find(value => value.locator?.id === options.locator!.id) : undefined;
      if (options?.locator && !selected) throw Object.assign(new Error('Aicu 当前查询页未返回指定记录'), { code: 'CONTENT_MISMATCH' });
      return document('aicu', url, selected?.title ?? 'Aicu 收录记录', selected ? JSON.stringify(selected.metadata!.record, null, 2) : JSON.stringify(values.map(value => value.metadata!.record), null, 2),
        { contentKind: 'post', locator: selected?.locator, publishedAt: selected?.publishedAt, metadata: { bodyAvailable: true, limitations: aicuLimitations, contentScope: definition[4] } });
    } };
}

function danmakus(config: ApiConfig): Source {
  const channelsSchema = z.strictObject({ page, pageSize: z.number().int().min(1).max(100).optional() });
  const livesSchema = z.strictObject({ uid, offset, pageSize: z.number().int().min(1).max(200).optional() });
  const eventsSchema = z.strictObject({ channelUid: uid.optional(), uid: uid.optional(), cursor: z.string().min(1).optional(), resultOffset: offset, taskId: z.string().regex(/^[\w-]+$/).optional(), requestId: z.uuid().optional() });
  const operations = [describeOperation('channels', '按主播名或 UID 发现已收录直播间', ['channel'], channelsSchema),
    describeOperation('lives', '按主播 UID 分页读取已录制场次，时间范围在本页过滤', ['live-session'], livesSchema),
    describeOperation('live-events', '按关键词、时间范围和可选主播 UID 查询已收录直播弹幕', ['live-danmaku'], eventsSchema)];
  const get = api(config, 'https://api.ukamnads.icu/', 'Danmakus', 'Token');
  const data = async (path: string, signal: AbortSignal, params: Row = {}, post = false) => {
    const url = endpoint(config, 'https://api.ukamnads.icu/', path);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
    if (!post) return checkEnvelope(await get(path, signal, params), 'Danmakus');
    const result = await response(url, { signal, method: 'POST', headers: config.apiKey ? { Token: config.apiKey } : {} }, 'Danmakus');
    return checkEnvelope(await result.json(), 'Danmakus');
  };
  const task = async (id: string, signal: AbortSignal) => {
    while (true) {
      const value = await data(`api/v2/danmaku/search/async/${encodeURIComponent(id)}`, signal);
      if (value.status === 'completed') return object(value.result, 'Danmakus 检索结果');
      if (value.status === 'failed') throw new Error(`Danmakus：${string(value.error) || '查询失败'}`);
      if (!['queued', 'running'].includes(string(value.status))) throw new Error('Danmakus 查询状态不可识别');
      await delay(1000, undefined, { signal });
    }
  };
  const eventHits = (items: Row[], url: string) => items.flatMap(item => hit('danmakus', {
    title: `${string(item.channelName)} · ${string(item.liveTitle)}`, url, snippet: string(item.text), publishedAt: timestamp(item.ts),
    locator: { kind: 'event', id: `${item.liveId}:${item.seq}`, parentUrl: `https://danmakus.com/live/${item.liveId}`, occurredAt: timestamp(item.ts),
      ...(typeof item.ts === 'number' && typeof item.liveStart === 'number' ? { startSeconds: Math.max(0, (item.ts - item.liveStart) / 1000) } : {}) }, metadata: { record: item, contentType: 'live-danmaku' } }));
  return { capability: capability('danmakus', config, operations, ['channel', 'live-session', 'live-danmaku'], '已录制直播数据；可选 Danmakus Token', danmakusLimitations),
    async search(request) {
      const operation = selectOperation(request, operations); let values: SearchHit[], nextCursor: string | undefined, truncated = false, resultOffset = 0, taskId: string | undefined;
      if (operation === 'channels') {
        const params = channelsSchema.parse(request.params ?? {}), pn = params.page ?? 1;
        const value = await data('api/v2/channel/filter', request.signal, { keyword: request.query, pageNum: pn, pageSize: params.pageSize ?? Math.min(request.limit, 100) });
        values = rows(value.data, 'Danmakus 直播间').flatMap(item => hit('danmakus', { title: string(item.uName), url: `https://danmakus.com/channel/${item.uId}`, snippet: string(item.title), metadata: { record: item, contentType: 'channel' } }));
        truncated = value.hasMore === true; if (truncated) nextCursor = String(pn + 1);
      } else if (operation === 'lives') {
        const params = livesSchema.parse(request.params ?? {}), skip = params.offset ?? 0;
        const value = await data('api/v2/channel', request.signal, { uId: params.uid, includeLive: true, includeExtra: false, includeFansHistory: false, maxLives: params.pageSize ?? Math.min(request.limit, 200), livesOffset: skip });
        const list = rows(value.lives, 'Danmakus 场次');
        values = list.flatMap(item => hit('danmakus', { title: string(item.title), url: `https://danmakus.com/live/${item.liveId}`, snippet: JSON.stringify(item), publishedAt: timestamp(item.startDate),
          locator: { kind: 'record', id: String(item.liveId) }, metadata: { record: item, contentType: 'live-session' } }));
        truncated = value.hasMoreLives === true; if (truncated) nextCursor = String(skip + list.length);
      } else {
        const params = eventsSchema.parse(request.params ?? {}), start = boundary(request.since), end = boundary(request.until, true);
        if (!params.taskId && (start === undefined || end === undefined || end <= start)) throw new Error('Danmakus 直播弹幕查询需要 since、until 时间范围');
        const requestId = params.requestId ?? randomUUID(), fields = { q: request.query, start, end, limit: 200, priority: Boolean(config.apiKey), requestId, channelUid: params.channelUid, uid: params.uid, cursor: params.cursor };
        const id = params.taskId ?? z.string().regex(/^[\w-]+$/).parse((await data('api/v2/danmaku/search/async', request.signal, fields, true)).taskId);
        taskId = id; resultOffset = params.resultOffset ?? 0;
        reportCoverage(request, 'danmakus:live-events', { completeness: 'partial', nextCursor: `task:${id}`, limitations: [...danmakusLimitations, `排队任务 ${id}；中断后可通过 params.taskId 续读。`] });
        const value = await task(id, request.signal), list = rows(value.hits, 'Danmakus 弹幕'), url = new URL('https://danmakus.com/search/content');
        for (const [key, value] of Object.entries({ ...fields, taskId: id })) if (value !== undefined) url.searchParams.set(key, String(value));
        values = eventHits(list, url.href); nextCursor = string(value.nextCursor) || undefined; truncated = Boolean(nextCursor);
      }
      const { hits: selected, remainder } = nextPage(values, request, resultOffset);
      if (operation === 'live-events' && remainder) nextCursor = JSON.stringify({ taskId, resultOffset: resultOffset + selected.length });
      reportCoverage(request, `danmakus:${operation}`, { completeness: 'partial', observed: observed(selected), truncated: truncated || selected.length < values.length,
        ...(nextCursor ? { nextCursor } : {}), limitations: [...danmakusLimitations, ...(operation === 'lives' ? ['日期仅过滤本页已录制场次，继续分页才能检查更早记录。'] : [])] });
      return selected;
    },
    async read(url, signal, options) {
      const parsed = new URL(url); if (parsed.hostname !== 'danmakus.com') throw new Error('Danmakus 读取需要该站直播间、场次或查询链接');
      if (parsed.pathname === '/search/content') {
        const id = z.string().regex(/^[\w-]+$/).parse(parsed.searchParams.get('taskId')), result = await task(id, signal);
        const values = eventHits(rows(result.hits, 'Danmakus 弹幕'), url), selected = options?.locator ? values.find(value => value.locator?.id === options.locator!.id) : undefined;
        if (options?.locator && !selected) throw Object.assign(new Error('Danmakus 当前查询任务未返回指定事件'), { code: 'CONTENT_MISMATCH' });
        return document('danmakus', url, selected?.title ?? 'Danmakus 弹幕查询记录', JSON.stringify(selected?.metadata?.record ?? result, null, 2),
          { contentKind: 'post', locator: selected?.locator, publishedAt: selected?.publishedAt, metadata: { bodyAvailable: true, limitations: danmakusLimitations } });
      }
      const channel = parsed.pathname.match(/^\/channel\/([1-9]\d*)$/)?.[1], live = parsed.pathname.match(/^\/live\/([\w-]+)$/)?.[1];
      if (!channel && !live) throw new Error('Danmakus 链接缺少直播间或场次 ID');
      const value = await data(channel ? 'api/v2/channel' : `api/v3/lives/${live}/insights`, signal, channel ? { uId: channel, includeLive: false, includeExtra: true, includeFansHistory: false } : {});
      return document('danmakus', url, channel ? `直播间 ${channel}` : `场次 ${live}`, JSON.stringify(value, null, 2),
        { contentKind: 'metadata', locator: { kind: 'record', id: channel ?? live! }, metadata: { contentScope: channel ? 'channel' : 'live-insights', limitations: danmakusLimitations } });
    } };
}

function filmot(config: ApiConfig): Source {
  const schema = z.strictObject({ channelId: channelId.optional(), lang: z.string().min(1).max(20).optional(), manual: z.boolean().optional(), page,
    pageSize: z.number().int().min(1).max(500).optional(), resultOffset: offset,
    title: z.string().optional(), sortField: z.enum(['id', 'viewcount', 'likecount', 'uploaddate', 'duration', 'chanrank', 'channelvariety', 'bm25match']).optional() });
  const operations = [describeOperation('subtitles', '跨视频检索 Filmot 已索引字幕中的实际片段', ['subtitle'], schema)];
  const limitations = ['仅覆盖 Filmot 已索引且仍可取得的字幕；匹配片段不代表完整字幕或历史视频存档。', '字幕检索消耗 API credits；HTTP 429 也可能表示 credits 不足。'];
  const get = api(config, 'https://apiv1.filmot.com/api/v1/', 'Filmot', 'X-API-Key');
  return { capability: capability('filmot', config, operations, ['subtitle', 'video-metadata'], 'Filmot API Key；字幕检索按 credits 计费', limitations, true),
    async search(request) {
      selectOperation(request, operations); const params = schema.parse(request.params ?? {}), pn = params.page ?? 1, size = params.pageSize ?? Math.min(request.limit, 500);
      const result = object(await get('getsubtitlesearch', request.signal, { query: request.query, channelID: params.channelId, lang: params.lang, title: params.title,
        searchManualSubs: params.manual ? 1 : 0, page: pn, perPageCount: size, format: 'json', exportInline: 1, getSnippets: 1,
        columns: 'id,title,uploaddate,channelid,channelname,lang,hits', startDate: request.since?.slice(0, 10), endDate: request.until?.slice(0, 10), sortField: params.sortField ?? 'bm25match' }), 'Filmot');
      const list = rows(result.result, 'Filmot'), values = list.flatMap(item => {
        const id = videoId.parse(item.id), lang = string(item.lang), parentUrl = `https://www.youtube.com/watch?v=${id}`;
        return (Array.isArray(item.hits) ? rows(item.hits, 'Filmot 片段') : []).flatMap(segment => {
          const start = z.number().nonnegative().parse(segment.start), end = z.number().nonnegative().parse(segment.end);
          return hit('filmot', { title: string(item.title), url: `${parentUrl}&t=${start}`, snippet: string(segment.context), publishedAt: date(item.uploaddate),
            locator: { kind: 'segment', id: `${id}:${lang}:${start}:${end}`, parentUrl, startSeconds: start, endSeconds: end },
            metadata: { contentType: 'subtitle', lang, channelId: item.channelid, context: segment, snippetOnly: true } });
        });
      });
      const { hits: selected, remainder } = nextPage(values, request, params.resultOffset), more = list.length >= size, truncated = more || remainder;
      reportCoverage(request, 'filmot:indexed-subtitles', { completeness: 'partial', observed: observed(selected), truncated,
        ...(truncated ? { nextCursor: JSON.stringify({ page: remainder ? pn : pn + 1, pageSize: size, resultOffset: remainder ? (params.resultOffset ?? 0) + selected.length : 0 }) } : {}), limitations });
      return selected;
    },
    async read(url, signal, options?: ReadOptions) {
      const parsed = new URL(url), id = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1) : /(^|\.)youtube\.com$/.test(parsed.hostname) ? parsed.searchParams.get('v') : parsed.hostname === 'filmot.com' ? parsed.pathname.match(/^\/video\/([\w-]+)$/)?.[1] : undefined;
      const video = videoId.parse(id), parts = options?.locator?.id.split(':'), lang = parts?.[0] === video ? parts[1] : undefined;
      if (options?.locator && (options.locator.kind !== 'segment' || parts?.length !== 4 || parts[0] !== video || !lang
        || Number(parts[2]) !== options.locator.startSeconds || Number(parts[3]) !== options.locator.endSeconds)) {
        throw Object.assign(new Error('Filmot 片段定位与视频、语言或时间范围不匹配'), { code: 'CONTENT_MISMATCH' });
      }
      const values = rows(await get('getvideos', signal, { id: video, columns: 'description,subtitles,ispartialdata,lastfetchdate', ...(lang ? { lang } : {}) }), 'Filmot 视频');
      const value = values.find(item => item.id === video); if (!value) throw Object.assign(new Error('Filmot 未索引该视频'), { code: 'NOT_FOUND' });
      const tracks = Array.isArray(value.subtitles) ? rows(value.subtitles, 'Filmot 字幕轨') : [];
      const chosen = tracks.filter(track => !lang || track.lang === lang), start = options?.locator?.startSeconds ?? Number(parsed.searchParams.get('t') ?? 0), end = options?.locator?.endSeconds;
      const subtitles = chosen.flatMap(track => rows(track.transcript, 'Filmot 字幕正文').filter(line => typeof line.s === 'number'
        && (end === undefined || line.s <= end) && line.s >= start).map(line => `[${track.lang} ${line.s}s] ${string(line.t)}`));
      if (!subtitles.length) throw Object.assign(new Error('Filmot 未返回指定片段的字幕正文；元数据不能代替字幕'), { code: 'CONTENT_MISMATCH' });
      return document('filmot', url, string(value.title), subtitles.join('\n'), { contentKind: 'subtitle', locator: options?.locator, publishedAt: date(value.uploaddate),
        metadata: { bodyAvailable: true, videoId: video, limitations, isPartialData: value.ispartialdata, lastFetchDate: value.lastfetchdate, contentScope: options?.locator ? 'subtitle-segment' : 'indexed-subtitles' } });
    } };
}

function holodex(config: ApiConfig): Source {
  const videosSchema = z.strictObject({ channelIds: z.array(channelId).max(10).optional(), organizations: z.array(z.string().min(1)).max(10).optional(),
    languages: z.array(z.string().min(1)).max(10).optional(), types: z.array(z.enum(['stream', 'clip'])).max(2).optional(), topics: z.array(z.string().min(1)).max(10).optional(), offset, sort: z.enum(['oldest', 'newest']).optional() });
  const channelsSchema = z.strictObject({ organization: z.string().min(1).optional(), language: z.string().min(1).optional(), type: z.enum(['vtuber', 'subber']).optional(), offset });
  const channelSchema = z.strictObject({ id: channelId });
  const operations = [describeOperation('videos', '检索直播与切片；多个频道 ID 查联动，日期仅过滤当前结果页', ['video-metadata', 'live-session'], videosSchema),
    describeOperation('channels', '按组织、语言列出频道，再在当前页匹配名称', ['channel'], channelsSchema), describeOperation('channel', '按频道 ID 读取频道资料与关联信息', ['channel'], channelSchema)];
  const limitations = ['仅覆盖 Holodex 已收录频道与视频；元数据和联动关系不代表字幕正文。', '本来源使用 Holodex API，依其公开许可与免责声明提供，不保证数据完整或实时。'];
  const get = api(config, 'https://holodex.net/api/v2/', 'Holodex', 'X-APIKEY');
  const videoHit = (item: Row) => hit('holodex', { title: string(item.title), url: `https://holodex.net/watch/${videoId.parse(item.id)}`, snippet: string(item.description) || JSON.stringify(item.channel ?? {}),
    publishedAt: date(item.available_at ?? item.published_at), locator: { kind: 'record', id: String(item.id) }, metadata: { record: item, contentType: item.type === 'stream' ? 'live-session' : 'video-metadata' } });
  const channelHit = (item: Row) => hit('holodex', { title: string(item.english_name) || string(item.name), url: `https://holodex.net/channel/${channelId.parse(item.id)}`,
    snippet: string(item.description), locator: { kind: 'record', id: String(item.id) }, metadata: { record: item, contentType: 'channel' } });
  return { capability: capability('holodex', config, operations, ['channel', 'video-metadata', 'live-session'], 'Holodex X-APIKEY；许可与免责声明：https://docs.holodex.net/#section/LICENSE', limitations, true),
    async search(request) {
      const operation = selectOperation(request, operations), limit = Math.min(request.limit, 50); let values: SearchHit[], more = false, skip = 0;
      if (operation === 'channel') {
        const params = channelSchema.parse(request.params ?? {}); values = channelHit(object(await get(`channels/${params.id}`, request.signal), 'Holodex 频道'));
      } else if (operation === 'channels') {
        const params = channelsSchema.parse(request.params ?? {}); skip = params.offset ?? 0;
        const list = rows(await get('channels', request.signal, { limit, offset: skip, org: params.organization, lang: params.language, type: params.type }), 'Holodex 频道');
        const needle = request.query.trim().toLowerCase(); more = list.length >= limit;
        values = list.filter(item => !needle || needle === '*' || [item.name, item.english_name, item.id].some(value => string(value).toLowerCase().includes(needle))).flatMap(channelHit);
      } else {
        const params = videosSchema.parse(request.params ?? {}); skip = params.offset ?? 0;
        const result = object(await get('search/videoSearch', request.signal, {}, { sort: params.sort ?? 'newest', comment: [], offset: skip, limit, paginated: true,
          conditions: request.query.trim() && request.query !== '*' ? [{ text: request.query }] : [], vch: params.channelIds ?? [], org: params.organizations ?? [], lang: params.languages ?? [], target: params.types ?? ['stream', 'clip'], topic: params.topics ?? [] }), 'Holodex 视频');
        const list = rows(result.items, 'Holodex 视频'); more = typeof result.total === 'number' ? skip + list.length < result.total : list.length >= limit; values = list.flatMap(videoHit);
      }
      const selected = filtered(request, values);
      reportCoverage(request, `holodex:${operation}`, { completeness: 'partial', observed: observed(selected), truncated: more || selected.length < values.length,
        ...(more ? { nextCursor: String(skip + limit) } : {}), limitations: [...limitations, ...(request.since || request.until ? ['日期范围仅在当前返回页过滤，不代表已遍历该时间段。'] : []), ...(operation === 'channels' ? ['名称只匹配当前频道页，需继续分页检查其他频道。'] : [])] });
      return selected;
    },
    async read(url, signal) {
      const parsed = new URL(url); if (parsed.hostname !== 'holodex.net') throw new Error('Holodex 读取需要该站视频或频道链接');
      const channel = parsed.pathname.match(/^\/channel\/([\w-]+)$/)?.[1], video = parsed.pathname.match(/^\/watch\/([\w-]+)$/)?.[1];
      if (!channel && !video) throw new Error('Holodex 链接缺少频道或视频 ID');
      const id = channel ? channelId.parse(channel) : videoId.parse(video), value = object(await get(channel ? `channels/${id}` : `videos/${id}`, signal), 'Holodex 记录');
      if (value.id !== id) throw Object.assign(new Error('Holodex 返回记录与请求 ID 不匹配'), { code: 'CONTENT_MISMATCH' });
      return document('holodex', url, string(value.title) || string(value.name), JSON.stringify(value, null, 2),
        { contentKind: 'metadata', locator: { kind: 'record', id }, publishedAt: date(value.available_at ?? value.published_at), metadata: { contentScope: channel ? 'channel' : 'video-and-relations', limitations } });
    } };
}

export function createHistoryApiSources(config: Config): Source[] {
  return [aicu(config.aicu ?? {}), danmakus(config.danmakus ?? {}), filmot(config.filmot ?? {}), holodex(config.holodex ?? {})];
}
