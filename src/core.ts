import { sourceConfig } from './source-config.js';
import { createHash } from 'node:crypto';
import { accessState, applyPolicy, allowedOperations } from './source-policy.js';
import { adaptStructuredSource } from './connectors.js';
import { createDeclaredSources, configuredSources } from './connector-registry.js';
import { sourceNameSchema } from './source-schema.js';
import { z } from 'zod';
import { sourceNames, platformIdPattern, intents } from './types.js';
import type { Channel, Config, Source, SourceName, SearchOptions, SearchReport, SearchHit, AggregatedHit, SourceRun, ReadReport, ResearchReport, Evidence, CommentReport, ImageRequest, ReadOptions, BatchReadReport, ResearchOptions, ResearchState, SearchAttempt, Document, SourceOperation } from './types.js';
import { canonicalUrl, retrievalKey, publisher, textPage, focusText, documentObservations, EvidenceStore } from './evidence.js';
import { errorMessage } from './config.js';
import { createHttpSources } from './providers/http.js';
import { createPlatformSources } from './providers/platform.js';
import { authKey, invalidateCredential, notLoggedIn, apiSources } from './credentials.js';
import { createWebSources } from './providers/web-apis.js';
import { createAcademicSources } from './providers/academic.js';
import { createCatalogSources } from './providers/catalog-apis.js';
import { createSocialSources } from './providers/social-apis.js';
import { createActionSources, bilibiliComments, serpImages, braveImages } from './providers/comments-images.js';
import { createDiscoverySources } from './providers/discovery.js';
import { createArchiveSources } from './providers/archives.js';
import { createForumSources } from './providers/forums.js';
import { createEntitySources, steamDocumentMatches } from './providers/entities.js';
import { directTarget, specificSource, taskRoute, preferredSources, materialTypes, webSearchOrder } from './routing.js';
import { legacyContentTypes, specialistSites, relatedPlatforms, materialMatches } from './provider-catalog.js';
import { assessRelevance, discoveryTerms } from './providers/relevance.js';
import { researchStateSchema, subjectSchema, criterionSchema, prepareResearch, inspectResearch, assessmentKey } from './research.js';
export { researchStateSchema } from './research.js';
import { httpTrace, networkReport } from './network.js';
import type { NetworkRequest } from './types.js';
import { createFeedSources } from './providers/feeds.js';
import { createMetadataSource } from './providers/metadata-parser.js';
import { BackendPool, createBackendSources } from './backends.js';
import { createExtensionSources } from './extensions.js';
import { locatorSchema, describeOperation } from './providers/operations.js';
import { createResearchApiSources } from './providers/research-apis.js';
import { createSpecialistApiSources } from './providers/specialist-apis.js';
import { createHistoryApiSources } from './providers/history-apis.js';
import { createDirectorySources } from './providers/directory.js';

export const searchSchema = z.object({
  query: z.string().trim().min(1).max(4096),
  sources: z.array(sourceNameSchema).min(1).optional(),
  limit: z.number().int().min(1).max(20).default(5),
  platform: z.string().regex(platformIdPattern).optional(),
  githubType: z.enum(['repositories', 'code', 'issues']).optional(),
  domains: z.array(z.string().min(1)).optional(),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, '日期需要有效的 YYYY-MM-DD').optional(),
  at: z.string().regex(/^(?:\d{8}|\d{14})$/).optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, '日期需要有效的 YYYY-MM-DD').optional(),
  operation: z.string().regex(platformIdPattern).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  contentTypes: z.array(z.string().trim().min(1).max(64)).min(1).max(20).optional(),
  maxSources: z.number().int().min(1).max(256).optional(),
  strategy: z.enum(['fallback', 'cross-check']).optional(),
  sourceOptions: z.record(sourceNameSchema, z.object({ operation: z.string().regex(platformIdPattern).optional(), params: z.record(z.string(), z.unknown()).optional() })).optional(),
  aliases: z.array(z.string().trim().min(1).max(256)).max(10).optional(),
  terms: z.array(z.string().trim().min(1).max(256)).max(32).optional(),
  excludeUrls: z.array(z.string().url()).optional(),
  excludeItems: z.array(z.string()).optional(),
  intent: z.enum(intents).optional(),
});

export const focusSchema = z.object({ query: z.string().trim().min(1).max(4096).optional(), keywords: z.array(z.string().trim().min(1).max(256)).max(32).optional(), length: z.number().int().min(1).max(20000).default(2000) });
export const recordSchema = z.object({ url: z.string().url(), title: z.string().min(1), content: z.string().refine(value => Boolean(value.trim()), '外部材料需要实际取得的内容'), method: z.string().min(1), observedAt: z.string().datetime({ offset: true }), publishedAt: z.string().datetime({ offset: true }).optional(), contentKind: z.enum(['page', 'post', 'subtitle', 'metadata']).default('page'), metadata: z.record(z.string(), z.unknown()).optional(), originSource: sourceNameSchema.optional(), locator: locatorSchema.optional() });
const readSettings = { timeoutMs: z.number().int().min(100).max(300000).optional(), browser: z.string().min(1).optional(), raw: z.boolean().default(false) };
export const readSchema = focusSchema.extend({ sources: z.array(sourceNameSchema).min(1).optional(), refresh: z.boolean().default(false), maxAgeMs: z.number().finite().nonnegative().optional(), locator: locatorSchema.optional(), contentTypes: searchSchema.shape.contentTypes, operation: searchSchema.shape.operation, params: searchSchema.shape.params, ...readSettings });
export const researchSchema = searchSchema.extend({
  readLimit: z.number().int().min(0).max(20).default(5), readSources: z.array(sourceNameSchema).min(1).optional(),
  goals: z.array(z.string().trim().min(1).max(256)).max(100).optional(), state: researchStateSchema.optional(),
  subjects: z.array(subjectSchema).max(100).optional(), criteria: z.array(criterionSchema).max(100).optional(),
  targetCount: z.number().int().min(1).max(100).optional(), discoveryQuery: z.string().trim().min(1).max(4096).optional(),
  keywords: focusSchema.shape.keywords, length: focusSchema.shape.length, refresh: z.boolean().default(false), ...readSettings,
});

export const commentsSchema = z.object({ url: z.string().url(), sources: z.array(sourceNameSchema).min(1).optional(), limit: z.number().int().min(1).max(100).default(20), cursor: z.string().optional(), parentId: z.string().optional(), order: z.string().optional() });
export const imagesSchema = z.object({ query: z.string().trim().min(1).optional(), imageUrl: z.string().url().optional(), sources: z.array(sourceNameSchema).min(1).optional(), platform: z.string().regex(platformIdPattern).optional(), operation: z.string().regex(platformIdPattern).optional(), limit: z.number().int().min(1).max(20).default(5) }).refine(value => value.query || value.imageUrl, '需要关键词或图片 URL');

export function mergeHits(hits: SearchHit[]): AggregatedHit[] {
  const merged = new Map<string, AggregatedHit>();
  const ranks = new Map<SourceName, number>();
  for (const hit of hits) {
    let url: string;
    try { url = canonicalUrl(hit.url); } catch { continue; }
    const rank = (ranks.get(hit.source) ?? 0) + 1;
    ranks.set(hit.source, rank);
    const key = retrievalKey(hit);
    const item = merged.get(key) ?? { title: hit.title, url, snippet: hit.snippet, sources: [], retrievals: [], rankScore: 0, publisher: publisher(url), publishedAt: hit.publishedAt, ...(hit.locator ? { locator: hit.locator } : {}) };
    if (item.sources.includes(hit.source)) continue;
    item.sources.push(hit.source);
    item.retrievals.push({ source: hit.source, rank, snippet: hit.snippet, ...(hit.metadata ? { metadata: hit.metadata } : {}) });
    // 排序只融合检索名次，不用于判断证据可信度。
    item.rankScore += 1 / (60 + rank);
    if (hit.snippet.length > item.snippet.length) item.snippet = hit.snippet;
    if (!item.publishedAt && hit.publishedAt) item.publishedAt = hit.publishedAt;
    merged.set(key, item);
  }
  return [...merged.values()].sort((a, b) => b.rankScore - a.rankScore || a.url.localeCompare(b.url));
}

