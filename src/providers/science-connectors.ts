import { z } from 'zod';
import { connectorClient, createStructuredSource } from '../connectors.js';
import type { ConnectorDefinition, ConnectorOperation, StructuredClient } from '../connectors.js';
import { sourceConfig } from '../source-config.js';
import type { Config, DataCoverage, Document, ReadOptions, SearchHit, SearchRequest, Source } from '../types.js';
import { date, document, hit, object, permitted, plain, rows, string } from './shared.js';
import { reportCoverage } from './operations.js';

const value = z.string().trim().min(1).max(2000), offset = z.number().int().min(0).max(100000).default(0);
function operation(description: string, contentTypes: string[], schema: z.ZodType): ConnectorOperation {
  return { description, content_types: contentTypes, input_schema: z.toJSONSchema(schema) };
}
function definition(id: string, base: string, label: string, evidence: string, operations: Record<string, ConnectorOperation>, extra: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return { id, type: 'rest', base_url: base, label, auth: { type: 'none' }, access: { authentication: 'none', billing: 'free', evidence },
    limits: { min_interval_ms: 200 }, operations, ...extra };
}
function results(request: SearchRequest, source: string, items: SearchHit[], scope: string, coverage: Partial<DataCoverage> = {}) {
  reportCoverage(request, scope, { completeness: 'partial', ...coverage, truncated: Boolean(coverage.truncated) || items.length > request.limit });
  return items.filter(item => permitted(request.domains, new URL(item.url).hostname)).slice(0, request.limit);
}
function record(source: string, url: string, id: string, title: string, data: unknown, metadata: Record<string, unknown> = {}): Document {
  return document(source, url, title, typeof data === 'string' ? data : JSON.stringify(data, null, 2), { contentKind: 'metadata', locator: { kind: 'record', id }, metadata: { contentScope: 'scientific-record', ...metadata } });
}
function pathId(url: string, hosts: string[], pattern: RegExp): string {
  const parsed = new URL(url), match = hosts.includes(parsed.hostname) ? parsed.pathname.match(pattern) : undefined;
  if (!match?.[1]) throw new Error('读取需要该科学数据库的记录链接');
  return decodeURIComponent(match[1]);
}
function nextLink(response: Response, parameter: string): string | undefined {
  const next = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  return next ? new URL(next).searchParams.get(parameter) ?? undefined : undefined;
}

