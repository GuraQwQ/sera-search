import type { Config, Intent, SourceName } from './types.js';
import { defaultWikiSites } from './providers/academic.js';
import { canonicalUrl } from './evidence.js';
import { steamTarget } from './providers/entities.js';
import { specialistSites, declaredReadHosts } from './provider-catalog.js';

export const webSearchOrder: SourceName[] = ['exa', 'tavily', 'brave', 'zhipu', 'doubao', 'bing'];

export function specificSource(value: string, config: Config): SourceName | undefined {
  if (steamTarget(value)) return 'steam';
  const url = new URL(value), host = url.hostname.replace(/^www\./, '');
  const declared = config.connectors?.find(item => item.read?.hosts.includes(url.hostname) && new RegExp(item.read.pattern).test(url.pathname));
  if (declared) return declared.id;
  if (host === 'weixin.sogou.com') return url.searchParams.get('type') === '1' ? 'wechat-official-account' : 'wechat-article-history';
  if (host === 'ec.europa.eu' && url.pathname.startsWith('/eurostat/api/dissemination/statistics/1.0/data/')) return 'eurostat';
  if (host === 'api.github.com') return url.hostname === host && /^\/repos\/[^/]+\/[^/]+\/releases\/\d+\/?$/.test(url.pathname) ? 'github' : undefined;
  if (host === 'www.ebi.ac.uk' || host === 'ebi.ac.uk') { if (url.pathname.includes('/chembl/')) return 'chembl'; if (url.pathname.includes('/europepmc/')) return 'europepmc'; }
  if (declaredReadHosts[host]) return declaredReadHosts[host];
  if (host === 'raw.githubusercontent.com' && /^\/Free-TV\/IPTV\//i.test(url.pathname) || config.iptv?.baseUrl && value.split('?')[0] === config.iptv.baseUrl.split('?')[0]) return 'iptv';
  if (host === 'news.google.com') return 'google-news';
  if (['gitlab.com', 'codeberg.org', 'gitea.com', 'git.disroot.org'].includes(host)) return 'ghgrab';
  if (host === 'github.com' || host === 'raw.githubusercontent.com') {
    if (url.hostname !== host) return undefined;
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'github.com' && parts[0] === 'advisories') return /^\/advisories\/(GHSA-[\w-]+)\/?$/.test(url.pathname) ? 'github-advisory' : undefined;
    if (parts.length < 2) return undefined;
    if (host === 'raw.githubusercontent.com' || ['blob', 'raw'].includes(parts[2] ?? '')) {
      let tail = parts.slice(host === 'raw.githubusercontent.com' ? 2 : 3);
      if (tail[0] === 'refs' && tail[1] === 'heads') tail = tail.slice(2);
      return tail.length >= 2 ? 'github' : undefined;
    }
    if (parts.length === 2 || ['issues', 'pull'].includes(parts[2] ?? '') && /^\d+$/.test(parts[3] ?? '')) return 'github';
    if (parts[2] === 'releases' && (parts[3] === 'tag' && parts.length > 4 || parts.length === 4 && (parts[3] === 'latest' || /^\d+$/.test(parts[3] ?? '')))) return 'github';
    return undefined;
  }
  if (/(^|\.)bilibili\.com$/.test(host)) return ['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'].includes(url.hostname) && /\/video\/(BV[\da-z]+|av\d+)/i.test(url.pathname) ? 'bilibili' : undefined;
  if (host === 'b23.tv') return url.hostname === host ? 'bilibili' : undefined;
  if (host === 'web.archive.org') return url.hostname === host && /^\/web\/\d{14}(?:[a-z]{1,3}_)?\/https?:\/\/.+$/i.test(url.pathname) ? 'wayback' : undefined;
  if (/(^|\.)v2ex\.com$/.test(host)) return 'v2ex';
  if (['doi.org', 'dx.doi.org', 'api.crossref.org'].includes(host)) return 'crossref';
  if (['openalex.org', 'api.openalex.org'].includes(host)) return 'openalex';
  if (host === 'pubmed.ncbi.nlm.nih.gov') return 'pubmed';
  for (const [name, site] of Object.entries(specialistSites)) if (site.domains.some(domain => host === domain || host.endsWith(`.${domain}`))) return name as SourceName;
  if (Object.values({ ...defaultWikiSites, ...config.wiki?.sites }).some(site => new URL(site.pageBaseUrl).hostname === host)) return 'wiki';
  return ({ 'archive.org': 'archive', 'linux.do': 'linuxdo', 'xiaoheihe.cn': 'heybox', 'nicovideo.jp': 'nicovideo', 'skills.sh': 'skills', 'bgm.tv': 'bangumi', 'bangumi.tv': 'bangumi', 'anilist.co': 'anilist', 'myanimelist.net': 'jikan', 'mangadex.org': 'mangadex', 'vndb.org': 'vndb', 'musicbrainz.org': 'musicbrainz', 'youtube.com': 'youtube', 'youtu.be': 'youtube', 'music.163.com': 'netease', 'twitch.tv': 'twitch', 'discord.com': 'discord', 'instagram.com': 'instagram' } as Record<string, SourceName>)[host];
}

