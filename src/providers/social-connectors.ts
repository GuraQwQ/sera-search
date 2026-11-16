import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { z } from 'zod';
import type { AccessPolicy, Config, Document, ReadOptions, SearchHit, SearchRequest, Source } from '../types.js';
import { createStructuredSource } from '../connectors.js';
import type { ConnectorDefinition, ConnectorOperation, StructuredClient } from '../connectors.js';
import { sourceConfig } from '../source-config.js';
import { date, decoded, document, hit, object, plain, rows, string, textResponse } from './shared.js';
import type { Row } from './shared.js';
import { reportCoverage } from './operations.js';

const qqNumber = z.string().regex(/^[1-9]\d{4,14}$/), offset = z.number().int().nonnegative().default(0);
const text = z.string().trim().min(1).max(512), publicAccess: AccessPolicy = { authentication: 'none', billing: 'free' };
const browserAccess: AccessPolicy = { authentication: 'session', billing: 'free' };
const op = (description: string, types: string[], schema: z.ZodType, access?: AccessPolicy): ConnectorOperation => ({ description, content_types: types, input_schema: z.toJSONSchema(schema), ...(access ? { access } : {}) });
const articleUrl = z.string().url().refine(value => new URL(value).hostname === 'mp.weixin.qq.com', '需要微信公众号文章或历史页链接');

export const socialDefinitions: ConnectorDefinition[] = [
  { id: 'qq-avatar', type: 'custom', base_url: 'https://q1.qlogo.cn/', label: '已知 QQ 号的公开头像资源', access: publicAccess,
    operations: { lookup: op('取得指定 QQ 号头像并验证图片、大小和哈希', ['avatar-metadata'], z.strictObject({ qq: qqNumber.optional(), size: z.enum(['40', '100', '140', '640']).default('100') })) },
    limitations: ['头像成功或默认头像不证明账号存在、身份、活跃状态；仅按已知 QQ 号读取资源。'] },
  { id: 'qq-group-avatar', type: 'custom', base_url: 'https://p.qlogo.cn/', label: '已知 QQ 群号的公开头像资源', access: publicAccess,
    operations: { lookup: op('取得指定群号的头像并验证图片元数据', ['avatar-metadata'], z.strictObject({ group: qqNumber.optional(), size: z.enum(['40', '100', '140', '640']).default('100') })) },
    limitations: ['群头像不等同于群公开资料；默认头像或资源响应不证明群存在、可加入或具有特定成员。'] },
  { id: 'qq-public-profile', type: 'custom', base_url: 'https://user.qzone.qq.com/', label: '指定 QQ 空间当前可见的页面元数据', access: { authentication: 'optional', billing: 'free' },
    operations: { profile: op('按已知 QQ 号读取当前可见昵称和空间元数据；可选择现有浏览器会话', ['account-metadata'], z.strictObject({ qq: qqNumber.optional(), browser: z.boolean().default(false) })) },
    limitations: ['仅保留实际可见字段；空间访问权限和浏览器会话影响结果，未取到不能推出账号不存在。'] },
  { id: 'qq-portrait-legacy', type: 'custom', base_url: 'https://users.qzone.qq.com/', label: '实验性 QQ portrait 昵称读取', access: publicAccess,
    operations: { portrait: op('按已知 QQ 号解析旧 portrait JSONP 的实际返回字段', ['account-metadata'], z.strictObject({ qq: qqNumber.optional() })) },
    limitations: ['旧接口没有稳定开放契约；昵称字段仅在实际返回对应位置时提供；不表示完整资料或账号身份确认。'] },
  { id: 'wechat-official-account', type: 'custom', base_url: 'https://weixin.sogou.com/', label: '微信公众号定位和页面可见认证信息', access: { authentication: 'optional', billing: 'free' },
    operations: { 'discover-accounts': op('通过搜狗公众号结果页按名称或微信号定位候选账号', ['official-account'], z.strictObject({ page: z.number().int().min(1).max(100).default(1), resultOffset: offset })),
      profile: op('从已知公众号文章或主页读取实际可见账号字段与认证文字', ['official-account'], z.strictObject({ url: articleUrl }), browserAccess) },
    limitations: ['需要配置现有 OpenCLI 原生入口及 Browser Bridge；复用现有会话，不主动发起登录。', '公众号名可能重名；认证只保留页面当前展示文字，未取得不视为未认证。'] },
  { id: 'wechat-article-history', type: 'custom', base_url: 'https://api.weixin.qq.com/', label: '公众号公开文章发现和已取得历史页', access: { authentication: 'optional', billing: 'free' },
    operations: { 'discover-articles': op('复用 OpenCLI 搜狗文章发现；按公众号名限定查询但不声称完整历史', ['article'], z.strictObject({ accountName: text.optional(), page: z.number().int().min(1).max(100).default(1), resultOffset: offset })),
      'history-page': op('从指定文章或公众号主页取得当前实际渲染的历史文章链接', ['article'], z.strictObject({ url: articleUrl, scrolls: z.number().int().min(0).max(5).default(0), resultOffset: offset }), browserAccess),
      'authorized-published': op('使用自己授权公众号的 access_token 分页获取已发表记录', ['article'], z.strictObject({ offset, resultOffset: offset }), { authentication: 'api-key', billing: 'free-quota', quota: '微信接口当前账号额度与权限', evidence: 'https://developers.weixin.qq.com/doc/offiaccount/Publish/GetPublicationRecords.html' }) },
    limitations: ['公开发现、浏览器会话可见列表、自己授权账号 API 分别报告；任一路径都不承诺任意公众号全部历史。', '历史页只报告实际取得的链接、日期和页内范围；账号限制、删除文章与验证码均可能造成缺口。'] },
];

