import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import type { AccessPolicy, ApiConfig, Config, Document, ReadOptions, SearchHit, SearchRequest, Source } from './types.js';
import { sourceConfig } from './source-config.js';
import { describeOperation, reportCoverage } from './providers/operations.js';
import { endpoint, response, plain, date, permitted } from './providers/shared.js';
import { sourceNameSchema } from './source-schema.js';
import { accessState, policyFor } from './source-policy.js';
import { specialistSites, relatedPlatforms } from './provider-catalog.js';

export interface ConnectorOperation {
  description: string;
  content_types: string[];
  input_schema: Record<string, unknown>;
  request?: { path: string; method?: 'GET' | 'POST'; query?: Record<string, unknown>; body?: unknown; format?: 'json' | 'text' };
  output?: { items?: string; id?: string; title: string; url: string; snippet?: string; published_at?: string; content_kind?: 'page' | 'post' | 'subtitle' | 'metadata' };
  pagination?: { next?: string; total?: string; cursor_param?: string };
  access?: AccessPolicy;
}
export interface ConnectorDefinition {
  id: string;
  type: 'rest' | 'graphql' | 'sdmx' | 'mediawiki' | 'custom';
  base_url: string;
  label?: string;
  platforms?: string[];
  auth?: { type: 'none' | 'api-key' | 'bearer'; header?: string; query?: string; body?: string; prefix?: string };
  access?: AccessPolicy;
  limits?: { min_interval_ms?: number; max_response_bytes?: number };
  operations: Record<string, ConnectorOperation>;
  read?: { hosts: string[]; pattern: string; request: NonNullable<ConnectorOperation['request']>; title?: string; content_kind?: 'page' | 'post' | 'subtitle' | 'metadata'; access?: AccessPolicy };
  limitations?: string[];
}
export type StructuredClient = (path: string, signal: AbortSignal, query?: Record<string, unknown>, body?: unknown, format?: 'json' | 'text' | 'response', headers?: Record<string, string>) => Promise<any>;
export interface ConnectorHooks {
  search?: Record<string, (request: SearchRequest, params: Record<string, any>, client: StructuredClient) => Promise<SearchHit[]>>;
  read?: (url: string, signal: AbortSignal, options: ReadOptions | undefined, client: StructuredClient) => Promise<Document>;
}

const accessSchema = z.object({ authentication: z.enum(['none', 'optional', 'api-key', 'session']), billing: z.enum(['free', 'free-quota', 'mixed', 'paid', 'trial', 'unknown']), quota: z.string().optional(), nonCommercial: z.boolean().optional(), evidence: z.string().url().optional() });
const requestSchema = z.object({ path: z.string().min(1), method: z.enum(['GET', 'POST']).optional(), query: z.record(z.string(), z.unknown()).optional(), body: z.unknown().optional(), format: z.enum(['json', 'text']).optional() }).refine(value => value.method !== 'GET' || value.body === undefined, 'GET 请求不能配置 body；需要请求正文时使用 POST');
export const connectorDefinitionSchema = z.object({
  id: sourceNameSchema, type: z.enum(['rest', 'graphql', 'sdmx', 'mediawiki', 'custom']), base_url: z.string().url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol)), label: z.string().optional(), platforms: z.array(sourceNameSchema).min(1).optional(),
  auth: z.object({ type: z.enum(['none', 'api-key', 'bearer']), header: z.string().optional(), query: z.string().optional(), body: z.string().optional(), prefix: z.string().optional() }).optional(), access: accessSchema.optional(),
  limits: z.object({ min_interval_ms: z.number().int().min(0).max(60000).optional(), max_response_bytes: z.number().int().min(1024).max(64 * 1024 * 1024).optional() }).optional(),
  operations: z.record(sourceNameSchema, z.object({ description: z.string().min(1), content_types: z.array(z.string().min(1)).min(1), input_schema: z.record(z.string(), z.unknown()), request: requestSchema.optional(),
    output: z.object({ items: z.string().optional(), id: z.string().optional(), title: z.string(), url: z.string(), snippet: z.string().optional(), published_at: z.string().optional(), content_kind: z.enum(['page', 'post', 'subtitle', 'metadata']).optional() }).optional(),
    pagination: z.object({ next: z.string().optional(), total: z.string().optional(), cursor_param: z.string().optional() }).optional(), access: accessSchema.optional() })),
  read: z.object({ hosts: z.array(z.string().min(1)).min(1), pattern: z.string().refine(value => { try { new RegExp(value); return true; } catch { return false; } }), request: requestSchema, title: z.string().optional(), content_kind: z.enum(['page', 'post', 'subtitle', 'metadata']).optional(), access: accessSchema.optional() }).optional(), limitations: z.array(z.string()).optional(),
});

