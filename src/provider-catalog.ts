import type { SpecialistSourceName } from './types.js';

export const specialistSites: Record<SpecialistSourceName, { domains: string[]; label: string; contentTypes: string[]; description?: string }> = {
  aicu: { domains: ['aicu.cc'], label: 'Aicu 历史互动记录', contentTypes: ['video-comment', 'video-danmaku', 'live-chat'] },
  danmakus: { domains: ['danmakus.com'], label: 'Danmakus 直播记录', contentTypes: ['live-chat', 'live-session'] },
  operationhong: { domains: ['operationhong.online'], label: '直播档案馆', contentTypes: ['page'], description: '公开页面发现；实际历史查询范围以站点返回为准' },
  matsuri: { domains: ['matsuri.icu'], label: 'Matsuri ICU', contentTypes: ['page'], description: '公开页面发现；当前服务状态调用时检查' },
  laplace: { domains: ['laplace.live', 'subspace.institute'], label: 'LAPLACE 本地记录', contentTypes: ['live-danmaku', 'live-event'], description: '通过 record 导入已采集记录，originSource 设为 laplace' },
  filmot: { domains: ['filmot.com'], label: 'Filmot 字幕索引', contentTypes: ['subtitle'] },
  holodex: { domains: ['holodex.net'], label: 'Holodex 直播与切片', contentTypes: ['video', 'live-session', 'channel'] },
  'semantic-scholar': { domains: ['semanticscholar.org'], label: 'Semantic Scholar', contentTypes: ['paper'] },
  openreview: { domains: ['openreview.net'], label: 'OpenReview 论文与公开评审', contentTypes: ['paper', 'review'] },
  osv: { domains: ['osv.dev'], label: 'OSV 包版本漏洞', contentTypes: ['advisory'] },
  'github-advisory': { domains: ['github.com'], label: 'GitHub 安全公告', contentTypes: ['advisory'] },
  gdelt: { domains: ['gdeltproject.org'], label: 'GDELT 新闻报道与趋势', contentTypes: ['news', 'timeline'] },
  'open-library': { domains: ['openlibrary.org'], label: 'Open Library 书目', contentTypes: ['book'] },
  clinicaltrials: { domains: ['clinicaltrials.gov'], label: 'ClinicalTrials 临床试验注册', contentTypes: ['clinical-trial'] },
  steamdb: { domains: ['steamdb.info'], label: 'SteamDB 游戏历史资料', contentTypes: ['page', 'price-history'], description: '页面发现与原文读取；Steam Web API 使用 steam 来源' },
  vgmdb: { domains: ['vgmdb.net'], label: 'VGMdb 原声与专辑', contentTypes: ['album'], description: '公开专辑和参与者页面；保留实际提取方法' },
  'open-meteo': { domains: ['open-meteo.com'], label: 'Open-Meteo 天气时间序列', contentTypes: ['weather'] },
  mangaupdates: { domains: ['mangaupdates.com'], label: 'MangaUpdates 漫画与发行', contentTypes: ['manga'] },
  novelupdates: { domains: ['novelupdates.com'], label: 'NovelUpdates 小说与翻译资料', contentTypes: ['novel'] },
  syosetu: { domains: ['syosetu.com'], label: '小説家になろう作品资料', contentTypes: ['novel'] },
  kakuyomu: { domains: ['kakuyomu.jp'], label: 'カクヨム小说与作者', contentTypes: ['novel'] },
  huggingface: { domains: ['huggingface.co'], label: 'Hugging Face 模型与数据集', contentTypes: ['model', 'dataset', 'space'] },
  biorxiv: { domains: ['biorxiv.org', 'medrxiv.org'], label: 'bioRxiv 预印本版本', contentTypes: ['paper'] },
  europepmc: { domains: ['europepmc.org'], label: 'Europe PMC 文献与开放全文', contentTypes: ['paper'] },
  zenodo: { domains: ['zenodo.org'], label: 'Zenodo 研究记录', contentTypes: ['research-record', 'dataset'] },
  'google-patents': { domains: ['patents.google.com'], label: 'Google Patents', contentTypes: ['patent'] },
  'j-platpat': { domains: ['j-platpat.inpit.go.jp'], label: 'J-PlatPat 日本专利', contentTypes: ['patent'], description: '网页检索入口；JPO 申请制 API 与网页检索分别核验' },
  ndl: { domains: ['ndlsearch.ndl.go.jp'], label: '日本国立国会图书馆', contentTypes: ['book'] },
  nga: { domains: ['nga.178.com', 'bbs.nga.cn'], label: 'NGA 讨论串', contentTypes: ['post'] },
  '5ch': { domains: ['5ch.net'], label: '5ch 公开讨论串', contentTypes: ['post'] },
  hackernews: { domains: ['news.ycombinator.com'], label: 'Hacker News', contentTypes: ['post'] },
  lobsters: { domains: ['lobste.rs'], label: 'Lobsters', contentTypes: ['post'] },
};