type OpenCliRunner = (args: string[], signal: AbortSignal) => Promise<unknown>;
export interface SocialConnectorDependencies { opencli?: OpenCliRunner }
function failure(message: string, code = 'CONTENT_MISMATCH') { return Object.assign(new Error(message), { code }); }
function canonical(value: string) { const url = new URL(value); url.hash = ''; return url.href; }
function report(request: SearchRequest, scope: string, nextCursor?: string, limitations?: string[]) {
  return reportCoverage(request, scope, { completeness: 'partial', ...(nextCursor ? { nextCursor, truncated: true } : { truncated: false }), limitations });
}
function selected(request: SearchRequest, values: SearchHit[]) {
  return values.filter(item => !request.domains?.length || request.domains.some(domain => new URL(item.url).hostname === domain || new URL(item.url).hostname.endsWith(`.${domain}`)))
    .filter(item => (!request.since || !item.publishedAt || item.publishedAt.slice(0, 10) >= request.since) && (!request.until || !item.publishedAt || item.publishedAt.slice(0, 10) <= request.until)).slice(0, request.limit);
}
async function imageMetadata(result: Response) {
  const contentType = result.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (!contentType?.startsWith('image/')) throw failure('头像端点没有返回图片', 'BAD_CONTENT_TYPE');
  const reader = result.body?.getReader(); if (!reader) throw failure('头像响应没有图片内容', 'EMPTY_BODY');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4 * 1024 * 1024) throw failure('头像图片超过 4 MiB', 'RESPONSE_BUDGET'); chunks.push(part.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const data = Buffer.concat(chunks), signature = data.subarray(0, 12);
  const format = signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : signature[0] === 255 && signature[1] === 216 && signature[2] === 255 ? 'jpeg'
    : /^GIF8[79]a/.test(signature.toString('ascii')) ? 'gif' : signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : undefined;
  if (!format || !size) throw failure('头像响应缺少支持的图片文件头', 'BAD_IMAGE');
  return { contentType, format, bytes: size, sha256: createHash('sha256').update(data).digest('hex'), retrievedAt: new Date().toISOString(), accountExistence: 'unknown' };
}