export const scienceDefinitions: ConnectorDefinition[] = [
  definition('rcsb-pdb', 'https://search.rcsb.org/', 'RCSB PDB 实验结构与序列', 'https://www.rcsb.org/docs/programmatic-access/web-apis-overview', {
    structures: operation('文本搜索实验结构，结果 ID 可继续取得结构详情', ['molecular-structure'], z.strictObject({ offset })),
    sequence: operation('蛋白序列相似性检索，query 使用氨基酸序列', ['molecular-structure'], z.strictObject({ offset, identity: z.number().min(0).max(1).default(0.5) })),
  }),
  definition('uniprot', 'https://rest.uniprot.org/', 'UniProt 蛋白序列、功能与跨库 ID', 'https://www.uniprot.org/api-documentation', {
    proteins: operation('使用 UniProt 查询表达式检索蛋白记录', ['protein'], z.strictObject({ cursor: value.optional(), reviewed: z.boolean().optional() })),
  }),
  definition('chembl', 'https://www.ebi.ac.uk/chembl/api/data/', 'ChEMBL 化合物、靶点与实验活性', 'https://chembl.gitbook.io/chembl-interface-documentation/web-services/chembl-data-web-services', {
    molecules: operation('关键词发现化合物', ['compound'], z.strictObject({ offset })),
    targets: operation('关键词发现靶点', ['target'], z.strictObject({ offset })),
    activities: operation('按 ChEMBL 靶点或分子 ID 读取活性记录，保留实验单位和关系运算符', ['bioactivity'], z.strictObject({ offset, target: value.optional(), molecule: value.optional() })),
  }),
  definition('pubchem', 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/', 'PubChem 化合物性质与结构', 'https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest', {
    compounds: operation('通过化合物名称或 CID 取得性质，resultOffset 续读同名多CID结果', ['compound'], z.strictObject({ cid: z.number().int().positive().optional(), resultOffset: z.number().int().min(0).max(10000).default(0) })),
  }, { limits: { min_interval_ms: 250 }, limitations: ['复杂结构检索可能需要异步任务；此动作按名称或 CID 读取化合物性质'] }),
  definition('materials-project', 'https://api.materialsproject.org/', 'Materials Project 材料结构与计算性质', 'https://docs.materialsproject.org/downloading-data/using-the-api/tips-for-large-downloads', {
    materials: operation('按化学式或材料 ID 检索材料及计算性质', ['material'], z.strictObject({ materialId: value.optional(), formula: value.optional(), offset })),
  }, { auth: { type: 'api-key', header: 'X-API-KEY' }, access: { authentication: 'api-key', billing: 'free', quota: 'API 起始限速 25 次/秒；当前账户访问状态由实际请求确认', evidence: 'https://docs.materialsproject.org/downloading-data/using-the-api/getting-started' } }),
  definition('nasa-exoplanets', 'https://exoplanetarchive.ipac.caltech.edu/', 'NASA 系外行星与恒星参数', 'https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html', {
    planets: operation('按行星或宿主名读取综合参数；按名称排序后用offset续查，最多偏移1000条', ['exoplanet'], z.strictObject({ host: value.optional(), minimumPeriodDays: z.number().nonnegative().optional(), offset: z.number().int().min(0).max(1000).default(0) })),
  }),
  definition('hepdata', 'https://www.hepdata.net/', 'HEPData 论文关联实验数据表', 'https://www.hepdata.net/terms', {
    datasets: operation('按关键词或合作组检索实验数据记录', ['experimental-dataset'], z.strictObject({ page: z.number().int().min(1).default(1), collaboration: value.optional() })),
  }, { limits: { min_interval_ms: 500 }, limitations: ['数据表与分析解释分别保留；服务可能触发网页访问验证'] }),
  definition('gbif', 'https://api.gbif.org/v1/', 'GBIF 分类群与物种出现记录', 'https://techdocs.gbif.org/en/openapi/', {
    taxa: operation('按学名发现分类群记录', ['taxon'], z.strictObject({ offset })),
    occurrences: operation('按 taxonKey 和事件日期检索公开出现记录', ['species-occurrence'], z.strictObject({ taxonKey: z.number().int().positive(), offset, country: z.string().length(2).optional() })),
  }, { limitations: ['公开出现记录覆盖依赖提供者；大规模下载与账号认证是另外的动作'] }),
  definition('inaturalist', 'https://api.inaturalist.org/v1/', 'iNaturalist 分类鉴定与公开观察', 'https://api.inaturalist.org/v1/swagger.json', {
    taxa: operation('按名称发现分类群', ['taxon'], z.strictObject({ page: z.number().int().min(1).default(1) })),
    observations: operation('按分类群 ID 和日期读取公开观察；时间范围是观察日期', ['species-occurrence'], z.strictObject({ taxonId: z.number().int().positive(), page: z.number().int().min(1).default(1), quality: z.enum(['research', 'needs_id', 'casual']).optional() })),
  }, { access: { authentication: 'none', billing: 'free', quota: '最高100次/分钟；建议60次/分钟及每天少于10000次，日值为使用建议', evidence: 'https://api.inaturalist.org/v1/swagger.json' }, limits: { min_interval_ms: 1000 } }),
  definition('earthdata-cmr', 'https://cmr.earthdata.nasa.gov/search/', 'NASA Earthdata 遥感集合与粒度元数据', 'https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html', {
    collections: operation('按关键词、传感器和时空范围发现公开集合', ['remote-sensing-dataset'], z.strictObject({ instrument: value.optional(), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(), cursor: value.optional() })),
    granules: operation('在指定集合内按日期发现 granule 元数据', ['remote-sensing-granule'], z.strictObject({ collectionId: value, cursor: value.optional() })),
  }, { limitations: ['此来源发现并读取元数据，下载链接的提供方认证与文件大小分别核验；不默认下载卫星文件'] }),
];

