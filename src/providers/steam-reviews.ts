import { z } from 'zod';
import type { ApiConfig, ReadOptions, SearchRequest } from '../types.js';
import { compactMetadata } from '../types.js';
import { describeOperation, reportCoverage } from './operations.js';
import { document, endpoint, epoch, hit, json, object, permitted, rows, string } from './shared.js';
import type { Row } from './shared.js';

const endpointPath = 'IUserReviewsService/GetAppReviews/v1/';
const uint32 = z.number().int().min(0).max(4294967295), languages = z.array(z.string().regex(/^[a-z_-]{1,32}$/)).min(1).max(32).default(['all']);
export const steamReviewsParams = z.strictObject({ appId: z.string().regex(/^[1-9]\d*$/).refine(value => Number(value) <= 4294967295), cursor: z.string().max(4096).default('*'),
  languages, sort: z.enum(['recent', 'updated', 'helpful', 'funny']).default('recent'), reviewType: z.enum(['all', 'positive', 'negative']).default('all'),
  purchaseType: z.enum(['all', 'steam', 'non-steam']).default('all'), pageSize: z.number().int().min(1).max(100).optional(), resultOffset: z.number().int().nonnegative().default(0), filterOfftopic: z.boolean().default(true) });
const payloadSchema = z.strictObject({ appid: uint32.refine(value => value > 0), filter: z.number().int().min(0).max(3).default(1), languages, cursor: z.string().max(4096).default('*'),
  review_type: z.number().int().min(0).max(2).default(0), purchase_type: z.number().int().min(0).max(2).default(1), num_per_page: z.number().int().min(1).max(100).default(20),
  filter_offtopic_activity: z.boolean().default(true), date_range_start: uint32.optional(), date_range_end: uint32.optional() });
const sortCodes = { helpful: 0, recent: 1, updated: 2, funny: 3 }, typeCodes = { all: 0, positive: 1, negative: 2 }, purchaseCodes = { steam: 0, all: 1, 'non-steam': 2 };
export const steamReviewsOperation = describeOperation('reviews', '按 AppID 读取公开评价单页；query 不作全文过滤，使用返回 cursor 续查', ['game-review'], steamReviewsParams);

function pagePayload(value: string) {
  if (!/^https?:\/\/api\.steampowered\.com\//i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!/^\/IUserReviewsService\/GetAppReviews\/v0*1\/?$/i.test(url.pathname)) return undefined;
    return payloadSchema.parse(JSON.parse(url.searchParams.get('input_json') ?? ''));
  }
  catch { return undefined; }
}

export function steamReviewsAppId(value: string): string | undefined {
  const payload = pagePayload(value);
  return payload ? String(payload.appid) : undefined;
}

function publicUrl(payload: z.output<typeof payloadSchema>, compact = false): URL {
  const url = new URL(endpointPath, 'https://api.steampowered.com/');
  // 省略 Steam 服务的默认值，保留会改变同页结果的筛选参数。
  const input = compact ? { ...payload, cursor: payload.cursor === '*' ? undefined : payload.cursor,
    review_type: payload.review_type === 0 ? undefined : payload.review_type,
    filter_offtopic_activity: payload.filter_offtopic_activity ? undefined : false } : payload;
  url.searchParams.set('input_json', JSON.stringify(input));
  return url;
}

export function steamReviewPageUrl(value: string, compact = false): string {
  const payload = pagePayload(value);
  return payload ? publicUrl(payload, compact).href : value;
}

function reviewRecord(item: Row) {
  if (!/^\d+$/.test(String(item.recommendationid ?? ''))) throw new Error('Steam 评价缺少有效 recommendationid');
  return { id: String(item.recommendationid), review: string(item.review), language: item.language, createdAt: epoch(item.timestamp_created), updatedAt: epoch(item.timestamp_updated),
    votedUp: item.voted_up, votesUp: item.votes_up, votesFunny: item.votes_funny, weightedVoteScore: item.weighted_vote_score, commentCount: item.comment_count,
    steamPurchase: item.steam_purchase, receivedForFree: item.received_for_free, writtenDuringEarlyAccess: item.written_during_early_access, refunded: item.refunded,
    developerResponse: string(item.developer_response) || undefined, developerRespondedAt: epoch(item.timestamp_dev_responded) };
}

async function fetchPage(config: ApiConfig, payload: z.output<typeof payloadSchema>, signal: AbortSignal) {
  const address = endpoint(config, 'https://api.steampowered.com/', endpointPath); address.searchParams.set('input_json', JSON.stringify(payload));
  const result = await json(address, { headers: { 'User-Agent': config.userAgent ?? 'SERA public app reviews', Accept: 'application/json' }, signal }, 'Steam 公开评价');
  const value = object(result.response, 'Steam 公开评价'), items = rows(value.reviews, 'Steam 公开评价');
  return { value, items, records: items.map(reviewRecord), url: publicUrl(payload).href };
}