function avatar(config: Config, definition: ConnectorDefinition, group = false): Source {
  const parts = (identity: string, size: string) => group ? { path: `gh/${identity}/${identity}/${size}/`, query: {}, url: `https://p.qlogo.cn/gh/${identity}/${identity}/${size}/` }
    : { path: 'g', query: { b: 'qq', nk: identity, s: size }, url: `https://q1.qlogo.cn/g?b=qq&nk=${identity}&s=${size}` };
  const load = async (identity: string, size: string, signal: AbortSignal, client: StructuredClient) => { const spec = parts(identity, size), metadata = await imageMetadata(await client(spec.path, signal, spec.query, undefined, 'response'));
    return document(definition.id, spec.url, `${group ? '群' : 'QQ'} ${identity} 头像`, JSON.stringify({ ...metadata, imageUrl: spec.url }, null, 2),
      { contentKind: 'metadata', locator: { kind: 'record', id: `${identity}:${size}` }, metadata: { ...metadata, imageUrl: spec.url, contentScope: 'avatar-resource', limitations: definition.limitations } }); };
  return createStructuredSource(config, definition, { search: { lookup: async (request, params, client) => { const identity = qqNumber.parse(params[group ? 'group' : 'qq'] ?? request.query), value = await load(identity, params.size, request.signal, client);
    report(request, 'known-identifier-avatar', undefined, definition.limitations); return selected(request, hit(definition.id, { title: value.title, url: value.url, snippet: `${value.metadata!.contentType} · ${value.metadata!.bytes} bytes · SHA-256 ${value.metadata!.sha256}`, locator: value.locator, metadata: value.metadata })); } },
    read: async (url, signal, _options, client) => { const parsed = new URL(url), match = group && parsed.hostname === 'p.qlogo.cn' ? parsed.pathname.match(/^\/gh\/(\d+)\/\1\/(40|100|140|640)\/?$/) : undefined;
      const identity = group ? match?.[1] : parsed.hostname === 'q1.qlogo.cn' ? parsed.searchParams.get('nk') : undefined, size = group ? match?.[2] : parsed.searchParams.get('s');
      if (!identity || !size || !['40', '100', '140', '640'].includes(size)) throw new Error('头像读取需要本来源的号码与尺寸链接'); return load(qqNumber.parse(identity), size, signal, client); } });
}

function portrait(config: Config, definition: ConnectorDefinition): Source {
  const load = async (identity: string, signal: AbortSignal, client: StructuredClient) => {
    const result: Response = await client('fcg-bin/cgi_get_portrait.fcg', signal, { uins: identity }, undefined, 'response'), decodedResponse = await textResponse(result);
    const match = decodedResponse.text.trim().match(/^[\w$.]+\s*\(\s*([\s\S]*)\s*\)\s*;?$/);
    if (!match) throw failure('QQ portrait 未返回可解析的 JSONP', 'BAD_RESPONSE');
    let value: unknown; try { value = JSON.parse(match[1]!); } catch { throw failure('QQ portrait JSONP 参数不是有效 JSON', 'BAD_RESPONSE'); }
    const response = object(value, 'QQ portrait'), raw = response[identity]; if (!Array.isArray(raw)) throw failure('QQ portrait 未返回请求号码的记录', 'NOT_FOUND');
    const fields = { rawFields: raw, ...(typeof raw[6] === 'string' ? { nickname: raw[6] } : {}), ...(typeof raw[0] === 'string' && /^https?:\/\//.test(raw[0]) ? { avatarUrl: raw[0] } : {}), encoding: decodedResponse.encoding };
    return document(definition.id, `https://users.qzone.qq.com/fcg-bin/cgi_get_portrait.fcg?uins=${identity}`, `QQ ${identity} portrait`, JSON.stringify(fields, null, 2), { contentKind: 'metadata', locator: { kind: 'record', id: identity }, metadata: { ...fields, experimental: true, limitations: definition.limitations } });
  };
  return createStructuredSource(config, definition, { search: { portrait: async (request, params, client) => { const identity = qqNumber.parse(params.qq ?? request.query), value = await load(identity, request.signal, client);
    report(request, 'qq:legacy-portrait', undefined, definition.limitations); return selected(request, hit(definition.id, { title: string(value.metadata!.nickname) || value.title, url: value.url, snippet: JSON.stringify(value.metadata!.rawFields), locator: value.locator, metadata: value.metadata })); } },
    read: async (url, signal, _options, client) => { const parsed = new URL(url); if (parsed.hostname !== 'users.qzone.qq.com' || parsed.pathname !== '/fcg-bin/cgi_get_portrait.fcg') throw new Error('portrait 读取需要对应旧接口链接'); return load(qqNumber.parse(parsed.searchParams.get('uins')), signal, client); } });
}

function runOpenCli(config: Config): OpenCliRunner {
  return async (args, signal) => {
    const command = config.opencli;
    if (!command || command.enabled === false) throw failure('请配置现有 OpenCLI 入口与 Browser Bridge', 'NEED_SETUP');
    if (/\.(cmd|bat|ps1)$/i.test(command.command)) throw failure('OpenCLI 请配置原生入口，例如 node 与 CLI 文件参数', 'BAD_COMMAND');
    signal.throwIfAborted();
    const stdout = await new Promise<string>((accept, reject) => {
      const child = spawn(command.command, [...command.args, ...args], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, OPENCLI_CONFIG_DIR: process.env.OPENCLI_CONFIG_DIR ?? join(config.home, 'opencli'), OPENCLI_CACHE_DIR: process.env.OPENCLI_CACHE_DIR ?? join(config.home, 'opencli', 'cache') } });
      const chunks: Buffer[] = []; let size = 0, failed: Error | undefined;
      const cancel = () => child.kill(); signal.addEventListener('abort', cancel, { once: true });
      child.stdout.on('data', (data: Buffer) => { size += data.length; if (size > 4 * 1024 * 1024) { failed = failure('OpenCLI 输出超过 4 MiB', 'RESPONSE_BUDGET'); child.kill(); } else chunks.push(data); });
      child.stderr.resume(); child.on('error', error => { failed = error; });
      child.on('close', code => { signal.removeEventListener('abort', cancel); if (signal.aborted) reject(signal.reason); else if (failed) reject(failed); else if (code) reject(failure(`OpenCLI 返回退出码 ${code}，请检查现有浏览器连接`, 'BROWSER_UNAVAILABLE')); else accept(Buffer.concat(chunks).toString('utf8')); });
      if (signal.aborted) cancel();
    });
    let result: unknown; try { result = JSON.parse(stdout.trim()); } catch { throw failure('OpenCLI 没有返回完整 JSON', 'BAD_RESPONSE'); }
    const envelope = result && typeof result === 'object' && !Array.isArray(result) ? result as Row : undefined;
    if (envelope?.ok === false) throw failure('OpenCLI 浏览器读取未完成，请检查会话或页面验证', 'BROWSER_UNAVAILABLE');
    return envelope?.ok === true && envelope.data !== undefined ? envelope.data : result;
  };
}

