import type { ApiConfig, Config, Document, Source } from '../types.js';
import type { Row } from './shared.js';
import { NotLoggedInError, notLoggedIn } from '../credentials.js';
import { object, rows, string, plain, decoded, htmlText, textResponse, date, epoch, hit, endpoint, response, json, document, apiHeaders, permitted } from './shared.js';

function github(config: ApiConfig): Source {
  const headers: Record<string, string> = { Accept: 'application/vnd.github.text-match+json', 'User-Agent': 'SERA' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const get = (path: string, signal: AbortSignal) => json(endpoint(config, 'https://api.github.com/', path), { headers, signal }, 'GitHub');
  return {
    capability: { name: 'github', search: true, read: true, configured: config.enabled !== false, requirement: '公开仓库可匿名访问，代码搜索需要 GitHub Token' },
    async search(request) {
      if (!permitted(request.domains, 'github.com')) return [];
      const type = request.githubType ?? 'repositories';
      if (type === 'code' && !config.apiKey) throw new NotLoggedInError();
      if (request.since && type === 'code') throw new Error('GitHub 代码搜索不支持发布日期过滤，请使用仓库或 issue 搜索');
      const url = endpoint(config, 'https://api.github.com/', `search/${type}`);
      url.searchParams.set('q', `${request.query}${request.since ? ` ${type === 'repositories' ? 'pushed' : 'created'}:>=${request.since.slice(0, 10)}` : ''}`);
      url.searchParams.set('per_page', String(Math.min(request.limit, 100)));
      const data = await json(url, { headers, signal: request.signal }, 'GitHub');
      return rows(data.items, 'GitHub').flatMap((item) => hit('github', {
        title: string(item.full_name) || string(item.title) || string(item.name),
        url: string(item.html_url),
        snippet: string(item.description) || string(item.body) || (Array.isArray(item.text_matches) ? rows(item.text_matches, 'GitHub 匹配片段').map((v) => string(v.fragment)).join('\n') : ''),
        publishedAt: type === 'issues' ? date(item.created_at) : undefined,
        metadata: { kind: type, updatedAt: item.updated_at, pushedAt: item.pushed_at },
      })).slice(0, request.limit);
    },
    async read(url, signal) {
      const parsed = new URL(url);
      if (!['github.com', 'raw.githubusercontent.com'].includes(parsed.hostname)) throw new Error('GitHub 读取需要 github.com 或 raw.githubusercontent.com 链接');
      const parts = parsed.pathname.split('/').filter(Boolean);
      const [owner, repo] = parts;
      if (!owner || !repo) throw new Error('GitHub 链接缺少仓库名');
      const root = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo.replace(/\.git$/, ''))}`;
      if (parsed.hostname === 'github.com' && ['issues', 'pull'].includes(parts[2] ?? '') && /^\d+$/.test(parts[3] ?? '')) {
        const number = parts[3]!;
        const issue = await get(`${root}/${parts[2] === 'pull' ? 'pulls' : 'issues'}/${number}`, signal);
        const count = typeof issue.comments === 'number' ? issue.comments : 0;
        let comments: Row[] = [];
        let commentsError: string | undefined;
        if (count > 0) {
          try {
            const result = await response(endpoint(config, 'https://api.github.com/', `${root}/issues/${number}/comments?per_page=100`), { headers, signal }, 'GitHub');
            comments = rows(await result.json(), 'GitHub 评论');
          } catch (error) {
            if (signal.aborted) throw error;
            commentsError = error instanceof Error ? error.message : '评论读取失败';
          }
        }
        const body = string(issue.body);
        const content = body || comments.length ? `# ${plain(issue.title)}\n\n${body}\n\n${comments.map((comment) => `## ${string(object(comment.user ?? {}, 'GitHub 用户').login)} · ${string(comment.created_at)}\n\n${string(comment.body)}`).join('\n\n')}` : JSON.stringify({ title: issue.title, state: issue.state, labels: issue.labels }, null, 2);
        return document('github', url, string(issue.title), content, {
          contentKind: body || comments.length ? 'post' : 'metadata',
          publishedAt: date(issue.created_at),
          metadata: { state: issue.state, updatedAt: issue.updated_at, commentsReturned: comments.length, commentsTotal: count, commentsComplete: comments.length >= count, commentsKind: 'issue', ...(commentsError ? { commentsError } : {}), ...(parts[2] === 'pull' ? { reviewCommentsTotal: issue.review_comments, reviewCommentsIncluded: false } : {}) },
        });
      }
      let path = `${root}/readme`;
      if (parsed.hostname === 'raw.githubusercontent.com' || ['blob', 'raw'].includes(parts[2] ?? '')) {
        const tail = parts.slice(parsed.hostname === 'raw.githubusercontent.com' ? 2 : 3);
        if (tail[0] === 'refs' && tail[1] === 'heads') tail.splice(0, 2);
        // shortcut: blob 的 ref 按首段解析，带斜杠的分支请改用提交 SHA。
        const ref = tail.shift();
        if (!ref || !tail.length) throw new Error('GitHub 文件链接缺少 ref 或文件路径');
        path = `${root}/contents/${tail.map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`;
      } else if (parts.length > 2) throw new Error('此 GitHub 链接不是仓库、文件、issue 或 PR');
      const file = await get(path, signal);
      if (file.encoding !== 'base64' || typeof file.content !== 'string') throw new Error('GitHub 未返回文件正文，目录列表不能作为文件证据');
      const bytes = Buffer.from(file.content, 'base64');
      let content: string;
      try {
        if (bytes.includes(0)) throw new Error('binary');
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch { throw new Error('GitHub 文件不是 UTF-8 文本，请使用对应附件读取来源'); }
      return document('github', url, string(file.name), content, { metadata: { path: file.path, sha: file.sha } });
    },
  };
}

