import { createHash, randomBytes } from 'node:crypto';
import type { ApiConfig, Comment, Config, Source } from '../types.js';
import { NotLoggedInError } from '../credentials.js';
import { date, document, endpoint, epoch, hit, json, object, permitted, plain, rows, string } from './shared.js';
import type { Row } from './shared.js';
import { createDiscoverySources } from './discovery.js';

function numericId(value: unknown, name: string): string {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : string(value);
  if (!/^[1-9]\d*$/.test(id)) throw new Error(`${name} 需要有效数字 ID`);
  return id;
}

function topicUrl(value: string, config: ApiConfig) {
  const url = new URL(value), parts = url.pathname.replace(/\.json\/?$/, '').split('/').filter(Boolean);
  const hosts = ['linux.do', ...(config.baseUrl ? [new URL(config.baseUrl).hostname] : [])];
  if (!['http:', 'https:'].includes(url.protocol) || !hosts.includes(url.hostname) || parts.shift() !== 't') throw new Error('LinuxDo 需要主题或楼层链接');
  if (parts[0] && !/^\d+$/.test(parts[0])) parts.shift();
  if (parts.length < 1 || parts.length > 2) throw new Error('LinuxDo 需要主题或楼层链接');
  return { topicId: numericId(parts[0], 'LinuxDo 主题'), postNumber: parts[1] ? Number(numericId(parts[1], 'LinuxDo 楼层')) : undefined };
}

