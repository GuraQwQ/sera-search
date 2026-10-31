import type { SearchHit } from '../types.js';

const genericTerms = new Set(['search', 'find', 'latest', 'official', 'release', 'released', 'date', 'version', 'language', 'support', 'review', 'reviews', 'what', 'when', 'where', 'which', 'with', 'from', 'about', 'the', 'and', 'for', 'how', 'in', 'on', 'of', 'to', 'is', 'id', '中文', '中文支持', '发行', '发行日期', '发布日期', '发布时间', '日期', '时间', '版本', '支持', '语言支持', '支持语言', '最新', '官方', '搜索', '查询', '评论', '评价']);
const normalized = (value: string) => value.normalize('NFKC').toLowerCase();

export function assessRelevance(query: string, hits: SearchHit[], aliases: string[] = []): { hits: SearchHit[]; reason?: string } {
  if (!hits.length) return { hits, reason: 'EMPTY_RESULTS' };
  const quoted = [...query.matchAll(/["“「『]([^"”」』]+)["”」』]/g)].map(match => match[1]!);
  const explicit = [...aliases, ...quoted].map(value => normalized(value).trim()).filter(Boolean);
  const words = [...normalized(query).matchAll(/[\p{L}\p{N}_-]+/gu)].map(match => match[0]);
  const inferred = words
    .filter(term => !genericTerms.has(term) && (/[^\x00-\x7f]/.test(term) ? Array.from(term).length >= 2 && Array.from(term).length <= 12 : term.length >= 4));
  const shortNames = explicit.length ? words.filter(term => /^[a-z\d_-]{2,3}$/.test(term) && !genericTerms.has(term)) : [];
  const terms = quoted.length ? explicit : [...explicit, ...inferred, ...shortNames];
  // 短名和缺少实体线索的查询交由 agent 判断，避免把 AIR 等歧义词当作强匹配条件。
  if (!terms.length || !explicit.length && words.some(word => /^[a-z]{2,3}$/.test(word)) && !inferred.some(term => /^[a-z\d_-]{4,}$/.test(term))) return { hits };
  const selected = hits.filter(item => {
    const text = normalized(`${item.title}\n${item.snippet}\n${item.url}`);
    return terms.some(term => text.includes(term));
  });
  return { hits: selected, ...(selected.length ? {} : { reason: 'NO_QUERY_MATCH' }) };
}