function hasBody(title: string, content: string): boolean {
  const compact = (value: string) => plain(value).replace(/\s+/g, ' ').trim();
  const body = compact(content);
  return Boolean(body && body !== compact(title) && !/^(?:please enable javascript|you need to enable javascript|enable javascript to (?:run|view)|请启用\s*JavaScript)[.!。\s]*$/i.test(body));
}

export function createHttpSources(config: Config): Source[] {
  const exa: Source = {
    capability: { name: 'exa', search: true, read: true, configured: config.exa.enabled !== false && !!config.exa.apiKey, requiresLogin: true, loggedIn: !!config.exa.apiKey, requirement: notLoggedIn },
    async search(request) {
      const payload = { query: request.query, numResults: request.limit, type: 'auto', contents: { highlights: { maxCharacters: 1200 } }, ...(request.domains?.length ? { includeDomains: request.domains } : {}), ...(request.since ? { startPublishedDate: request.since } : {}) };
      const data = await json(endpoint(config.exa, 'https://api.exa.ai/', 'search'), { method: 'POST', headers: apiHeaders(config.exa, 'x-api-key'), body: JSON.stringify(payload), signal: request.signal }, 'Exa');
      return rows(data.results, 'Exa').flatMap((item) => hit('exa', { title: string(item.title), url: string(item.url), snippet: Array.isArray(item.highlights) ? item.highlights.filter((v) => typeof v === 'string').join('\n') : string(item.text) || string(item.summary), publishedAt: date(item.publishedDate) })).slice(0, request.limit);
    },
    async read(url, signal) {
      const data = await json(endpoint(config.exa, 'https://api.exa.ai/', 'contents'), { method: 'POST', headers: apiHeaders(config.exa, 'x-api-key'), body: JSON.stringify({ urls: [url], text: true, maxAgeHours: 0 }), signal }, 'Exa');
      const item = rows(data.results, 'Exa').find((row) => row.url === url) ?? rows(data.results, 'Exa')[0];
      if (!item) throw new Error('Exa 未获取到该链接的正文');
      return document('exa', string(item.url) || url, string(item.title), item.text, { publishedAt: date(item.publishedDate) });
    },
  };
  const tavily: Source = {
    capability: { name: 'tavily', search: true, read: true, configured: config.tavily.enabled !== false && !!config.tavily.apiKey, requiresLogin: true, loggedIn: !!config.tavily.apiKey, requirement: notLoggedIn },
    async search(request) {
      const payload = { query: request.query, max_results: Math.min(request.limit, 20), search_depth: 'basic', include_answer: false, include_raw_content: false, include_published_date: true, ...(request.domains?.length ? { include_domains: request.domains } : {}), ...(request.since ? { start_date: request.since.slice(0, 10), filter_by_published_date: true } : {}) };
      const data = await json(endpoint(config.tavily, 'https://api.tavily.com/', 'search'), { method: 'POST', headers: apiHeaders(config.tavily, 'Authorization', true), body: JSON.stringify(payload), signal: request.signal }, 'Tavily');
      return rows(data.results, 'Tavily').flatMap((item) => hit('tavily', { title: string(item.title), url: string(item.url), snippet: string(item.content), publishedAt: date(item.published_date) })).slice(0, request.limit);
    },
    async read(url, signal) {
      const data = await json(endpoint(config.tavily, 'https://api.tavily.com/', 'extract'), { method: 'POST', headers: apiHeaders(config.tavily, 'Authorization', true), body: JSON.stringify({ urls: [url], format: 'markdown', extract_depth: 'basic' }), signal }, 'Tavily');
      const item = rows(data.results, 'Tavily').find((row) => row.url === url) ?? rows(data.results, 'Tavily')[0];
      if (!item) throw new Error('Tavily 未获取到该链接的正文，请检查 failed_results 或换用其他读取来源');
      return document('tavily', string(item.url) || url, string(item.title), item.raw_content, { publishedAt: date(item.published_date) });
    },
  };
  const brave: Source = {
    capability: { name: 'brave', search: true, read: false, configured: config.brave.enabled !== false && !!config.brave.apiKey, requiresLogin: true, loggedIn: !!config.brave.apiKey, requirement: notLoggedIn },
    async search(request) {
      const url = endpoint(config.brave, 'https://api.search.brave.com/', 'res/v1/web/search');
      const domainQuery = request.domains?.length ? ` (${request.domains.map((domain) => `site:${domain}`).join(' OR ')})` : '';
      url.searchParams.set('q', `${request.query}${domainQuery}`);
      url.searchParams.set('count', String(Math.min(request.limit, 20)));
      url.searchParams.set('extra_snippets', 'true');
      if (request.since) url.searchParams.set('freshness', `${request.since.slice(0, 10)}to${new Date().toISOString().slice(0, 10)}`);
      const data = await json(url, { headers: { 'X-Subscription-Token': config.brave.apiKey ?? '', Accept: 'application/json' }, signal: request.signal }, 'Brave');
      if (data.web === undefined) return [];
      return rows(object(data.web, 'Brave').results, 'Brave').flatMap((item) => hit('brave', { title: string(item.title), url: string(item.url), snippet: [string(item.description), ...(Array.isArray(item.extra_snippets) ? item.extra_snippets.filter((v) => typeof v === 'string') : [])].join('\n'), metadata: { pageAge: item.page_age, age: item.age } })).slice(0, request.limit);
    },
  };
  const bilibili: Source = {
    capability: { name: 'bilibili', search: true, read: true, configured: config.bilibili.enabled !== false, platforms: ['bilibili'], requirement: '公开搜索和视频元数据，字幕需另选平台后端' },
    async search(request) {
      if (!permitted(request.domains, 'www.bilibili.com')) return [];
      const url = endpoint(config.bilibili, 'https://api.bilibili.com/', 'x/web-interface/search/all/v2');
      url.searchParams.set('keyword', request.query);
      url.searchParams.set('page', '1');
      const data = await json(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' }, signal: request.signal }, 'B站');
      if (data.code !== 0) throw new Error(`B站搜索失败，API code=${String(data.code)}`);
      const groups = rows(object(data.data, 'B站').result, 'B站');
      return groups.filter((group) => group.result_type === 'video').flatMap((group) => rows(group.data, 'B站视频')).filter((item) => !request.since || (epoch(item.pubdate) ?? '') >= request.since).flatMap((item) => hit('bilibili', {
        title: string(item.title), url: string(item.bvid) ? `https://www.bilibili.com/video/${string(item.bvid)}` : string(item.arcurl), snippet: string(item.description), publishedAt: epoch(item.pubdate), metadata: { author: item.author, bvid: item.bvid },
      })).slice(0, request.limit);
    },
    async read(url, signal) {
      let parsed = new URL(url);
      if (parsed.hostname === 'b23.tv') parsed = new URL((await response(url, { signal }, 'B站短链接')).url);
      if (!['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'].includes(parsed.hostname)) throw new Error('B站读取需要视频链接');
      const id = parsed.pathname.match(/\/video\/(BV[\da-z]+|av\d+)/i)?.[1];
      if (!id) throw new Error('B站链接中未找到视频 ID');
      const api = endpoint(config.bilibili, 'https://api.bilibili.com/', 'x/web-interface/view');
      api.searchParams.set(id.startsWith('av') ? 'aid' : 'bvid', id.startsWith('av') ? id.slice(2) : id);
      const data = await json(api, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' }, signal }, 'B站');
      if (data.code !== 0) throw new Error(`B站详情失败，API code=${String(data.code)}`);
      const item = object(data.data, 'B站');
      if (!string(item.title)) throw new Error('B站未返回视频元数据');
      const metadata = { bvid: item.bvid, title: item.title, description: item.desc, duration: item.duration, owner: item.owner, statistics: item.stat };
      return document('bilibili', url, string(item.title), JSON.stringify(metadata, null, 2), { contentKind: 'metadata', publishedAt: epoch(item.pubdate) });
    },
  };
  const v2ex: Source = {
    capability: { name: 'v2ex', search: false, read: true, configured: config.v2ex.enabled !== false, platforms: ['v2ex'], requirement: '公开主题、节点和用户资料读取' },
    async read(url, signal) {
      const parsed = new URL(url);
      if (!['v2ex.com', 'www.v2ex.com'].includes(parsed.hostname)) throw new Error('V2EX 读取需要 v2ex.com 链接');
      const topicId = parsed.pathname.match(/^\/t\/(\d+)/)?.[1];
      const get = async (path: string): Promise<unknown> => (await response(endpoint(config.v2ex, 'https://www.v2ex.com/', path), { headers: { 'User-Agent': 'SERA' }, signal }, 'V2EX')).json();
      if (topicId) {
        const topic = rows(await get(`api/topics/show.json?id=${topicId}`), 'V2EX')[0];
        if (!topic) throw new Error('V2EX 主题不存在或未公开');
        let comments: Row[] = [];
        let commentsError: string | undefined;
        if (typeof topic.replies === 'number' && topic.replies > 0) {
          try { comments = rows(await get(`api/replies/show.json?topic_id=${topicId}&page=1`), 'V2EX 回复'); }
          catch (error) {
            if (signal.aborted) throw error;
            commentsError = error instanceof Error ? error.message : '回复读取失败';
          }
        }
        const content = string(topic.content) || plain(topic.content_rendered);
        const complete = typeof topic.replies === 'number' && comments.length >= topic.replies;
        const replyText = comments.map((item) => `${plain(object(item.member ?? {}, 'V2EX 用户').username)}：${string(item.content) || plain(item.content_rendered)}`).join('\n\n');
        return document('v2ex', url, string(topic.title), content || replyText ? `# ${plain(topic.title)}\n\n${content}\n\n${replyText}` : JSON.stringify({ title: topic.title, replies: topic.replies }, null, 2), { contentKind: content || replyText ? 'post' : 'metadata', publishedAt: epoch(topic.created), metadata: { commentsReturned: comments.length, commentsTotal: topic.replies, commentsComplete: complete, ...(commentsError ? { commentsError } : {}) } });
      }
      const node = parsed.pathname.match(/^\/go\/([^/]+)/)?.[1];
      const member = parsed.pathname.match(/^\/member\/([^/]+)/)?.[1];
      if (!node && !member && parsed.pathname !== '/') throw new Error('V2EX 读取支持公开主题、节点和用户链接');
      const item = object(await get(node ? `api/nodes/show.json?name=${encodeURIComponent(node)}` : member ? `api/members/show.json?username=${encodeURIComponent(member)}` : 'api/site/info.json'), 'V2EX');
      if (item.success === false || (node && !string(item.name)) || (member && !string(item.username)) || (!node && !member && !string(item.title))) throw new Error('V2EX 未返回有效的公开资料');
      return document('v2ex', url, string(item.title) || string(item.username) || 'V2EX', JSON.stringify(item, null, 2), { contentKind: 'metadata' });
    },
  };
  const web: Source = {
    capability: { name: 'web', search: false, read: true, configured: config.web?.enabled !== false, requirement: '公开 API 和文本直读；网页通过 Jina 或公开 HTML 读取，页面框架与正文分别标记' },
    async read(url, signal) {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('网页读取仅支持 HTTP 或 HTTPS 链接');
      const textResource = /\.(md|txt|csv|json|xml|vtt|srt)$/i.test(parsed.pathname);
      const raw = async () => {
        const page = await response(url, { signal, headers: { 'User-Agent': config.web?.userAgent ?? 'SERA page-reader', Accept: 'text/html,text/plain,application/json,application/xml' } }, '公开原文');
        const actualUrl = page.url || url;
        if (page.redirected && /\/(?:login|signin|sign-in)(?:\/|$)/i.test(new URL(actualUrl).pathname)) throw new NotLoggedInError();
        const type = page.headers.get('content-type') ?? '';
        if (!/text\/|json|xml/.test(type) && !textResource) { await page.body?.cancel(); throw new Error('该资源需要对应的内容读取来源'); }
        const decoded = await textResponse(page), text = decoded.text;
        const html = /html/i.test(type);
        const title = html ? text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? url : url;
        const content = html ? htmlText(text, actualUrl) : text;
        if (/json/i.test(type) || /\.json$/i.test(parsed.pathname)) {
          try { JSON.parse(text); } catch { throw Object.assign(new Error('公开 API 未返回有效 JSON'), { code: 'CONTENT_INVALID' }); }
        }
        const body = html ? htmlText((text.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? text)
          .replace(/<(?:head|header|nav|footer)\b[^>]*>[\s\S]*?<\/(?:head|header|nav|footer)>/gi, ''), actualUrl) : content;
        const bodyAvailable = !html || hasBody(title, body);
        return document('web', actualUrl, title, content || plain(title), {
          contentKind: /\.(vtt|srt)$/i.test(parsed.pathname) ? 'subtitle' : /json|xml|text\/csv/i.test(type) || /\.(csv|json|xml)$/i.test(parsed.pathname) ? 'metadata' : 'page',
          metadata: { extraction: html ? 'html-source-text' : 'direct-text', contentScope: bodyAvailable ? 'server-returned-text' : 'page-shell', bodyAvailable, renderedScripts: false, encoding: decoded.encoding, ...(page.redirected ? { requestedUrl: url } : {}) },
        });
      };
      if (textResource || parsed.hostname.startsWith('api.') || /(?:^|\/)api(?:\/|$)/i.test(parsed.pathname) || ['format', 'output', 'f'].some(key => parsed.searchParams.get(key) === 'json')) return raw();
      let shell: Document | undefined, readerError: unknown;
      try {
        const result = await response(`${(config.web?.baseUrl ?? 'https://r.jina.ai/').replace(/\/$/, '')}/${url}`, { headers: { Accept: 'application/json' }, signal }, 'Jina Reader');
        let title: string, content: string, actualUrl = url, warning: unknown;
        if (result.headers.get('content-type')?.includes('application/json')) {
          const data = object(object(await result.json(), 'Jina Reader').data, 'Jina Reader');
          actualUrl = string(data.url) || url; title = string(data.title); content = string(data.content); warning = data.warning;
          if (actualUrl !== url && /\/(?:login|signin|sign-in)(?:\/|$)/i.test(new URL(actualUrl).pathname)) throw new NotLoggedInError();
        } else {
          const text = await result.text(), marker = 'Markdown Content:', start = text.indexOf(marker);
          if (start < 0) throw new Error('Jina Reader 未返回可识别的正文');
          title = text.match(/^Title: (.*)$/m)?.[1] ?? ''; content = text.slice(start + marker.length).replace(/^\r?\n(?:\r?\n)?/, '');
        }
        const bodyAvailable = hasBody(title, content);
        const page = document('web', actualUrl, title, content || title, { metadata: { extraction: 'jina-reader', contentScope: bodyAvailable ? 'server-returned-text' : 'page-shell', bodyAvailable, ...(warning ? { warning } : {}) } });
        if (bodyAvailable) return page;
        shell = page;
      } catch (error) { if (signal.aborted) throw error; readerError = error; }
      try {
        const page = await raw();
        if (readerError) page.metadata = { ...page.metadata, readerFallbackCode: (readerError as { code?: string }).code ?? 'READER_FAILED' };
        return page;
      } catch (error) { if (signal.aborted || !shell) throw error; return { ...shell, metadata: { ...shell.metadata, fallbackCode: (error as { code?: string }).code ?? 'READ_FAILED' } }; }
    },
  };
  return [exa, tavily, brave, github(config.github), bilibili, v2ex, web];
}
