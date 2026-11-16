import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import type { Config, Source, SpecialistSourceName } from '../types.js';
import { specialistSites } from '../provider-catalog.js';
import { EvidenceStore } from '../evidence.js';
import { createDiscoverySources } from './discovery.js';
import { createHttpSources } from './http.js';
import { describeOperation, reportCoverage, selectOperation } from './operations.js';
import { permitted } from './shared.js';

const directoryNames: SpecialistSourceName[] = ['operationhong', 'matsuri', 'steamdb', 'vgmdb', 'novelupdates', 'kakuyomu', 'google-patents', 'j-platpat', 'nga', '5ch'];

export function createDirectorySources(config: Config): Source[] {
  const discovery = createDiscoverySources({ ...config, catalog: { sites: { ...specialistSites, ...config.catalog?.sites } } }).find(source => source.capability.name === 'sites')!;
  const web = createHttpSources(config).find(source => source.capability.name === 'web')!;
  const sources: Source[] = directoryNames.map(name => {
    const site = specialistSites[name], schema = z.strictObject({});
    const operations = [describeOperation('pages', `${site.label}公开页面发现`, site.contentTypes, schema, 'site-search')];
    return {
      capability: { name, configured: config[name]?.enabled !== false, search: true, read: true, category: 'catalog', contentTypes: site.contentTypes, operations, accessMethod: 'site-search',
        requirement: site.description ?? '按站点域名发现页面，再读取实际原文', limitations: ['站点发现使用网页索引，结果不表示历史数据库的完整收录'] },
      async search(request) {
        selectOperation(request, operations); schema.parse(request.params ?? {});
        reportCoverage(request, '站点公开页面索引', { limitations: ['页面命中与站内数据库记录分别核验'] });
        const hits = await discovery.search!({ ...request, operation: undefined, params: undefined, platform: name });
        return hits.map(hit => ({ ...hit, source: name, metadata: { ...hit.metadata, accessMethod: 'site-search' } }));
      },
      async read(url, signal, options) {
        if (!permitted(site.domains, new URL(url).hostname)) throw new Error(`链接不属于 ${site.label}`);
        const value = await web.read!(url, signal, options);
        return { ...value, source: name, metadata: { ...value.metadata, acquisitionBackend: 'web', contentScope: 'public-page' } };
      },
    };
  });
  const name = 'laplace' as const, store = new EvidenceStore(config), schema = z.strictObject({});
  const operations = [describeOperation('local-records', '检索已通过 record 导入的 LAPLACE 记录', ['live-danmaku', 'live-event'], schema, 'local')];
  sources.push({
    capability: { name, configured: config.laplace?.enabled !== false, search: true, read: true, category: 'platform', operations, contentTypes: ['live-danmaku', 'live-event'], accessMethod: 'local',
      requirement: 'record 导入时设置 originSource:laplace，保留原始事件标识和时间' },
    async search(request) {
      selectOperation(request, operations); schema.parse(request.params ?? {});
      const results = [];
      let files: string[];
      try { files = await readdir(store.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; files = []; }
      for (const file of files) {
        request.signal.throwIfAborted();
        if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
        const evidence = await store.load(file.slice(0, -5)).catch(() => undefined);
        if (!evidence || evidence.metadata?.originSource !== name || !permitted(request.domains, new URL(evidence.url).hostname)) continue;
        const at = evidence.locator?.occurredAt ?? evidence.publishedAt;
        if ((request.since || request.until) && (!at || request.since && at.slice(0, 10) < request.since || request.until && at.slice(0, 10) > request.until)) continue;
        if (!`${evidence.title}\n${evidence.content}`.toLocaleLowerCase().includes(request.query.toLocaleLowerCase())) continue;
        results.push({ source: name, title: evidence.title, url: evidence.url, snippet: evidence.content.slice(0, 1500), locator: evidence.locator, publishedAt: evidence.publishedAt, metadata: { evidenceId: evidence.id, accessMethod: 'local', acquisition: evidence.metadata.acquisition } });
        if (results.length >= request.limit) break;
      }
      reportCoverage(request, '已导入的本地 LAPLACE 记录', { completeness: 'partial', truncated: results.length >= request.limit, limitations: ['本地记录范围取决于实际录制与导入内容'] });
      return results;
    },
    async read(url, _signal, options) {
      const evidence = await store.find(url, ['external'], config.retentionDays * 86400000, item => item.metadata?.originSource === name, options?.locator);
      if (!evidence) throw Object.assign(new Error('尚无此 LAPLACE 导入记录，请使用 record 导入实际材料'), { code: 'LOCAL_RECORD_NOT_FOUND' });
      return evidence;
    },
  });
  return sources;
}