interface Snapshot { url: string; title: string; text: string; article: string; account: Row; links: { url: string; title: string; publishedAt?: string }[]; accounts: { url: string; title: string; text: string }[] }
const snapshotScript = (scrolls: number) => `(async () => {
  for (let i = 0; i < ${scrolls}; i++) { window.scrollTo(0, document.body.scrollHeight); await new Promise(resolve => setTimeout(resolve, 350)); }
  const clean = value => (value || '').replace(/\\s+/g, ' ').trim();
  const body = document.body?.innerText || '';
  const absolute = value => { try { return new URL(value, location.href).href; } catch { return ''; } };
  const meta = key => document.querySelector('meta[property="' + key + '"],meta[name="' + key + '"]')?.content || '';
  const fields = {};
  for (const [key, selectors] of Object.entries({nickname:['#js_name','.profile_nickname'], accountId:['#js_alias','.profile_account'], certification:['#js_verify_info'], description:['#js_profile_desc','.profile_desc']})) {
    const value = selectors.map(selector => clean(document.querySelector(selector)?.textContent)).find(Boolean); if (value) fields[key] = value;
  }
  if (!fields.certification) { const verified = Array.from(document.querySelectorAll('.profile_desc')).find(item => /认证主体|微信认证/.test(item.querySelector('.profile_desc_label,.profile_desc_title')?.textContent || '')); const value = clean(verified?.querySelector('.profile_desc_value')?.textContent); if (value) fields.certification = value; }
  if (!fields.nickname && meta('og:title')) fields.title = meta('og:title');
  if (meta('description')) fields.description = meta('description');
  const links = Array.from(document.querySelectorAll('a[href]')).map(item => ({url:absolute(item.getAttribute('href')),title:clean(item.textContent),publishedAt:item.querySelector('time')?.dateTime || undefined})).filter(item => item.url && item.title);
  const accounts = Array.from(document.querySelectorAll('.news-list2 li')).map(item => { const anchor=item.querySelector('h3 a[href],.tit a[href],a[uigs*="account_name"]'); return {url:absolute(anchor?.getAttribute('href') || location.href),title:clean(anchor?.textContent || item.querySelector('h3,.tit')?.textContent),text:clean(item.textContent)}; }).filter(item=>item.title);
  return {url:location.href,title:document.title,text:body.slice(0,200000),article:document.querySelector('#js_content')?.innerText || '',account:fields,links,accounts};
})()`;

