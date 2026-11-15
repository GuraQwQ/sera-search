import type { SearchHit } from '../types.js';

const genericTerms = new Set(['search', 'find', 'please', 'latest', 'official', 'release', 'released', 'date', 'version', 'language', 'support', 'review', 'reviews', 'what', 'when', 'where', 'which', 'with', 'from', 'about', 'the', 'and', 'for', 'how', 'in', 'on', 'of', 'to', 'is', 'id', '中文', '中文支持', '发行', '发行日期', '发布日期', '发布时间', '日期', '时间', '版本', '支持', '语言支持', '支持语言', '最新', '官方', '搜索', '查询', '评论', '评价', '寻找', '主打', '可用', '优先', '要求', '排除', '额外', '系列']);
const normalized = (value: string) => value.normalize('NFKC').toLowerCase();
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

export function discoveryTerms(query: string): string[] {
  const quoted = [...query.matchAll(/["“「『]([^"”」』]+)["”」』]/g)].map(match => normalized(match[1]!));
  const versions = [...normalized(query).matchAll(/([a-z][a-z\d_-]+)[\s_-]+(\d+(?:\.\d+)*)/g)].filter(match => !genericTerms.has(match[1]!));
  let text = normalized(query);
  for (const match of versions) text = text.replace(match[0], ' ');
  const words = [...segmenter.segment(text)].filter(item => item.isWordLike).map(item => item.segment)
    .filter(term => !genericTerms.has(term) && !/^\d+$/.test(term) && (/\p{Script=Han}/u.test(term) ? Array.from(term).length >= 2 : term.length >= 4));
  const isolated = [...text.matchAll(/(?:^|\s)(\p{Script=Han}{2,12})(?=\s|$)/gu)].map(match => match[1]!).filter(term => !genericTerms.has(term));
  return [...new Set([...quoted, ...versions.map(match => `${match[1]} ${match[2]}`), ...isolated, ...words])].slice(0, 32);
}

export function assessRelevance(query: string, hits: SearchHit[], aliases: string[] = [], discovery?: string[]): { hits: SearchHit[]; annotatedHits: SearchHit[]; reason?: string } {
  if (!hits.length) return { hits, annotatedHits: hits, reason: 'EMPTY_RESULTS' };
  const quoted = [...query.matchAll(/["“「『]([^"”」』]+)["”」』]/g)].map(match => match[1]!);
  const explicit = [...aliases, ...quoted].map(value => normalized(value).trim()).filter(Boolean);
  const queryTerms = [...new Set((discovery?.length ? discovery : discoveryTerms(query)).map(normalized))];
  const versionTerms = new Map(queryTerms.flatMap(term => {
    const match = term.match(/^([a-z][a-z\d_-]+)\s+(\d+(?:\.\d+)*)$/);
    return match ? [[term, new RegExp(`${match[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s_-]*${match[2]!.replace(/\./g, '\\.')}\\b(?![\\d.])`, 'i')] as const] : [];
  }));
  const terms = [...new Set([...queryTerms, ...explicit])];
  const entity = discovery?.[0] ? normalized(discovery[0]) : quoted[0] ? normalized(quoted[0]) : [...versionTerms.keys()][0] ?? queryTerms.find(term => /^[a-z\d_.-]+$/.test(term)) ?? queryTerms[0];
  // 短名和缺少实体线索的查询交由 agent 判断，避免把 AIR 等歧义词当作强匹配条件。
  const ambiguous = !terms.length;
  const assessed = hits.map(item => {
    const text = normalized(`${item.title}\n${item.snippet}\n${item.url}`);
    const matches = (term: string) => versionTerms.get(term)?.test(text) ?? text.includes(term);
    const matchedTerms = terms.filter(matches);
    const missingTerms = queryTerms.filter(term => !matches(term) && !(term === entity && aliases.some(alias => matches(normalized(alias)))));
    const status = ambiguous ? 'uncertain' : !matchedTerms.length ? 'irrelevant'
      : missingTerms.length ? 'uncertain' : 'relevant';
    const entityMatch = entity && (matches(entity) || aliases.some(alias => matches(normalized(alias))));
    const score = (entityMatch ? 0.5 : 0) + (queryTerms.length ? (queryTerms.length - missingTerms.length) / queryTerms.length * 0.5 : 0);
    return { ...item, metadata: { ...item.metadata, relevance: { status, matchedTerms, missingTerms, score } } };
  });
  const selected = assessed.filter(item => item.metadata.relevance.status !== 'irrelevant');
  return { hits: selected, annotatedHits: assessed, ...(!selected.length ? { reason: 'NO_QUERY_MATCH' }
    : !selected.some(item => item.metadata.relevance.status === 'relevant') ? { reason: 'PARTIAL_QUERY_MATCH' } : {}) };
}
