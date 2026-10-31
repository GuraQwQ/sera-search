import type { ApiConfig, Config, SearchRequest, Source, WikiSite } from '../types.js';
import { object, rows, string, plain, date, hit, endpoint, json, response, document, permitted } from './shared.js';
import type { Row } from './shared.js';

const headers = { 'User-Agent': 'SERA academic-search', Accept: 'application/json' };

function publishedParts(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const parts = (value as Row)['date-parts'];
  if (!Array.isArray(parts) || !Array.isArray(parts[0]) || parts[0].length < 3) return undefined;
  const text = `${parts[0][0]}-${String(parts[0][1]).padStart(2, '0')}-${String(parts[0][2]).padStart(2, '0')}`;
  const result = date(text);
  return result?.slice(0, 10) === text ? result : undefined;
}

function accepted(request: SearchRequest, url: string) { return permitted(request.domains, new URL(url).hostname); }
function firstTitle(value: unknown) { return Array.isArray(value) ? string(value[0]) : string(value); }
function abstract(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const words = Object.entries(value).flatMap(([word, positions]) => Array.isArray(positions)
    ? positions.filter(position => Number.isSafeInteger(position) && position >= 0).map(position => ({ word, position })) : []);
  return words.sort((a, b) => a.position - b.position).map(item => item.word).join(' ');
}

function crossref(config: ApiConfig): Source {
  const get = (path: string, signal: AbortSignal) => json(endpoint(config, 'https://api.crossref.org/', path), { headers, signal }, 'Crossref');
  return {
    capability: { name: 'crossref', search: true, read: true, configured: config.enabled !== false, category: 'academic', requiresLogin: false, loggedIn: true, requirement: '公开 DOI 与书目元数据' },
    async search(request) {
      const url = endpoint(config, 'https://api.crossref.org/', 'works');
      url.searchParams.set('query', request.query);
      url.searchParams.set('rows', String(request.limit));
      if (request.since) url.searchParams.set('filter', `from-pub-date:${request.since}`);
      const result = await json(url, { headers, signal: request.signal }, 'Crossref');
      const message = object(result.message, 'Crossref');
      return rows(message.items, 'Crossref').flatMap(item => {
        const doi = string(item.DOI), target = doi ? `https://doi.org/${doi}` : string(item.URL);
        if (!target || !accepted(request, target)) return [];
        return hit('crossref', { title: firstTitle(item.title), url: target, snippet: plain(item.abstract) || [string(item.publisher), firstTitle(item['container-title'])].filter(Boolean).join(' · '), publishedAt: publishedParts(item.published), metadata: { doi, type: item.type, publisher: item.publisher, links: item.link } });
      });
    },
    async read(url, signal) {
      const parsed = new URL(url);
      let doi = ['doi.org', 'dx.doi.org'].includes(parsed.hostname) ? decodeURIComponent(parsed.pathname.slice(1))
        : parsed.hostname === 'api.crossref.org' && parsed.pathname.startsWith('/works/') ? decodeURIComponent(parsed.pathname.slice(7)) : '';
      if (!/^10\.\d{4,9}\/.+/.test(doi)) throw new Error('Crossref 读取需要 DOI 链接');
      const value = object((await get(`works/${encodeURIComponent(doi)}`, signal)).message, 'Crossref 记录');
      doi = string(value.DOI) || doi;
      return document('crossref', `https://doi.org/${doi}`, firstTitle(value.title), JSON.stringify(value, null, 2), {
        contentKind: 'metadata', publishedAt: publishedParts(value.published), metadata: { doi, format: 'crossref-json', links: value.link },
      });
    },
  };
}

function openalex(config: ApiConfig): Source {
  const address = (path: string) => {
    const url = endpoint(config, 'https://api.openalex.org/', path);
    if (config.apiKey) url.searchParams.set('api_key', config.apiKey);
    return url;
  };
  return {
    capability: { name: 'openalex', search: true, read: true, configured: config.enabled !== false, category: 'academic', requiresLogin: false, loggedIn: true, requirement: '公开论文图谱；API Key 可提高预算' },
    async search(request) {
      const url = address('works');
      url.searchParams.set('search', request.query);
      url.searchParams.set('per_page', String(request.limit));
      if (request.since) url.searchParams.set('filter', `from_publication_date:${request.since}`);
      const result = await json(url, { headers, signal: request.signal }, 'OpenAlex');
      return rows(result.results, 'OpenAlex').flatMap(item => {
        const target = string(item.id);
        if (!target || !accepted(request, target)) return [];
        return hit('openalex', { title: string(item.display_name) || string(item.title), url: target, snippet: abstract(item.abstract_inverted_index), publishedAt: date(item.publication_date), metadata: { doi: item.doi, citedByCount: item.cited_by_count, openAccess: item.open_access, bestLocation: item.best_oa_location } });
      });
    },
    async read(url, signal) {
      const parsed = new URL(url);
      const id = ['openalex.org', 'api.openalex.org'].includes(parsed.hostname) ? parsed.pathname.match(/(?:^|\/)(W\d+)\/?$/)?.[1] : undefined;
      if (!id) throw new Error('OpenAlex 读取需要 W 开头的论文记录链接');
      const value = await json(address(`works/${id}`), { headers, signal }, 'OpenAlex');
      if (!string(value.id)) throw new Error('OpenAlex 未返回论文记录');
      return document('openalex', string(value.id), string(value.display_name) || string(value.title), JSON.stringify(value, null, 2), {
        contentKind: 'metadata', publishedAt: date(value.publication_date), metadata: { doi: value.doi, bestLocation: value.best_oa_location, format: 'openalex-json' },
      });
    },
  };
}

