import { z } from 'zod';
import type { Config, Source } from '../types.js';
import { createStructuredSource } from '../connectors.js';
import type { ConnectorDefinition, StructuredClient } from '../connectors.js';
import { document, hit, object, permitted, rows, string } from './shared.js';
import type { Row } from './shared.js';
import { reportCoverage } from './operations.js';

const entityId = z.string().regex(/^[QP][1-9]\d*$/);
const language = z.string().regex(/^[a-z][a-z0-9-]{0,19}$/).default('zh');
const searchParams = z.strictObject({ language, type: z.enum(['item', 'property']).default('item'), offset: z.number().int().min(0).default(0) });
const entityParams = z.strictObject({ id: entityId.optional(), language });
const definition: ConnectorDefinition = {
  id: 'wikidata', type: 'custom', base_url: 'https://www.wikidata.org/', platforms: ['wikidata'], label: 'Wikidata 实体、修订与外部数据库 ID',
  auth: { type: 'none' }, access: { authentication: 'none', billing: 'free', evidence: 'https://www.wikidata.org/wiki/Wikidata:Data_access' },
  limits: { min_interval_ms: 250 },
  operations: {
    search: { description: '按名称和语言发现实体 ID，offset 按返回游标续查', content_types: ['entity-metadata'], input_schema: z.toJSONSchema(searchParams) },
    entity: { description: '按明确的 Q/P ID 取得标签、声明、外部 ID 及站点链接', content_types: ['entity-metadata'], input_schema: z.toJSONSchema(entityParams) },
  },
  limitations: ['实体数据为 CC0；声明、限定条件、参考文献和修订号分别保留。外部 ID 是数据库声明，关联仍需核验。'],
};

function target(url: string) {
  const parsed = new URL(url), match = ['www.wikidata.org', 'wikidata.org'].includes(parsed.hostname)
    ? parsed.pathname.match(/^\/(?:wiki\/(?:Special:EntityData\/|Property:)?|entity\/)([QP][1-9]\d*)(?:\.json)?\/?$/) : undefined;
  if (!match) throw new Error('Wikidata 读取需要实体页或 EntityData JSON 链接');
  const requested = parsed.searchParams.get('revision'), oldid = parsed.searchParams.get('oldid');
  if (requested && oldid && requested !== oldid) throw Object.assign(new Error('revision 与 oldid 指向不同修订'), { code: 'BAD_INPUT' });
  const revision = requested ?? oldid ?? undefined;
  if (revision && !/^[1-9]\d*$/.test(revision)) throw new Error('Wikidata 修订号需要正整数');
  return { id: match[1]!, revision, language: language.parse(parsed.searchParams.get('uselang') ?? undefined) };
}

async function entity(client: StructuredClient, id: string, lang: string, signal: AbortSignal, revision?: string) {
  const raw = revision ? await client(`wiki/Special:EntityData/${id}.json`, signal, { revision })
    : await client('w/api.php', signal, { action: 'wbgetentities', format: 'json', ids: id, props: 'info|labels|descriptions|aliases|claims|sitelinks', languages: lang, languagefallback: 1, maxlag: 5 });
  if (raw.error) throw Object.assign(new Error(`Wikidata 请求失败：${string(object(raw.error, 'Wikidata 错误').code)}`), { code: 'WIKIDATA_API_ERROR' });
  const value = object(object(raw.entities, 'Wikidata 实体')[id], 'Wikidata 实体');
  if ('missing' in value || value.id !== id) throw Object.assign(new Error('Wikidata 未返回目标实体'), { code: 'CONTENT_MISMATCH' });
  if (revision && String(value.lastrevid) !== revision) throw Object.assign(new Error('Wikidata 返回的修订与请求不一致'), { code: 'CONTENT_MISMATCH' });
  return value;
}

