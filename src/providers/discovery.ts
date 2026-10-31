import type { Config, SearchHit, SearchRequest, Source, SearchAttempt } from '../types.js';
import { decoded, endpoint, hit, permitted, plain, response } from './shared.js';
import { createHttpSources } from './http.js';
import { createWebSources } from './web-apis.js';
import { errorMessage } from '../config.js';
import { invalidateCredential } from '../credentials.js';
import { assessRelevance } from './relevance.js';

async function bing(config: Config, request: SearchRequest): Promise<SearchHit[]> {
  if (request.since) throw new Error('Bing RSS 不支持统一发布日期过滤');
  const url = endpoint(config.bing ?? {}, 'https://www.bing.com/', 'search');
  url.searchParams.set('format', 'rss');
  url.searchParams.set('q', request.query + (request.domains?.length ? ` (${request.domains.map(domain => `site:${domain}`).join(' OR ')})` : ''));
  const result = await response(url, { headers: { 'User-Agent': 'SERA search', Accept: 'application/rss+xml' }, signal: request.signal }, 'Bing RSS');
  const xml = await result.text();
  if (!/<rss[\s>]/i.test(xml)) throw new Error('Bing 没有返回 RSS 搜索结果');
  const field = (item: string, name: string) => decoded(item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]?.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1') ?? '');
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap(match => {
    const value = match[1]!;
    const link = field(value, 'link');
    try { if (!permitted(request.domains, new URL(link).hostname)) return []; } catch { return []; }
    return hit('bing', { title: field(value, 'title'), url: link, snippet: plain(field(value, 'description')), metadata: { searchEngine: 'bing', transport: 'rss' } });
  }).slice(0, request.limit);
}

export function createDiscoverySources(config: Config): Source[] {
  const providers = [...createHttpSources(config), ...createWebSources(config)];
  const sites = config.catalog?.sites ?? {};
  const searchSite = async (request: SearchRequest) => {
    const site = request.platform ? sites[request.platform] : undefined;
    if (!site) throw new Error('站点查询需要 --platform，可用站点见 channels；Galgame 使用 --group galgame');
    const domains = site.domains.filter(domain => permitted(request.domains, domain));
    if (!domains.length) return [];
    const available = ['exa', 'tavily', 'brave', 'zhipu', 'doubao'].flatMap(name => {
      const provider = providers.find(source => source.capability.name === name && source.capability.configured && source.search);
      return provider ? [provider] : [];
    });
    if (config.bing?.enabled !== false) available.push({ capability: { name: 'bing', search: true, read: false, configured: true }, search: input => bing(config, input) });
    if (!available.length) throw Object.assign(new Error('站点发现没有可用搜索后端，请启用公开 Bing 或配置搜索来源'), { code: 'NO_SEARCH_BACKEND' });
    const attempts: SearchAttempt[] = [];
    const report = (attempt: SearchAttempt) => { attempts.push(attempt); request.onAttempt?.(attempt); };
    let lastError: unknown;
    let completed = false;
    const skipped = new Set<string>();
    // shortcut: 换引擎后最多重试一个显式别名，需要扩大查询预算时再增加别名轮次。
    const alias = request.aliases?.find(value => value.trim() && value.trim().toLowerCase() !== request.query.trim().toLowerCase());
    for (const query of [request.query, ...(alias ? [alias.trim()] : [])]) for (const provider of available) {
      if (skipped.has(provider.capability.name)) continue;
      request.signal.throwIfAborted();
      const started = Date.now(), backend = provider.capability.name;
      try {
        const raw = await provider.search!({ ...request, query, platform: undefined, domains });
        const scoped = raw.filter(item => { try { return permitted(domains, new URL(item.url).hostname); } catch { return false; } });
        const relevant = assessRelevance(request.query, scoped, request.aliases);
        const reason = raw.length && !scoped.length ? 'DOMAIN_MISMATCH' : relevant.reason;
        completed = true;
        report({ backend, query, status: relevant.hits.length ? 'ok' : raw.length ? 'irrelevant' : 'empty', elapsedMs: Date.now() - started, returned: relevant.hits.length, ...(reason ? { reason } : {}) });
        if (relevant.hits.length) return relevant.hits.slice(0, request.limit).map(value => ({ ...value, source: 'sites' as const, metadata: { ...value.metadata, platform: request.platform, discoveryQuery: query, discoveryBackend: backend, discoveryAttempts: attempts } }));
      } catch (error) {
        const detail = error as { code?: string; retryAfterSeconds?: number };
        report({ backend, query, status: request.signal.aborted ? 'cancelled' : 'error', elapsedMs: Date.now() - started, returned: 0, reason: errorMessage(error, config), code: detail.code, retryAfterSeconds: detail.retryAfterSeconds });
        if (request.signal.aborted) throw error;
        skipped.add(backend);
        if (detail.code === 'NOT_LOGGED_IN') {
          const expected = config.credentials?.[backend];
          if (expected) await invalidateCredential(config.home, backend, undefined, expected);
          provider.capability.configured = false;
          provider.capability.loggedIn = false;
        }
        lastError = error;
      }
    }
    if (!completed && lastError) throw lastError;
    return [];
  };
  return [
    { capability: { name: 'bing', search: true, read: false, configured: config.bing?.enabled !== false, category: 'web', requiresLogin: false, loggedIn: true, requirement: '公开 Bing RSS；只表示本次搜索返回的结果' }, search: request => bing(config, request) },
    { capability: { name: 'sites', search: true, read: false, configured: config.sites?.enabled !== false, category: 'catalog', platforms: Object.keys(sites), requiresLogin: false, loggedIn: true, requirement: '按目录域名发现公开页面' },
      channels: async () => Object.entries(sites).map(([platform, site]) => ({ source: 'sites', platform, search: true, read: false, configured: config.sites?.enabled !== false, browser: false, status: '公开可用', description: `${site.label}：${site.domains.join(', ')}${site.description ? '；' + site.description : ''}` })), search: searchSite },
  ];
}