export function directTarget(query: string): string | undefined {
  const value = query.trim();
  if (/^https?:\/\/\S+$/i.test(value)) return canonicalUrl(value);
  const app = value.match(/^(?:steam|appid):\s*(\d+)$/i);
  if (app) return `https://store.steampowered.com/app/${app[1]}/`;
  if (/^(?:sm|nm|so)\d+$/i.test(value)) return `https://www.nicovideo.jp/watch/${value.toLowerCase()}`;
  if (/^BV[\w]{10}$/.test(value)) return `https://www.bilibili.com/video/${value}`;
  if (/^10\.\d{4,9}\/\S+$/i.test(value)) return `https://doi.org/${value}`;
  const pmid = value.match(/^pmid:\s*(\d+)$/i);
  if (pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pmid[1]}/`;
  const wikidata = value.match(/^wikidata:\s*([QP][1-9]\d*)$/i);
  if (wikidata) { const id = wikidata[1]!.toUpperCase(); return `https://www.wikidata.org/wiki/${id.startsWith('P') ? 'Property:' : ''}${id}`; }
  return undefined;
}

export function taskRoute(query = '', intent?: Intent) {
  const inferred: Intent = intent ?? (/失传|历史|旧官网|快照|归档|时光机|wayback|lost media/i.test(query) ? 'historical'
    : /galgame|视觉小说|汉化考据/i.test(query) ? 'galgame'
    : /评论|口碑|风评|用户反馈|体验|评价|感想/i.test(query) ? 'feedback'
    : /游戏.*(?:wiki|百科|攻略|机制)|(?:wiki|攻略).*游戏/i.test(query) ? 'game'
    : /论文|doi|pmid|文献|学术/i.test(query) ? 'academic'
    : /github|代码|仓库|issue|pull request/i.test(query) ? 'code'
    : /搜图|识图|图片来源|动画帧/i.test(query) ? 'images'
    : /版本|发行|发布日期|规格|支持|官方|文档|release|specification/i.test(query) ? 'official' : 'general');
  const reasons: Record<Intent, string> = { general: '先发现相关页面，再读取原始对象', official: '先确认实体与版本，查官方页面、公告或结构化记录', feedback: '读取原帖与评论，区分作者体验、评论观点和官方声明', historical: '确认原 URL、历史域名和目标时间，定位快照或馆藏', game: '确认游戏与版本，按需加载独立游戏 Wiki', galgame: '作品实体与发行事实先官方或数据库，讨论按需加载社区目录', academic: '先确认 DOI/PMID 等记录，书目摘要后继续追原文', code: '仓库、代码、issue 分别选择 GitHub 搜索类型', images: '关键词图片与反向匹配分别选动作，结果回原作品核对' };
  const directUrl = directTarget(query);
  return { intent: inferred, reason: reasons[inferred], ...(directUrl ? { directUrl } : {}) };
}

export function materialTypes(query: string): string[] {
  if (/^https?:\/\/\S+$/i.test(query.trim())) return [];
  if (/Wikidata|维基数据|跨库.*(?:实体|标识)|外部数据库\s*ID/i.test(query)) return ['entity-metadata'];
  if (/(?:Steam|游戏|商店).*(?:评价|评测|用户评论)|game.?reviews?/i.test(query)) return ['game-review'];
  if (/(?:GitHub|仓库).*(?:发布说明|发行说明|release)|release.?notes/i.test(query)) return ['release'];
  if (/(?:VNDB|视觉小说|galgame).*(?:发行版本|发行记录|语言版本)/i.test(query)) return ['game-release'];
  if (/直播.*(?:弹幕|聊天|发言|互动记录)|live.?chat/i.test(query)) return ['live-danmaku'];
  if (/直播.*(?:场次|记录|回放)|(?:直播间|Twitch).*记录|live.?session/i.test(query)) return ['live-session'];
  if (/(?:视频|B站|哔哩哔哩|bilibili|YouTube|油管).*评论|评论区|video.?comments/i.test(query)) return ['video-comment'];
  if (/视频弹幕|video.?danmaku/i.test(query)) return ['video-danmaku'];
  if (/(?:UID|用户).*评论|历史评论/i.test(query)) return ['comment'];
  if (/字幕|台词|transcript|subtitle/i.test(query)) return ['subtitle'];
  if (/公开评审|同行评审|openreview|peer.?review/i.test(query)) return ['review'];
  if (/模型权重|模型卡|hugging.?face|开源模型/i.test(query)) return ['model'];
  if (/数据集|dataset/i.test(query)) return ['dataset'];
  if (/临床试验|clinical.?trial/i.test(query)) return ['clinical-trial'];
  if (/CVE-\d|GHSA-|软件包漏洞/i.test(query)) return ['vulnerability'];
  if (/历史天气|天气预报|weather/i.test(query)) return ['weather-timeseries'];
  if (/历史价格|价格历史|史低|price.?history/i.test(query)) return ['price-history'];
  if (/专利|patent/i.test(query)) return ['patent'];
  if (/依赖图|依赖树|dependency.?graph/i.test(query)) return ['dependency-graph'];
  if (/GH.?Archive|GitHub.*历史事件/i.test(query)) return ['github-event'];
  if (/Common.?Crawl/i.test(query)) return ['web-capture'];
  if (/维基.*阅读量|pageviews/i.test(query)) return ['pageview-timeseries'];
  if (/PDB|蛋白.*(?:三维|结构)|氨基酸序列/i.test(query)) return ['molecular-structure'];
  if (/UniProt|蛋白质功能|蛋白序列/i.test(query)) return ['protein'];
  if (/PubChem|化合物|ChEMBL/i.test(query)) return ['compound'];
  if (/系外行星|exoplanet/i.test(query)) return ['exoplanet'];
  if (/GBIF|物种|分类群/i.test(query)) return ['taxon'];
  if (/遥感数据|卫星数据集|Earthdata/i.test(query)) return ['remote-sensing-dataset'];
  if (/QQ.*头像|群头像/i.test(query)) return ['avatar-metadata'];
  if (/公众号|微信文章/i.test(query)) return ['article'];
  return [];
}

