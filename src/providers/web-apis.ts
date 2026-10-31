import type { ApiConfig, Config, SearchHit, SearchRequest, Source, SourceName } from '../types.js';
import { NotLoggedInError, notLoggedIn } from '../credentials.js';
import { object, rows, string, plain, date, hit, endpoint, json, apiHeaders, permitted } from './shared.js';

function capability(name: SourceName, config: ApiConfig, account = false) {
  const loggedIn = account ? Boolean(config.username && config.password) : Boolean(config.apiKey);
  return { name, search: true, read: false, configured: config.enabled !== false && loggedIn,
    requiresLogin: true, loggedIn, requirement: loggedIn ? '已记录' : notLoggedIn, category: 'web' as const };
}

function requireKey(config: ApiConfig) { if (!config.apiKey) throw new NotLoggedInError(); }

function boundedQuery(query: string, maximum: number, name: string) {
  if (Array.from(query).length > maximum) throw new Error(`${name} 查询最多 ${maximum} 个字符，请使用聚焦的搜索词`);
}

function engine(config: ApiConfig, request: SearchRequest) {
  const value = request.platform ?? config.engine ?? 'google';
  if (!['google', 'bing'].includes(value)) throw new Error('SERP 引擎需要 google 或 bing');
  return value;
}

function keyword(request: SearchRequest) {
  return request.query + (request.domains?.length ? ` (${request.domains.map(domain => `site:${domain}`).join(' OR ')})` : '');
}

function calendarDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${month}/${day}/${year}`;
}

function recency(since: string) {
  const days = (Date.now() - Date.parse(since)) / 86400000;
  return days <= 1 ? 'oneDay' : days <= 7 ? 'oneWeek' : days <= 28 ? 'oneMonth' : days <= 365 ? 'oneYear' : 'noLimit';
}

function filtered(results: SearchHit[], request: SearchRequest, nativeTime = false) {
  return results.filter(item => {
    if (!permitted(request.domains, new URL(item.url).hostname)) return false;
    if (!request.since) return true;
    return item.publishedAt ? Date.parse(item.publishedAt) >= Date.parse(request.since) : nativeTime;
  }).slice(0, request.limit);
}

function errorCode(value: unknown, name: string) {
  if (!value || typeof value !== 'object') throw new Error(`${name} 返回接口错误`);
  const error = object(value, name);
  const code = string(error.Code) || string(error.code) || String(error.CodeN ?? 'UNKNOWN');
  if ([error.Code, error.code, error.CodeN].some(value => ['10401', '40100'].includes(String(value)))) throw new NotLoggedInError();
  throw Object.assign(new Error(`${name} 请求失败，错误码 ${code}`), { code: `${name}_${code}` });
}

export function createWebSources(config: Config): Source[] {
  const zhipu = config.zhipu ?? {}, doubao = config.doubao ?? {}, serpapi = config.serpapi ?? {}, dataforseo = config.dataforseo ?? {};
  return [
    {
      capability: capability('zhipu', zhipu),
      async search(request) {
        requireKey(zhipu);
        boundedQuery(request.query, 70, '智谱');
        const searchEngine = zhipu.engine ?? 'search_std';
        if (!['search_std', 'search_pro', 'search_pro_sogou', 'search_pro_quark'].includes(searchEngine)) throw new Error('智谱 search_engine 不受支持');
        const payload: Record<string, unknown> = { search_query: request.query, search_engine: searchEngine, search_intent: false, content_size: 'medium' };
        if (searchEngine !== 'search_pro_quark') payload.count = searchEngine === 'search_pro_sogou' ? Math.ceil(request.limit / 10) * 10 : request.limit;
        if (request.domains?.length === 1 && searchEngine !== 'search_pro_quark') payload.search_domain_filter = request.domains[0];
        if (request.since) payload.search_recency_filter = recency(request.since);
        const data = await json(endpoint(zhipu, 'https://open.bigmodel.cn/api/paas/v4/', 'web_search'), {
          method: 'POST', headers: apiHeaders(zhipu, 'Authorization', true), body: JSON.stringify(payload), signal: request.signal,
        }, '智谱');
        if (data.error) errorCode(data.error, '智谱');
        return filtered(rows(data.search_result, '智谱').flatMap(item => hit('zhipu', {
          title: string(item.title), url: string(item.link), snippet: string(item.content), publishedAt: date(item.publish_date),
          metadata: { searchEngine, siteName: item.media, publicationTimeRaw: item.publish_date, filters: 'API 时间窗口及本地域名/发布日期过滤' },
        })), request);
      },
    },
    {
      capability: capability('doubao', doubao),
      channels: async () => ['web', 'finance', 'game', 'health', 'gov'].map(platform => ({ source: 'doubao', platform,
        search: true, read: false, configured: doubao.enabled !== false && Boolean(doubao.apiKey), browser: false,
        status: doubao.apiKey ? '已记录' : notLoggedIn })),
      async search(request) {
        requireKey(doubao);
        boundedQuery(request.query, 100, '豆包搜索');
        if ((request.domains?.length ?? 0) > 20) throw new Error('豆包搜索最多支持 20 个域名');
        const filter: Record<string, unknown> = { NeedContent: false, NeedUrl: true };
        if (request.domains?.length) filter.Sites = request.domains.join('|');
        if (request.since) filter.TimeRange = `${request.since}..${new Date().toISOString().slice(0, 10)}`;
        if (request.platform && request.platform !== 'web') {
          if (!['finance', 'game', 'health', 'gov'].includes(request.platform)) throw new Error('豆包行业搜索支持 finance、game、health 或 gov');
          filter.Industry = request.platform;
        }
        const data = await json(endpoint(doubao, 'https://open.feedcoopapi.com/search_api/', 'web_search'), {
          method: 'POST', headers: apiHeaders(doubao, 'Authorization', true),
          body: JSON.stringify({ Query: request.query, SearchType: 'web', Count: request.limit, Filter: filter, QueryControl: { QueryRewrite: false } }), signal: request.signal,
        }, '豆包搜索');
        const metadata = data.ResponseMetadata ? object(data.ResponseMetadata, '豆包搜索') : undefined;
        if (metadata?.Error) errorCode(metadata.Error, '豆包搜索');
        const result = object(data.Result, '豆包搜索');
        const items = result.WebResults == null && result.ResultCount === 0 ? [] : rows(result.WebResults, '豆包搜索');
        return filtered(items.flatMap(item => hit('doubao', {
          title: string(item.Title), url: string(item.Url), snippet: string(item.Summary) || string(item.Snippet), publishedAt: date(item.PublishTime),
          metadata: { searchEngine: 'doubao-custom', siteName: item.SiteName, publicationTimeRaw: item.PublishTime, industry: filter.Industry, contentType: 'summary' },
        })), request, Boolean(request.since));
      },
    },
    {
      capability: capability('serpapi', serpapi),
      async search(request) {
        requireKey(serpapi);
        const searchEngine = engine(serpapi, request);
        const url = endpoint(serpapi, 'https://serpapi.com/', 'search.json');
        url.searchParams.set('api_key', serpapi.apiKey!);
        url.searchParams.set('engine', searchEngine);
        url.searchParams.set('q', keyword(request));
        if (searchEngine === 'google') {
          url.searchParams.set('num', String(request.limit));
          if (request.since) url.searchParams.set('tbs', `cdr:1,cd_min:${calendarDate(request.since)}`);
        }
        const data = await json(url, { signal: request.signal }, 'SerpAPI');
        if (data.error) {
          const message = string(data.error);
          if (/invalid api key|no valid api key|api key.*(?:invalid|missing)/i.test(message)) throw new NotLoggedInError();
          throw new Error('SerpAPI 请求失败，请查看服务状态或额度');
        }
        const items = data.organic_results === undefined ? [] : rows(data.organic_results, 'SerpAPI');
        return filtered(items.flatMap(item => hit('serpapi', {
          title: string(item.title), url: string(item.link), snippet: plain(item.snippet), publishedAt: date(item.date),
          metadata: { searchEngine, publicationTimeRaw: item.date, timeFilter: request.since ? searchEngine === 'google' ? 'search-engine' : 'local-publication-date' : undefined },
        })), request, searchEngine === 'google' && Boolean(request.since));
      },
    },
    {
      capability: capability('dataforseo', dataforseo, true),
      async search(request) {
        if (!dataforseo.username || !dataforseo.password) throw new NotLoggedInError();
        const searchEngine = engine(dataforseo, request);
        if (request.since && searchEngine === 'bing') throw Object.assign(new Error('当前 DataForSEO Bing 路径未提供可核验的日期过滤，请选择 Google 或调整查询条件'), { code: 'UNSUPPORTED_FILTER' });
        const query = keyword(request);
        boundedQuery(query, 700, 'DataForSEO');
        const payload: Record<string, unknown> = { keyword: query, location_code: dataforseo.locationCode ?? 2840,
          language_code: dataforseo.languageCode ?? 'en', depth: Math.max(10, request.limit) };
        if (request.since && searchEngine === 'google') payload.search_param = `tbs=cdr:1,cd_min:${calendarDate(request.since)}`;
        const data = await json(endpoint(dataforseo, 'https://api.dataforseo.com/', `v3/serp/${searchEngine}/organic/live/advanced`), {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${dataforseo.username}:${dataforseo.password}`, 'utf8').toString('base64') },
          body: JSON.stringify([payload]), signal: request.signal,
        }, 'DataForSEO');
        const checked = (value: Record<string, unknown>) => {
          if (value.status_code === 40100) throw new NotLoggedInError();
          if (value.status_code !== 20000) throw Object.assign(new Error(`DataForSEO 请求失败，错误码 ${String(value.status_code)}`), { code: `DATAFORSEO_${String(value.status_code)}` });
        };
        checked(data);
        const items = rows(data.tasks, 'DataForSEO').flatMap(task => { checked(task); return task.result === null && task.result_count === 0 ? [] : rows(task.result, 'DataForSEO'); })
          .flatMap(result => result.items === null ? [] : rows(result.items, 'DataForSEO')).filter(item => item.type === 'organic');
        return filtered(items.flatMap(item => hit('dataforseo', {
          title: string(item.title), url: string(item.url), snippet: string(item.description),
          metadata: { searchEngine, locationCode: payload.location_code, languageCode: payload.language_code, timeFilter: request.since ? searchEngine === 'google' ? 'search-engine' : 'local-publication-date' : undefined },
        })), request, searchEngine === 'google' && Boolean(request.since));
      },
    },
  ];
}