export const legacyContentTypes: Record<string, string[]> = {
  exa: ['page'], tavily: ['page'], brave: ['page'], bing: ['page'], zhipu: ['page'], doubao: ['page'], web: ['page'], sites: ['page'],
  crossref: ['paper'], openalex: ['paper'], pubmed: ['paper'], wiki: ['page'], github: ['code'], ghgrab: ['code'],
  bilibili: ['video', 'video-comment'], youtube: ['video', 'video-comment'], nicovideo: ['video'], steam: ['game', 'news', 'player-count'],
  wayback: ['web-snapshot'], archive: ['archive-record'], linuxdo: ['post'], heybox: ['post'], v2ex: ['post'],
};

export const declaredReadHosts: Record<string, string> = {
  'index.commoncrawl.org': 'common-crawl', 'data.commoncrawl.org': 'common-crawl', 'data.gharchive.org': 'gh-archive', 'wikimedia.org': 'wikimedia-analytics',
  'packages.ecosyste.ms': 'ecosystems', 'api.deps.dev': 'deps-dev', 'stat.ripe.net': 'ripestat', 'api.ooni.io': 'ooni', 'explorer.ooni.org': 'ooni', 'urlscan.io': 'urlscan',
  'rcsb.org': 'rcsb-pdb', 'data.rcsb.org': 'rcsb-pdb', 'uniprot.org': 'uniprot', 'rest.uniprot.org': 'uniprot', 'pubchem.ncbi.nlm.nih.gov': 'pubchem', 'materialsproject.org': 'materials-project',
  'exoplanetarchive.ipac.caltech.edu': 'nasa-exoplanets', 'hepdata.net': 'hepdata', 'gbif.org': 'gbif', 'api.gbif.org': 'gbif', 'inaturalist.org': 'inaturalist', 'api.inaturalist.org': 'inaturalist', 'cmr.earthdata.nasa.gov': 'earthdata-cmr',
  'fred.stlouisfed.org': 'fred', 'api.stlouisfed.org': 'fred', 'api.worldbank.org': 'world-bank', 'comtradeapi.un.org': 'un-comtrade', 'courtlistener.com': 'courtlistener', 'federalregister.gov': 'federal-register', 'openstreetmap.org': 'osm-overpass',
  'metmuseum.org': 'met', 'collectionapi.metmuseum.org': 'met', 'artic.edu': 'artic', 'api.artic.edu': 'artic', 'chatarchive.tv': 'chatarchive', 'sakugabooru.com': 'sakugabooru', 'isthereanydeal.com': 'isthereanydeal',
  'api.modrinth.com': 'modrinth', 'modrinth.com': 'modrinth', 'speedrun.com': 'speedrun', 'boardgamegeek.com': 'boardgamegeek', 'scryfall.com': 'scryfall', 'api.scryfall.com': 'scryfall', 'acoustid.org': 'acoustid', 'api.acoustid.org': 'acoustid', 'setlist.fm': 'setlistfm',
  'q1.qlogo.cn': 'qq-avatar', 'p.qlogo.cn': 'qq-group-avatar', 'user.qzone.qq.com': 'qq-public-profile', 'users.qzone.qq.com': 'qq-portrait-legacy', 'mp.weixin.qq.com': 'wechat-article-history',
};