function pubmed(config: ApiConfig): Source {
  const address = (path: string, params: Record<string, string>) => {
    const url = endpoint(config, 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/', path);
    for (const [key, value] of Object.entries({ db: 'pubmed', ...params })) url.searchParams.set(key, value);
    if (config.apiKey) url.searchParams.set('api_key', config.apiKey);
    return url;
  };
  return {
    capability: { name: 'pubmed', search: true, read: true, configured: config.enabled !== false, category: 'academic', requiresLogin: false, loggedIn: true, requirement: '公开医学书目与摘要；全文需要继续到 PMC 或出版者' },
    async search(request) {
      if (request.domains?.length && !permitted(request.domains, 'pubmed.ncbi.nlm.nih.gov')) return [];
      const term = request.since ? `(${request.query}) AND ("${request.since.replaceAll('-', '/')}"[Date - Publication] : "3000"[Date - Publication])` : request.query;
      const found = await json(address('esearch.fcgi', { term, retmode: 'json', retmax: String(request.limit), sort: 'relevance' }), { headers, signal: request.signal }, 'PubMed ESearch');
      const search = object(found.esearchresult, 'PubMed ESearch');
      if (!Array.isArray(search.idlist)) throw new Error('PubMed 未返回 PMID 列表');
      const ids = search.idlist.map(string).filter(id => /^\d+$/.test(id)).slice(0, request.limit);
      if (!ids.length) return [];
      const summaries = object((await json(address('esummary.fcgi', { id: ids.join(','), retmode: 'json' }), { headers, signal: request.signal }, 'PubMed ESummary')).result, 'PubMed ESummary');
      return ids.flatMap(id => {
        const value = summaries[id];
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const item = value as Row;
        return hit('pubmed', { title: string(item.title), url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, snippet: [string(item.fulljournalname), string(item.pubdate)].filter(Boolean).join(' · '), metadata: { pmid: id, publicationTimeRaw: item.pubdate, authors: item.authors, articleIds: item.articleids } });
      });
    },
    async read(url, signal) {
      const parsed = new URL(url);
      const id = parsed.hostname === 'pubmed.ncbi.nlm.nih.gov' ? parsed.pathname.match(/^\/(\d+)\/?$/)?.[1] : undefined;
      if (!id) throw new Error('PubMed 读取需要 PMID 记录链接');
      const result = await response(address('efetch.fcgi', { id, retmode: 'xml' }), { headers: { ...headers, Accept: 'application/xml' }, signal }, 'PubMed EFetch');
      const xml = await result.text();
      if (!/<PubmedArticle[\s>]/.test(xml)) throw new Error('PubMed 未返回文献与摘要 XML');
      const title = plain(xml.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)?.[1]) || id;
      return document('pubmed', url, title, xml, { contentKind: 'metadata', metadata: { pmid: id, format: 'pubmed-xml', contentScope: 'bibliography-and-abstract' } });
    },
  };
}

export const defaultWikiSites: Record<string, WikiSite> = {
  'wikipedia-zh': { apiUrl: 'https://zh.wikipedia.org/w/api.php', pageBaseUrl: 'https://zh.wikipedia.org/wiki/', label: '中文维基百科' },
  'wikipedia-en': { apiUrl: 'https://en.wikipedia.org/w/api.php', pageBaseUrl: 'https://en.wikipedia.org/wiki/', label: '英文维基百科' },
  'wikipedia-ja': { apiUrl: 'https://ja.wikipedia.org/w/api.php', pageBaseUrl: 'https://ja.wikipedia.org/wiki/', label: '日文维基百科' },
  'wiktionary-zh': { apiUrl: 'https://zh.wiktionary.org/w/api.php', pageBaseUrl: 'https://zh.wiktionary.org/wiki/', label: '中文维基词典' },
  'wikisource-zh': { apiUrl: 'https://zh.wikisource.org/w/api.php', pageBaseUrl: 'https://zh.wikisource.org/wiki/', label: '中文维基文库' },
  'wikivoyage-zh': { apiUrl: 'https://zh.wikivoyage.org/w/api.php', pageBaseUrl: 'https://zh.wikivoyage.org/wiki/', label: '中文维基导游' },
  commons: { apiUrl: 'https://commons.wikimedia.org/w/api.php', pageBaseUrl: 'https://commons.wikimedia.org/wiki/', label: '维基共享资源页面' },
};