export function createScienceSources(config: Config): Source[] {
  return scienceDefinitions.map(def => {
    const id = def.id, settings = sourceConfig(config, id);
    if (id === 'rcsb-pdb') {
      const data = connectorClient(settings, { ...def, base_url: 'https://data.rcsb.org/' });
      const search = async (request: SearchRequest, p: Record<string, any>, client: StructuredClient) => {
        const sequence = request.operation === 'sequence';
        if (sequence && !/^[ACDEFGHIKLMNPQRSTVWYX]{10,10000}$/i.test(request.query)) throw new Error('序列查询需要10至10000个氨基酸字符');
        const query = sequence ? { type: 'terminal', service: 'sequence', parameters: { evalue_cutoff: 1, identity_cutoff: p.identity, sequence_type: 'protein', value: request.query } }
          : { type: 'terminal', service: 'full_text', parameters: { value: request.query } };
        const response: Response = await client('rcsbsearch/v2/query', request.signal, {}, { query, return_type: 'entry', request_options: { paginate: { start: p.offset, rows: request.limit } } }, 'response');
        const raw = response.status === 204 ? { result_set: [], total_count: 0 } : await response.json();
        const entries = rows(raw.result_set ?? [], 'RCSB');
        const more = Number(raw.total_count) > p.offset + entries.length;
        return results(request, id, entries.flatMap(item => hit(id, { title: `PDB ${item.identifier}`, url: `https://www.rcsb.org/structure/${encodeURIComponent(string(item.identifier))}`, snippet: `结构检索分数 ${item.score ?? ''}`, locator: { kind: 'record', id: string(item.identifier) }, metadata: { record: item } })), 'structure-search', { truncated: more, nextCursor: more ? String(p.offset + entries.length) : undefined });
      };
      return createStructuredSource(config, def, { search: { structures: search, sequence: search }, read: async (url, signal) => { const key = pathId(url, ['www.rcsb.org', 'rcsb.org'], /^\/structure\/([a-z\d_-]+)\/?$/i); const v = await data(`rest/v1/core/entry/${encodeURIComponent(key)}`, signal); return record(id, url, key, string(v.struct?.title) || key, v, { contentType: 'molecular-structure', units: 'PDB/mmCIF 字段定义', citation: v.rcsb_primary_citation }); } });
    }
    if (id === 'uniprot') return createStructuredSource(config, def, { search: { proteins: async (request, p, client) => {
      const r: Response = await client('uniprotkb/search', request.signal, { query: `${request.query}${p.reviewed === undefined ? '' : ` AND reviewed:${p.reviewed}`}`,
        format: 'json', fields: 'accession,id,protein_name,organism_name,length,reviewed', size: request.limit, cursor: p.cursor }, undefined, 'response');
      const raw = await r.json(), entries = rows(raw.results, 'UniProt'), cursor = nextLink(r, 'cursor');
      return results(request, id, entries.flatMap(item => hit(id, { title: string((item.proteinDescription as any)?.recommendedName?.fullName?.value) || string(item.uniProtkbId), url: `https://www.uniprot.org/uniprotkb/${item.primaryAccession}`,
        snippet: `${item.uniProtkbId ?? ''} · ${(item.organism as any)?.scientificName ?? ''}`, locator: { kind: 'record', id: string(item.primaryAccession) },
        metadata: { accession: item.primaryAccession, length: (item.sequence as { length?: number } | undefined)?.length, entryType: item.entryType, release: r.headers.get('x-uniprot-release') } })), 'protein-records', { truncated: Boolean(cursor), nextCursor: cursor });
    } }, read: async (url, signal, _options, client) => {
      const key = pathId(url, ['www.uniprot.org', 'uniprot.org'], /^\/uniprotkb\/([a-z\d]+)(?:\/entry)?\/?$/i);
      const v = await client(`uniprotkb/${encodeURIComponent(key)}.json`, signal);
      const length = v.sequence?.length, referenceCount = Array.isArray(v.references) ? v.references.length : undefined;
      const summary = [v.proteinDescription?.recommendedName?.fullName?.value, v.organism?.scientificName,
        typeof length === 'number' ? `${length} aa` : undefined, v.entryType].filter(Boolean).join(' · ');
      return record(id, url, key, string(v.uniProtkbId), v, { contentType: 'protein', accession: v.primaryAccession, sequenceLength: length,
        referenceCount, summary, license: 'CC BY 4.0' });
    } });
    if (id === 'chembl') {
      const search = async (request: SearchRequest, p: Record<string, any>, client: StructuredClient) => {
        const op = request.operation ?? 'molecules', resource = op === 'molecules' ? 'molecule' : op === 'targets' ? 'target' : 'activity';
        if (op === 'activities' && !p.target && !p.molecule) throw new Error('活性查询需要 params.target 或 params.molecule 的 ChEMBL ID');
        const raw = await client(op === 'activities' ? 'activity.json' : `${resource}/search.json`, request.signal, { limit: request.limit, offset: p.offset, ...(op === 'activities' ? { target_chembl_id: p.target, molecule_chembl_id: p.molecule } : { q: request.query }) });
        const entries = rows(raw[op === 'molecules' ? 'molecules' : op === 'targets' ? 'targets' : 'activities'], 'ChEMBL'), next = raw.page_meta?.next;
        return results(request, id, entries.flatMap(item => { const key = String(item[resource === 'activity' ? 'activity_id' : `${resource}_chembl_id`] ?? ''); const url = resource === 'activity' ? `https://www.ebi.ac.uk/chembl/api/data/activity/${key}.json` : `https://www.ebi.ac.uk/chembl/explore/${resource === 'molecule' ? 'compound' : 'target'}/${key}`;
          return hit(id, { title: string(item.pref_name) || key, url, snippet: resource === 'activity' ? `${item.standard_type ?? ''} ${item.standard_relation ?? ''} ${item.standard_value ?? ''} ${item.standard_units ?? ''}` : string(item.molecule_type) || string(item.target_type), locator: { kind: 'record', id: `${resource}:${key}` }, metadata: { record: item, sourceDocument: item.document_chembl_id } }); }), `chembl-${resource}`, { truncated: Boolean(next), nextCursor: next ? String(p.offset + entries.length) : undefined });
      };
      return createStructuredSource(config, def, { search: { molecules: search, targets: search, activities: search }, read: async (url, signal, _options, client) => { const parsed = new URL(url); if (parsed.hostname !== 'www.ebi.ac.uk') throw new Error('需要 ChEMBL 记录链接'); const match = parsed.pathname.match(/^\/chembl\/explore\/(compound|target)\/(CHEMBL\d+)\/?$/i) ?? parsed.pathname.match(/^\/chembl\/api\/data\/(activity)\/(\d+)\.json$/); if (!match) throw new Error('需要化合物、靶点或活性记录链接'); const type = match[1] === 'compound' ? 'molecule' : match[1]!, key = match[2]!; const v = await client(`${type}/${key}.json`, signal); return record(id, url, `${type}:${key}`, string(v.pref_name) || key, v, { contentType: type === 'molecule' ? 'compound' : type === 'target' ? 'target' : 'bioactivity', license: 'CC BY-SA 3.0', contentScope: `chembl-${type}` }); } });
    }
    if (id === 'pubchem') return createStructuredSource(config, def, { search: { compounds: async (request, p, client) => { const path = p.cid ? `compound/cid/${p.cid}` : `compound/name/${encodeURIComponent(request.query)}`; const v = await client(`${path}/property/MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES/JSON`, request.signal), entries = rows(v.PropertyTable?.Properties, 'PubChem'), nextOffset = p.resultOffset + request.limit, more = nextOffset < entries.length; return results(request, id, entries.slice(p.resultOffset, nextOffset).flatMap(item => hit(id, { title: string(item.IUPACName) || `CID ${item.CID}`, url: `https://pubchem.ncbi.nlm.nih.gov/compound/${item.CID}`, snippet: `${item.MolecularFormula ?? ''} · ${item.MolecularWeight ?? ''} g/mol`, locator: { kind: 'record', id: String(item.CID) }, metadata: { record: item, molecularWeightUnit: 'g/mol' } })), 'compound-properties', { truncated: more, nextCursor: more && nextOffset <= 10000 ? String(nextOffset) : undefined }); } }, read: async (url, signal, _options, client) => { const key = pathId(url, ['pubchem.ncbi.nlm.nih.gov'], /^\/compound\/(\d+)\/?$/); const v = await client(`compound/cid/${key}/JSON`, signal); return record(id, url, key, `PubChem CID ${key}`, v, { contentType: 'compound', contentScope: 'compound-record' }); } });
    if (id === 'materials-project') return createStructuredSource(config, def, { search: { materials: async (request, p, client) => { const v = await client('materials/summary/', request.signal, { material_ids: p.materialId, formula: p.materialId ? undefined : p.formula ?? request.query, _limit: request.limit, _skip: p.offset, _fields: 'material_id,formula_pretty,structure,band_gap,formation_energy_per_atom,energy_above_hull,is_stable,density,last_updated' }), entries = rows(v.data, 'Materials Project'), more = Number(v.meta?.total_doc) > p.offset + entries.length; return results(request, id, entries.flatMap(item => hit(id, { title: `${item.formula_pretty} (${item.material_id})`, url: `https://materialsproject.org/materials/${item.material_id}`, snippet: `带隙 ${item.band_gap ?? '未知'} eV；稳定性 ${item.is_stable ?? '未知'}`, locator: { kind: 'record', id: string(item.material_id) }, metadata: { record: item, units: { band_gap: 'eV', formation_energy_per_atom: 'eV/atom', energy_above_hull: 'eV/atom', density: 'g/cm³' } } })), 'computed-materials', { truncated: more, nextCursor: more ? String(p.offset + entries.length) : undefined }); } }, read: async (url, signal, _options, client) => { const key = pathId(url, ['materialsproject.org', 'www.materialsproject.org'], /^\/materials\/(mp-\d+)\/?$/), v = await client('materials/summary/', signal, { material_ids: key, _limit: 1 }); if (!v.data?.length) throw new Error('材料记录不存在'); return record(id, url, key, string(v.data[0].formula_pretty), v.data[0], { contentType: 'material', contentScope: 'computed-material-properties' }); } });
    if (id === 'nasa-exoplanets') {
      const escaped = (s: string) => s.replaceAll("'", "''");
      const query = (client: StructuredClient, signal: AbortSignal, clauses: string[], count: number) => client('TAP/sync', signal, { query: `select top ${count} pl_name,hostname,pl_orbper,pl_rade,pl_bmasse,st_teff,st_rad,st_mass,sy_dist,disc_year,discoverymethod,disc_refname,pl_orbper_reflink,pl_rade_reflink,pl_bmasse_reflink from pscomppars where ${clauses.join(' and ')} order by pl_name`, format: 'json' });
      return createStructuredSource(config, def, { search: { planets: async (request, p, client) => { const clauses = [p.host ? `hostname='${escaped(p.host)}'` : `pl_name like '%${escaped(request.query)}%'`]; if (p.minimumPeriodDays !== undefined) clauses.push(`pl_orbper>=${p.minimumPeriodDays}`); const entries = rows(await query(client, request.signal, clauses, p.offset + request.limit + 1), 'Exoplanet Archive'), nextOffset = p.offset + request.limit, more = entries.length > nextOffset; return results(request, id, entries.slice(p.offset, nextOffset).flatMap(item => hit(id, { title: string(item.pl_name), url: `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(string(item.pl_name))}`, snippet: `${item.hostname} · 周期 ${item.pl_orbper ?? '未知'} 天 · 半径 ${item.pl_rade ?? '未知'} 地球半径`, locator: { kind: 'record', id: string(item.pl_name) }, metadata: { record: item, units: { pl_orbper: 'day', pl_rade: 'Earth radius', pl_bmasse: 'Earth mass', sy_dist: 'pc', st_teff: 'K' } } })), 'planet-composite-parameters', { truncated: more, nextCursor: more && nextOffset <= 1000 ? String(nextOffset) : undefined, limitations: ['按pl_name稳定排序有界重读；offset上限1000，更大范围请缩小行星或宿主条件'] }); } }, read: async (url, signal, _options, client) => { const key = pathId(url, ['exoplanetarchive.ipac.caltech.edu'], /^\/overview\/(.+)$/), entries = rows(await query(client, signal, [`pl_name='${escaped(key)}'`], 1), 'Exoplanet Archive'); if (!entries[0]) throw new Error('系外行星记录不存在'); return record(id, url, key, key, entries[0], { contentType: 'exoplanet', table: 'pscomppars', units: { pl_orbper: 'day', pl_rade: 'Earth radius', pl_bmasse: 'Earth mass', sy_dist: 'pc' } }); } });
    }
    if (id === 'hepdata') return createStructuredSource(config, def, { search: { datasets: async (request, p, client) => { const v = await client('search/', request.signal, { q: request.query, page: p.page, size: request.limit, format: 'json', collaboration: p.collaboration }), entries = rows(v.results ?? [], 'HEPData'), more = Number(v.total) > p.page * request.limit; return results(request, id, entries.flatMap(item => { const key = String(item.recid ?? item.id ?? ''); return hit(id, { title: string(item.title), url: `https://www.hepdata.net/record/${encodeURIComponent(key)}`, snippet: plain(item.abstract), locator: { kind: 'record', id: key }, metadata: { record: item } }); }), 'experimental-records', { truncated: more, nextCursor: more ? String(p.page + 1) : undefined }); } }, read: async (url, signal, _options, client) => { const parsed = new URL(url), key = pathId(url, ['www.hepdata.net', 'hepdata.net'], /^\/record\/([a-z\d]+)\/?$/i), version = parsed.searchParams.get('version') ?? undefined; const v = await client(`record/${key}`, signal, { format: 'json', version }); return record(id, url, key, string(v.record?.title) || string(v.title) || key, v, { contentType: 'experimental-dataset', license: 'CC0，个别数据集以各自声明为准', version }); } });
    if (id === 'gbif') {
      const search = async (request: SearchRequest, p: Record<string, any>, client: StructuredClient) => { const occurrences = request.operation === 'occurrences', v = await client(occurrences ? 'occurrence/search' : 'species/search', request.signal, { limit: request.limit, offset: p.offset, ...(occurrences ? { taxonKey: p.taxonKey, country: p.country, eventDate: request.since || request.until ? `${request.since ?? '*'},${request.until ?? '*'}` : undefined } : { q: request.query }) }), entries = rows(v.results, 'GBIF'); const more = v.endOfRecords === false; return results(request, id, entries.flatMap(item => { const key = String(item.key), type = occurrences ? 'occurrence' : 'species'; return hit(id, { title: string(item.scientificName) || string(item.canonicalName) || key, url: `https://www.gbif.org/${type}/${key}`, snippet: occurrences ? `${item.country ?? ''} · ${item.eventDate ?? ''} · ${item.basisOfRecord ?? ''}` : `${item.rank ?? ''} · ${item.taxonomicStatus ?? ''}`, locator: { kind: 'record', id: `${type}:${key}` }, metadata: { record: item, datasetKey: item.datasetKey, license: item.license, eventDate: item.eventDate } }); }), occurrences ? 'public-occurrences' : 'taxon-catalog', { truncated: more, nextCursor: more ? String(p.offset + entries.length) : undefined }); };
      return createStructuredSource(config, def, { search: { taxa: search, occurrences: search }, read: async (url, signal, _options, client) => { const parsed = new URL(url), match = ['www.gbif.org', 'gbif.org'].includes(parsed.hostname) ? parsed.pathname.match(/^\/(species|occurrence)\/(\d+)\/?$/) : undefined; if (!match) throw new Error('需要 GBIF 分类群或出现记录链接'); const key = match[2]!, type = match[1]!, v = await client(`${type}/${key}`, signal); return record(id, url, `${type}:${key}`, string(v.scientificName) || key, v, { contentType: type === 'occurrence' ? 'species-occurrence' : 'taxon', license: v.license, datasetKey: v.datasetKey, contentScope: type }); } });
    }
    if (id === 'inaturalist') {
      const search = async (request: SearchRequest, p: Record<string, any>, client: StructuredClient) => { const observations = request.operation === 'observations', type = observations ? 'observations' : 'taxa'; const v = await client(type, request.signal, { per_page: request.limit, page: p.page, ...(observations ? { taxon_id: p.taxonId, d1: request.since, d2: request.until, quality_grade: p.quality } : { q: request.query }) }), entries = rows(v.results, 'iNaturalist'), more = Number(v.total_results) > p.page * request.limit; return results(request, id, entries.flatMap(item => hit(id, { title: string(item.name) || string((item.taxon as any)?.name) || `观察 ${item.id}`, url: `https://www.inaturalist.org/${type}/${item.id}`, snippet: string(item.preferred_common_name) || string(item.description), locator: { kind: 'record', id: `${type}:${item.id}` }, metadata: { record: item, observedOn: item.observed_on, license: item.license_code } })), `public-${type}`, { truncated: more, nextCursor: more ? String(p.page + 1) : undefined }); };
      return createStructuredSource(config, def, { search: { taxa: search, observations: search }, read: async (url, signal, _options, client) => { const parsed = new URL(url), match = ['www.inaturalist.org', 'inaturalist.org'].includes(parsed.hostname) ? parsed.pathname.match(/^\/(taxa|observations)\/(\d+)(?:-[^/]*)?\/?$/) : undefined; if (!match) throw new Error('需要 iNaturalist 分类群或公开观察链接'); const type = match[1]!, key = match[2]!, v = await client(`${type}/${key}`, signal), item = rows(v.results, 'iNaturalist')[0]; if (!item) throw new Error('iNaturalist未返回该记录'); return record(id, url, `${type}:${key}`, string(item.name) || string((item.taxon as any)?.name) || key, item, { contentType: type === 'observations' ? 'species-occurrence' : 'taxon', license: item.license_code }); } });
    }
    if (id === 'earthdata-cmr') {
      const search = async (request: SearchRequest, p: Record<string, any>, client: StructuredClient) => { const granules = request.operation === 'granules', r: Response = await client(granules ? 'granules.json' : 'collections.json', request.signal, { page_size: request.limit, ...(granules ? { collection_concept_id: p.collectionId } : { keyword: request.query, instrument: p.instrument, bounding_box: p.bbox?.join(',') }), temporal: request.since || request.until ? `${request.since ? request.since + 'T00:00:00Z' : ''},${request.until ? request.until + 'T23:59:59Z' : ''}` : undefined }, undefined, 'response', p.cursor ? { 'CMR-Search-After': p.cursor } : {}); const v = await r.json(), entries = rows(v.feed?.entry ?? [], 'CMR'), cursor = r.headers.get('cmr-search-after') ?? undefined; return results(request, id, entries.flatMap(item => hit(id, { title: string(item.title), url: `https://cmr.earthdata.nasa.gov/search/concepts/${item.id}`, snippet: string(item.summary), locator: { kind: 'record', id: string(item.id) }, metadata: { record: item, dataLinks: item.links, contentScope: granules ? 'granule-metadata' : 'collection-metadata' } })), granules ? 'remote-sensing-granules' : 'remote-sensing-collections', { truncated: Boolean(cursor), nextCursor: cursor, limitations: ['只读取元数据；文件下载可能需要 Earthdata 登录'] }); };
      return createStructuredSource(config, def, { search: { collections: search, granules: search }, read: async (url, signal, _options, client) => { const key = pathId(url, ['cmr.earthdata.nasa.gov'], /^\/search\/concepts\/([CG][\w-]+)\/?$/), v = await client(key.startsWith('G') ? 'granules.json' : 'collections.json', signal, { concept_id: key, page_size: 1 }); const entry = rows(v.feed?.entry ?? [], 'CMR')[0]; if (!entry) throw new Error('CMR未返回公开元数据'); return record(id, url, key, string(entry.title), entry, { contentType: key.startsWith('G') ? 'remote-sensing-granule' : 'remote-sensing-dataset', contentScope: key.startsWith('G') ? 'granule-metadata' : 'collection-metadata', filesDownloaded: 0 }); } });
    }
    throw new Error(`科学连接器尚未映射：${id}`);
  });
}
