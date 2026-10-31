import { setTimeout as delay } from 'node:timers/promises';
import type { ApiConfig, Config, SearchHit, SearchRequest, Source, SourceName } from '../types.js';
import { NotLoggedInError } from '../credentials.js';
import { document, endpoint, hit, json, object, permitted, plain, rows, string } from './shared.js';
import type { Row } from './shared.js';

function capability(name: SourceName, config: ApiConfig, requirement: string, platforms?: string[], requiresLogin = false) {
  return { name, search: true, read: true, configured: config.enabled !== false && (!requiresLogin || Boolean(config.apiKey)),
    category: 'catalog' as const, requiresLogin, loggedIn: !requiresLogin || Boolean(config.apiKey), requirement, ...(platforms ? { platforms } : {}) };
}

function api(config: ApiConfig, fallback: string, name: string) {
  return async (path: string, signal: AbortSignal, params: Record<string, string> = {}, body?: Row) => {
    const url = endpoint(config, fallback, path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return json(url, { signal, method: body ? 'POST' : 'GET', headers: {
      Accept: 'application/json', 'User-Agent': config.userAgent ?? 'SERA/0.1 (catalog metadata client)',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) }, name);
  };
}

function selection(request: SearchRequest, config: ApiConfig, supported: string[], fallback: string): string {
  const selected = request.platform ?? config.engine ?? fallback;
  if (!supported.includes(selected)) throw new Error(`该来源支持的平台：${supported.join('、')}`);
  return selected;
}

function published(value: unknown): string | undefined {
  const text = string(value);
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text) || Number.isNaN(Date.parse(text))) return undefined;
  return new Date(text).toISOString();
}

function results(name: SourceName, request: SearchRequest, values: Omit<SearchHit, 'source'>[]): SearchHit[] {
  return values.filter(value => value.metadata?.id !== undefined && value.metadata.id !== '').flatMap(value => hit(name, value)).filter(value => permitted(request.domains, new URL(value.url).hostname)
    && (!request.since || Boolean(value.publishedAt && Date.parse(value.publishedAt) >= Date.parse(request.since)))).slice(0, request.limit);
}

function record(name: SourceName, url: string, title: string, value: Row, extra: Row = {}) {
  return document(name, url, title, JSON.stringify(value, null, 2), { contentKind: 'metadata', metadata: { id: value.id, format: `${name}-json`, ...extra } });
}

function numericId(url: string, hosts: string[], pattern: RegExp, name: string): string {
  const parsed = new URL(url), id = hosts.includes(parsed.hostname) ? parsed.pathname.match(pattern)?.[1] : undefined;
  if (!id) throw new Error(`${name} 读取需要该平台的作品记录链接`);
  return id;
}

function skills(config: ApiConfig): Source {
  const get = api(config, 'https://skills.sh/', 'skills.sh');
  const skillId = (value: Row) => string(value.id) || [string(value.source), string(value.skillId)].filter(Boolean).join('/');
  return {
    capability: capability('skills', config, '公开技能目录；记录提供 GitHub 归属与安装量'),
    async search(request) {
      const value = await get('api/search', request.signal, { q: request.query, limit: String(Math.min(100, request.limit)) });
      return results('skills', request, rows(value.skills, 'skills.sh').map(item => ({
        title: string(item.name) || string(item.skillId), url: `https://skills.sh/${skillId(item).split('/').map(encodeURIComponent).join('/')}`,
        snippet: `${string(item.source)} · 安装量 ${item.installs ?? 0}`, metadata: { id: skillId(item), record: item },
      })));
    },
    async read(url, signal) {
      const parsed = new URL(url), parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parsed.hostname !== 'skills.sh' || parts.length !== 3) throw new Error('技能读取需要 skills.sh 的所属仓库与技能记录链接');
      // shortcut: 官方目录无详情接口，按技能名匹配前 100 条；提供按 ID 接口后改用直接读取。
      const id = parts.join('/'), value = await get('api/search', signal, { q: parts[2]!, limit: '100' });
      const item = rows(value.skills, 'skills.sh').find(item => skillId(item) === id);
      if (!item) throw new Error('skills.sh 未返回该技能记录');
      return record('skills', `https://skills.sh/${parts.map(encodeURIComponent).join('/')}`, string(item.name), item, {
        id, repositoryUrl: `https://github.com/${parts.slice(0, 2).map(encodeURIComponent).join('/')}`, contentScope: 'skill-catalog',
      });
    },
  };
}

