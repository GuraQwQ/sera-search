import type { Config, Intent, SourceName } from './types.js';
import { defaultWikiSites } from './providers/academic.js';
import { canonicalUrl } from './evidence.js';
import { steamTarget } from './providers/entities.js';

export const webSearchOrder: SourceName[] = ['exa', 'tavily', 'brave', 'zhipu', 'doubao', 'bing'];

export function specificSource(value: string, config: Config): SourceName | undefined {
  if (steamTarget(value)) return 'steam';
  const host = new URL(value).hostname.replace(/^www\./, '');
  if (host === 'github.com' || host === 'raw.githubusercontent.com') return 'github';
  if (/(^|\.)bilibili\.com$/.test(host) || host === 'b23.tv') return 'bilibili';
  if (/(^|\.)v2ex\.com$/.test(host)) return 'v2ex';
  if (['doi.org', 'dx.doi.org', 'api.crossref.org'].includes(host)) return 'crossref';
  if (['openalex.org', 'api.openalex.org'].includes(host)) return 'openalex';
  if (host === 'pubmed.ncbi.nlm.nih.gov') return 'pubmed';
  if (Object.values({ ...defaultWikiSites, ...config.wiki?.sites }).some(site => new URL(site.pageBaseUrl).hostname === host)) return 'wiki';
  return ({ 'web.archive.org': 'wayback', 'archive.org': 'archive', 'linux.do': 'linuxdo', 'xiaoheihe.cn': 'heybox', 'nicovideo.jp': 'nicovideo', 'skills.sh': 'skills', 'bgm.tv': 'bangumi', 'bangumi.tv': 'bangumi', 'anilist.co': 'anilist', 'myanimelist.net': 'jikan', 'mangadex.org': 'mangadex', 'vndb.org': 'vndb', 'musicbrainz.org': 'musicbrainz', 'youtube.com': 'youtube', 'youtu.be': 'youtube', 'music.163.com': 'netease', 'twitch.tv': 'twitch', 'discord.com': 'discord', 'instagram.com': 'instagram' } as Record<string, SourceName>)[host];
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
  return undefined;
}

export function taskRoute(query = '', intent?: Intent) {
  const inferred: Intent = intent ?? (/失传|历史|旧官网|快照|归档|时光机|wayback|lost media/i.test(query) ? 'historical'
    : /galgame|视觉小说|汉化考据/i.test(query) ? 'galgame'
    : /评论|口碑|用户反馈|体验|评价|感想/i.test(query) ? 'feedback'
    : /游戏.*(?:wiki|百科|攻略|机制)|(?:wiki|攻略).*游戏/i.test(query) ? 'game'
    : /论文|doi|pmid|文献|学术/i.test(query) ? 'academic'
    : /github|代码|仓库|issue|pull request/i.test(query) ? 'code'
    : /搜图|识图|图片来源|动画帧/i.test(query) ? 'images'
    : /版本|发行|发布日期|规格|支持|官方|文档|release|specification/i.test(query) ? 'official' : 'general');
  const reasons: Record<Intent, string> = { general: '先发现相关页面，再读取原始对象', official: '先确认实体与版本，查官方页面、公告或结构化记录', feedback: '读取原帖与评论，区分作者体验、评论观点和官方声明', historical: '确认原 URL、历史域名和目标时间，定位快照或馆藏', game: '确认游戏与版本，按需加载独立游戏 Wiki', galgame: '作品实体与发行事实先官方或数据库，讨论按需加载社区目录', academic: '先确认 DOI/PMID 等记录，书目摘要后继续追原文', code: '仓库、代码、issue 分别选择 GitHub 搜索类型', images: '关键词图片与反向匹配分别选动作，结果回原作品核对' };
  const directUrl = directTarget(query);
  return { intent: inferred, reason: reasons[inferred], ...(directUrl ? { directUrl } : {}) };
}

export function preferredSources(intent: Intent, query = ''): SourceName[] {
  if (intent === 'historical') return ['wayback', 'archive', ...webSearchOrder];
  if (intent === 'game') return ['wiki', 'steam', ...webSearchOrder];
  if (intent === 'galgame') return ['vndb', 'bangumi', 'steam', 'sites', ...webSearchOrder];
  if (intent === 'academic') return ['crossref', 'openalex', 'pubmed'];
  if (intent === 'code') return ['github', ...webSearchOrder];
  if (intent === 'feedback') return ['linuxdo', 'heybox', 'agent-reach', 'opencli', ...webSearchOrder];
  if (intent === 'images') return ['brave', 'serpapi', 'baidu-images', 'sogou-images', 'trace-moe', 'saucenao'];
  if (/steam/i.test(query)) return ['steam', ...webSearchOrder];
  if (/niconico|nicovideo|ニコニコ/i.test(query)) return ['nicovideo', ...webSearchOrder];
  return [...webSearchOrder, 'github', 'wiki'];
}