export class Engine {
  readonly store: EvidenceStore;
  readonly sources: Source[];
  constructor(readonly config: Config, sources?: Source[], readonly backends = new BackendPool()) {
    if (!sources) {
      config = { ...config };
      for (const name of new Set([...apiSources, ...Object.keys(config.sources ?? {})])) Object.assign(config, { [name]: sourceConfig(config, name) });
      this.config = config;
    }
    this.sources = sources ?? [...createHttpSources(config), ...createWebSources(config), ...createAcademicSources(config), ...createPlatformSources(config), ...createCatalogSources(config), ...createSocialSources(config), ...createActionSources(config), ...createDiscoverySources(config), ...createArchiveSources(config), ...createForumSources(config), ...createEntitySources(config), ...createFeedSources(config), createMetadataSource(config), ...createBackendSources(config, backends), ...createExtensionSources(config, backends), ...createResearchApiSources(config), ...createSpecialistApiSources(config), ...createHistoryApiSources(config), ...createDirectorySources(config), ...createDeclaredSources(config)];
    if (!sources) {
      for (const source of this.sources) source.capability.contentTypes ??= legacyContentTypes[source.capability.name] ?? specialistSites[source.capability.name as keyof typeof specialistSites]?.contentTypes;
      this.sources = this.sources.map(source => source.capability.backend || ['agent-reach', 'opencli'].includes(source.capability.name) ? source : adaptStructuredSource(config, source));
      this.sources.push(...configuredSources(config, this.sources));
    }
    if (!sources) {
      const attach = (name: SourceName) => this.sources.find(source => source.capability.name === name)!;
      attach('bilibili').comments = request => bilibiliComments(config.bilibili, request);
      attach('bilibili').capability.comments = true;
      attach('serpapi').images = request => serpImages(config.serpapi ?? {}, request);
      attach('serpapi').capability.images = true;
      attach('brave').images = request => braveImages(config.brave, request);
      attach('brave').capability.images = true;
      attach('brave').capability.operations!.push({ ...describeOperation('keyword', '按关键词检索图片', ['image'], z.object({ query: z.string().trim().min(1) })), entrypoint: 'images' });
    }
    for (const source of this.sources) {
      source.capability.contentTypes ??= legacyContentTypes[source.capability.name] ?? specialistSites[source.capability.name as keyof typeof specialistSites]?.contentTypes;
      source.capability.platforms = [...new Set(this.config.connectors?.find(item => item.id === source.capability.name)?.platforms ?? relatedPlatforms[source.capability.name] ?? (webSearchOrder.includes(source.capability.name) || ['web', 'serpapi'].includes(source.capability.name) ? ['web'] : source.capability.platforms ?? [source.capability.name]))];
      if (source.connector) source.connector.platforms = source.capability.platforms;
      if (source.comments) {
        source.capability.operations = [...(source.capability.operations ?? []).filter(item => item.entrypoint !== 'comments'), { ...describeOperation('comments', '读取指定公开对象的评论单页，按返回游标续读', ['bilibili', 'youtube'].includes(source.capability.name) ? ['video-comment'] : ['comment'], commentsSchema), entrypoint: 'comments' }];
      }
      if (!sources) { if (source.capability.operations) source.capability.operations = allowedOperations(source.capability.operations); applyPolicy(config, source); }
      if (source.capability.operations?.length) source.capability.contentTypes = [...new Set([...(source.capability.contentTypes ?? []), ...source.capability.operations.flatMap(item => item.contentTypes)])];
    }
    this.store = new EvidenceStore(config);
  }

  private availableAction(source: Source) { return source.capability.operations?.map(operation => accessState(this.config, source, operation.name)).find(state => state.automatic) ?? accessState(this.config, source); }

  capabilities(names?: SourceName[]) { return this.sources.filter(source => !names || names.includes(source.capability.name)).map(source => { const state = this.availableAction(source); return { ...source.capability, priority: state.priority, automatic: state.automatic, status: source.capability.requiresLogin && !source.capability.loggedIn ? notLoggedIn : state.reason ?? (source.capability.configured ? '可调用' : '不可用'), availability: '调用时检查' }; }); }

  connectors(names?: SourceName[]) { return this.sources.filter(source => !names || names.includes(source.capability.name)).flatMap(source => source.connector ? [source.connector] : []); }

  async channels(options: { sources?: SourceName[]; platform?: string; signal?: AbortSignal } = {}) {
    const names = options.sources ? [...new Set(options.sources)] : this.sources.map(source => source.capability.name);
    const results = await Promise.all(names.map(async name => {
      const source = this.sources.find(item => item.capability.name === name);
      const started = Date.now(), signal = this.signal(options.signal), requests: NetworkRequest[] = [];
      if (!source) return { channels: [], run: this.unavailable(name, source) };
      try {
        signal.throwIfAborted();
        const dynamic = source.capability.backend || ['agent-reach', 'opencli'].includes(name);
        const channels: Channel[] = source.channels && source.capability.configured && (dynamic || !this.config.connectors?.find(item => item.id === name)?.platforms) ? await httpTrace.run(requests, () => source.channels!(signal)) : (source.capability.platforms ?? [name]).map(platform => ({ source: name,
          platform,
          search: source.capability.search && (!source.capability.searchPlatforms || source.capability.searchPlatforms.includes(platform)), read: source.capability.read, configured: source.capability.configured,
          comments: source.capability.comments, images: source.capability.images,
          operations: source.capability.operations, contentTypes: source.capability.contentTypes,
          browser: false, description: source.capability.requirement, status: source.capability.requiresLogin && !source.capability.loggedIn ? notLoggedIn : source.capability.configured ? '可调用' : '不可用' }));
        const state = this.availableAction(source);
        const selected = (options.platform ? channels.filter(channel => channel.platform === options.platform || options.platform === 'academic' && source.capability.category === 'academic') : channels).map(channel => {
          const operations = dynamic ? channel.operations ?? source.capability.operations : source.capability.operations ?? channel.operations;
          return { ...channel, comments: channel.comments ?? source.capability.comments, images: channel.images ?? source.capability.images, contentTypes: dynamic ? channel.contentTypes ?? source.capability.contentTypes : source.capability.contentTypes ?? channel.contentTypes, access: source.capability.access, priority: state.priority, automatic: channel.configured && state.automatic, operations, ...(state.reason ? { status: state.reason } : {}) };
        });
        return { channels: selected, run: { source: name, status: selected.length ? 'ok' : 'empty', elapsedMs: Date.now() - started, returned: selected.length, network: networkReport(requests, this.config) } as SourceRun };
      } catch (error) { return { channels: [], run: { ...await this.failure(name, error, started, signal), network: networkReport(requests, this.config) } }; }
    }));
    const runs = results.map(item => item.run), good = runs.some(run => ['ok', 'empty'].includes(run.status));
    return { status: !good ? 'error' : runs.some(run => !['ok', 'empty'].includes(run.status)) ? 'partial' : 'ok', channels: results.flatMap(item => item.channels), runs };
  }