function linuxdo(config: ApiConfig): Source {
  const get = async (path: string | URL, params: Record<string, string>, signal: AbortSignal) => {
    const url = path instanceof URL ? path : endpoint(config, 'https://linux.do/', path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return json(url, { headers: { Accept: 'application/json', 'User-Agent': config.userAgent ?? 'SERA forum-search',
      ...(config.apiKey ? { 'Api-Key': config.apiKey } : {}), ...(config.username ? { 'Api-Username': config.username } : {}) }, signal }, 'LinuxDo');
  };
  const posts = async (topicId: string, ids: string[], signal: AbortSignal) => {
    const url = endpoint(config, 'https://linux.do/', `t/${topicId}/posts.json`);
    url.searchParams.set('include_raw', 'true');
    for (const id of ids) url.searchParams.append('post_ids[]', id);
    const data = await get(url, {}, signal);
    return rows(object(data.post_stream, 'LinuxDo 楼层流').posts, 'LinuxDo 楼层');
  };
  return {
    capability: { name: 'linuxdo', search: true, read: true, comments: true, configured: config.enabled !== false, category: 'catalog',
      requiresLogin: false, loggedIn: Boolean(config.apiKey), platforms: ['posts'], requirement: 'Discourse 原生搜索、主题和楼层；可选 Api-Key / Api-Username，权限以站点响应为准' },
    async search(request) {
      const data = await get('search.json', { q: request.query + (request.since ? ` after:${request.since}` : '') }, request.signal);
      const topics = rows(data.topics, 'LinuxDo 搜索主题');
      return rows(data.posts, 'LinuxDo 搜索帖子').flatMap(post => {
        const topic = topics.find(item => item.id === post.topic_id);
        if (!topic) return [];
        const topicId = numericId(topic.id, 'LinuxDo 主题'), postNumber = numericId(post.post_number, 'LinuxDo 楼层');
        const url = `https://linux.do/t/${encodeURIComponent(string(topic.slug) || '-')}/${topicId}/${postNumber}`;
        if (!permitted(request.domains, 'linux.do')) return [];
        return hit('linuxdo', { title: string(topic.title), url, snippet: string(post.blurb) || plain(post.cooked), publishedAt: date(post.created_at),
          metadata: { topicId, postId: post.id, postNumber: Number(postNumber), contentScope: 'matched-post-excerpt' } });
      }).slice(0, request.limit);
    },
    async read(url, signal) {
      const { topicId, postNumber } = topicUrl(url, config);
      const data = await get(`t/${topicId}${postNumber ? '/' + postNumber : ''}.json`, { include_raw: 'true' }, signal);
      const post = rows(object(data.post_stream, 'LinuxDo 楼层流').posts, 'LinuxDo 楼层').find(item => item.post_number === (postNumber ?? 1));
      if (!post) throw new Error('LinuxDo 未返回指定楼层正文');
      return document('linuxdo', url, string(data.title), typeof post.raw === 'string' ? post.raw : string(post.cooked), {
        contentKind: 'post', publishedAt: date(post.created_at), metadata: { topicId, postId: post.id, postNumber: post.post_number,
          author: post.username, format: typeof post.raw === 'string' ? 'markdown' : 'html', contentScope: 'single-topic-post' } });
    },
    async comments(request) {
      if (request.order && !['default', 'oldest'].includes(request.order)) throw new Error('LinuxDo 楼层分页按主题顺序返回，order 支持 oldest');
      const { topicId } = topicUrl(request.url, config);
      const offset = request.cursor ? Number(request.cursor) : 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || request.cursor && !/^\d+$/.test(request.cursor)) throw new Error('LinuxDo 评论游标需要非负整数');
      const topic = await get(`t/${topicId}.json`, { include_raw: 'true' }, request.signal), stream = object(topic.post_stream, 'LinuxDo 楼层流');
      const initial = rows(stream.posts, 'LinuxDo 楼层'), first = initial.find(post => post.post_number === 1);
      if (!first || !Array.isArray(stream.stream)) throw new Error('LinuxDo 未返回完整楼层 ID 流');
      const rootId = numericId(first.id, 'LinuxDo 主帖'), ids = stream.stream.map(value => numericId(value, 'LinuxDo 楼层')).filter(id => id !== rootId);
      const selected = ids.slice(offset, offset + Math.min(request.limit, 100));
      const batch = selected.length ? await posts(topicId, selected, request.signal) : [];
      const parentId = request.parentId ? numericId(request.parentId, 'LinuxDo 父楼层') : undefined;
      const parent = parentId ? [...initial, ...batch].find(post => String(post.id) === parentId) ?? (await posts(topicId, [parentId], request.signal))[0] : undefined;
      if (parentId && (!parent || String(parent.id) !== parentId)) throw new Error('LinuxDo 该父楼层不属于主题或当前不可见');
      const known = [...initial, ...batch, ...(parent ? [parent] : [])];
      const ordered = selected.flatMap(id => batch.filter(post => String(post.id) === id));
      const comments: Comment[] = ordered.filter(post => !parent || post.reply_to_post_number === parent.post_number || parent.post_number === 1 && !post.reply_to_post_number).map(post => {
        const replying = known.find(item => item.post_number === (post.reply_to_post_number || 1));
        return { id: numericId(post.id, 'LinuxDo 评论'), rootId, ...(replying ? { parentId: String(replying.id) } : {}),
          text: typeof post.raw === 'string' ? post.raw : string(post.cooked), author: string(post.username), publishedAt: date(post.created_at),
          likes: typeof post.like_count === 'number' ? post.like_count : undefined, url: `https://linux.do/t/-/${topicId}/${post.post_number}` };
      });
      const next = offset + selected.length;
      return { url: request.url, scope: parent ? 'direct-replies' : 'topic-replies', comments, nextCursor: next < ids.length ? String(next) : undefined,
        metadata: { topicId, scannedPosts: selected.length, totalReplyIds: ids.length, format: 'raw-markdown-or-cooked-html',
          replyToPostNumbers: Object.fromEntries(ordered.map(post => [String(post.id), post.reply_to_post_number ?? 1])) } };
    },
  };
}

function heyboxPost(value: string): string {
  const url = new URL(value), match = url.pathname.match(/^\/app\/bbs\/link\/([\da-f]+)\/?$/i);
  if (!['http:', 'https:'].includes(url.protocol) || !['xiaoheihe.cn', 'www.xiaoheihe.cn'].includes(url.hostname) || !match
    || !(/^\d+$/.test(match[1]!) || /^[\da-f]{12}$/i.test(match[1]!))) throw new Error('小黑盒需要 xiaoheihe.cn/app/bbs/link/ 下的帖子链接');
  return match[1]!;
}

