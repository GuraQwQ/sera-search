import { createHash } from 'node:crypto';
import type { ApiConfig, Config, Source } from '../types.js';
import { date, decoded, document, endpoint, hit, htmlText, permitted, plain, response, textResponse } from './shared.js';

interface NewsItem {
  title: string;
  url: string;
  description: string;
  publishedAt?: string;
  publisher: string;
  publisherUrl?: string;
}

function httpUrl(value: string, base?: string): string | undefined {
  try { const url = new URL(value, base); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}

function attributes(value: string): Record<string, string> {
  return Object.fromEntries([...value.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g)]
    .map(match => [match[1]!.toLowerCase(), decoded(match[2] ?? match[3] ?? match[4] ?? '')]));
}

function xmlValue(value: string, tag: string): string {
  return decoded((value.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i'))?.[1] ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

function newsItems(xml: string): NewsItem[] {
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<rss\b/i.test(xml) || !/<channel\b[\s\S]*<\/channel\s*>[\s\S]*<\/rss\s*>\s*$/i.test(xml)) {
    throw new Error('Google News 未返回有效 RSS 目录');
  }
  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)];
  if ((xml.match(/<item\b/gi) ?? []).length !== blocks.length) throw new Error('Google News RSS 条目不完整');
  return blocks.map(match => {
    const value = match[1]!, title = plain(xmlValue(value, 'title')), url = httpUrl(xmlValue(value, 'link'));
    if (!title || !url) throw new Error('Google News RSS 条目缺少标题或有效链接');
    const source = value.match(/<source\b([^>]*)>/i)?.[1] ?? '';
    return { title, url, description: plain(xmlValue(value, 'description')), publishedAt: date(xmlValue(value, 'pubDate')),
      publisher: plain(xmlValue(value, 'source')), publisherUrl: httpUrl(attributes(source).url ?? '') };
  });
}

