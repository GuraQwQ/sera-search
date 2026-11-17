import type { AccessPolicy, Config, Source, SourceOperation } from './types.js';
import { sourceConfig } from './source-config.js';

const publicFree = (evidence?: string): AccessPolicy => ({ authentication: 'none', billing: 'free', ...(evidence ? { evidence } : {}) });
const keyedQuota = (evidence: string): AccessPolicy => ({ authentication: 'api-key', billing: 'mixed', quota: '免费档与付费余额共用接口，使用前确认免费档', evidence });
const policies: Record<string, AccessPolicy> = {
  exa: keyedQuota('https://exa.ai/docs/admin/pricing'), tavily: keyedQuota('https://docs.tavily.com/documentation/api-credits'), brave: keyedQuota('https://brave.com/search/api/'), serpapi: keyedQuota('https://serpapi.com/pricing'),
  dataforseo: { authentication: 'api-key', billing: 'trial', evidence: 'https://dataforseo.com/pricing' },
  filmot: { authentication: 'api-key', billing: 'unknown', quota: '每月 credits，免费 API 档待账户确认', evidence: 'https://filmot.com/api-documentation-md' },
  zhipu: { authentication: 'api-key', billing: 'unknown', evidence: 'https://docs.bigmodel.cn/cn/guide/tools/web-search' },
  doubao: { authentication: 'api-key', billing: 'unknown', evidence: 'https://www.volcengine.com/docs/87772/2272951' },
  openalex: { authentication: 'optional', billing: 'free-quota', quota: '匿名免费每日预算；额度耗尽后等待重置', evidence: 'https://help.openalex.org/access/pricing/' },
  youtube: { authentication: 'api-key', billing: 'free-quota', quota: '每日查询与调用 units 额度', evidence: 'https://developers.google.com/youtube/v3/getting-started#quota' },
  saucenao: { authentication: 'api-key', billing: 'free-quota', quota: '免费短窗口和每日额度，以实际返回为准', evidence: 'https://saucenao.com/user.php?page=search-api' },
  instagram: { authentication: 'api-key', billing: 'free-quota', quota: '授权对象及滚动调用预算', evidence: 'https://developers.facebook.com/docs/graph-api/overview/rate-limiting' },
  holodex: { authentication: 'api-key', billing: 'free', evidence: 'https://docs.holodex.net/' },
  'semantic-scholar': { authentication: 'optional', billing: 'free', evidence: 'https://www.semanticscholar.org/product/api' },
  huggingface: { authentication: 'optional', billing: 'free', evidence: 'https://huggingface.co/docs/hub/rate-limits' },
  aicu: { authentication: 'optional', billing: 'free' },
  danmakus: { authentication: 'optional', billing: 'free' },
  linuxdo: { authentication: 'optional', billing: 'free' },
  heybox: { authentication: 'optional', billing: 'free' },
  pubmed: { authentication: 'optional', billing: 'free' },
  openreview: { authentication: 'optional', billing: 'free' },
  zenodo: { authentication: 'optional', billing: 'free' },
  bangumi: { authentication: 'optional', billing: 'free' },
  listenbrainz: { authentication: 'optional', billing: 'free' },
  'github-advisory': { authentication: 'optional', billing: 'free' },
  lastfm: { authentication: 'api-key', billing: 'free', nonCommercial: true, evidence: 'https://www.last.fm/api/tos' },
  vndb: { ...publicFree('https://api.vndb.org/kana'), nonCommercial: true },
  anilist: { ...publicFree('https://docs.anilist.co/guide/terms-of-use'), nonCommercial: true },
  discogs: { authentication: 'api-key', billing: 'free', evidence: 'https://www.discogs.com/developers' },
  twitch: { authentication: 'api-key', billing: 'free', evidence: 'https://dev.twitch.tv/docs/api/guide/' },
  discord: { authentication: 'api-key', billing: 'free', evidence: 'https://docs.discord.com/developers/topics/rate-limits' },
};

export function policyFor(source: Source, operation?: string): AccessPolicy {
  return (operation === 'read' ? source.connector?.read?.access : undefined) ?? source.capability.operations?.find(item => item.name === operation)?.access ?? source.capability.access ?? policies[source.capability.name]
    ?? { authentication: source.capability.requiresLogin ? 'api-key' : 'none', billing: 'free' };
}

export function accessState(config: Config, source: Source, operation?: string, declaredPolicy?: AccessPolicy) {
  const declared = declaredPolicy ?? policyFor(source, operation), settings = sourceConfig(config, source.capability.name);
  const policy: AccessPolicy = source.capability.name === 'openalex' && ['free-quota', 'mixed'].includes(declared.billing)
    ? { ...declared, authentication: settings.apiKey ? 'api-key' : 'optional', billing: settings.apiKey ? 'mixed' : 'free-quota', quota: settings.apiKey ? '免费每日预算耗尽后会消耗已购余额；调用前需确认账户仅使用免费档' : '匿名免费每日预算；额度耗尽后等待重置', evidence: 'https://help.openalex.org/access/pricing/' }
    : declared;
  const credentialReady = policy.authentication === 'api-key' ? Boolean(settings.apiKey) : policy.authentication === 'session' ? source.capability.configured && source.capability.loggedIn !== false : true;
  const blocked = policy.billing === 'paid' || policy.billing === 'trial';
  const confirmation = ['mixed', 'unknown'].includes(policy.billing) && settings.freeTierConfirmed !== true;
  const authenticated = policy.authentication !== 'none' && (Boolean(settings.apiKey) || policy.authentication === 'session');
  const quota = ['free-quota', 'mixed', 'unknown'].includes(policy.billing);
  const priority = blocked ? 100 : confirmation ? 90 : !credentialReady ? 80 : quota ? authenticated ? 30 : 20 : policy.authentication !== 'none' && authenticated ? 10 : 0;
  return { policy, priority, automatic: !blocked && !confirmation && credentialReady && source.capability.configured,
    ...(blocked ? { code: 'SOURCE_EXCLUDED', reason: '该操作需要付费或只有一次性试用额度' } : confirmation ? { code: 'FREE_TIER_UNCONFIRMED', reason: '免费档尚未确认，请在来源配置中设置 freeTierConfirmed 后使用' } : !credentialReady ? { code: 'NOT_LOGGED_IN', reason: '此动作需要有效的认证配置' } : {}) };
}

export function applyPolicy(config: Config, source: Source): Source {
  source.capability.access = policyFor(source);
  const state = accessState(config, source);
  source.capability.access = state.policy;
  if (source.capability.name === 'openalex') {
    source.capability.operations = source.capability.operations?.map(operation => ({ ...operation, access: accessState(config, source, operation.name, operation.access ?? state.policy).policy }));
    if (source.connector) {
      source.connector.access = state.policy;
      for (const operation of Object.values(source.connector.operations)) operation.access = accessState(config, source, undefined, operation.access ?? state.policy).policy;
    }
  }
  source.capability.priority = state.priority; source.capability.automatic = state.automatic;
  return source;
}

export function allowedOperations(operations: SourceOperation[]) { return operations.filter(item => !item.access || !['paid', 'trial'].includes(item.access.billing)); }