export async function searchSteamReviews(config: ApiConfig, request: SearchRequest) {
  const params = steamReviewsParams.parse(request.params ?? {});
  if (!permitted(request.domains, 'api.steampowered.com') && !permitted(request.domains, 'store.steampowered.com')) return [];
  const payload = payloadSchema.parse({ appid: Number(params.appId), filter: sortCodes[params.sort], languages: params.languages, cursor: params.cursor,
    review_type: typeCodes[params.reviewType], purchase_type: purchaseCodes[params.purchaseType], num_per_page: params.pageSize ?? Math.min(request.limit, 100), filter_offtopic_activity: params.filterOfftopic,
    ...(request.since || request.until ? { date_range_start: request.since ? Math.floor(Date.parse(request.since) / 1000) : 0,
      date_range_end: request.until ? Math.floor(Date.parse(request.until + 'T23:59:59Z') / 1000) : Math.floor(Date.now() / 1000) } : {}) });
  const page = await fetchPage(config, payload, request.signal), remaining = params.resultOffset + request.limit < page.records.length;
  const cursor = string(page.value.cursor), more = page.records.length > 0 && Boolean(cursor && cursor !== params.cursor);
  const next = remaining ? { ...params, pageSize: payload.num_per_page, resultOffset: params.resultOffset + request.limit }
    : more ? { ...params, pageSize: payload.num_per_page, cursor, resultOffset: 0 } : undefined;
  const summary = page.value.query_summary as Row | undefined;
  const querySummary = Object.fromEntries(['num_reviews', 'review_score', 'review_score_desc', 'total_positive', 'total_negative', 'total_reviews']
    .flatMap(key => {
      const item = summary?.[key];
      return typeof item === 'number' && Number.isFinite(item) || typeof item === 'string' && item.length <= 120 ? [[key, item]] : [];
    }));
  reportCoverage(request, 'steam:public-app-reviews', { completeness: 'partial', truncated: Boolean(next), ...(next ? { nextCursor: JSON.stringify(next) } : {}),
    ...(typeof page.value.total_matching === 'number' ? { totalMatching: page.value.total_matching } : {}),
    ...(Object.keys(querySummary).length ? { querySummary } : {}),
    limitations: ['匿名响应可能缓存10分钟；仅当前评价页，近期或更新排序可续查到空页，热门与搞笑排序不代表完整遍历。'] });
  return page.records.slice(params.resultOffset, params.resultOffset + request.limit).flatMap(record => hit('steam', {
    title: `Steam ${params.appId} ${record.votedUp ? '推荐' : '不推荐'}评价 ${record.id}`, url: page.url, snippet: record.review, publishedAt: record.createdAt,
    locator: { kind: 'record', id: record.id, parentUrl: `https://store.steampowered.com/app/${params.appId}/` },
    metadata: { appId: params.appId, contentType: 'game-review', contentScope: 'review-record', record, [compactMetadata]: {
      appId: params.appId, contentType: 'game-review', contentScope: 'review-record', language: record.language, updatedAt: record.updatedAt,
      votedUp: record.votedUp, votesUp: record.votesUp, votesFunny: record.votesFunny, weightedVoteScore: record.weightedVoteScore, commentCount: record.commentCount,
      steamPurchase: record.steamPurchase, receivedForFree: record.receivedForFree, writtenDuringEarlyAccess: record.writtenDuringEarlyAccess,
      refunded: record.refunded, developerRespondedAt: record.developerRespondedAt,
    } } }));
}

export async function readSteamReviews(config: ApiConfig, url: string, signal: AbortSignal, options?: ReadOptions) {
  const address = new URL(url), payload = payloadSchema.parse(JSON.parse(address.searchParams.get('input_json') ?? ''));
  const page = await fetchPage(config, payload, signal), record = options?.locator ? page.records.find(item => item.id === options.locator!.id) : undefined;
  if (options?.locator && (options.locator.kind !== 'record' || !record)) throw Object.assign(new Error('Steam 当前评价页未返回指定 recommendationid'), { code: 'CONTENT_MISMATCH' });
  return document('steam', page.url, record ? `Steam ${payload.appid} 评价 ${record.id}` : `Steam ${payload.appid} 公开评价页`, record ? record.review : JSON.stringify({ reviews: page.records, querySummary: page.value.query_summary, totalMatching: page.value.total_matching, cursor: page.value.cursor }, null, 2), {
    contentKind: record ? 'post' : 'metadata', publishedAt: record?.createdAt,
    ...(record ? { locator: { kind: 'record', id: record.id, parentUrl: `https://store.steampowered.com/app/${payload.appid}/` } } : {}),
    metadata: { appId: String(payload.appid), contentType: 'game-review', contentScope: record ? 'review-record' : 'review-page', cursor: page.value.cursor,
      reviewsReturned: page.records.length, truncated: page.records.length > 0 && Boolean(string(page.value.cursor) && page.value.cursor !== payload.cursor), ...(record ? { record } : {}) } });
}