const slots = new Map<string, { tail: Promise<void>; lastStart: number }>();
async function pace(key: string, interval: number, signal: AbortSignal) {
  const state = slots.get(key) ?? { tail: Promise.resolve(), lastStart: 0 }; slots.set(key, state);
  const previous = state.tail;
  let release!: () => void; const turn = new Promise<void>(resolve => { release = resolve; });
  state.tail = previous.then(() => turn);
  try {
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { signal.removeEventListener('abort', cancel); reject(signal.reason); };
      signal.addEventListener('abort', cancel, { once: true });
      previous.then(() => { signal.removeEventListener('abort', cancel); resolve(); });
      if (signal.aborted) cancel();
    });
    const wait = state.lastStart + interval - Date.now(); if (wait > 0) await delay(wait, undefined, { signal });
    signal.throwIfAborted(); state.lastStart = Date.now();
  } finally { release(); }
}
export function connectorClient(config: ApiConfig, definition: Pick<ConnectorDefinition, 'id' | 'base_url' | 'auth' | 'limits'>): StructuredClient {
  return async (path, signal, query = {}, body, format = 'json', headers = {}) => {
    const url = endpoint(config, definition.base_url, path);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) url.searchParams.set(key, typeof value === 'string' ? value : String(value));
    const auth = definition.auth;
    if (config.apiKey && auth?.query) url.searchParams.set(auth.query, config.apiKey);
    if (config.apiKey && auth?.body && body && typeof body === 'object' && !Array.isArray(body)) body = { ...body, [auth.body]: config.apiKey };
    const requestHeaders = { Accept: format === 'text' ? 'text/plain,application/xml,text/html' : 'application/json', 'User-Agent': config.userAgent ?? 'SERA structured-data client', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(config.apiKey && auth && auth.type !== 'none' && !auth.query && !auth.body ? { [auth.header ?? 'Authorization']: `${auth.prefix ?? (auth.type === 'bearer' ? 'Bearer ' : '')}${config.apiKey}` } : {}), ...headers };
    const interval = definition.limits?.min_interval_ms ?? 0, key = definition.id + ':' + url.origin;
    if (interval) await pace(key, interval, signal);
    const result = await response(url, { signal, headers: requestHeaders, ...(body === undefined ? {} : { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }) }, definition.id);
    const maximum = definition.limits?.max_response_bytes ?? 8 * 1024 * 1024;
    if (format === 'response') {
      if (!result.body) return result;
      let received = 0;
      const body = result.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maximum) throw Object.assign(new Error('结构化响应超过本次字节预算，请缩小范围或继续分页'), { code: 'RESPONSE_BUDGET' });
        controller.enqueue(chunk);
      } }));
      const bounded = new Response(body, { status: result.status, statusText: result.statusText, headers: result.headers });
      Object.defineProperty(bounded, 'url', { value: result.url });
      return bounded;
    }
    const reader = result.body?.getReader(); if (!reader) throw new Error(`${definition.id} 响应没有内容`);
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > maximum) throw Object.assign(new Error('结构化响应超过本次字节预算，请缩小范围或继续分页'), { code: 'RESPONSE_BUDGET' }); chunks.push(part.value); } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const value = Buffer.concat(chunks).toString('utf8');
    return format === 'text' ? value : JSON.parse(value);
  };
}