function wiki(config: Config['wiki'] = {}): Source {
  const sites = { ...defaultWikiSites, ...config.sites };
  const address = (site: WikiSite, params: Record<string, string>) => {
    const url = config.baseUrl ? endpoint(config, site.apiUrl, 'api.php') : new URL(site.apiUrl);
    for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: '2', ...params })) url.searchParams.set(key, value);
    return url;
  };
  const pageUrl = (site: WikiSite, title: string) => site.pageBaseUrl + encodeURIComponent(title.replaceAll(' ', '_'));
  return {
    capability: { name: 'wiki', search: true, read: true, configured: config.enabled !== false, category: 'wiki', requiresLogin: false, loggedIn: true, platforms: Object.keys(sites), requirement: '公开 MediaWiki 搜索与原始页面内容' },
    channels: async () => Object.entries(sites).map(([platform, site]) => ({ source: 'wiki', platform, search: true, read: true, configured: config.enabled !== false, browser: false, description: site.label || platform })),
    async search(request) {
      if (request.since) throw new Error('Wiki 的页面修改时间不是发布日期；请使用 Wiki 原生查询条件');
      const selected = request.platform ?? (request.domains?.length ? Object.keys(sites).find(name => permitted(request.domains, new URL(sites[name]!.pageBaseUrl).hostname)) : 'wikipedia-zh');
      const site = selected ? sites[selected] : undefined;
      if (!site) throw new Error('Wiki 平台未配置，请查看 channels 或 wiki.sites');
      if (!permitted(request.domains, new URL(site.pageBaseUrl).hostname)) return [];
      const result = await json(address(site, { list: 'search', srsearch: request.query, srlimit: String(request.limit), ...(selected === 'commons' ? { srnamespace: '0|6|14' } : {}) }), { headers, signal: request.signal }, 'MediaWiki');
      if (result.error) throw new Error(`MediaWiki 搜索失败：${string(object(result.error, 'MediaWiki 错误').code)}`);
      return rows(object(result.query, 'MediaWiki').search, 'MediaWiki').filter(item => string(item.title).trim()).flatMap(item => hit('wiki', {
        title: string(item.title), url: pageUrl(site, string(item.title)), snippet: plain(item.snippet), metadata: { platform: selected, pageId: item.pageid, updatedAt: item.timestamp },
      }));
    },
    async read(url, signal) {
      const parsed = new URL(url);
      const entry = Object.entries(sites).find(([, site]) => url.startsWith(site.pageBaseUrl)
        || parsed.hostname === new URL(site.pageBaseUrl).hostname && Boolean(parsed.searchParams.get('title') || parsed.searchParams.get('curid') || parsed.searchParams.get('oldid')));
      if (!entry) throw new Error('该 Wiki 链接未配置，请添加对应 wiki.sites');
      const [platform, site] = entry;
      const pageId = parsed.searchParams.get('curid');
      const oldId = parsed.searchParams.get('oldid');
      if (oldId && !/^\d+$/.test(oldId)) throw new Error('Wiki 修订 ID 需要数字');
      const title = parsed.searchParams.get('title') || decodeURIComponent(url.slice(site.pageBaseUrl.length).split(/[?#]/)[0]!).replaceAll('_', ' ');
      const query: Record<string, string> = oldId ? { revids: oldId } : pageId ? { pageids: pageId } : { titles: title };
      const result = await json(address(site, { ...query, prop: 'revisions|info', rvprop: 'content|ids|timestamp', rvslots: 'main', inprop: 'url', redirects: '1' }), { headers, signal }, 'MediaWiki');
      if (result.error) throw new Error('MediaWiki 未授权读取此页面');
      const page = rows(object(result.query, 'MediaWiki').pages, 'MediaWiki 页面')[0];
      if (!page || page.missing) throw new Error('Wiki 页面不存在或未公开');
      const revision = rows(page.revisions, 'MediaWiki 修订')[0];
      if (!revision) throw new Error('Wiki 未返回页面修订');
      const main = object(object(revision.slots, 'MediaWiki 内容槽').main, 'MediaWiki 主内容');
      return document('wiki', oldId ? url : string(page.fullurl) || pageUrl(site, string(page.title)), string(page.title), main.content, {
        metadata: { platform, revisionId: revision.revid, updatedAt: revision.timestamp, format: string(main.contentmodel) || 'wikitext', contentScope: 'wiki-revision' },
      });
    },
  };
}

export function createAcademicSources(config: Config): Source[] {
  return [crossref(config.crossref ?? {}), openalex(config.openalex ?? {}), pubmed(config.pubmed ?? {}), wiki(config.wiki)];
}