function metadata(value: Row) {
  const externalIds: { property: string; value: unknown; rank: unknown; statementId: unknown }[] = [];
  for (const [property, claims] of Object.entries(value.claims && typeof value.claims === 'object' ? value.claims : {})) {
    for (const statement of rows(claims, 'Wikidata 声明')) {
      const snak = object(statement.mainsnak, 'Wikidata 主声明');
      if (snak.datatype === 'external-id' && snak.datavalue) externalIds.push({ property, value: object(snak.datavalue, 'Wikidata 值').value, rank: statement.rank, statementId: statement.id });
    }
  }
  return { contentType: 'entity-metadata', contentScope: 'wikidata-entity', revisionId: value.lastrevid,
    externalIdCount: externalIds.length, externalIds, license: 'CC0' };
}

function label(value: Row, field: string, lang: string) {
  const labels = value[field] && typeof value[field] === 'object' ? value[field] as Row : {};
  const selected = labels[lang] ?? Object.values(labels)[0];
  return selected && typeof selected === 'object' ? string((selected as Row).value) : '';
}

function entityUrl(id: string, lang: string) {
  const url = new URL(`https://www.wikidata.org/wiki/${id.startsWith('P') ? 'Property:' : ''}${id}`);
  url.searchParams.set('uselang', lang);
  return url.href;
}

export function createWikidataSource(config: Config): Source {
  return createStructuredSource(config, definition, { search: {
    search: async (request, params, client) => {
      if (!permitted(request.domains, 'www.wikidata.org')) return [];
      const raw = await client('w/api.php', request.signal, { action: 'wbsearchentities', format: 'json', search: request.query, language: params.language, uselang: params.language, type: params.type, limit: request.limit, continue: params.offset, maxlag: 5 });
      if (raw.error) throw new Error(`Wikidata 搜索失败：${string(object(raw.error, 'Wikidata 错误').code)}`);
      const next = typeof raw['search-continue'] === 'number' ? raw['search-continue'] : undefined;
      reportCoverage(request, 'wikidata:名称检索页', { completeness: 'partial', truncated: next !== undefined, ...(next !== undefined ? { nextCursor: JSON.stringify({ ...params, offset: next }) } : {}) });
      return rows(raw.search, 'Wikidata 搜索').flatMap(item => hit('wikidata', { title: string(item.label) || string(item.id), url: entityUrl(entityId.parse(item.id), params.language), snippet: string(item.description), locator: { kind: 'record', id: string(item.id) }, metadata: { contentType: 'entity-metadata', entityId: item.id, language: params.language, matchedLabel: item.match } }));
    },
    entity: async (request, params, client) => {
      if (!permitted(request.domains, 'www.wikidata.org')) return [];
      const id = entityId.parse(params.id ?? request.query), value = await entity(client, id, params.language, request.signal);
      reportCoverage(request, 'wikidata:单个实体修订', { completeness: 'complete' });
      const url = entityUrl(id, params.language), revision = String(value.lastrevid ?? '');
      const recordUrl = /^[1-9]\d*$/.test(revision) ? `${url}&revision=${revision}` : url;
      return hit('wikidata', { title: label(value, 'labels', params.language) || id, url, snippet: label(value, 'descriptions', params.language),
        locator: { kind: 'record', id }, metadata: { entityId: id, recordUrl, ...metadata(value), record: value } });
    },
  }, read: async (url, signal, options, client) => {
    const selected = target(url);
    if (options?.locator && (options.locator.kind !== 'record' || options.locator.id !== selected.id)) throw Object.assign(new Error('实体链接与定位 ID 不一致'), { code: 'CONTENT_MISMATCH' });
    const value = await entity(client, selected.id, selected.language, signal, selected.revision);
    const detail = metadata(value);
    const summary = [selected.id, label(value, 'descriptions', selected.language), detail.revisionId && `修订 ${detail.revisionId}`,
      `${detail.externalIdCount} 条外部 ID 声明`].filter(Boolean).join(' · ');
    return document('wikidata', url, label(value, 'labels', selected.language) || selected.id, JSON.stringify(value, null, 2),
      { contentKind: 'metadata', locator: { kind: 'record', id: selected.id }, metadata: { ...detail, summary } });
  } });
}