function bangumi(config: ApiConfig): Source {
  const get = api(config, 'https://api.bgm.tv/v0/', 'Bangumi');
  const types: Record<string, number> = { book: 1, anime: 2, music: 3, game: 4, real: 6 };
  return {
    capability: capability('bangumi', config, '公开条目目录与评分元数据', ['all', ...Object.keys(types)]),
    async search(request) {
      const platform = selection(request, config, ['all', ...Object.keys(types)], 'all');
      const value = await get('search/subjects', request.signal, { limit: String(Math.min(50, request.limit)), offset: '0' }, {
        keyword: request.query, sort: 'match', filter: platform === 'all' ? {} : { type: [types[platform]] },
      });
      return results('bangumi', request, rows(value.data, 'Bangumi').map(item => ({
        title: string(item.name_cn) || string(item.name), url: `https://bgm.tv/subject/${item.id}`, snippet: plain(item.summary),
        publishedAt: published(item.date), metadata: { id: item.id, record: item },
      })));
    },
    async read(url, signal) {
      const id = numericId(url, ['bgm.tv', 'bangumi.tv', 'chii.in'], /^\/subject\/(\d+)\/?$/, 'Bangumi');
      const item = await get(`subjects/${id}`, signal);
      return record('bangumi', `https://bgm.tv/subject/${id}`, string(item.name_cn) || string(item.name), item);
    },
  };
}

function anilist(config: ApiConfig): Source {
  const get = api(config, 'https://graphql.anilist.co/', 'AniList');
  const fields = 'id type title { romaji english native } siteUrl description format status episodes chapters startDate { year month day }';
  const query = async (query: string, variables: Row, signal: AbortSignal) => {
    const value = await get('', signal, {}, { query, variables });
    if (value.errors) throw new Error('AniList GraphQL 未返回有效记录，请核对查询或稍后重试');
    return object(value.data, 'AniList');
  };
  const title = (item: Row) => { const value = object(item.title, 'AniList 标题'); return string(value.native) || string(value.english) || string(value.romaji); };
  return {
    capability: capability('anilist', config, '公开动画与漫画目录', ['anime', 'manga']),
    async search(request) {
      const platform = selection(request, config, ['anime', 'manga'], 'anime');
      const data = await query(`query($search:String,$type:MediaType,$limit:Int){Page(page:1,perPage:$limit){media(search:$search,type:$type,sort:SEARCH_MATCH){${fields}}}}`,
        { search: request.query, type: platform.toUpperCase(), limit: Math.min(50, request.limit) }, request.signal);
      return results('anilist', request, rows(object(data.Page, 'AniList 页面').media, 'AniList').map(item => {
        const start = object(item.startDate ?? {}, 'AniList 日期');
        return { title: title(item), url: string(item.siteUrl) || `https://anilist.co/${string(item.type).toLowerCase() || platform}/${item.id}`,
          snippet: plain(item.description), publishedAt: start.year && start.month && start.day ? published(`${start.year}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`) : undefined,
          metadata: { id: item.id, record: item } };
      }));
    },
    async read(url, signal) {
      const id = numericId(url, ['anilist.co'], /^\/(?:anime|manga)\/(\d+)(?:\/.*)?$/, 'AniList');
      const item = object((await query(`query($id:Int){Media(id:$id){${fields}}}`, { id: Number(id) }, signal)).Media, 'AniList 记录');
      return record('anilist', string(item.siteUrl) || url, title(item), item);
    },
  };
}

