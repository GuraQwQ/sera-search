import { z } from 'zod';
import { sourceNames, platformIdPattern, intents } from './types.js';
import type { Channel, Config, Source, SourceName, SearchOptions, SearchReport, SearchHit, AggregatedHit, SourceRun, ReadReport, ResearchReport, Evidence, CommentReport, ImageRequest, ReadOptions, BatchReadReport, ResearchOptions, ResearchState, SearchAttempt } from './types.js';
import { canonicalUrl, publisher, textPage, focusText, EvidenceStore } from './evidence.js';
import { errorMessage } from './config.js';
import { createHttpSources } from './providers/http.js';
import { createPlatformSources } from './providers/platform.js';
import { authKey, invalidateCredential, notLoggedIn } from './credentials.js';
import { createWebSources } from './providers/web-apis.js';
import { createAcademicSources } from './providers/academic.js';
import { createCatalogSources } from './providers/catalog-apis.js';
import { createSocialSources } from './providers/social-apis.js';
import { createActionSources, bilibiliComments, serpImages, braveImages } from './providers/comments-images.js';
import { createDiscoverySources } from './providers/discovery.js';
import { createArchiveSources } from './providers/archives.js';
import { createForumSources } from './providers/forums.js';
import { createEntitySources } from './providers/entities.js';
import { directTarget, specificSource, taskRoute, preferredSources } from './routing.js';
import { assessRelevance } from './providers/relevance.js';

export const searchSchema = z.object({
  query: z.string().trim().min(1).max(4096),
  sources: z.array(z.enum(sourceNames)).min(1).optional(),
  limit: z.number().int().min(1).max(20).default(5),
  platform: z.string().regex(platformIdPattern).optional(),
  githubType: z.enum(['repositories', 'code', 'issues']).optional(),
  domains: z.array(z.string().min(1)).optional(),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, '日期需要有效的 YYYY-MM-DD').optional(),
  at: z.string().regex(/^(?:\d{8}|\d{14})$/).optional(),
  aliases: z.array(z.string().trim().min(1).max(256)).max(10).optional(),
  intent: z.enum(intents).optional(),
});

export const focusSchema = z.object({ query: z.string().trim().min(1).max(4096).optional(), keywords: z.array(z.string().trim().min(1).max(256)).max(32).optional(), length: z.number().int().min(1).max(20000).default(2000) });
export const readSchema = focusSchema.extend({ sources: z.array(z.enum(sourceNames)).min(1).optional(), refresh: z.boolean().default(false), maxAgeMs: z.number().finite().nonnegative().optional() });
export const researchStateSchema = z.object({
  fields: z.array(z.object({ name: z.string().trim().min(1).max(256), status: z.enum(['pending', 'supported', 'conflict']), evidenceIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).default([]), note: z.string().optional() })).max(30),
  examinedUrls: z.array(z.string().url()).default([]),
  candidates: z.array(z.object({ field: z.string(), evidenceId: z.string().regex(/^[a-f0-9]{64}$/), url: z.string().url() })).optional(),
  accessFailures: z.array(z.object({ url: z.string().url(), codes: z.array(z.string()) })).optional(),
  nextAction: z.enum(['continue', 'review-evidence', 'complete']).optional(),
});
export const researchSchema = searchSchema.extend({
  readLimit: z.number().int().min(0).max(20).default(5), readSources: z.array(z.enum(sourceNames)).min(1).optional(),
  goals: z.array(z.string().trim().min(1).max(256)).max(30).optional(), state: researchStateSchema.optional(),
  keywords: focusSchema.shape.keywords, length: focusSchema.shape.length, refresh: z.boolean().default(false),
});

export const commentsSchema = z.object({ url: z.string().url(), sources: z.array(z.enum(sourceNames)).min(1).optional(), limit: z.number().int().min(1).max(100).default(20), cursor: z.string().optional(), parentId: z.string().optional(), order: z.string().optional() });
export const imagesSchema = z.object({ query: z.string().trim().min(1).optional(), imageUrl: z.string().url().optional(), sources: z.array(z.enum(sourceNames)).min(1).optional(), platform: z.string().optional(), limit: z.number().int().min(1).max(20).default(5) }).refine(value => value.query || value.imageUrl, '需要关键词或图片 URL');