function googleNews(config: NonNullable<Config['google-news']>): Source {
  const headers = { 'User-Agent': config.userAgent ?? 'SERA RSS client', Accept: 'application/rss+xml,application/xml,text/xml,text/html' };
  const base = endpoint(config, 'https://news.google.com/', '');
  const records = new Map<string, { item: NewsItem; feedUrl: string; expires: number }>();
  const remember = (items: NewsItem[], feedUrl: string) => {
    for (const [url, entry] of records) if (entry.expires <= Date.now()) records.delete(url);
    for (const item of items) {
      records.delete(item.url);
      records.set(item.url, { item, feedUrl, expires: Date.now() + 300_000 });
      if (records.size > 100) records.delete(records.keys().next().value!);
    }
  };
  const metadata = (item: NewsItem, feedUrl: string) => ({ ...item, feedUrl, aggregationUrl: item.url, contentScope: 'rss-item',
    fullContentVerified: false, linkResolution: new URL(item.url).hostname === 'news.google.com' ? 'google-aggregation-url' : 'rss-link' });
  return {
    capability: { name: 'google-news', search: true, read: true, configured: config.enabled !== false, category: 'web',
      requiresLogin: false, loggedIn: true, requirement: '公开 Google News RSS 新闻发现与聚合记录读取' },
    async search(request) {
      const since = request.since ? date(request.since) : undefined;
      if (request.since && !since) throw new Error('Google News 日期过滤需要有效日期');
      if (request.at) throw new Error('Google News RSS 提供当前新闻目录；历史网页请使用档案来源');
      const url = endpoint(config, 'https://news.google.com/', config.topicId ? `rss/topics/${encodeURIComponent(config.topicId)}` : 'rss/search');
      const country = config.country ?? 'US', language = config.languageCode ?? 'en-US';
      if (!config.topicId) url.searchParams.set('q', request.query);
      url.searchParams.set('hl', language);
      url.searchParams.set('gl', country);
      url.searchParams.set('ceid', config.edition ?? `${country}:${language.split('-')[0]}`);
      const result = await response(url, { headers, signal: request.signal }, 'Google News RSS');
      const items = newsItems((await textResponse(result)).text);
      remember(items, url.href);
      return items.filter(item => permitted(request.domains, new URL(item.publisherUrl ?? item.url).hostname)
        && (!since || Boolean(item.publishedAt && item.publishedAt >= since)))
        .slice(0, request.limit).flatMap(item => hit('google-news', { title: item.title, url: item.url, snippet: item.description || item.publisher,
          publishedAt: item.publishedAt, metadata: metadata(item, url.href) }));
    },
    async read(url, signal) {
      const requested = new URL(url), saved = records.get(requested.href);
      if (saved && saved.expires > Date.now()) return document('google-news', requested.href, saved.item.title,
        JSON.stringify(saved.item, null, 2), { contentKind: 'metadata', publishedAt: saved.item.publishedAt, metadata: metadata(saved.item, saved.feedUrl) });
      records.delete(requested.href);
      const isGoogle = requested.hostname === 'news.google.com';
      const localPath = requested.origin === base.origin && requested.pathname.startsWith(base.pathname)
        ? requested.pathname.slice(base.pathname.length) : isGoogle ? requested.pathname.slice(1) : '';
      if (!['http:', 'https:'].includes(requested.protocol) || !/^(?:(?:(?:rss\/)?articles|read)\/[^/]+\/?|rss(?:\/(?:search|topics\/[^/]+))?\/?)$/.test(localPath)) {
        throw new Error('Google News 读取需要新闻聚合链接或 RSS 目录链接');
      }
      const target = isGoogle && config.baseUrl ? endpoint(config, 'https://news.google.com/', localPath + requested.search) : requested;
      const result = await response(target, { headers, signal }, 'Google News 读取');
      const decodedText = await textResponse(result), text = decodedText.text;
      if (/^\s*(?:<\?xml[^>]*>\s*)?<rss\b/i.test(text)) {
        const items = newsItems(text);
        remember(items, requested.href);
        return document('google-news', requested.href, 'Google News RSS', JSON.stringify(items.slice(0, 100), null, 2), {
          contentKind: 'metadata', metadata: { feedUrl: requested.href, contentScope: 'rss-feed', itemsReturned: Math.min(items.length, 100),
            itemsTotal: items.length, truncated: items.length > 100, fullContentVerified: false, encoding: decodedText.encoding },
        });
      }
      if (!/(?:^|\/)(?:articles|read)\//.test(localPath)) throw new Error('Google News 未返回有效 RSS 目录');
      const actual = new URL(result.url || target), type = result.headers.get('content-type') ?? '';
      const title = plain(text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') || requested.href;
      const body = /html/i.test(type) ? htmlText(text.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '', actual.href) : /^text\//i.test(type) ? text : '';
      if (actual.hostname !== 'news.google.com' && actual.origin !== base.origin && body.trim()) {
        return document('google-news', actual.href, title, body, { metadata: { aggregationUrl: requested.href, contentScope: 'publisher-server-text',
          extraction: /html/i.test(type) ? 'html-source-text' : 'direct-text', renderedScripts: false, encoding: decodedText.encoding } });
      }
      // shortcut: Google News 编码链接仅保留聚合记录，取得稳定的公开解码接口后再接入。
      const record = { title, aggregationUrl: requested.href, resolvedUrl: actual.href };
      return document('google-news', requested.href, title, JSON.stringify(record, null, 2), {
        contentKind: 'metadata', metadata: { ...record, contentScope: 'google-news-landing', fullContentVerified: false, linkResolution: 'unresolved' },
      });
    },
  };
}

interface IptvChannel {
  id: string;
  name: string;
  tvgName?: string;
  country?: string;
  group?: string;
  logo?: string;
  tvgId?: string;
  duration: string;
  streamUrl?: string;
  rawStreamUrl: string;
  streamProvided: boolean;
  attributes: Record<string, string>;
}

function playlist(text: string): { channels: IptvChannel[]; epgUrls: string[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim());
  const first = lines.findIndex(Boolean), header = lines[first] ?? '';
  if (!/^#EXTM3U(?:\s|$)/.test(header)) throw new Error('IPTV 未返回有效的 M3U 频道目录');
  const epg = attributes(header), channels: IptvChannel[] = [];
  let pending: { name: string; duration: string; fields: Record<string, string>; group?: string } | undefined;
  for (const line of lines.slice(first + 1)) {
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      if (pending) throw new Error('IPTV 频道缺少流地址');
      let quote = '', comma = -1;
      for (let index = 8; index < line.length; index++) {
        const char = line[index]!;
        if (quote) { if (char === quote) quote = ''; }
        else if (char === '"' || char === "'") quote = char;
        else if (char === ',') { comma = index; break; }
      }
      const info = line.slice(8, comma), duration = info.match(/^\s*(-?\d+(?:\.\d+)?)(?:\s|$)/)?.[1];
      if (comma < 0 || !duration) throw new Error('IPTV EXTINF 频道记录格式无效');
      const fields = attributes(info), name = decoded(line.slice(comma + 1)) || fields['tvg-name'] || fields['tvg-id'];
      if (!name) throw new Error('IPTV 频道记录缺少名称');
      pending = { name, duration, fields };
    } else if (line.startsWith('#EXTGRP:') && pending) pending.group = decoded(line.slice(8));
    else if (!line.startsWith('#')) {
      const streamProvided = line !== '[NO PUBLIC STREAM]';
      if (!pending || streamProvided && (/[<>]/.test(line) || !/^[a-z][a-z\d+.-]*:\/\//i.test(line))) throw new Error('IPTV 频道目录包含无效流地址');
      if (streamProvided) { try { new URL(line); } catch { throw new Error('IPTV 频道目录包含无效流地址'); } }
      const { name, duration, fields } = pending;
      channels.push({ id: createHash('sha256').update(JSON.stringify([name, fields['tvg-id'] ?? '', line])).digest('hex'), name, duration,
        tvgName: fields['tvg-name'], country: fields['tvg-country'], group: fields['group-title'] || pending.group,
        logo: fields['tvg-logo'], tvgId: fields['tvg-id'], streamUrl: streamProvided ? line : undefined, rawStreamUrl: line, streamProvided, attributes: fields });
      pending = undefined;
    }
  }
  if (pending) throw new Error('IPTV 频道缺少流地址');
  return { channels, epgUrls: [...new Set([epg['x-tvg-url'], epg['url-tvg'], epg['tvg-url']].filter(Boolean).flatMap(value => value!.split(',').map(url => url.trim()).filter(Boolean)))] };
}

function iptv(config: ApiConfig): Source {
  const catalog = new URL(config.baseUrl ?? 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8');
  catalog.hash = '';
  if (!['http:', 'https:'].includes(catalog.protocol)) throw new Error('IPTV 目录地址需要 HTTP 或 HTTPS');
  const headers = { 'User-Agent': config.userAgent ?? 'SERA IPTV catalog client', Accept: 'application/x-mpegURL,application/vnd.apple.mpegurl,text/plain' };
  const load = async (signal: AbortSignal) => {
    const result = await response(catalog, { headers, signal }, 'Free-TV IPTV 目录');
    const decodedText = await textResponse(result);
    return { ...playlist(decodedText.text), encoding: decodedText.encoding };
  };
  const channelUrl = (id: string) => { const url = new URL(catalog); url.searchParams.set('sera-channel', id); return url.href; };
  return {
    capability: { name: 'iptv', search: true, read: true, configured: config.enabled !== false, category: 'catalog',
      requiresLogin: false, loggedIn: true, requirement: 'Free-TV IPTV 公开频道目录与节目单线索' },
    async search(request) {
      if (request.since || request.at) throw new Error('IPTV 目录未提供频道发布日期或历史快照');
      const data = await load(request.signal);
      const normalized = (value: string) => value.normalize('NFKC').toLowerCase();
      const queries = [request.query, ...(request.aliases ?? [])].map(normalized).map(value => value.trim()).filter(Boolean);
      return data.channels.filter(channel => {
        const text = normalized([channel.name, channel.tvgName, channel.tvgId, channel.country, channel.group].filter(Boolean).join(' '));
        return (!queries.length || queries.some(query => query.split(/\s+/).every(term => text.includes(term))))
          && (permitted(request.domains, catalog.hostname) || permitted(request.domains, channel.streamUrl ? new URL(channel.streamUrl).hostname : ''));
      }).slice(0, request.limit).flatMap(channel => hit('iptv', { title: channel.name, url: channelUrl(channel.id),
        snippet: [channel.country, channel.group, channel.tvgId].filter(Boolean).join(' · '), metadata: { ...channel, catalogUrl: catalog.href,
          epgUrls: data.epgUrls, contentScope: 'channel-catalog', streamAvailability: 'unknown' } }));
    },
    async read(url, signal) {
      const requested = new URL(url), id = requested.searchParams.get('sera-channel');
      requested.searchParams.delete('sera-channel');
      requested.hash = '';
      if (requested.href !== catalog.href) throw new Error('IPTV 读取需要当前频道目录或频道记录链接');
      const data = await load(signal);
      const channels = id === null ? data.channels.slice(0, 100) : data.channels.filter(channel => channel.id === id);
      if (id !== null && !channels.length) throw new Error('IPTV 当前目录未找到该频道记录');
      const value = { catalogUrl: catalog.href, channels, epgUrls: data.epgUrls };
      return document('iptv', id === null ? catalog.href : channelUrl(id), id === null ? 'Free-TV IPTV 频道目录' : channels[0]!.name,
        JSON.stringify(value, null, 2), { contentKind: 'metadata', metadata: { catalogUrl: catalog.href, contentScope: id === null ? 'channel-catalog-list' : 'channel-catalog',
          channelsReturned: channels.length, channelsTotal: data.channels.length, truncated: id === null && data.channels.length > channels.length,
          streamAvailability: 'unknown', encoding: data.encoding } });
    },
  };
}

export function createFeedSources(config: Config): Source[] { return [googleNews(config['google-news'] ?? {}), iptv(config.iptv ?? {})]; }