// 官网 website 1.2.64 的 eSe/Tr GET 签名；升级接口时核对官网 bundle 的参数与字符映射。
function heyboxSignature(path: string, time: number, nonce: string): string {
  const alphabet = 'AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89';
  const mapped = (value: string, chars: string) => [...value].map(char => chars[char.charCodeAt(0) % chars.length]).join('');
  const values = [mapped(String(time + 1), alphabet.slice(0, -2)), mapped('/' + path.split('/').filter(Boolean).join('/') + '/', alphabet), mapped(nonce, alphabet)];
  let interleaved = '';
  for (let index = 0; interleaved.length < 20; index++) for (const value of values) interleaved += value[index] ?? '';
  const md5 = createHash('md5').update(interleaved.slice(0, 20)).digest('hex'), bytes = [...md5.slice(-6)].map(char => char.charCodeAt(0));
  const double = (value: number) => value & 128 ? (value << 1 ^ 27) & 255 : value << 1;
  const triple = (value: number) => double(value) ^ value;
  const six = (value: number) => triple(double(value));
  const twenty = (value: number) => six(triple(double(value)));
  const mixed = (value: number) => twenty(value) ^ six(value) ^ triple(value);
  const [a, b, c, d] = bytes as [number, number, number, number, number, number];
  const sum = (mixed(a) ^ twenty(b) ^ six(c) ^ triple(d)) + (triple(a) ^ mixed(b) ^ twenty(c) ^ six(d))
    + (six(a) ^ triple(b) ^ mixed(c) ^ twenty(d)) + (twenty(a) ^ six(b) ^ triple(c) ^ mixed(d)) + bytes[4]! + bytes[5]!;
  return mapped(md5.slice(0, 5), alphabet.slice(0, -4)) + String(sum % 100).padStart(2, '0');
}