export function mergeHits(hits: SearchHit[]): AggregatedHit[] {
  const merged = new Map<string, AggregatedHit>();
  const ranks = new Map<SourceName, number>();
  for (const hit of hits) {
    let url: string;
    try { url = canonicalUrl(hit.url); } catch { continue; }
    const rank = (ranks.get(hit.source) ?? 0) + 1;
    ranks.set(hit.source, rank);
    const item = merged.get(url) ?? { title: hit.title, url, snippet: hit.snippet, sources: [], retrievals: [], rankScore: 0, publisher: publisher(url), publishedAt: hit.publishedAt };
    if (item.sources.includes(hit.source)) continue;
    item.sources.push(hit.source);
    item.retrievals.push({ source: hit.source, rank, snippet: hit.snippet, ...(hit.metadata ? { metadata: hit.metadata } : {}) });
    // 排序只融合检索名次，不用于判断证据可信度。
    item.rankScore += 1 / (60 + rank);
    if (hit.snippet.length > item.snippet.length) item.snippet = hit.snippet;
    if (!item.publishedAt && hit.publishedAt) item.publishedAt = hit.publishedAt;
    merged.set(url, item);
  }
  return [...merged.values()].sort((a, b) => b.rankScore - a.rankScore || a.url.localeCompare(b.url));
}

export class Engine {
  readonly store: EvidenceStore;
  readonly sources: Source[];
  constructor(readonly config: Config, sources?: Source[]) {
    this.sources = sources ?? [...createHttpSources(config), ...createWebSources(config), ...createAcademicSources(config), ...createPlatformSources(config), ...createCatalogSources(config), ...createSocialSources(config), ...createActionSources(config), ...createDiscoverySources(config), ...createArchiveSources(config), ...createForumSources(config), ...createEntitySources(config)];
    if (!sources) {
      const attach = (name: SourceName) => this.sources.find(source => source.capability.name === name)!;
      attach('bilibili').comments = request => bilibiliComments(config.bilibili, request);
      attach('bilibili').capability.comments = true;
      attach('serpapi').images = request => serpImages(config.serpapi ?? {}, request);
      attach('serpapi').capability.images = true;
      attach('brave').images = request => braveImages(config.brave, request);
      attach('brave').capability.images = true;
    }
    this.store = new EvidenceStore(config);
  }

  capabilities(names?: SourceName[]) { return this.sources.filter(source => !names || names.includes(source.capability.name)).map(source => ({ ...source.capability, status: source.capability.requiresLogin && !source.capability.loggedIn ? notLoggedIn : source.capability.configured ? '可调用' : '不可用', availability: '调用时检查' })); }

  async channels(options: { sources?: SourceName[]; platform?: string; signal?: AbortSignal } = {}) {
    const names = options.sources ? [...new Set(options.sources)] : this.sources.map(source => source.capability.name);
    const results = await Promise.all(names.map(async name => {
      const source = this.sources.find(item => item.capability.name === name);
      const started = Date.now(), signal = this.signal(options.signal);
      if (!source || source.channels && !source.capability.configured) return { channels: [], run: this.unavailable(name, source) };
      try {
        signal.throwIfAborted();
        const channels: Channel[] = source.channels ? await source.channels(signal) : [{ source: name,
          platform: source.capability.platforms?.[0] ?? (['exa', 'tavily', 'brave', 'web'].includes(name) ? 'web' : name),
          search: source.capability.search, read: source.capability.read, configured: source.capability.configured,
          comments: source.capability.comments, images: source.capability.images,
          browser: false, description: source.capability.requirement, status: source.capability.requiresLogin && !source.capability.loggedIn ? notLoggedIn : source.capability.configured ? '可调用' : '不可用' }];
        const selected = options.platform ? channels.filter(channel => channel.platform === options.platform) : channels;
        return { channels: selected, run: { source: name, status: selected.length ? 'ok' : 'empty', elapsedMs: Date.now() - started, returned: selected.length } as SourceRun };
      } catch (error) { return { channels: [], run: await this.failure(name, error, started, signal) }; }
    }));
    const runs = results.map(item => item.run), good = runs.some(run => ['ok', 'empty'].includes(run.status));
    return { status: !good ? 'error' : runs.some(run => !['ok', 'empty'].includes(run.status)) ? 'partial' : 'ok', channels: results.flatMap(item => item.channels), runs };
  }