function jikan(config: ApiConfig): Source {
  const get = api(config, 'https://api.jikan.moe/v4/', 'Jikan');
  return {
    capability: capability('jikan', config, 'MyAnimeList 公开动画与漫画元数据', ['anime', 'manga']),
    async search(request) {
      const platform = selection(request, config, ['anime', 'manga'], 'anime');
      const value = await get(platform, request.signal, { q: request.query, limit: String(Math.min(25, request.limit)) });
      return results('jikan', request, rows(value.data, 'Jikan').map(item => ({ title: string(item.title),
        url: string(item.url) || `https://myanimelist.net/${platform}/${item.mal_id}`, snippet: plain(item.synopsis),
        publishedAt: published(object(item[platform === 'anime' ? 'aired' : 'published'] ?? {}, 'Jikan 日期').from), metadata: { id: item.mal_id, record: item },
      })));
    },
    async read(url, signal) {
      const parsed = new URL(url), match = parsed.hostname === 'myanimelist.net' ? parsed.pathname.match(/^\/(anime|manga)\/(\d+)(?:\/.*)?$/) : null;
      if (!match) throw new Error('Jikan 读取需要 MyAnimeList 动画或漫画链接');
      const item = object((await get(`${match[1]}/${match[2]}/full`, signal)).data, 'Jikan 记录');
      return record('jikan', string(item.url) || url, string(item.title), item, { id: item.mal_id });
    },
  };
}

function mangadex(config: ApiConfig): Source {
  const get = api(config, 'https://api.mangadex.org/', 'MangaDex');
  const title = (item: Row) => {
    const names = object(object(item.attributes, 'MangaDex 属性').title, 'MangaDex 标题');
    return string(names.en) || string(Object.values(names)[0]);
  };
  return {
    capability: capability('mangadex', config, '公开漫画目录；正文需后续读取获准公开章节'),
    async search(request) {
      const value = await get('manga', request.signal, { title: request.query, limit: String(Math.min(100, request.limit)), 'order[relevance]': 'desc' });
      return results('mangadex', request, rows(value.data, 'MangaDex').map(item => {
        const attributes = object(item.attributes, 'MangaDex 属性'), description = object(attributes.description ?? {}, 'MangaDex 简介');
        return { title: title(item), url: `https://mangadex.org/title/${item.id}`, snippet: string(description.en) || string(Object.values(description)[0]), metadata: { id: item.id, record: item } };
      }));
    },
    async read(url, signal) {
      const id = numericId(url, ['mangadex.org'], /^\/title\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:\/.*)?$/i, 'MangaDex');
      const item = object((await get(`manga/${id}`, signal)).data, 'MangaDex 记录');
      return record('mangadex', `https://mangadex.org/title/${id}`, title(item), item);
    },
  };
}

function vndb(config: ApiConfig): Source {
  const get = api(config, 'https://api.vndb.org/kana/', 'VNDB');
  const fields = 'id,title,alttitle,description,released,rating,length_minutes,image.url';
  return {
    capability: capability('vndb', config, '公开视觉小说目录'),
    async search(request) {
      const value = await get('vn', request.signal, {}, { filters: ['search', '=', request.query], fields, sort: 'searchrank', results: Math.min(100, request.limit) });
      return results('vndb', request, rows(value.results, 'VNDB').map(item => ({ title: string(item.title), url: `https://vndb.org/${item.id}`,
        snippet: plain(item.description), publishedAt: published(item.released), metadata: { id: item.id, record: item },
      })));
    },
    async read(url, signal) {
      const id = numericId(url, ['vndb.org', 'www.vndb.org'], /^\/(v\d+)\/?$/, 'VNDB');
      const item = rows((await get('vn', signal, {}, { filters: ['id', '=', id], fields, results: 1 })).results, 'VNDB')[0];
      if (!item) throw new Error('VNDB 未返回该作品记录');
      return record('vndb', `https://vndb.org/${id}`, string(item.title), item);
    },
  };
}