async function snapshot(run: OpenCliRunner, url: string, signal: AbortSignal, scrolls = 0): Promise<Snapshot> {
  const session = `sera-social-${randomUUID().slice(0, 8)}`;
  try {
    await run(['browser', session, 'open', url], signal);
    let value = await run(['browser', session, 'eval', snapshotScript(scrolls)], signal);
    for (let i = 0; i < 3; i++) { if (!value || typeof value !== 'object' || Array.isArray(value)) break; const row = value as Row; if (typeof row.url === 'string' && typeof row.text === 'string') break; value = row.result ?? row.value ?? row.data ?? value; }
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw failure('浏览器没有返回页面字段', 'BAD_RESPONSE'); } }
    const checked = z.object({ url: z.string().url(), title: z.string(), text: z.string(), article: z.string().default(''), account: z.record(z.string(), z.unknown()).default({}), links: z.array(z.object({ url: z.string(), title: z.string(), publishedAt: z.string().optional() })).default([]), accounts: z.array(z.object({ url: z.string(), title: z.string(), text: z.string() })).default([]) }).parse(value);
    if (/验证码|完成验证后即可|环境异常|访问过于频繁/.test(checked.text.slice(0, 3000)) && !checked.article) throw failure('页面需要现有浏览器完成验证或稍后重试', 'PAGE_AUTH_REQUIRED');
    return checked;
  } finally { await run(['browser', session, 'close'], AbortSignal.timeout(5000)).catch(() => {}); }
}