function at(value: unknown, path = ''): unknown {
  return path ? path.split('.').reduce<unknown>((item, key) => item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined, value) : value;
}
function expand(value: unknown, context: Record<string, unknown>): any {
  if (typeof value === 'string') { const exact = value.match(/^\{\{([^}]+)\}\}$/); if (exact) return at(context, exact[1]); return value.replace(/\{\{([^}]+)\}\}/g, (_, path) => String(at(context, path) ?? '')); }
  if (Array.isArray(value)) return value.map(item => expand(item, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, context)]).filter(([, item]) => item !== undefined));
  return value;
}
export function createStructuredSource(config: Config, definition: ConnectorDefinition, hooks: ConnectorHooks = {}): Source {
  const override = config.connectors?.find(item => item.id === definition.id);
  if (override) definition = { ...definition, ...override, operations: { ...definition.operations, ...override.operations } };
  const settings = sourceConfig(config, definition.id), client = connectorClient(settings, definition), anonymousClient = connectorClient({ ...settings, apiKey: undefined }, definition);
  const entries = Object.entries(definition.operations), schemas = new Map(entries.map(([name, operation]) => {
    const parsed = z.fromJSONSchema(operation.input_schema as any);
    return [name, operation.request && operation.output && parsed instanceof z.ZodObject ? parsed.extend({ resultOffset: z.number().int().nonnegative().default(0) }) : parsed];
  }));
  const allowed = entries.filter(([, operation]) => !['paid', 'trial'].includes((operation.access ?? definition.access)?.billing ?? 'free'));
  const operations = allowed.map(([name, operation]) => ({ ...describeOperation(name, operation.description, operation.content_types, schemas.get(name)!), ...(operation.access ?? definition.access ? { access: operation.access ?? definition.access } : {}) }));
  const fallbackAccess: AccessPolicy = definition.access ?? { authentication: definition.auth?.type && definition.auth.type !== 'none' ? 'api-key' : 'none', billing: 'free' };
  const policies = [...allowed.map(([, operation]) => operation.access ?? fallbackAccess), ...(hooks.read || definition.read ? [definition.read?.access ?? fallbackAccess] : [])];
  const required = policies.length > 0 && policies.every(policy => ['api-key', 'session'].includes(policy.authentication));
  const source: Source = {
    connector: definition,
    capability: { name: definition.id, platforms: definition.platforms ?? relatedPlatforms[definition.id] ?? [definition.id], search: allowed.length > 0, read: Boolean(hooks.read || definition.read), configured: settings.enabled !== false, requiresLogin: required, loggedIn: !required || Boolean(settings.apiKey), category: 'catalog', accessMethod: 'api', contentTypes: [...new Set(operations.flatMap(item => item.contentTypes))], operations, access: fallbackAccess, requirement: definition.label ?? definition.id, limitations: definition.limitations },
    async search(request) {
      const name = request.operation ?? (definition.id === 'github' ? request.githubType : undefined) ?? allowed[0]?.[0], operation = name && definition.operations[name];
      if (!name && entries.length && !allowed.length) throw Object.assign(new Error('此来源的操作需要付费或只有一次性试用额度'), { code: 'SOURCE_EXCLUDED' });
      if (!operation || !name) throw Object.assign(new Error('操作不存在，请查看 channels'), { code: 'UNSUPPORTED_OPERATION' });
      const access = accessState(config, source, name, operation.access ?? fallbackAccess);
      if (access.code) throw Object.assign(new Error(access.reason), { code: access.code });
      if (!source.capability.configured) throw Object.assign(new Error('来源已停用'), { code: 'SOURCE_DISABLED' });
      const params = schemas.get(name)!.parse(request.params ?? {}) as Record<string, any>;
      const selectedClient = access.policy.authentication === 'none' ? anonymousClient : client;
      if (hooks.search?.[name] && !operation.request) return hooks.search[name]!({ ...request, operation: name }, params, selectedClient);
      if (!operation.request || !operation.output) throw new Error('此操作需要专用协议适配器');
      const context = { query: request.query, limit: request.limit, since: request.since, until: request.until, params };
      const spec = operation.request;
      if (spec.method === 'GET' && spec.body !== undefined) throw Object.assign(new Error('GET 请求不能配置 body'), { code: 'BAD_CONNECTOR_CONFIG' });
      const payload = expand(spec.body, context);
      const value = await selectedClient(expand(spec.path, context), request.signal, expand(spec.query ?? {}, context), spec.method === 'POST' && payload === undefined ? {} : payload, spec.format);
      const errors = definition.type === 'graphql' && value && typeof value === 'object' && Array.isArray(value.errors) ? value.errors : [];
      if (errors.length && !value.data) throw Object.assign(new Error(`${definition.id} GraphQL 返回协议错误`), { code: 'GRAPHQL_ERROR' });
      const values = at(value, operation.output.items), items = Array.isArray(values) ? values : values === undefined ? [] : [values];
      const next = operation.pagination?.next ? at(value, operation.pagination.next) : undefined;
      const offset = Number(params.resultOffset ?? 0), remainder = offset + request.limit < items.length;
      const nextParams = remainder ? { ...params, resultOffset: offset + request.limit } : next ? { ...params, [operation.pagination?.cursor_param ?? 'cursor']: next, resultOffset: 0 } : undefined;
      reportCoverage(request, `${definition.id}:${name}`, { completeness: 'partial', truncated: Boolean(nextParams), ...(nextParams ? { nextCursor: JSON.stringify(nextParams) } : {}), limitations: [...(definition.limitations ?? []), ...(errors.length ? ['GraphQL 部分字段未取得，已保留可用数据'] : [])] });
      if (errors.length) request.onAttempt?.({ backend: definition.id, query: request.query, status: 'ok', elapsedMs: 0, returned: Math.min(request.limit, items.length), code: 'PARTIAL_RESULT', reason: 'GraphQL 部分字段返回协议错误，已保留可用数据' });
      return items.slice(offset, offset + request.limit).flatMap(item => {
        const output = operation.output!, url = String(expand(output.url, { item, ...context }) ?? '');
        try { if (!permitted(request.domains, new URL(url).hostname)) return []; } catch { return []; }
        const id = output.id ? at(item, output.id) : undefined;
        return [{ source: definition.id, url, title: plain(at(item, output.title)) || url, snippet: plain(output.snippet ? at(item, output.snippet) : ''), publishedAt: output.published_at ? date(at(item, output.published_at)) : undefined,
          ...(id !== undefined ? { locator: { kind: 'record' as const, id: String(id) } } : {}), metadata: { record: item, contentType: operation.content_types[0], connector: definition.id } }];
      });
    },
    ...(hooks.read || definition.read ? { read: async (url: string, signal: AbortSignal, options?: ReadOptions) => {
      const access = accessState(config, source, 'read', definition.read?.access ?? fallbackAccess); if (access.code) throw Object.assign(new Error(access.reason), { code: access.code });
      if (!source.capability.configured) throw Object.assign(new Error('来源已停用'), { code: 'SOURCE_DISABLED' });
      const selectedClient = access.policy.authentication === 'none' ? anonymousClient : client;
      if (hooks.read && !definition.read) return hooks.read(url, signal, options, selectedClient);
      const spec = definition.read!, address = new URL(url), match = address.pathname.match(new RegExp(spec.pattern));
      if (spec.request.method === 'GET' && spec.request.body !== undefined) throw Object.assign(new Error('GET 请求不能配置 body'), { code: 'BAD_CONNECTOR_CONFIG' });
      if (!spec.hosts.includes(address.hostname) || !match) throw new Error('链接不属于此结构化来源');
      const context = { id: decodeURIComponent(match[1] ?? ''), match: [...match], url, params: Object.fromEntries(address.searchParams) };
      const body = expand(spec.request.body, context);
      const data = await selectedClient(expand(spec.request.path, context), signal, expand(spec.request.query ?? {}, context), spec.request.method === 'POST' && body === undefined ? {} : body, spec.request.format);
      const errors = definition.type === 'graphql' && data && typeof data === 'object' && Array.isArray(data.errors) ? data.errors : [];
      if (errors.length && !data.data) throw Object.assign(new Error(`${definition.id} GraphQL 返回协议错误`), { code: 'GRAPHQL_ERROR' });
      return { source: definition.id, url, title: spec.title ? plain(at(data, spec.title)) || url : url, content: typeof data === 'string' ? data : JSON.stringify(data, null, 2), contentKind: spec.content_kind ?? 'metadata', ...(context.id ? { locator: { kind: 'record' as const, id: context.id } } : {}), metadata: { connector: definition.id, contentScope: 'structured-record', ...(errors.length ? { partial: true, protocolErrorCount: errors.length } : {}) } };
    } } : {}),
  };
  return source;
}