let musicbrainzNextRequest = 0;
function musicbrainz(config: ApiConfig): Source {
  const request = api(config, 'https://musicbrainz.org/ws/2/', 'MusicBrainz');
  const get = async (path: string, signal: AbortSignal, params: Record<string, string> = {}) => {
    const origin = endpoint(config, 'https://musicbrainz.org/ws/2/', '').origin;
    // MusicBrainz 公共服务要求每秒至多一次请求，取消等待不会影响下一次请求。
    if (origin === 'https://musicbrainz.org') {
      const wait = Math.max(0, musicbrainzNextRequest - Date.now());
      musicbrainzNextRequest = Date.now() + wait + 1000;
      await delay(wait, undefined, { signal });
    }
    return request(path, signal, { fmt: 'json', ...params });
  };
  return {
    capability: capability('musicbrainz', config, '公开录音、艺人与发行目录；建议 userAgent 包含项目联系方式', ['recording', 'artist', 'release']),
    async search(request) {
      const platform = selection(request, config, ['recording', 'artist', 'release'], 'recording');
      const value = await get(platform, request.signal, { query: request.query, limit: String(Math.min(100, request.limit)) });
      return results('musicbrainz', request, rows(value[platform === 'release' ? 'releases' : `${platform}s`], 'MusicBrainz').map(item => ({
        title: string(item.title) || string(item.name), url: `https://musicbrainz.org/${platform}/${item.id}`,
        snippet: string(item.disambiguation) || [string(item.type), string(item.country)].filter(Boolean).join(' · '),
        publishedAt: published(item['first-release-date'] ?? item.date), metadata: { id: item.id, platform, record: item },
      })));
    },
    async read(url, signal) {
      const parsed = new URL(url), match = parsed.hostname === 'musicbrainz.org' ? parsed.pathname.match(/^\/(recording|artist|release)\/([\da-f-]{36})\/?$/i) : null;
      if (!match) throw new Error('MusicBrainz 读取需要录音、艺人或发行的 MBID 链接');
      const item = await get(`${match[1]}/${match[2]}`, signal);
      return record('musicbrainz', `https://musicbrainz.org/${match[1]}/${match[2]}`, string(item.title) || string(item.name), item);
    },
  };
}

function lastfm(config: ApiConfig): Source {
  const get = api({ ...config, apiKey: undefined }, 'https://ws.audioscrobbler.com/2.0/', 'Last.fm');
  const call = async (method: string, params: Record<string, string>, signal: AbortSignal) => {
    if (!config.apiKey) throw new NotLoggedInError();
    const value = await get('', signal, { method, api_key: config.apiKey, format: 'json', ...params });
    if (value.error) {
      if ([4, 9, 10, 14, 26].includes(Number(value.error))) throw new NotLoggedInError();
      throw Object.assign(new Error(`Last.fm 请求失败，代码 ${value.error}`), { code: Number(value.error) === 29 ? 'RATE_LIMITED' : `LASTFM_${value.error}` });
    }
    return value;
  };
  return {
    capability: capability('lastfm', config, '需要 Last.fm API Key；曲目与艺人目录', ['track', 'artist'], true),
    async search(request) {
      if (!config.apiKey) throw new NotLoggedInError();
      const platform = selection(request, config, ['track', 'artist'], 'track');
      const value = object((await call(`${platform}.search`, { [platform]: request.query, limit: String(Math.min(100, request.limit)) }, request.signal)).results, 'Last.fm');
      const matches = object(value[`${platform}matches`], 'Last.fm 命中')[platform];
      return results('lastfm', request, rows(matches, 'Last.fm').map(item => ({ title: string(item.name), url: string(item.url),
        snippet: string(item.artist) || `听众 ${item.listeners ?? 0}`, metadata: { id: item.mbid || item.url, platform, record: item },
      })));
    },
    async read(url, signal) {
      if (!config.apiKey) throw new NotLoggedInError();
      const parsed = new URL(url), parts = parsed.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part.replaceAll('+', ' ')));
      if (!['last.fm', 'www.last.fm'].includes(parsed.hostname) || parts[0] !== 'music' || !parts[1]
        || (parts.length !== 2 && !(parts.length === 4 && parts[2] === '_'))) throw new Error('Last.fm 读取需要艺人或曲目记录链接');
      const platform = parts.length === 4 ? 'track' : 'artist';
      const item = object((await call(`${platform}.getInfo`, { artist: parts[1], ...(platform === 'track' ? { track: parts[3]! } : {}) }, signal))[platform], 'Last.fm 记录');
      return record('lastfm', string(item.url) || url, string(item.name), item, { id: item.mbid || item.url, platform });
    },
  };
}