function profileFields(html: string) {
  const field = (name: string) => { const match = html.match(new RegExp(`<meta\\b[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i')); return decoded(match?.[1]); };
  const nickname = field('og:title'), description = field('description') || field('og:description');
  return { ...(nickname ? { nickname } : {}), ...(description ? { description } : {}) };
}
function publicQq(config: Config, definition: ConnectorDefinition, run: OpenCliRunner): Source {
  const load = async (identity: string, useBrowser: boolean, signal: AbortSignal, client: StructuredClient) => {
    const url = `https://user.qzone.qq.com/${identity}`;
    const fields: Row = useBrowser ? (await snapshot(run, url, signal)).account : profileFields((await textResponse(await client(identity, signal, {}, undefined, 'response'))).text);
    const name = string(fields.nickname ?? fields.title);
    if (!Object.keys(fields).length || /^(?:QQ空间(?:\s*[-—|].*)?|Qzone|QQ登录|登录QQ空间)$/i.test(name)) throw failure('QQ 空间当前页面未公开可提取的资料字段，可在已有会话中重试', 'PAGE_AUTH_REQUIRED');
    return document(definition.id, url, string(fields.nickname ?? fields.title) || `QQ ${identity} 空间`, JSON.stringify(fields, null, 2), { contentKind: 'metadata', locator: { kind: 'record', id: identity }, metadata: { fields, accessScope: useBrowser ? 'existing-browser-session' : 'anonymous-page', limitations: definition.limitations } });
  };
  return createStructuredSource(config, definition, { search: { profile: async (request, params, client) => { const identity = qqNumber.parse(params.qq ?? request.query), value = await load(identity, params.browser, request.signal, client);
    report(request, 'qq:visible-profile', undefined, definition.limitations); return selected(request, hit(definition.id, { title: value.title, url: value.url, snippet: value.content, locator: value.locator, metadata: value.metadata })); } },
    read: async (url, signal, options, client) => { const parsed = new URL(url), identity = parsed.hostname === 'user.qzone.qq.com' ? parsed.pathname.match(/^\/(\d+)\/?$/)?.[1] : undefined;
      if (!identity) throw new Error('QQ 空间读取需要指定号码的主页'); return load(qqNumber.parse(identity), Boolean(options?.browser), signal, client); } });
}

function accountId(item: { title: string; text: string }) { return createHash('sha256').update(`${item.title}\n${item.text}`).digest('hex'); }
function publicWechat(config: Config, definition: ConnectorDefinition, run: OpenCliRunner): Source {
  const load = async (url: string, signal: AbortSignal, options?: ReadOptions) => {
    const parsed = new URL(url); if (!['weixin.sogou.com', 'mp.weixin.qq.com'].includes(parsed.hostname)) throw new Error('微信账号读取需要公众号发现页、文章或主页');
    const page = await snapshot(run, url, signal);
    if (parsed.hostname === 'weixin.sogou.com') {
      const item = options?.locator ? page.accounts.find(item => accountId(item) === options.locator!.id) : undefined;
      if (options?.locator && !item) throw failure('当前公众号发现页未返回指定候选账号');
      if (!page.accounts.length) throw failure('页面没有可提取的公众号候选资料', 'NOT_FOUND');
      return document(definition.id, url, item?.title ?? '公众号候选账号', JSON.stringify(item ?? page.accounts, null, 2), { contentKind: 'metadata', ...(item ? { locator: { kind: 'record', id: accountId(item) } } : {}), metadata: { contentScope: 'public-account-discovery', pageUrl: page.url, limitations: definition.limitations } });
    }
    if (!Object.keys(page.account).length) throw failure('公众号页面没有实际可见的账号字段', 'PAGE_AUTH_REQUIRED');
    const identity = canonical(page.url);
    return document(definition.id, url, string(page.account.nickname ?? page.account.title) || page.title, JSON.stringify(page.account, null, 2), { contentKind: 'metadata', locator: { kind: 'record', id: identity }, metadata: { contentScope: 'visible-official-account-fields', accessScope: 'existing-browser-session', certificationObserved: Boolean(page.account.certification), limitations: definition.limitations } });
  };
  const source = createStructuredSource(config, definition, { search: {
    'discover-accounts': async (request, params) => { const url = new URL('https://weixin.sogou.com/weixin'); url.searchParams.set('type', '1'); url.searchParams.set('query', request.query); url.searchParams.set('page', String(params.page));
      const page = await snapshot(run, url.href, request.signal), values = page.accounts.slice(params.resultOffset, params.resultOffset + request.limit);
      const next = params.resultOffset + request.limit < page.accounts.length ? { ...params, resultOffset: params.resultOffset + request.limit } : page.accounts.length && params.page < 100 ? { page: params.page + 1, resultOffset: 0 } : undefined;
      report(request, 'wechat:public-account-discovery', next ? JSON.stringify(next) : undefined, definition.limitations);
      return selected(request, values.flatMap(item => hit(definition.id, { title: item.title, url: url.href, snippet: item.text, locator: { kind: 'record', id: accountId(item) }, metadata: { accountPageUrl: item.url, contentScope: 'account-candidate', accountId: item.text.match(/微信号[:：]?\s*(\S+)/)?.[1], certification: item.text.match(/(?:微信认证|认证主体|认证)[:：]?\s*([^\n]+)/)?.[1] } }))); },
    profile: async (request, params) => { const value = await load(params.url, request.signal); report(request, 'wechat:visible-account-profile', undefined, definition.limitations); return selected(request, hit(definition.id, { title: value.title, url: value.url, snippet: value.content, locator: value.locator, metadata: value.metadata })); },
  }, read: async (url, signal, options) => load(url, signal, options) });
  return source;
}

function articleIdentity(url: string) { return canonical(url); }
function wechatHistory(config: Config, definition: ConnectorDefinition, run: OpenCliRunner): Source {
  const articleHits = (values: { url: string; title: string; publishedAt?: string }[]) => values.flatMap(item => {
    let parsed: URL; try { parsed = new URL(item.url); } catch { return []; }
    if (parsed.hostname !== 'mp.weixin.qq.com' || !/^\/(?:s(?:\/|$)|mp\/appmsgalbum)/.test(parsed.pathname)) return [];
    return hit(definition.id, { title: item.title, url: item.url, snippet: item.title, publishedAt: date(item.publishedAt), locator: { kind: 'record', id: articleIdentity(item.url) }, metadata: { contentScope: 'observed-article-link' } });
  });
  const source = createStructuredSource(config, definition, { search: {
    'discover-articles': async (request, params) => { const value = await run(['weixin', 'search', [params.accountName, request.query === '*' ? '' : request.query].filter(Boolean).join(' '), '--page', String(params.page), '--limit', '10', '-f', 'json'], request.signal);
      const items = rows(Array.isArray(value) ? value : object(value, 'OpenCLI').data, 'OpenCLI 微信搜索'), page = items.slice(params.resultOffset, params.resultOffset + request.limit);
      const next = params.resultOffset + request.limit < items.length ? { ...params, resultOffset: params.resultOffset + request.limit } : items.length >= 10 && params.page < 100 ? { ...params, page: params.page + 1, resultOffset: 0 } : undefined;
      report(request, 'wechat:sogou-indexed-articles', next ? JSON.stringify(next) : undefined, [...definition.limitations!, '公众号名称只是查询条件，需通过原文账号字段确认归属。']);
      return selected(request, page.flatMap(item => hit(definition.id, { title: string(item.title), url: string(item.url), snippet: string(item.summary), publishedAt: date(item.publish_time), metadata: { publicationTimeRaw: item.publish_time, accountName: params.accountName, contentScope: 'article-discovery-snippet' } }))); },
    'history-page': async (request, params) => { const page = await snapshot(run, params.url, request.signal, params.scrolls), distinct = [...new Map(articleHits(page.links).map(item => [item.url, item])).values()];
      const value = distinct.slice(params.resultOffset, params.resultOffset + request.limit), more = params.resultOffset + request.limit < distinct.length;
      report(request, 'wechat:observed-history-page', more ? JSON.stringify({ ...params, resultOffset: params.resultOffset + request.limit }) : undefined, [...definition.limitations!, `本页实际取得 ${distinct.length} 个不同文章链接，滚动 ${params.scrolls} 次；没有推断未加载历史。`]);
      return selected(request, value); },
    'authorized-published': async (request, params, client) => { const settings = sourceConfig(config, definition.id); if (!settings.apiKey) throw failure('自己授权公众号的已发表记录需要 access_token', 'AUTH_REQUIRED');
      const result = object(await client('cgi-bin/freepublish/batchget', request.signal, { access_token: settings.apiKey }, { offset: params.offset, count: 20, no_content: 0 }), '微信已发表记录');
      if (result.errcode) throw failure(`微信已发表记录接口返回 ${result.errcode}`, 'UPSTREAM_QUERY_ERROR');
      const items = rows(result.item ?? [], '微信已发表记录'), articles = items.flatMap(item => rows(object(item.content, '微信文章内容').news_item, '微信文章').map(article => ({ url: string(article.url), title: string(article.title), publishedAt: typeof item.update_time === 'number' ? new Date(item.update_time * 1000).toISOString() : undefined })));
      const more = params.offset + items.length < Number(result.total_count), remaining = params.resultOffset + request.limit < articles.length;
      const next = remaining ? { ...params, resultOffset: params.resultOffset + request.limit } : more && items.length ? { offset: params.offset + items.length, resultOffset: 0 } : undefined;
      report(request, 'wechat:authorized-account-published-records', next ? JSON.stringify(next) : undefined, ['只覆盖此 access_token 授权账号的已发表接口记录；更新时间不作为文章首次发布时间。']);
      return selected(request, articleHits(articles).slice(params.resultOffset, params.resultOffset + request.limit).map(item => ({ ...item, publishedAt: undefined, metadata: { ...item.metadata, updateTime: item.publishedAt, accessScope: 'own-authorized-official-account' } }))); },
  }, read: async (url, signal, _options) => {
    const parsed = new URL(url); if (!['mp.weixin.qq.com', 'weixin.sogou.com'].includes(parsed.hostname)) throw new Error('公众号文章读取需要微信文章或搜狗发现链接');
    const page = await snapshot(run, url, signal);
    if (new URL(page.url).hostname !== 'mp.weixin.qq.com' || !page.article.trim()) throw failure('当前浏览器未取得公众号文章正文', 'PAGE_AUTH_REQUIRED');
    return document(definition.id, page.url, page.title, page.article, { contentKind: 'page', locator: { kind: 'record', id: articleIdentity(page.url) }, metadata: { contentScope: 'article-body', account: page.account, accessScope: 'existing-browser-session', limitations: definition.limitations } });
  } });
  return source;
}

export function createSocialConnectorSources(config: Config, dependencies: SocialConnectorDependencies = {}): Source[] {
  const run = dependencies.opencli ?? runOpenCli(config), browserAvailable = Boolean(dependencies.opencli || config.opencli && config.opencli.enabled !== false);
  const sources = socialDefinitions.map(definition => definition.id === 'qq-avatar' || definition.id === 'qq-group-avatar' ? avatar(config, definition, definition.id === 'qq-group-avatar')
    : definition.id === 'qq-portrait-legacy' ? portrait(config, definition) : definition.id === 'qq-public-profile' ? publicQq(config, definition, run)
    : definition.id === 'wechat-official-account' ? publicWechat(config, definition, run) : wechatHistory(config, definition, run));
  for (const source of sources) if (source.capability.name.startsWith('wechat-') && !browserAvailable && !(source.capability.name === 'wechat-article-history' && sourceConfig(config, source.capability.name).apiKey)) source.capability.configured = false;
  return sources;
}