function heybox(config: Config): Source {
  const api = config.heybox ?? {};
  const get = async (path: string, params: Record<string, string>, signal: AbortSignal, url: string) => {
    const target = endpoint(api, 'https://api.xiaoheihe.cn/', path), time = Math.floor(Date.now() / 1000), nonce = randomBytes(16).toString('hex').toUpperCase();
    for (const [key, value] of Object.entries({ app: 'heybox', os_type: 'web', x_app: 'heybox_website', x_client_type: 'weboutapp', x_os_type: 'Windows', web_version: '3',
      version: '999.0.4', hkey: heyboxSignature('/' + path, time, nonce), _time: String(time), nonce, ...params })) target.searchParams.set(key, value);
    const data = await json(target, { headers: { Accept: 'application/json', 'User-Agent': api.userAgent ?? 'SERA forum-search', Referer: url,
      ...(api.apiKey ? { Cookie: api.apiKey } : {}) }, signal }, '小黑盒');
    if (['login', 'relogin'].includes(string(data.status))) throw new NotLoggedInError();
    if (data.status !== 'ok') throw Object.assign(new Error(`小黑盒接口 ${string(data.status) || '响应状态缺失'}：${string(data.msg) || '未取得内容'}`), {
      code: ['lack_token', 'show_captcha'].includes(string(data.status)) ? 'PLATFORM_BLOCKED' : `HEYBOX_${string(data.status).toUpperCase() || 'INVALID_RESPONSE'}` });
    return object(data.result, '小黑盒');
  };
  const comment = (item: Row, url: string, rootId?: string): Comment => ({ id: numericId(item.commentid, '小黑盒评论'), text: string(item.text),
    author: item.user && typeof item.user === 'object' ? string((item.user as Row).username) : undefined, publishedAt: epoch(item.create_at),
    likes: typeof item.up === 'number' ? item.up : undefined, replyCount: typeof item.child_num === 'number' ? item.child_num : undefined,
    url: `${url.split('?')[0]}?comment_id=${item.commentid}${rootId ? '&root_comment_id=' + rootId : ''}`,
    ...(rootId ? { rootId, parentId: item.replyid ? numericId(item.replyid, '小黑盒被回复评论') : rootId } : {}) });
  return {
    capability: { name: 'heybox', search: true, read: true, comments: true, configured: api.enabled !== false, category: 'catalog', requiresLogin: false,
      loggedIn: Boolean(api.apiKey), platforms: ['posts'], requirement: 'Bing 发现真实帖子；官网原生帖子及楼层接口，可选 apiKey 保存完整网站 Cookie，访问范围以站点响应为准' },
    async search(request) {
      const bing = createDiscoverySources(config).find(source => source.capability.name === 'bing')!;
      return (await bing.search!({ ...request, query: request.query + ' site:xiaoheihe.cn/app/bbs/link/', domains: ['xiaoheihe.cn'] })).filter(item => {
        try { heyboxPost(item.url); return permitted(request.domains, new URL(item.url).hostname); } catch { return false; }
      }).map(item => ({ ...item, source: 'heybox' as const, metadata: { ...item.metadata, discoveryBackend: 'bing', contentScope: 'indexed-post-excerpt' } }));
    },
    async read(url, signal) {
      const result = await get('bbs/app/link/tree', { link_id: heyboxPost(url), is_first: '1', page: '1', index: '1', limit: '1', owner_only: '0' }, signal, url);
      const link = object(result.link, '小黑盒帖子');
      if (!string(link.text).trim() && link.has_video !== 1 && !(Array.isArray(link.imgs) && link.imgs.length)) throw new Error('小黑盒未返回帖子正文');
      return document('heybox', url, string(link.title), JSON.stringify(link, null, 2), { contentKind: 'post', publishedAt: epoch(link.create_at),
        metadata: { postId: link.linkid, format: 'native-post-json', contentScope: 'single-post' } });
    },
    async comments(request) {
      const postId = heyboxPost(request.url);
      if (request.order && request.order !== 'default') throw new Error('小黑盒当前按官网默认楼层顺序返回评论');
      if (request.parentId) {
        const rootId = numericId(request.parentId, '小黑盒根评论'), cursor = request.cursor ? numericId(request.cursor, '小黑盒子评论游标') : '';
        const result = await get('bbs/app/comment/sub/comments', { root_comment_id: rootId, lastval: cursor }, request.signal, request.url);
        const items = rows(result.comments, '小黑盒子评论'), selected = items.slice(0, request.limit), more = items.length > selected.length || Boolean(result.has_more);
        if (more && !selected.length) throw new Error('小黑盒返回了更多回复标记，但缺少可继续分页的评论');
        return { url: request.url, scope: 'replies', comments: selected.map(item => comment(item, request.url, rootId)),
          nextCursor: more ? numericId(selected.at(-1)!.commentid, '小黑盒子评论') : undefined, metadata: { postId, rootId } };
      }
      const cursor = request.cursor?.match(/^([1-9]\d*):(\d+)$/), page = cursor ? Number(cursor[1]) : 1, offset = cursor ? Number(cursor[2]) : 0;
      if (request.cursor && !cursor || !Number.isSafeInteger(page) || !Number.isSafeInteger(offset)) throw new Error('小黑盒楼层游标需要 页码:页内偏移');
      const result = await get('bbs/app/link/tree', { link_id: postId, is_first: page === 1 ? '1' : '0', page: String(page), index: '1', limit: '20', owner_only: '0' }, request.signal, request.url);
      const items = rows(result.comments, '小黑盒评论楼层').map(group => rows(group.comment, '小黑盒评论楼层内容')[0]);
      if (items.some(item => !item)) throw new Error('小黑盒返回了没有根评论的楼层');
      const selected = (items as Row[]).slice(offset, offset + request.limit), next = offset + selected.length;
      const more = Boolean(result.has_more_floors) || Boolean(result.has_more) || typeof result.total_page === 'number' && page < result.total_page;
      if (more && !items.length) throw new Error('小黑盒返回了更多楼层标记，但当前页缺少评论');
      return { url: request.url, scope: 'top-level', comments: selected.map(item => comment(item, request.url)),
        nextCursor: next < items.length ? `${page}:${next}` : more ? `${page + 1}:0` : undefined, metadata: { postId, page, totalFloors: result.total_floor_num } };
    },
  };
}

export function createForumSources(config: Config): Source[] {
  return [linuxdo(config.linuxdo ?? {}), heybox(config)];
}