function listenbrainz(config: ApiConfig): Source {
  const get = api(config, 'https://api.listenbrainz.org/1/', 'ListenBrainz');
  const username = (value: string) => {
    const name = value.trim();
    if (!name || /[/?#\s]/.test(name)) throw new Error('ListenBrainz 查询需要一个用户名');
    return name;
  };
  const stats = (user: string, signal: AbortSignal, count: number) => get(`stats/user/${encodeURIComponent(user)}/recordings`, signal, { range: 'all_time', count: String(Math.min(100, count)) });
  const profile = (user: string) => `https://listenbrainz.org/user/${encodeURIComponent(user)}/stats/?range=all_time`;
  return {
    capability: capability('listenbrainz', config, '仅按用户名查询公开播放统计', ['user']),
    async search(request) {
      selection(request, config, ['user'], 'user');
      const user = username(request.query), value = await stats(user, request.signal, request.limit);
      const payload = object(value.payload, 'ListenBrainz 统计');
      const recordings = rows(payload.recordings, 'ListenBrainz 录音');
      if (!recordings.length) return [];
      return results('listenbrainz', request, [{ title: `${user} 的公开播放统计`, url: profile(user),
        snippet: recordings.map(item => `${string(item.artist_name)} — ${string(item.track_name)} (${item.listen_count ?? 0})`).join('；'),
        metadata: { id: user, platform: 'user', record: payload },
      }]);
    },
    async read(url, signal) {
      const parsed = new URL(url), match = parsed.hostname === 'listenbrainz.org' ? parsed.pathname.match(/^\/user\/([^/]+)(?:\/stats)?\/?$/) : null;
      if (!match) throw new Error('ListenBrainz 读取需要用户主页或统计链接');
      const user = username(decodeURIComponent(match[1]!)), value = await stats(user, signal, 100);
      return record('listenbrainz', profile(user), `${user} 的公开播放统计`, object(value.payload, 'ListenBrainz 统计'), { id: user, range: 'all_time', contentScope: 'user-listening-statistics' });
    },
  };
}

function discogs(config: ApiConfig): Source {
  const call = async (path: string, signal: AbortSignal, params: Record<string, string> = {}) => {
    if (!config.apiKey) throw new NotLoggedInError();
    const url = endpoint(config, 'https://api.discogs.com/', path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return json(url, { signal, headers: { Accept: 'application/json', 'User-Agent': config.userAgent ?? 'SERA/0.1 (catalog metadata client)', Authorization: `Discogs token=${config.apiKey}` } }, 'Discogs');
  };
  return {
    capability: capability('discogs', config, '需要 Discogs 用户 Token；发行、母版、艺人与厂牌目录', ['all', 'release', 'master', 'artist', 'label'], true),
    async search(request) {
      if (!config.apiKey) throw new NotLoggedInError();
      const platform = selection(request, config, ['all', 'release', 'master', 'artist', 'label'], 'all');
      const value = await call('database/search', request.signal, { q: request.query, per_page: String(Math.min(100, request.limit)), ...(platform === 'all' ? {} : { type: platform }) });
      return results('discogs', request, rows(value.results, 'Discogs').map(item => ({
        title: string(item.title), url: new URL(string(item.uri) || `/${item.type}/${item.id}`, 'https://www.discogs.com/').href,
        snippet: [string(item.country), item.year, ...(Array.isArray(item.genre) ? item.genre : [])].filter(Boolean).join(' · '), metadata: { id: item.id, platform: item.type, record: item },
      })));
    },
    async read(url, signal) {
      if (!config.apiKey) throw new NotLoggedInError();
      const parsed = new URL(url), match = ['discogs.com', 'www.discogs.com'].includes(parsed.hostname) ? parsed.pathname.match(/^\/(?:[a-z]{2}\/)?(release|master|artist|label)\/(\d+)(?:-[^/]*)?\/?$/) : null;
      if (!match) throw new Error('Discogs 读取需要发行、母版、艺人或厂牌记录链接');
      const plural: Record<string, string> = { release: 'releases', master: 'masters', artist: 'artists', label: 'labels' };
      const item = await call(`${plural[match[1]!]}/${match[2]}`, signal);
      return record('discogs', string(item.uri) || `https://www.discogs.com/${match[1]}/${match[2]}`, string(item.title) || string(item.name), item);
    },
  };
}

export function createCatalogSources(config: Config): Source[] {
  return [skills(config.skills ?? {}), bangumi(config.bangumi ?? {}), anilist(config.anilist ?? {}), jikan(config.jikan ?? {}),
    mangadex(config.mangadex ?? {}), vndb(config.vndb ?? {}), musicbrainz(config.musicbrainz ?? {}), lastfm(config.lastfm ?? {}),
    listenbrainz(config.listenbrainz ?? {}), discogs(config.discogs ?? {})];
}