  private signal(signal?: AbortSignal) { return AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(signal ? [signal] : [])]); }

  private unavailable(name: SourceName, source?: Source): SourceRun {
    const login = source?.capability.requiresLogin && !source.capability.loggedIn || ['agent-reach', 'opencli'].includes(name);
    const disabled = name === 'agent-reach' ? this.config.agentReach?.enabled === false : this.config[name]?.enabled === false;
    return { source: name, status: 'unavailable', elapsedMs: 0, returned: 0, message: login ? notLoggedIn : disabled ? '来源已停用' : source?.capability.requirement ?? '此来源不支持该操作', ...(login ? { code: 'NOT_LOGGED_IN' } : {}) };
  }

  private async failure(source: SourceName, error: unknown, started: number, signal: AbortSignal): Promise<SourceRun> {
    const detail = error as { code?: unknown; retryAfterSeconds?: number; platform?: string };
    const login = ['NOT_LOGGED_IN', 'NEED_LOGIN', 'AUTH_REQUIRED', 'HTTP_401'].includes(String(detail?.code));
    if (login) {
      const expected = this.config.credentials?.[authKey(source, detail.platform)];
      if (expected) await invalidateCredential(this.config.home, source, detail.platform, expected).catch(() => {});
      const provider = this.sources.find(item => item.capability.name === source);
      if (provider?.capability.requiresLogin && !detail.platform) { provider.capability.loggedIn = false; provider.capability.configured = false; }
    }
    return {
      source, status: login ? 'unavailable' : signal.aborted && signal.reason?.name === 'AbortError' ? 'cancelled' : 'error',
      elapsedMs: Date.now() - started, returned: 0, message: errorMessage(error, this.config),
      code: login ? 'NOT_LOGGED_IN' : typeof detail?.code === 'string' ? detail.code : signal.aborted ? signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED' : undefined,
      retryAfterSeconds: detail?.retryAfterSeconds,
    };
  }

  async search(options: SearchOptions): Promise<SearchReport> {
    const input = searchSchema.parse(options);
    const route = taskRoute(input.query, input.intent);
    const selected = input.sources ? [...new Set(input.sources)] : input.at ? ['wayback' as SourceName] : input.platform
      ? this.sources.filter(source => source.capability.configured && source.search && (source.capability.platforms?.includes(input.platform!) || ['agent-reach', 'opencli'].includes(source.capability.name) || input.platform === 'academic' && source.capability.category === 'academic')).map(source => source.capability.name)
      : [...new Set<SourceName>([...preferredSources(route.intent, input.query), 'agent-reach'])].filter(name => this.sources.some(source => source.capability.name === name && source.capability.configured && source.search && (name !== 'sites' || Boolean(input.platform))));
    const run = async (name: SourceName, query = input.query, filter = false) => {
      const source = this.sources.find(item => item.capability.name === name);
      if (!source?.search || !source.capability.configured) return { hits: [], run: this.unavailable(name, source) };
      const started = Date.now(), signal = this.signal(options.signal);
      const attempts: SearchAttempt[] = [];
      try {
        signal.throwIfAborted();
        const raw = (await source.search({ ...input, query, signal, onAttempt: attempt => attempts.push(attempt) })).slice(0, input.limit);
        const relevant = filter ? assessRelevance(input.query, raw, input.aliases) : { hits: raw };
        if (!attempts.length) attempts.push({ backend: name, query, status: relevant.hits.length ? 'ok' : raw.length ? 'irrelevant' : 'empty', elapsedMs: Date.now() - started, returned: relevant.hits.length, reason: relevant.reason });
        return { hits: relevant.hits, run: { source: name, status: relevant.hits.length ? 'ok' : 'empty', elapsedMs: Date.now() - started, returned: relevant.hits.length, attempts } as SourceRun };
      } catch (error) {
        const failure = await this.failure(name, error, started, signal);
        if (!attempts.length) attempts.push({ backend: name, query, status: failure.status === 'cancelled' ? 'cancelled' : 'error', elapsedMs: failure.elapsedMs, returned: 0, reason: failure.message, code: failure.code, retryAfterSeconds: failure.retryAfterSeconds });
        return { hits: [], run: { ...failure, attempts } };
      }
    };
    const results: { hits: SearchHit[]; run: SourceRun }[] = [];
    if (input.sources || input.platform || input.at) results.push(...await Promise.all(selected.map(name => run(name))));
    else {
      for (const name of selected) {
        const result = await run(name, input.query, true);
        results.push(result);
        if (result.hits.length || options.signal?.aborted) break;
      }
      const alias = input.aliases?.find(value => value !== input.query);
      if (alias && !results.some(result => result.hits.length) && !options.signal?.aborted) {
        for (const name of selected) {
          if (results.some(result => result.run.source === name && (result.run.code === 'NOT_LOGGED_IN' || result.run.code === 'RATE_LIMITED' || result.run.code === 'HTTP_429'))) continue;
          const result = await run(name, alias, true);
          results.push(result);
          if (result.hits.length || options.signal?.aborted) break;
        }
      }
    }
    const runs = results.map(result => result.run);
    const hits = mergeHits(results.flatMap(result => result.hits));
    const good = runs.some(run => ['ok', 'empty'].includes(run.status));
    const failed = runs.some(run => !['ok', 'empty'].includes(run.status));
    return { query: input.query, hits, runs, route, status: !good ? 'error' : failed ? 'partial' : hits.length ? 'ok' : 'empty' };
  }

  async images(options: Omit<ImageRequest, 'signal'> & { sources?: SourceName[]; signal?: AbortSignal }): Promise<SearchReport> {
    const input = imagesSchema.parse(options);
    const names = input.sources ?? (input.imageUrl ? ['serpapi', 'trace-moe', 'saucenao'] as SourceName[] : ['brave', 'serpapi', 'baidu-images', 'sogou-images'] as SourceName[]);
    const results = await Promise.all(names.map(async name => {
      const source = this.sources.find(item => item.capability.name === name), started = Date.now(), signal = this.signal(options.signal);
      if (!source?.images || !source.capability.configured) return { hits: [], run: this.unavailable(name, source) };
      try { const hits = await source.images({ ...input, signal }); return { hits, run: { source: name, status: hits.length ? 'ok' : 'empty', elapsedMs: Date.now() - started, returned: hits.length } as SourceRun }; }
      catch (error) { return { hits: [], run: await this.failure(name, error, started, signal) }; }
    }));
    const hits = mergeHits(results.flatMap(item => item.hits)), runs = results.map(item => item.run), good = runs.some(run => ['ok', 'empty'].includes(run.status));
    return { query: input.query ?? input.imageUrl!, hits, runs, status: !good ? 'error' : runs.some(run => !['ok', 'empty'].includes(run.status)) ? 'partial' : hits.length ? 'ok' : 'empty' };
  }

  async comments(options: z.input<typeof commentsSchema> & { signal?: AbortSignal }): Promise<CommentReport> {
    const input = commentsSchema.parse(options), url = canonicalUrl(input.url), host = new URL(url).hostname;
    const fallback: SourceName = /(^|\.)bilibili\.com$/.test(host) || host === 'b23.tv' ? 'bilibili' : /(^|\.)instagram\.com$/.test(host) ? 'instagram' : host === 'music.163.com' ? 'netease' : host === 'linux.do' ? 'linuxdo' : /(^|\.)xiaoheihe\.cn$/.test(host) ? 'heybox' : 'youtube';
    const runs: SourceRun[] = [];
    for (const name of input.sources ?? [fallback]) {
      const source = this.sources.find(item => item.capability.name === name), started = Date.now(), signal = this.signal(options.signal);
      if (!source?.comments || !source.capability.configured) { runs.push(this.unavailable(name, source)); continue; }
      try {
        const page = await source.comments({ ...input, url, signal });
        runs.push({ source: name, status: page.comments.length ? 'ok' : 'empty', elapsedMs: Date.now() - started, returned: page.comments.length });
        if (!page.comments.length) return { status: 'empty', page, runs };
        const result: CommentReport = { status: 'ok', page, runs };
        try {
          const saved = await this.store.save({ source: name, url: page.url, title: '评论：' + page.url, content: JSON.stringify(page, null, 2), contentKind: 'post', metadata: { objectKind: 'comments', scope: page.scope, truncated: page.truncated, nextCursor: page.nextCursor } });
          const { content: _content, ...metadata } = saved;
          result.evidence = metadata;
        } catch (error) { result.status = 'partial'; result.cacheWarnings = [errorMessage(error, this.config)]; }
        return result;
      } catch (error) { runs.push(await this.failure(name, error, started, signal)); if (signal.aborted) break; }
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
      ...(specific ? [specific] : []), 'exa', 'tavily', 'agent-reach', 'opencli', 'web',
    ])];
    const eligible = order.filter(name => this.sources.some(source => source.capability.name === name && source.capability.configured && source.read));
    const view = (content: string) => input.query || input.keywords?.length ? focusText(content, input, input.length) : { ...textPage(content, 0, input.length), selection: 'leading' as const };
    if (!input.refresh) {
      try {
        const cached = await this.store.find(url, eligible, input.maxAgeMs);
        if (cached) {
          const { content, ...metadata } = cached;
          return { status: 'ok', evidence: metadata, ...view(content), cacheHit: true, cacheAgeMs: Date.now() - Date.parse(cached.retrievedAt),
            runs: [{ source: cached.source, status: 'ok', elapsedMs: 0, returned: 1, cacheHit: true }], ...(cacheWarnings.length ? { cacheWarnings } : {}) };
        }
      } catch (error) { cacheWarnings.push(`URL 缓存未读取：${errorMessage(error, this.config)}`); }
    }
    const runs: SourceRun[] = [];
    for (const name of order) {
      const source = this.sources.find(item => item.capability.name === name);
      if (!source?.read || !source.capability.configured) {
        if (input.sources) runs.push(this.unavailable(name, source));
        continue;
      }
      const started = Date.now(), signal = this.signal(options.signal);
      try {
        signal.throwIfAborted();
        const document = await source.read(url, signal);
        if (typeof document.content !== 'string' || !document.content.trim()) throw new Error('读取结果没有正文或有效元数据');
        runs.push({ source: name, status: 'ok', elapsedMs: Date.now() - started, returned: 1 });
        try {
          const evidence = await this.store.save(document);
          if (canonicalUrl(document.url) !== url) {
            try { await this.store.remember(url, evidence); }
            catch (error) { cacheWarnings.push(`URL 缓存未保存：${errorMessage(error, this.config)}`); }
          }
          const { content: _content, ...metadata } = evidence;
          return { status: 'ok', evidence: metadata, ...view(document.content), cacheHit: false, runs, ...(cacheWarnings.length ? { cacheWarnings } : {}) };
        } catch (error) {
          cacheWarnings.push(`证据保存未完成：${errorMessage(error, this.config)}`);
          const { content, ...metadata } = document;
          return { status: 'partial', document: metadata, ...view(content), cacheHit: false, runs, cacheWarnings };
        }
      } catch (error) {
        runs.push(await this.failure(name, error, started, signal));
        if (options.signal?.aborted || (error as { terminal?: boolean }).terminal) break;
      }
    }
    return { status: 'error', runs, ...(cacheWarnings.length ? { cacheWarnings } : {}) };
  }

  async readMany(urls: string[], options: ReadOptions = {}): Promise<BatchReadReport> {
    const addresses = z.array(z.string().min(1)).min(1).max(20).parse(urls).map(url => canonicalUrl(directTarget(url) ?? url));
    readSchema.parse(options);
    const unique = [...new Set(addresses)], reports = new Map<string, ReadReport>();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, unique.length) }, async () => {
      while (next < unique.length) {
        const url = unique[next++]!;
        reports.set(url, await this.read(url, options));
      }
    }));
    const documents = addresses.map(url => reports.get(url)!);
    return { status: documents.every(item => item.status === 'ok') ? 'ok' : documents.every(item => item.status === 'error') ? 'error' : 'partial', documents };
  }

  async research(options: ResearchOptions): Promise<ResearchReport> {
    const input = researchSchema.parse(options), { readLimit, readSources } = input;
    const fields = input.state?.fields.map(field => ({ ...field, evidenceIds: [...field.evidenceIds] })) ?? [];
    for (const name of input.goals ?? []) if (!fields.some(field => field.name === name)) fields.push({ name, status: 'pending', evidenceIds: [] });
    const unresolved = fields.filter(field => field.status !== 'supported');
    const complete = fields.length > 0 && !unresolved.length;
    const route = taskRoute(input.query, input.intent);
    const direct = !input.at && !input.since && !input.sources?.includes('wayback') && (route.intent !== 'historical' || route.directUrl?.startsWith('https://web.archive.org/web/')) ? route.directUrl : undefined;
    const query = input.state && unresolved.length && !direct ? `${input.query} ${unresolved.map(field => field.name).join(' ')}`.slice(0, 4096) : input.query;
    const search: SearchReport = complete ? { query: input.query, status: 'ok', hits: [], runs: [], route }
      : direct ? { query: input.query, status: 'ok', hits: mergeHits([{ source: specificSource(direct, this.config) ?? readSources?.[0] ?? input.sources?.[0] ?? 'web', title: direct, url: direct, snippet: '', metadata: { directTarget: true } }]), runs: [], route }
      : await this.search({ ...input, query, signal: options.signal });
    const examined = new Set((input.state?.examinedUrls ?? []).map(canonicalUrl));
    const available = search.hits.filter(hit => input.refresh || !examined.has(hit.url));
    const selected: AggregatedHit[] = [];
    const publishers = new Set<string>();
    for (const hit of available) {
      if (!publishers.has(hit.publisher) && selected.length < readLimit) { selected.push(hit); publishers.add(hit.publisher); }
    }
    for (const hit of available) if (selected.length < readLimit && !selected.includes(hit)) selected.push(hit);
    const documents: ReadReport[] = new Array(selected.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
      while (next < selected.length) {
        const index = next++, hit = selected[index]!;
        documents[index] = await this.read(hit.url, { sources: readSources ?? input.sources, signal: options.signal, query: unresolved.length ? unresolved.map(field => field.name).join(' ') : direct ? undefined : input.query, keywords: input.keywords, length: input.length, refresh: input.refresh });
      }
    }));
    const evidence = documents.flatMap(document => document.evidence ? [document.evidence] : []);
    const grouped = (key: (item: Omit<Evidence, 'content'>) => string) => {
      const groups = new Map<string, string[]>();
      for (const item of evidence) { const value = key(item); groups.set(value, [...(groups.get(value) ?? []), item.id]); }
      return groups;
    };
    const nextSteps = ['围绕具体结论读取原文片段，核对支持、冲突和引用关系；不同检索入口不等于独立证据。'];
    if (documents.some(document => document.status === 'error')) nextSteps.push('部分原文未取得，请根据读取记录补查对应来源。');
    if (documents.some(document => document.status === 'partial')) nextSteps.push('部分原文已读取但证据缓存未保存，请保留返回正文并查看缓存记录。');
    if (evidence.some(item => item.contentKind === 'metadata')) nextSteps.push('部分结果是元数据，判断正文内容前需要补充原文。');
    if (selected.length < available.length) nextSteps.push('本次读取受预算限制，可按结果链接继续获取证据。');
    if (available.length < search.hits.length) nextSteps.push('已取证的页面本轮跳过；可通过证据 ID 继续核验，或用 refresh 重新读取。');
    let state: ResearchState | undefined;
    if (fields.length) {
      const candidates = new Map((input.state?.candidates ?? []).map(item => [`${item.field}\n${item.evidenceId}`, item]));
      const failures = new Map((input.state?.accessFailures ?? []).map(item => [canonicalUrl(item.url), item]));
      for (const [index, document] of documents.entries()) {
        const url = selected[index]!.url;
        if (document.content !== undefined) { examined.add(url); if (document.evidence) examined.add(document.evidence.url); failures.delete(url); }
        else failures.set(url, { url, codes: document.runs.map(run => run.code ?? run.status) });
        if (document.evidence) for (const field of unresolved) candidates.set(`${field.name}\n${document.evidence.id}`, { field: field.name, evidenceId: document.evidence.id, url: document.evidence.url });
      }
      const needsReview = documents.some(document => document.content !== undefined) || [...candidates.values()].some(item => unresolved.some(field => field.name === item.field));
      state = { fields, examinedUrls: [...examined], candidates: [...candidates.values()], accessFailures: [...failures.values()], nextAction: complete ? 'complete' : needsReview ? 'review-evidence' : 'continue' };
      if (unresolved.length) nextSteps.push(`待核验：${unresolved.map(field => field.name).join('、')}。阅读候选证据后更新 fields 的状态与 evidenceIds，再传回 state 只补缺口。`);
      else nextSteps.splice(0, nextSteps.length, '目标字段已由调用方核验；本轮停止检索。');
    }
    return {
      ...search, status: search.status !== 'error' && documents.some(document => document.status !== 'ok') ? 'partial' : search.status,
      documents, ...(state ? { state } : {}),
      comparison: {
        documentsRead: documents.filter(document => document.content !== undefined).length,
        publisherGroups: [...grouped(item => publisher(item.url))].map(([publisher, evidenceIds]) => ({ publisher, evidenceIds })),
        duplicateContent: [...grouped(item => item.contentHash)].filter(([, ids]) => ids.length > 1).map(([contentHash, evidenceIds]) => ({ contentHash, evidenceIds })),
        nextSteps,
      },
    };
  }
}