export function adaptStructuredSource(config: Config, original: Source): Source {
  if (original.connector || !original.search) return original;
  const name = original.capability.name, access = policyFor(original);
  const bases: Record<string, string> = { exa: 'https://api.exa.ai/', tavily: 'https://api.tavily.com/', brave: 'https://api.search.brave.com/', github: 'https://api.github.com/',
    zhipu: 'https://open.bigmodel.cn/api/paas/v4/', doubao: 'https://open.feedcoopapi.com/', serpapi: 'https://serpapi.com/', crossref: 'https://api.crossref.org/', openalex: 'https://api.openalex.org/', pubmed: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/',
    wiki: 'https://zh.wikipedia.org/w/api.php', skills: 'https://skills.sh/', bangumi: 'https://api.bgm.tv/', anilist: 'https://graphql.anilist.co/', jikan: 'https://api.jikan.moe/v4/', mangadex: 'https://api.mangadex.org/', vndb: 'https://api.vndb.org/kana/',
    musicbrainz: 'https://musicbrainz.org/ws/2/', lastfm: 'https://ws.audioscrobbler.com/2.0/', listenbrainz: 'https://api.listenbrainz.org/1/', discogs: 'https://api.discogs.com/',
    bilibili: 'https://api.bilibili.com/', v2ex: 'https://www.v2ex.com/api/', youtube: 'https://www.googleapis.com/youtube/v3/', twitch: 'https://api.twitch.tv/helix/', discord: 'https://discord.com/api/', instagram: 'https://graph.facebook.com/',
    steam: 'https://store.steampowered.com/', nicovideo: 'https://snapshot.search.nicovideo.jp/', wayback: 'https://web.archive.org/', archive: 'https://archive.org/', linuxdo: 'https://linux.do/', heybox: 'https://www.xiaoheihe.cn/' };
  const site = specialistSites[name as keyof typeof specialistSites];
  const base = sourceConfig(config, name).baseUrl ?? bases[name] ?? (site?.domains[0] ? `https://${site.domains[0]}/` : undefined);
  if (!base) return original;
  const descriptions = original.capability.operations?.length ? original.capability.operations.filter(item => !item.entrypoint || item.entrypoint === 'search') : [describeOperation('search', original.capability.requirement ?? '检索公开记录', original.capability.contentTypes ?? ['record'], z.strictObject({}))];
  const operations = Object.fromEntries(descriptions.map(operation => [operation.name, { description: operation.description, content_types: operation.contentTypes, input_schema: operation.inputSchema, ...(operation.access ? { access: operation.access } : {}) }]));
  const auth: NonNullable<ConnectorDefinition['auth']> = access.authentication === 'none' || access.authentication === 'session' ? { type: 'none' }
    : name === 'tavily' ? { type: 'api-key', body: 'api_key' } : ['serpapi', 'openalex', 'pubmed', 'lastfm'].includes(name) ? { type: 'api-key', query: 'api_key' }
    : ['exa', 'semantic-scholar'].includes(name) ? { type: 'api-key', header: 'x-api-key' } : name === 'brave' ? { type: 'api-key', header: 'X-Subscription-Token' }
    : name === 'holodex' ? { type: 'api-key', header: 'X-APIKEY' } : name === 'filmot' ? { type: 'api-key', header: 'X-API-Key' } : { type: 'bearer' };
  const definition: ConnectorDefinition = { id: name, platforms: original.capability.platforms, type: name === 'anilist' ? 'graphql' : name === 'wiki' ? 'mediawiki' : 'custom', base_url: base,
    label: original.capability.requirement ?? name, access, operations, limitations: original.capability.limitations, auth };
  const source = createStructuredSource(config, definition, { search: Object.fromEntries(descriptions.map(operation => [operation.name, (request: SearchRequest, params: Record<string, unknown>) => original.search!({ ...request, params })])),
    ...(original.read ? { read: (url: string, signal: AbortSignal, options?: ReadOptions) => original.read!(url, signal, options) } : {}) });
  const accessOverride = config.connectors?.some(item => item.id === name) && !source.capability.requiresLogin;
  source.capability = { ...source.capability, ...original.capability, ...(accessOverride ? { requiresLogin: source.capability.requiresLogin, loggedIn: source.capability.loggedIn } : {}), configured: (original.capability.configured || Boolean(accessOverride)) && sourceConfig(config, name).enabled !== false, operations: [...(source.capability.operations ?? []), ...(original.capability.operations ?? []).filter(item => item.entrypoint && item.entrypoint !== 'search')], access: source.capability.access };
  for (const key of ['channels', 'login', 'logout', 'comments', 'images'] as const) if (original[key]) Object.assign(source, { [key]: original[key] });
  return source;
}