  private signal(signal?: AbortSignal, timeoutMs = this.config.timeoutMs) { return AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]); }

  private unavailable(name: SourceName, source?: Source): SourceRun {
    const login = source?.capability.requiresLogin && !source.capability.loggedIn || ['agent-reach', 'opencli'].includes(name);
    const disabled = name === 'agent-reach' ? this.config.agentReach?.enabled === false : sourceConfig(this.config, name).enabled === false;
    return { source: name, status: 'unavailable', elapsedMs: 0, returned: 0, message: login ? notLoggedIn : disabled ? '来源已停用' : source?.capability.requirement ?? '此来源不支持该操作', ...(login ? { code: 'NOT_LOGGED_IN' } : {}) };
  }

  private accessFailure(source: Source, operation?: string): SourceRun | undefined {
    const state = source.capability.access ? accessState(this.config, source, operation) : undefined;
    return state?.code ? { source: source.capability.name, status: 'unavailable', code: state.code, message: state.reason, elapsedMs: 0, returned: 0 } : undefined;
  }

  private matchesMaterial(document: Document, requested?: string[]) {
    if (!requested?.length) return true;
    const declared = [document.metadata?.contentType, ...(Array.isArray(document.metadata?.contentTypes) ? document.metadata.contentTypes : [])].filter((value): value is string => typeof value === 'string');
    const types = [document.contentKind, ...declared];
    if (!declared.length && document.contentKind === 'metadata' && document.metadata?.objectKind !== 'comments') {
      const source = this.sources.find(item => item.capability.name === document.source);
      const materials = [...new Set(source?.capability.operations?.filter(item => !item.entrypoint || ['search', 'read'].includes(item.entrypoint)).flatMap(item => item.contentTypes) ?? source?.capability.contentTypes ?? [])];
      // 单一结构化材料可由来源声明补充；元数据不能据此冒充页面、帖子或字幕正文。
      if (materials.length === 1 && !['page', 'post', 'subtitle'].includes(materials[0]!)) types.push(materials[0]!);
    }
    return materialMatches(types, requested);
  }

  private matchesRead(document: Document, options: ReadOptions) {
    if (document.metadata?.objectKind === 'comments' || !this.matchesMaterial(document, options.contentTypes)) return false;
    if (document.source === 'web' && Boolean(document.metadata?.raw) !== Boolean(options.raw)) return false;
    const previous = document.metadata?.readRequest as { operation?: string; params?: Record<string, unknown> } | undefined;
    return previous?.operation === options.operation && JSON.stringify(previous?.params ?? {}) === JSON.stringify(options.params ?? {});
  }

  private async failure(source: SourceName, error: unknown, started: number, signal: AbortSignal): Promise<SourceRun> {
    const detail = error as { code?: unknown; retryAfterSeconds?: number; retryAt?: string; fallbackUrl?: string; platform?: string; credentialUsed?: boolean };
    const retryTime = Date.now() + (detail?.retryAfterSeconds ?? NaN) * 1000;
    const provider = this.sources.find(item => item.capability.name === source);
    const login = detail?.credentialUsed !== false && (['NOT_LOGGED_IN', 'NEED_LOGIN', 'AUTH_REQUIRED'].includes(String(detail?.code))
      || detail?.code === 'HTTP_401' && Boolean(provider?.capability.requiresLogin || this.config.credentials?.[authKey(source, detail.platform)]));
    if (login) {
      const expected = this.config.credentials?.[authKey(source, detail.platform)];
      if (expected) await invalidateCredential(this.config.home, source, detail.platform, expected).catch(() => {});
      if (provider?.capability.requiresLogin && !detail.platform) { provider.capability.loggedIn = false; provider.capability.configured = false; }
    }
    return {
      source, status: login ? 'unavailable' : signal.aborted && signal.reason?.name === 'AbortError' ? 'cancelled' : 'error',
      elapsedMs: Date.now() - started, returned: 0, message: login ? notLoggedIn : errorMessage(error, this.config),
      code: login ? 'NOT_LOGGED_IN' : typeof detail?.code === 'string' ? detail.code : signal.aborted ? signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED' : undefined,
      retryAfterSeconds: detail?.retryAfterSeconds,
      retryAt: detail?.retryAt ?? (Number.isFinite(new Date(retryTime).getTime()) ? new Date(retryTime).toISOString() : undefined),
      fallbackUrl: detail?.fallbackUrl,
    };
  }

  async search(options: SearchOptions, sourceOrder?: SourceName[]): Promise<SearchReport> {
    const input = searchSchema.parse(options);
    if (input.since && input.until && input.since > input.until) throw new Error('since 不能晚于 until');
    const githubOperation = input.sourceOptions?.github?.operation ?? input.operation;
    if (input.githubType && githubOperation && input.githubType !== githubOperation) throw Object.assign(new Error('githubType 与 GitHub operation 不一致，请选择同一操作'), { code: 'BAD_INPUT' });
    const material = input.contentTypes ?? materialTypes(input.query);
    const inferred = taskRoute(input.query, input.intent), route = material.length ? { ...inferred, reason: `按材料 ${material.join('、')} 匹配来源和动作；时间条件由动作解释` } : inferred;
    const supportsPlatform = (source: Source) => !input.platform || (source.capability.searchPlatforms ?? source.capability.platforms)?.includes(input.platform)
      || ['agent-reach', 'opencli'].includes(source.capability.name) || Boolean(input.sources?.includes(source.capability.name) && source.capability.backend && source.channels && !source.capability.searchPlatforms) || input.platform === 'academic' && source.capability.category === 'academic';
    const searchOperations = (source: Source) => source.capability.operations?.filter(item => !item.entrypoint || item.entrypoint === 'search');
    const requestedOperationFor = (source: Source) => input.sourceOptions?.[source.capability.name]?.operation ?? input.operation ?? (source.capability.name === 'github' ? input.githubType : undefined);
    const parametersFor = (source: Source) => input.sourceOptions?.[source.capability.name]?.params ?? input.params ?? {};
    const requiredFor = (source: Source, operation: string | undefined) => {
      const schema = source.capability.operations?.find(item => item.name === operation)?.inputSchema;
      const properties = schema?.properties as Record<string, { default?: unknown }> | undefined;
      return ((schema?.required as string[] | undefined) ?? []).filter(key => parametersFor(source)[key] === undefined && properties?.[key]?.default === undefined);
    };
    const operationFor = (source: Source) => requestedOperationFor(source) ?? searchOperations(source)?.filter(item => !material.length || materialMatches(item.contentTypes, material)).sort((a, b) => {
      const ready = (operation: typeof a) => !requiredFor(source, operation.name).length && (!source.capability.access || accessState(this.config, source, operation.name).automatic);
      return Number(ready(b)) - Number(ready(a)) || (material.length ? a.contentTypes.length - b.contentTypes.length : 0);
    })[0]?.name;
    const pendingActions = this.sources.filter(source => (!input.sources || input.sources.includes(source.capability.name)) && supportsPlatform(source)).flatMap(source => {
      const requested = input.sourceOptions?.[source.capability.name]?.operation ?? input.operation;
      return (source.capability.operations ?? []).filter(operation => operation.entrypoint !== 'images' && (requested ? operation.name === requested : material.length ? materialMatches(operation.contentTypes, material) : Boolean(input.sources || input.platform) && operation === searchOperations(source)?.[0])).flatMap(operation => {
        const required = requiredFor(source, operation.name);
        return operation.entrypoint === 'comments' || operation.entrypoint === 'read' || required.length ? [{ source: source.capability.name, operation: operation.name, entrypoint: operation.entrypoint ?? 'search' as const, required }] : [];
      });
    });
    const selected = input.sources ? [...new Set(input.sources)] : input.at ? ['wayback' as SourceName] : input.platform
      ? this.sources.filter(source => source.capability.configured && source.search && supportsPlatform(source)).map(source => source.capability.name)
       : [...new Set<SourceName>([...(sourceOrder ?? preferredSources(route.intent, input.query, material)), ...Object.keys(input.sourceOptions ?? {}), ...(material.length || input.operation || input.githubType ? this.sources.filter(source => source.search && source.capability.configured).map(source => source.capability.name) : ['agent-reach' as const])])].filter(name => this.sources.some(source => source.capability.name === name && source.capability.configured && source.search && (name !== 'sites' || Boolean(input.platform))));
    const matching = selected.filter(name => {
      const source = this.sources.find(source => source.capability.name === name);
      if (!source) return Boolean(input.sources);
      const operations = searchOperations(source), operation = operationFor(source), effective = operations?.find(item => item.name === operation) ?? (!operation ? operations?.[0] : undefined);
      if (!input.sources && !material.length && !requestedOperationFor(source) && relatedPlatforms[name]) return false;
      if (material.length && operations?.length && !operation && !materialMatches(operations.flatMap(item => item.contentTypes), material)) return false;
      return (input.sources || supportsPlatform(source)) && (input.sources || input.at || !material.length || materialMatches(effective?.contentTypes ?? operations?.flatMap(item => item.contentTypes) ?? source.capability.contentTypes, material))
        && (!operation || input.sources || Boolean(effective)) && !requiredFor(source, effective?.name).length;
    });
    if (!input.sources) {
      for (let index = matching.length - 1; index >= 0; index--) {
        const source = this.sources.find(item => item.capability.name === matching[index])!;
        if (source.capability.access && !accessState(this.config, source, operationFor(source)).automatic) matching.splice(index, 1);
      }
      matching.sort((a, b) => {
        const first = this.sources.find(item => item.capability.name === a)!, second = this.sources.find(item => item.capability.name === b)!;
        return (first.capability.access ? accessState(this.config, first, operationFor(first)).priority : 0) - (second.capability.access ? accessState(this.config, second, operationFor(second)).priority : 0);
      });
    }
    const strategy = input.strategy ?? 'fallback';
    const scheduled = matching.slice(0, input.maxSources ?? (strategy === 'cross-check' && !input.sources ? 3 : matching.length));
    const known = new Set((input.excludeUrls ?? []).map(canonicalUrl)), knownItems = new Set(input.excludeItems ?? []);
    const knownPages = new Set([...known, ...[...knownItems].map(key => key.split('\n')[0]!)]);
    const fresh = (hit: SearchHit) => !known.has(canonicalUrl(hit.url)) && !knownItems.has(retrievalKey(hit));
    const run = async (name: SourceName, query = input.query, filter = false) => {
      const source = this.sources.find(item => item.capability.name === name);
      if (!source?.search || !source.capability.configured) return { hits: [], run: this.unavailable(name, source) };
      if (!supportsPlatform(source)) return { hits: [], run: { source: name, status: 'unavailable' as const, elapsedMs: 0, returned: 0, code: 'UNSUPPORTED_PLATFORM', message: '所选来源不支持此平台，请查看 channels' } };
      const restricted = this.accessFailure(source, operationFor(source));
      if (restricted) return { hits: [], run: restricted };
      const settings = { operation: input.sourceOptions?.[name]?.operation ?? input.operation, params: input.sourceOptions?.[name]?.params ?? input.params };
      const started = Date.now(), signal = this.signal(options.signal), requests: NetworkRequest[] = [];
      const attempts: SearchAttempt[] = [];
      let coverage: SourceRun['coverage'] = { scope: '本次检索返回范围', completeness: 'unknown', requested: { since: input.since, until: input.until }, limitations: ['检索命中数量不表示数据收录完整'] };
      try {
        signal.throwIfAborted();
        if (settings.operation && !searchOperations(source)?.some(operation => operation.name === settings.operation)) throw Object.assign(new Error('此动作不能通过 search 执行，请查看 channels 的 entrypoint'), { code: 'UNSUPPORTED_OPERATION' });
        if (settings.params && Object.keys(settings.params).length && !source.capability.operations?.length) throw Object.assign(new Error('来源未声明结构化参数，请查看 channels'), { code: 'UNSUPPORTED_PARAMETERS' });
        const operation = operationFor(source);
        const returned = await httpTrace.run(requests, () => source.search!({ ...input, ...settings, query, operation, signal, onAttempt: attempt => attempts.push(attempt), onCoverage: value => { coverage = value; } }));
        const valid = returned.filter(hit => { try { canonicalUrl(hit.url); return true; } catch { return false; } });
        const dated = valid.filter(hit => {
          const timestamp = hit.locator?.occurredAt ?? hit.publishedAt;
          return !timestamp || (!input.since || timestamp.slice(0, 10) >= input.since) && (!input.until || timestamp.slice(0, 10) <= input.until);
        });
        const invalidUrls = returned.length - valid.length, raw = dated.slice(0, input.limit);
        if ((input.since || input.until) && raw.some(hit => !(hit.locator?.occurredAt ?? hit.publishedAt))) coverage = { ...coverage!, limitations: [...(coverage?.limitations ?? []), '部分记录缺少精确时间，时间条件需继续核验'] };
        const assessed = assessRelevance(query, raw, input.aliases, input.terms);
        if (source.capability.accessMethod === 'api' && (settings.operation || settings.params && Object.keys(settings.params).length)) {
          for (const hit of assessed.annotatedHits) if (hit.metadata?.relevance?.status === 'irrelevant') hit.metadata.relevance.status = 'uncertain';
          assessed.hits = assessed.annotatedHits;
        }
        const relevant = { hits: filter ? assessed.hits : assessed.annotatedHits, reason: assessed.reason };
        if (!attempts.length) attempts.push({ backend: name, query, status: assessed.hits.length ? 'ok' : raw.length ? 'irrelevant' : 'empty', elapsedMs: Date.now() - started, returned: relevant.hits.length, reason: relevant.reason });
        const partial = attempts.find(attempt => attempt.code === 'PARTIAL_RESULT');
        return { hits: relevant.hits, run: { source: name, status: relevant.hits.length ? 'ok' : 'empty', elapsedMs: Date.now() - started, returned: relevant.hits.length,
          newUrls: new Set(assessed.hits.map(hit => canonicalUrl(hit.url)).filter(url => !knownPages.has(url))).size, newItems: new Set(assessed.hits.filter(fresh).map(retrievalKey)).size, attempts, coverage, network: networkReport(requests, this.config),
           ...(partial ? { code: partial.code, message: partial.reason } : invalidUrls ? { code: 'PARTIAL_RESULT', message: `忽略 ${invalidUrls} 条无效 URL，保留有效候选` } : {}) } as SourceRun };
      } catch (error) {
        const failure = await this.failure(name, error, started, signal);
        if (!attempts.length) attempts.push({ backend: name, query, status: failure.status === 'cancelled' ? 'cancelled' : 'error', elapsedMs: failure.elapsedMs, returned: 0, reason: failure.message, code: failure.code, retryAfterSeconds: failure.retryAfterSeconds });
        return { hits: [], run: { ...failure, attempts, coverage, network: networkReport(requests, this.config) } };
      }
    };
    const results: { hits: SearchHit[]; run: SourceRun }[] = [];
    const enough = () => new Set(results.flatMap(result => result.hits).filter(hit => fresh(hit) && hit.metadata?.relevance?.status !== 'irrelevant').map(retrievalKey)).size >= input.limit;
    if (input.sources || input.platform || input.at) {
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(3, scheduled.length) }, async () => {
        while (next < scheduled.length && !options.signal?.aborted) { const index = next++; results[index] = await run(scheduled[index]!); }
      }));
    }
    else {
      for (const name of scheduled) {
        const result = await run(name, input.query, true);
        results.push(result);
        if (strategy === 'fallback' && enough() || options.signal?.aborted) break;
      }
      const alias = input.aliases?.find(value => value !== input.query);
      if (alias && !results.some(result => result.run.newItems ?? result.run.newUrls) && !options.signal?.aborted) {
        for (const name of scheduled) {
          if (results.some(result => result.run.source === name && (result.run.code === 'NOT_LOGGED_IN' || result.run.code === 'RATE_LIMITED' || result.run.code === 'HTTP_429'))) continue;
          const result = await run(name, alias, true);
          results.push(result);
          if (strategy === 'fallback' && enough() || options.signal?.aborted) break;
        }
      }
    }
    const runs = results.filter(Boolean).map(result => result.run);
    const hits = mergeHits(results.filter(Boolean).flatMap(result => result.hits));
    const good = runs.some(run => ['ok', 'empty'].includes(run.status));
    const failed = runs.some(run => !['ok', 'empty'].includes(run.status) || run.code === 'PARTIAL_RESULT');
    return { query: input.query, hits, runs, route, plan: { strategy, contentTypes: material, selected: scheduled,
      ...(pendingActions.length ? { pendingActions } : {}),
      stopReason: options.signal?.aborted ? 'cancelled' : strategy === 'fallback' && enough() ? 'enough-results' : scheduled.length < matching.length ? 'budget' : 'exhausted' }, status: !good ? pendingActions.length ? 'partial' : 'error' : failed ? 'partial' : hits.length ? 'ok' : 'empty' };
  }

  async images(options: Omit<ImageRequest, 'signal'> & { sources?: SourceName[]; signal?: AbortSignal }): Promise<SearchReport> {
    const input = imagesSchema.parse(options);
    const names = input.sources ?? (input.imageUrl ? ['serpapi', 'trace-moe', 'saucenao'] as SourceName[] : ['brave', 'serpapi', 'baidu-images', 'sogou-images'] as SourceName[]);
    if (!input.sources) names.sort((a, b) => { const first = this.sources.find(source => source.capability.name === a), second = this.sources.find(source => source.capability.name === b); return (first ? accessState(this.config, first).priority : 100) - (second ? accessState(this.config, second).priority : 100); });
    const run = async (name: SourceName) => {
      const source = this.sources.find(item => item.capability.name === name), started = Date.now(), signal = this.signal(options.signal), requests: NetworkRequest[] = [];
      if (!source?.images || !source.capability.configured) return { hits: [], run: this.unavailable(name, source) };
      const restricted = this.accessFailure(source, input.operation); if (restricted) return { hits: [], run: restricted };
      try {
        if (input.platform && !source.capability.platforms?.includes(input.platform)) throw Object.assign(new Error('所选来源不支持此平台，请查看 channels'), { code: 'UNSUPPORTED_PLATFORM' });
        if (input.operation && !source.capability.operations?.some(item => item.name === input.operation && item.entrypoint === 'images')) throw Object.assign(new Error('此动作不能通过 images 执行，请查看 channels 的 entrypoint'), { code: 'UNSUPPORTED_OPERATION' });
        const hits = await httpTrace.run(requests, () => source.images!({ ...input, signal })); return { hits, run: { source: name, status: hits.length ? 'ok' : 'empty', elapsedMs: Date.now() - started, returned: hits.length, network: networkReport(requests, this.config) } as SourceRun };
      }
      catch (error) { return { hits: [], run: { ...await this.failure(name, error, started, signal), network: networkReport(requests, this.config) } }; }
    };
    const results = [];
    if (input.sources) {
      for (let start = 0; start < names.length; start += 3) { if (options.signal?.aborted) break; results.push(...await Promise.all(names.slice(start, start + 3).map(run))); }
    } else for (const name of names) { if (options.signal?.aborted) break; const source = this.sources.find(item => item.capability.name === name); if (source?.capability.access && !accessState(this.config, source, input.operation).automatic || input.platform && !source?.capability.platforms?.includes(input.platform) || input.operation && !source?.capability.operations?.some(item => item.name === input.operation && item.entrypoint === 'images')) continue; results.push(await run(name)); if (mergeHits(results.flatMap(item => item.hits)).length >= input.limit) break; }
    const hits = mergeHits(results.flatMap(item => item.hits)), runs = results.map(item => item.run), good = runs.some(run => ['ok', 'empty'].includes(run.status));
    return { query: input.query ?? input.imageUrl!, hits, runs, status: !good ? 'error' : runs.some(run => !['ok', 'empty'].includes(run.status)) ? 'partial' : hits.length ? 'ok' : 'empty' };
  }

  async comments(options: z.input<typeof commentsSchema> & { signal?: AbortSignal }): Promise<CommentReport> {
    const input = commentsSchema.parse(options), url = canonicalUrl(input.url), host = new URL(url).hostname;
    const fallback: SourceName = /(^|\.)bilibili\.com$/.test(host) || host === 'b23.tv' ? 'bilibili' : /(^|\.)instagram\.com$/.test(host) ? 'instagram' : host === 'music.163.com' ? 'netease' : host === 'linux.do' ? 'linuxdo' : /(^|\.)xiaoheihe\.cn$/.test(host) ? 'heybox' : 'youtube';
    const runs: SourceRun[] = [];
    for (const name of input.sources ?? [fallback]) {
      const source = this.sources.find(item => item.capability.name === name), started = Date.now(), signal = this.signal(options.signal), requests: NetworkRequest[] = [];
      if (!source?.comments || !source.capability.configured) { runs.push(this.unavailable(name, source)); continue; }
      const restricted = this.accessFailure(source, 'comments'); if (restricted) { runs.push(restricted); continue; }
      try {
        const page = await httpTrace.run(requests, () => source.comments!({ ...input, url, signal }));
        runs.push({ source: name, status: page.comments.length ? 'ok' : 'empty', elapsedMs: Date.now() - started, returned: page.comments.length, network: networkReport(requests, this.config) });
        if (!page.comments.length) return { status: 'empty', page, runs };
        const result: CommentReport = { status: 'ok', page, runs };
        try {
          const identity = createHash('sha256').update(JSON.stringify([page.scope, input.parentId ?? null, input.cursor ?? null, input.order ?? null, input.limit])).digest('hex');
          const saved = await this.store.save({ source: name, url: page.url, title: '评论：' + page.url, content: JSON.stringify(page, null, 2), contentKind: 'post', locator: { kind: 'record', id: `comments:${identity}` }, metadata: { objectKind: 'comments', scope: page.scope, truncated: page.truncated, nextCursor: page.nextCursor } });
          const { content: _content, ...metadata } = saved;
          result.evidence = metadata;
        } catch (error) { result.status = 'partial'; result.cacheWarnings = [errorMessage(error, this.config)]; }
        return result;
      } catch (error) { runs.push({ ...await this.failure(name, error, started, signal), network: networkReport(requests, this.config) }); if (signal.aborted) break; }
    }
    return { status: 'error', runs };
  }

  async read(url: string, options: ReadOptions = {}): Promise<ReadReport> {
    const input = readSchema.parse(options);
    url = canonicalUrl(directTarget(url) ?? url);
    if (options.signal?.aborted) return { status: 'error', runs: [{ source: input.sources?.[0] ?? 'web', status: 'cancelled', elapsedMs: 0, returned: 0, code: 'CANCELLED', message: '操作已取消' }] };
    const cacheWarnings: string[] = [];
    try {
      const cleanup = await this.store.cleanIfDue();
      cacheWarnings.push(...cleanup.failures.map(item => `缓存清理保留 ${item.file}：${item.code}`));
    } catch (error) { cacheWarnings.push(`缓存清理未完成：${errorMessage(error, this.config)}`); }
    const specific = specificSource(url, this.config);
    const order: SourceName[] = input.sources ?? [...new Set<SourceName>([
      ...(specific ? [specific] : []), 'web', 'exa', 'tavily', 'scrapling', 'agent-reach', 'opencli',
    ])];
    if (!input.sources) order.sort((a, b) => { if (a === specific) return -1; if (b === specific) return 1; const first = this.sources.find(source => source.capability.name === a), second = this.sources.find(source => source.capability.name === b); return (first ? accessState(this.config, first).priority : 100) - (second ? accessState(this.config, second).priority : 100); });
    const eligible = order.filter(name => this.sources.some(source => source.capability.name === name && source.capability.configured && source.read));
    const view = (content: string) => input.query || input.keywords?.length ? focusText(content, input, input.length) : { ...textPage(content, 0, input.length), selection: 'leading' as const };
    if (!input.refresh) {
      try {
        const cached = await this.store.find(url, eligible, input.maxAgeMs, evidence => evidence.metadata?.bodyAvailable !== false && this.matchesRead(evidence, input)
          && (evidence.source !== 'steam' || steamDocumentMatches(url, evidence)), input.locator);
        if (cached && cached.source !== 'external') {
          const { content, ...metadata } = cached;
          return { status: cached.metadata?.partial ? 'partial' : 'ok', evidence: metadata, ...view(content), cacheHit: true, cacheAgeMs: Date.now() - Date.parse(cached.retrievedAt),
            runs: [{ source: cached.source, status: 'ok', elapsedMs: 0, returned: 1, cacheHit: true, network: networkReport([], this.config) }], ...(cacheWarnings.length ? { cacheWarnings } : {}) };
        }
      } catch (error) { cacheWarnings.push(`URL 缓存未读取：${errorMessage(error, this.config)}`); }
    }
    const runs: SourceRun[] = [];
    let partial: ReadReport | undefined;
    for (const name of order) {
      const source = this.sources.find(item => item.capability.name === name);
      if (!source?.read || !source.capability.configured) {
        if (input.sources) runs.push(this.unavailable(name, source));
        continue;
      }
      const operation = input.operation ?? source.capability.operations?.filter(item => item.entrypoint === 'read' && materialMatches(item.contentTypes, input.contentTypes ?? [])).sort((a, b) => a.contentTypes.length - b.contentTypes.length)[0]?.name;
      const restricted = this.accessFailure(source, operation ?? 'read'); if (restricted) { runs.push(restricted); continue; }
      const started = Date.now(), signal = this.signal(options.signal, input.timeoutMs), requests: NetworkRequest[] = [];
      try {
        signal.throwIfAborted();
        if (input.operation && !source.channels && !source.capability.operations?.some(item => item.name === input.operation && item.entrypoint === 'read')) throw Object.assign(new Error('此动作不能通过 read 执行，请查看 channels 的 entrypoint'), { code: 'UNSUPPORTED_OPERATION' });
        const observed = await httpTrace.run(requests, () => source.read!(url, signal, { ...input, operation }));
        const document: Document = { ...observed, metadata: { ...observed.metadata, ...(input.operation || Object.keys(input.params ?? {}).length ? { readRequest: { operation: input.operation, params: input.params ?? {} } } : {}) } };
        if (input.locator && (document.locator?.kind !== input.locator.kind || document.locator?.id !== input.locator.id)) throw Object.assign(new Error('读取结果未定位到请求的片段或事件'), { code: 'CONTENT_MISMATCH' });
        if (typeof document.content !== 'string' || !document.content.trim()) throw new Error('读取结果没有正文或有效元数据');
        if (name === 'steam' && !steamDocumentMatches(url, document)) throw Object.assign(new Error('读取对象与目标 URL 不匹配，需要对应公告或原文'), { code: 'CONTENT_MISMATCH' });
        const bodyAvailable = document.metadata?.bodyAvailable !== false, materialAvailable = this.matchesMaterial(document, input.contentTypes);
        runs.push({ source: name, status: bodyAvailable && materialAvailable ? 'ok' : 'error', elapsedMs: Date.now() - started, returned: bodyAvailable && materialAvailable ? 1 : 0, network: networkReport(requests, this.config),
          ...(!bodyAvailable ? { code: 'CONTENT_INCOMPLETE', message: '已取得页面框架或标题，目标正文尚未取得' } : !materialAvailable ? { code: 'CONTENT_MISMATCH', message: '已取得内容尚不能确认为请求的材料类型' } : {}) });
        try {
          const evidence = await this.store.save(document);
          if (!input.locator && document.locator) {
            try { await this.store.remember(url, evidence, null); }
            catch (error) { cacheWarnings.push(`URL 缓存未保存：${errorMessage(error, this.config)}`); }
          }
          if (canonicalUrl(document.url) !== url) {
            try { await this.store.remember(url, evidence); }
            catch (error) { cacheWarnings.push(`URL 缓存未保存：${errorMessage(error, this.config)}`); }
          }
          const { content: _content, ...metadata } = evidence;
          if (!bodyAvailable || !materialAvailable) {
            partial = { status: 'partial', evidence: metadata, ...view(document.content), cacheHit: false, runs, nextSteps: [!bodyAvailable ? '页面框架已保存，继续使用公开结构化 API、原始正文入口或其他允许的读取来源。' : '已取得材料已保存，请继续选择提供目标材料类型的读取入口。'], ...(cacheWarnings.length ? { cacheWarnings } : {}) };
            continue;
          }
          return { status: document.metadata?.partial ? 'partial' : 'ok', evidence: metadata, ...view(document.content), cacheHit: false, runs, ...(cacheWarnings.length ? { cacheWarnings } : {}) };
        } catch (error) {
          cacheWarnings.push(`证据保存未完成：${errorMessage(error, this.config)}`);
          const { content, ...metadata } = document;
          if (!bodyAvailable || !materialAvailable) {
            partial = { status: 'partial', document: metadata, ...view(content), cacheHit: false, runs, cacheWarnings, nextSteps: ['目标正文尚未取得，请继续使用其他允许的入口。'] };
            continue;
          }
          return { status: 'partial', document: metadata, ...view(content), cacheHit: false, runs, cacheWarnings };
        }
      } catch (error) {
        runs.push({ ...await this.failure(name, error, started, signal), network: networkReport(requests, this.config) });
        if (options.signal?.aborted || (error as { terminal?: boolean }).terminal) break;
      }
    }
    const nextSteps = [...new Set(runs.map(run => run.retryAt ? `此入口在 ${run.retryAt} 后重试；先补查其他允许的来源。`
      : run.fallbackUrl ? `可用其他允许的读取来源取得原始页面：${run.fallbackUrl}`
      : run.code === 'HTTP_403' || run.code === 'NOT_LOGGED_IN' ? '当前对象受访问条件限制，请使用可用的公开记录或其他允许来源，并保留缺口。'
      : run.code === 'CONTENT_MISMATCH' || run.code === 'CONTENT_INCOMPLETE' ? '读取对象或正文范围不足，请改用对应原文或结构化入口。' : '根据本次来源记录调整入口或查询，保留已取得的材料。'))];
    return partial ?? { status: 'error', runs, nextSteps, ...(cacheWarnings.length ? { cacheWarnings } : {}) };
  }

  async readMany(urls: string[], options: ReadOptions = {}): Promise<BatchReadReport> {
    const inputs = z.array(z.string()).min(1).max(20).parse(urls);
    readSchema.parse(options);
    const addresses = inputs.map(url => {
      try { return canonicalUrl(directTarget(url) ?? url); }
      catch (error) { return { status: 'error' as const, runs: [{ source: options.sources?.[0] ?? 'web', status: 'error' as const, elapsedMs: 0, returned: 0, code: 'BAD_INPUT', message: errorMessage(error, this.config) }] }; }
    });
    const unique = [...new Set(addresses.filter((value): value is string => typeof value === 'string'))], reports = new Map<string, ReadReport>();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, unique.length) }, async () => {
      while (next < unique.length) {
        const url = unique[next++]!;
        reports.set(url, await this.read(url, options));
      }
    }));
    const documents = addresses.map(value => typeof value === 'string' ? reports.get(value)! : value);
    return { status: documents.every(item => item.status === 'ok') ? 'ok' : documents.every(item => item.status === 'error') ? 'error' : 'partial', documents };
  }

  async record(options: z.input<typeof recordSchema>): Promise<ReadReport> {
    const input = recordSchema.parse(options);
    const cacheWarnings: string[] = [];
    try { await this.store.cleanIfDue(); }
    catch (error) { cacheWarnings.push(errorMessage(error, this.config)); }
    const document = { source: 'external' as const, url: canonicalUrl(input.url), title: input.title, content: input.content, contentKind: input.contentKind, publishedAt: input.publishedAt, ...(input.locator ? { locator: input.locator } : {}),
      metadata: { ...input.metadata, ...(input.originSource ? { originSource: input.originSource } : {}), acquisition: { method: input.method, observedAt: input.observedAt, origin: 'external' } } };
    try {
      const { content, ...evidence } = await this.store.save(document);
      return { status: 'ok', evidence, ...textPage(content, 0, 2000), runs: [], ...(cacheWarnings.length ? { cacheWarnings } : {}) };
    } catch (error) {
      const { content, ...metadata } = document;
      return { status: 'partial', document: metadata, ...textPage(content, 0, 2000), runs: [], cacheWarnings: [...cacheWarnings, errorMessage(error, this.config)] };
    }
  }

  async research(options: ResearchOptions): Promise<ResearchReport> {
    const input = researchSchema.parse(options), state = prepareResearch(input);
    if (input.since && input.until && input.since > input.until) throw new Error('since 不能晚于 until');
    const existing = await inspectResearch(state, this.store);
    const requestedMaterials = input.contentTypes ?? materialTypes(input.query);
    const readDeclarations = new Map<SourceName, SourceOperation[]>(), readDiscoveryFailures: SourceRun[] = [];
    const addresses = [taskRoute(input.query).directUrl, taskRoute(input.discoveryQuery).directUrl,
      ...state.subjects.flatMap(subject => subject.urls ?? []), ...[...existing.evidence.values()].map(evidence => evidence.url)].filter((url): url is string => Boolean(url));
    const platforms = input.platform ? [input.platform] : [...new Set(addresses.flatMap(url => {
      const name = specificSource(url, this.config);
      return name ? this.sources.find(source => source.capability.name === name)?.capability.platforms ?? [] : [];
    }))];
    for (const name of input.readSources ?? input.sources ?? Object.keys(input.sourceOptions ?? {})) {
      const source = this.sources.find(item => item.capability.name === name), requested = input.sourceOptions?.[name]?.operation ?? input.operation;
      if (!requested || !source?.channels || !source.read || !source.capability.configured || source.capability.operations?.some(operation => operation.name === requested)
        || !(source.capability.backend || ['agent-reach', 'opencli'].includes(name))) continue;
      const discovered = await Promise.all((platforms.length ? platforms : [undefined]).map(platform => this.channels({ sources: [name], platform, signal: options.signal })));
      const operations = discovered.flatMap(result => result.channels.flatMap(channel => channel.operations ?? []));
      readDeclarations.set(name, operations);
      if (!operations.some(operation => operation.name === requested)) readDiscoveryFailures.push({ source: name, status: 'unavailable', returned: 0, elapsedMs: 0, code: discovered.flatMap(result => result.runs).find(run => run.code)?.code ?? 'UNSUPPORTED_OPERATION', message: '当前平台没有声明此原文读取动作，请查看 channels 的 entrypoint' });
    }
    const readOptionsFor = (source: SourceName) => {
      const scoped = input.sourceOptions?.[source], operation = scoped?.operation ?? input.operation;
      return operation && [...(this.sources.find(item => item.capability.name === source)?.capability.operations ?? []), ...(readDeclarations.get(source) ?? [])].some(item => item.name === operation && item.entrypoint === 'read')
        ? { operation, params: scoped?.params ?? input.params } : {};
    };
    const acceptObservation = (evidence: Document) => {
      const allowed = input.readSources ?? input.sources;
      if (allowed && !allowed.includes(evidence.source) && !(evidence.source === 'external' && allowed.includes(String(evidence.metadata?.originSource)))) return false;
      if (readDiscoveryFailures.some(run => run.source === evidence.source)) return false;
      const requested = readOptionsFor(evidence.source), previous = evidence.metadata?.readRequest as { operation?: string; params?: Record<string, unknown>; at?: string } | undefined;
      if (!this.matchesRead(evidence, { contentTypes: requestedMaterials, raw: options.raw === undefined ? Boolean(evidence.metadata?.raw) : input.raw,
        ...(requested.operation ? requested : { operation: previous?.operation, params: previous?.params }) })) return false;
      const timestamp = evidence.locator?.occurredAt ?? evidence.publishedAt ?? (typeof evidence.metadata?.captureAt === 'string' ? evidence.metadata.captureAt : undefined);
      if ((input.since || input.until) && (!timestamp || !Number.isFinite(Date.parse(timestamp))
        || input.since && timestamp.slice(0, 10) < input.since || input.until && timestamp.slice(0, 10) > input.until)) return false;
      if (input.at) {
        const captured = new URL(evidence.url).pathname.match(/^\/web\/(\d{14})/i)?.[1];
        if (evidence.metadata?.requestedTimestamp !== input.at && previous?.at !== input.at && captured?.slice(0, input.at.length) !== input.at) return false;
      }
      return evidence.metadata?.bodyAvailable !== false;
    };
    const acceptedEvidence = (evidence: Evidence) => documentObservations(evidence).find(acceptObservation);
    const accepted = (document: Document) => documentObservations(document).some(acceptObservation);
    const initial = await inspectResearch(state, this.store, acceptedEvidence);
    for (const assessment of state.assessments) if (assessment.status === 'supported' && assessment.citations.some(citation => {
      const evidence = initial.evidence.get(citation.evidenceId);
      return evidence && !acceptedEvidence(evidence);
    })) assessment.status = 'pending';
    const excluded = new Set(initial.coverage.excluded);
    const unresolved = state.assessments.filter(item => !initial.verified.has(assessmentKey(item)) && !excluded.has(item.subjectId));
    unresolved.sort((a, b) => Number(b.status === 'conflict') - Number(a.status === 'conflict')
      || Number(state.criteria.find(item => item.id === b.criterionId)?.kind === 'required') - Number(state.criteria.find(item => item.id === a.criterionId)?.kind === 'required'));
    const focus = unresolved[0] ?? (input.refresh ? state.assessments[0] : undefined);
    if (input.refresh && focus) focus.status = 'pending';
    const subject = state.subjects.find(item => item.id === focus?.subjectId);
    const criterion = state.criteria.find(item => item.id === focus?.criterionId);
    const seed = subject?.id === 'task' ? input.query : subject?.name ?? input.query;
    const shortSeed = seed.length > 64 ? discoveryTerms(seed).join(' ') || seed : seed;
    const focusedQuery = [shortSeed, criterion?.keywords?.join(' ') || criterion?.description].filter(Boolean).join(' ').slice(0, 4096);
    const previous = state.history.at(-1);
    const stagnant = previous && previous.sources.length > 0 && (previous.newItems ?? previous.newUrls) + previous.newEvidence + previous.resolved === 0;
    let query = input.discoveryQuery ?? (input.state && state.nextAction === 'change-query' && state.nextQuery && initial.verified.size === state.resolvedCount
      ? state.nextQuery : input.state && focus ? focusedQuery : input.query);
    if (stagnant && state.nextAction === 'change-query' && previous.query === query && input.discoveryQuery === undefined) query = subject?.aliases?.[0] ?? input.aliases?.[0] ?? shortSeed;
    const route = taskRoute(taskRoute(input.query).directUrl ?? query, criterion?.intent ?? input.intent);
    const preferred = preferredSources(route.intent, query, requestedMaterials).filter(name => this.sources.some(source => source.capability.name === name && source.capability.configured && source.search));
    const used = new Set(state.history.filter(round => round.query === query && (round.newItems ?? round.newUrls) + round.newEvidence === 0).flatMap(round => round.sources));
    const suggested = state.nextAction === 'change-source' ? state.nextSources?.filter(name => preferred.includes(name)) ?? [] : [];
    const sourceOrder = [...new Set([...suggested, ...preferred.filter(name => !used.has(name)), ...preferred.filter(name => used.has(name))])];
    const explicitRead = (input.readSources ?? input.sources ?? []).some(source => Boolean(readOptionsFor(source).operation));
    const readRequest = (source: SourceName) => Boolean(readOptionsFor(source).operation || readDiscoveryFailures.some(run => run.source === source));
    const operationSources = input.sources ?? input.readSources ?? [];
    const searchSources = input.sources?.some(source => !readRequest(source)) ? input.sources.filter(source => !readRequest(source)) : input.sources;
    const structuredSearch = input.githubType || input.operation && (operationSources.length ? operationSources.some(source => !readRequest(source)) : !explicitRead)
      || Object.keys(input.params ?? {}).length && !explicitRead && !readDiscoveryFailures.length
      || Object.entries(input.sourceOptions ?? {}).some(([source, settings]) => (settings?.operation || Object.keys(settings?.params ?? {}).length) && !readRequest(source));
    const direct = !input.at && !input.since && !input.until && !structuredSearch && !input.sources?.includes('wayback') && (route.intent !== 'historical' || route.directUrl?.startsWith('https://web.archive.org/web/')) ? route.directUrl : undefined;
    const documents: ReadReport[] = [];
    const knownEvidence = new Set(state.evidenceIds), examined = new Set(state.examinedUrls.map(canonicalUrl));
    const examinedItems = new Set(state.examinedItems ?? state.examinedUrls.map(canonicalUrl));
    for (const evidence of initial.evidence.values()) if (!accepted(evidence)) { examined.delete(canonicalUrl(evidence.url)); examinedItems.delete(canonicalUrl(evidence.url)); examinedItems.delete(retrievalKey(evidence)); }
    for (const candidate of state.candidates) if (!initial.evidence.has(candidate.evidenceId)) { examined.delete(canonicalUrl(candidate.url)); examinedItems.delete(candidate.itemKey ?? canonicalUrl(candidate.url)); }
    for (const assessment of state.assessments) if (assessment.citations.some(item => !initial.evidence.has(item.evidenceId))) {
      for (const url of state.subjects.find(item => item.id === assessment.subjectId)?.urls ?? []) { examined.delete(canonicalUrl(url)); for (const key of examinedItems) if (key === canonicalUrl(url) || key.startsWith(canonicalUrl(url) + '\n')) examinedItems.delete(key); }
    }
    const discovered = new Set(state.discoveredUrls.map(canonicalUrl));
    const discoveredItems = new Set(state.discoveredItems ?? state.discoveredUrls.map(canonicalUrl));
    const failures = new Map(state.accessFailures.map(item => [canonicalUrl(item.url), item]));
    const waiting = new Set(state.accessFailures.filter(item => item.retryAt && Date.parse(item.retryAt) > Date.now()).map(item => canonicalUrl(item.url)));
    const candidates = state.candidates.filter(item => initial.evidence.has(item.evidenceId));
    const reviewed = new Set(focus?.reviewedEvidenceIds ?? []);
    const addCandidate = (evidence: Omit<Evidence, 'content'>) => {
      if (focus && !reviewed.has(evidence.id) && !candidates.some(item => item.subjectId === focus.subjectId && item.criterionId === focus.criterionId && item.evidenceId === evidence.id)) {
        candidates.push({ subjectId: focus.subjectId, criterionId: focus.criterionId, evidenceId: evidence.id, url: evidence.url, itemKey: retrievalKey(evidence) });
      }
    };
    if (focus && !input.refresh && !initial.coverage.complete) {
      for (const stored of initial.evidence.values()) {
        if (documents.length >= input.readLimit) break;
        const evidence = acceptedEvidence(stored);
        if (!evidence) continue;
        const belongs = subject?.id === 'task' || subject?.urls?.some(url => canonicalUrl(url) === evidence.url)
          || state.candidates.some(item => item.subjectId === subject?.id && item.evidenceId === evidence.id)
          || [subject?.name, ...(subject?.aliases ?? [])].some(name => name && `${evidence.title}\n${evidence.content}`.toLowerCase().includes(name.toLowerCase()));
        if (!belongs || reviewed.has(evidence.id)) continue;
        const { content, ...metadata } = evidence;
        documents.push({ status: 'ok', evidence: metadata, ...focusText(content, { query: criterion?.description, keywords: input.keywords ?? criterion?.keywords }, input.length), cacheHit: true, runs: [] });
        addCandidate(metadata);
      }
    }
    let search: SearchReport = { query, status: 'ok', hits: [], runs: [], route, plan: { strategy: input.strategy ?? 'fallback', contentTypes: requestedMaterials, selected: [], stopReason: 'exhausted' } };
    if ((!initial.coverage.complete || input.refresh) && !documents.length && !options.signal?.aborted) {
      search = direct ? { ...search, hits: mergeHits([{ source: specificSource(direct, this.config) ?? input.readSources?.[0] ?? 'web', title: direct, url: direct, snippet: '', metadata: { directTarget: true } }]) }
        : await this.search({ ...input, sources: searchSources, query, intent: route.intent, excludeItems: [...new Set([...(input.excludeItems ?? []), ...discoveredItems])], signal: options.signal }, sourceOrder);
      const available = search.hits.filter(hit => !waiting.has(hit.url) && (input.refresh || !examinedItems.has(retrievalKey(hit)))
        && hit.retrievals.some(item => item.metadata?.relevance?.status !== 'irrelevant'));
      const score = (hit: AggregatedHit) => Math.max(...hit.retrievals.map(item => item.metadata?.relevance?.score ?? 0));
      available.sort((a, b) => score(b) - score(a) || b.rankScore - a.rankScore);
      const selected: AggregatedHit[] = [], publishers = new Set<string>();
      for (const hit of available) if (!publishers.has(hit.publisher) && selected.length < input.readLimit) { selected.push(hit); publishers.add(hit.publisher); }
      for (const hit of available) if (selected.length < input.readLimit && !selected.includes(hit)) selected.push(hit);
      let next = 0;
      const read: ReadReport[] = new Array(selected.length);
      await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
        while (next < selected.length && !options.signal?.aborted) {
          const index = next++, hit = selected[index]!;
          const native = hit.sources.filter(name => this.sources.some(source => source.capability.name === name && source.read));
          const readers = input.readSources ?? input.sources ?? [...new Set<SourceName>([...native, specificSource(hit.url, this.config) ?? 'web', 'web', 'exa', 'tavily', 'scrapling', 'agent-reach', 'opencli'])];
          const settings = { signal: options.signal, locator: hit.locator, contentTypes: requestedMaterials.length ? requestedMaterials : undefined,
            query: criterion?.description ?? input.query, keywords: input.keywords ?? criterion?.keywords, length: input.length,
            refresh: input.refresh || Boolean(input.since || input.until || input.at), timeoutMs: input.timeoutMs, browser: input.browser, raw: input.raw };
          if (readers.some(name => readOptionsFor(name).operation || readDiscoveryFailures.some(run => run.source === name))) {
            const runs: SourceRun[] = [];
            let result: ReadReport | undefined;
            for (const name of readers) {
              const unavailable = readDiscoveryFailures.find(run => run.source === name);
              if (unavailable) { runs.push(unavailable); continue; }
              const value = await this.read(hit.url, { ...settings, sources: [name], ...readOptionsFor(name) });
              runs.push(...value.runs);
              if (!result || value.status === 'ok' || !result.content && value.content) result = value;
              if (value.status === 'ok' || options.signal?.aborted) break;
            }
            read[index] = { ...(result ?? { status: 'error' as const }), runs };
          } else read[index] = await this.read(hit.url, { ...settings, sources: readers });
        }
      }));
      for (const [index, document] of read.entries()) {
        if (!document) continue;
        const hit = selected[index]!;
        if (input.at && document.evidence && hit.retrievals.some(item => item.metadata?.requestedTimestamp === input.at)) {
          try {
            const stored = await this.store.load(document.evidence.id), observed = documentObservations(stored).find(item => item.observationId === document.evidence?.observationId) ?? stored;
            const previous = observed.metadata?.readRequest as Record<string, unknown> | undefined;
            const { content: _content, ...metadata } = await this.store.save({ ...observed, metadata: { ...observed.metadata, readRequest: { ...previous, at: input.at } } });
            document.evidence = metadata;
          } catch (error) { document.cacheWarnings = [...(document.cacheWarnings ?? []), errorMessage(error, this.config)]; }
        }
        documents.push(document);
        const url = hit.url, key = retrievalKey(hit);
        const material = document.evidence ?? document.document;
        if (document.evidence) state.evidenceIds.push(document.evidence.id);
        if (document.content !== undefined && material && material.metadata?.bodyAvailable !== false && accepted({ ...material, content: document.content })) {
          examined.add(url); examinedItems.add(key); failures.delete(url);
          if (document.evidence) { examined.add(document.evidence.url); addCandidate(document.evidence); }
        } else {
          const retryAt = document.runs.map(run => run.retryAt).filter((value): value is string => Boolean(value)).sort().at(-1);
          failures.set(url, { url, codes: document.runs.map(run => run.code ?? run.status), ...(retryAt ? { retryAt } : {}) });
        }
      }
    }
    const newHits = search.hits.filter(hit => !discoveredItems.has(retrievalKey(hit)) && hit.retrievals.some(item => item.metadata?.relevance?.status !== 'irrelevant'));
    const newUrls = newHits.map(hit => hit.url);
    for (const hit of newHits) discoveredItems.add(retrievalKey(hit));
    state.discoveredUrls = [...new Set([...discovered, ...newUrls])]; state.examinedUrls = [...examined];
    state.discoveredItems = [...discoveredItems]; state.examinedItems = [...examinedItems];
    state.evidenceIds = [...new Set([...state.evidenceIds, ...initial.evidence.keys()])];
    state.candidates = candidates; state.accessFailures = [...failures.values()];
    const inspected = await inspectResearch(state, this.store, acceptedEvidence);
    const progress = { query, sources: [...new Set(search.runs.map(run => run.source))], newUrls: new Set(newUrls.filter(url => !discovered.has(url))).size, newItems: new Set(newHits.map(retrievalKey)).size,
      newEvidence: state.evidenceIds.filter(id => !knownEvidence.has(id) && inspected.evidence.has(id)).length,
      resolved: Math.max(0, inspected.coverage.verified.length - state.resolvedCount) };
    state.resolvedCount = inspected.coverage.verified.length;
    const pendingCandidates = candidates.filter(item => inspected.evidence.has(item.evidenceId) && acceptedEvidence(inspected.evidence.get(item.evidenceId)!)
      && !inspected.coverage.excluded.includes(item.subjectId) && !inspected.verified.has(assessmentKey(item))
      && !state.assessments.find(assessment => assessmentKey(assessment) === assessmentKey(item))?.reviewedEvidenceIds.includes(item.evidenceId));
    const noProgress = progress.newItems + progress.newEvidence + progress.resolved === 0;
    const allWaiting = search.hits.length > 0 && search.hits.every(hit => waiting.has(hit.url));
    state.nextAction = inspected.coverage.complete ? 'complete' : pendingCandidates.length || (!state.subjects.length && inspected.evidence.size) ? 'review-evidence'
      : allWaiting ? 'waiting' : noProgress && search.runs.length ? sourceOrder.some(name => !progress.sources.includes(name)) ? 'change-source' : 'change-query' : 'continue';
    if (state.nextAction === 'complete') { delete state.nextQuery; delete state.nextSources; }
    else {
      state.nextQuery = noProgress && search.runs.length ? subject?.aliases?.[0] ?? input.aliases?.[0] ?? shortSeed : focusedQuery;
      state.nextSources = input.sources ?? [...sourceOrder.filter(name => !progress.sources.includes(name)), ...sourceOrder.filter(name => progress.sources.includes(name))];
    }
    if (search.runs.length || documents.length || progress.resolved) state.history = [...state.history, progress].slice(-100);
    const evidence = [...inspected.evidence.values()];
    const grouped = (key: (item: Evidence) => string) => {
      const groups = new Map<string, string[]>();
      for (const item of evidence) { const value = key(item); groups.set(value, [...(groups.get(value) ?? []), item.id]); }
      return groups;
    };
    const messages = { complete: '任务要求的覆盖与原文引用检查已通过。', 'review-evidence': '审阅已有片段，填写结论、outcome 与 citations；无助于当前判据的材料记入 reviewedEvidenceIds。',
      continue: '按对象和剩余判据继续取证。', 'change-source': '本轮没有增加材料，下一轮优先其他可用来源。', 'change-query': '现有查询没有推进缺口，可用 discoveryQuery 提供新的发现查询。', waiting: '命中的入口仍在 Retry-After 等待期，先处理其他对象或允许的来源。' };
    const nextSteps = [messages[state.nextAction]];
    if (search.runs.some(run => run.coverage?.completeness !== 'complete')) nextSteps.push('任务判据完成情况与数据收录范围分别核验；无命中或已读完当前页不能证明目标时期没有相关事件。');
    if (documents.some(item => item.status !== 'ok')) nextSteps.push('部分材料尚未完整取得，已取得内容与失败记录继续保留。');
    const warnings = [...new Set(inspected.warnings)];
    return { ...search, status: search.status !== 'error' && documents.some(item => item.status !== 'ok') ? 'partial' : search.status,
      documents, state, coverage: inspected.coverage, ...(warnings.length ? { stateWarnings: warnings } : {}),
      comparison: { documentsRead: documents.filter(item => { const material = item.evidence ?? item.document; return item.content !== undefined && material && material.metadata?.bodyAvailable !== false && accepted({ ...material, content: item.content }); }).length,
        publisherGroups: [...grouped(item => publisher(item.url))].map(([publisher, evidenceIds]) => ({ publisher, evidenceIds })),
        duplicateContent: [...grouped(item => item.contentHash)].filter(([, ids]) => ids.length > 1).map(([contentHash, evidenceIds]) => ({ contentHash, evidenceIds })),
        groups: inspected.groups, progress, nextSteps } };
  }
}