export function preferredSources(intent: Intent, query = '', types = materialTypes(query)): SourceName[] {
  if (types.includes('entity-metadata')) return ['wikidata'];
  if (types.includes('game-review')) return ['steam'];
  if (types.includes('release')) return ['github'];
  if (types.includes('game-release')) return ['vndb'];
  if (types.includes('live-danmaku')) return ['aicu', 'danmakus', 'laplace'];
  if (types.includes('video-danmaku') || types.includes('comment')) return ['aicu', 'bilibili'];
  if (types.includes('subtitle')) return ['filmot'];
  if (types.includes('review')) return ['openreview'];
  if (types.includes('model') || types.includes('dataset')) return ['huggingface', 'zenodo'];
  if (types.includes('clinical-trial')) return ['clinicaltrials'];
  if (types.includes('vulnerability')) return ['osv', 'github-advisory'];
  if (types.includes('weather-timeseries')) return ['open-meteo'];
  if (types.includes('price-history')) return ['isthereanydeal', 'steamdb'];
  if (types.includes('patent')) return ['google-patents', 'j-platpat'];
  if (/B站|哔哩哔哩|\bbilibili\b/i.test(query)) return ['bilibili', ...webSearchOrder];
  if (/\byoutube\b|油管/i.test(query)) return ['youtube', ...webSearchOrder];
  if (/\btwitch\b/i.test(query)) return ['twitch', ...webSearchOrder];
  if (['general', 'official', 'feedback', 'code'].includes(intent) && /中转|服务商|替代方案|性价比|选型|套餐对比|service providers?|alternatives?|compare/i.test(query)) {
    const community: SourceName[] = /\p{Script=Han}/u.test(query) ? ['bilibili', 'linuxdo'] : [];
    return /软件|模型|中转|插件|客户端|\bapi\b/i.test(query) ? ['github', ...community, ...webSearchOrder, 'agent-reach', 'opencli']
      : [...webSearchOrder, ...community, 'github', 'agent-reach', 'opencli'];
  }
  if (intent === 'historical') return ['wayback', 'archive', ...webSearchOrder];
  if (intent === 'game') return ['wiki', 'steam', ...webSearchOrder];
  if (intent === 'galgame') return ['vndb', 'bangumi', 'steam', 'sites', ...webSearchOrder];
  if (intent === 'academic') return ['crossref', 'openalex', 'europepmc', 'semantic-scholar', 'openreview', 'pubmed'];
  if (intent === 'code') return ['github', 'ghgrab', ...webSearchOrder];
  if (intent === 'feedback') return ['linuxdo', 'heybox', 'agent-reach', 'opencli', ...webSearchOrder];
  if (intent === 'images') return ['brave', 'serpapi', 'baidu-images', 'sogou-images', 'trace-moe', 'saucenao'];
  if (/\biptv\b|电视频道|直播频道/i.test(query)) return ['iptv', ...webSearchOrder];
  if (/新闻|快讯|\bnews\b/i.test(query)) return ['google-news', ...webSearchOrder];
  if (/steam/i.test(query)) {
    const people = /用户|玩家|社区|个人(?:主页|资料)|昵称|展示名|账号|账户|\b(?:profiles?|users?|steamid|community|players?)\b/i.test(query);
    return people && !/在线人数|玩家(?:数量|人数|数)|player.?count|concurrent/i.test(query) ? [...webSearchOrder] : ['steam', ...webSearchOrder];
  }
  if (/niconico|nicovideo|ニコニコ/i.test(query)) return ['nicovideo', ...webSearchOrder];
  return [...webSearchOrder, 'github', 'wiki'];
}
