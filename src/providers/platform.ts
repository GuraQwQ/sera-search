import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Channel, CommandConfig, Config, ContentKind, Document, SearchHit, SearchRequest, Source, SourceName } from '../types.js';
import { platformIdPattern } from '../types.js';
import { credential, NotLoggedInError, notLoggedIn } from '../credentials.js';

const outputLimit = 4 * 1024 * 1024;
const terminalCodes = new Set(['NEED_LOGIN', 'AUTH_REQUIRED', 'RATE_LIMITED', 'PLATFORM_BLOCKED', 'SECURITY_BLOCK', 'BUSY']);

export class PlatformError extends Error {
  readonly terminal: boolean;
  constructor(readonly code: string, message: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'PlatformError';
    this.terminal = terminalCodes.has(code);
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanError(value: string): string {
  let result = value;
  for (const [name, secret] of Object.entries(process.env)) {
    if (/key|token|cookie|secret|password/i.test(name) && secret && secret.length >= 4) result = result.replaceAll(secret, '[已隐藏]');
  }
  return result.replace(/\b(api[_-]?key|token|cookie|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[已隐藏]').slice(0, 800);
}

function parseJson(output: string): unknown {
  // 外部 CLI 可能在 JSON 前后附加诊断；只截取完整的顶层 JSON。
  for (let start = 0; start < output.length; start++) {
    if (output[start] !== '{' && output[start] !== '[') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let end = start; end < output.length; end++) {
      const char = output[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(output.slice(start, end + 1)); } catch { break; }
        }
      }
    }
  }
  throw new PlatformError('BAD_OUTPUT', '外部命令没有返回完整 JSON。请检查命令入口与输出格式。');
}

function authenticationError(args: string[]) {
  const platform = args[0] === 'read' ? siteForUrl(args.at(-1)!)
    : ['login', 'logout', 'check'].includes(args[0] ?? '') ? args[1] : args[0];
  return new NotLoggedInError(platform);
}

async function invoke(command: CommandConfig, args: string[], signal: AbortSignal, cwd?: string, env?: NodeJS.ProcessEnv): Promise<unknown> {
  signal.throwIfAborted();
  if (/\.(cmd|bat|ps1)$/i.test(command.command)) {
    throw new PlatformError('BAD_COMMAND', '请配置原生可执行入口，例如 python -m agent_reach.cli 或 node OpenCLI入口.js。');
  }
  const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((accept, reject) => {
    const child = spawn(command.command, [...command.args, ...args], { shell: false, windowsHide: true, cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    const cancel = () => { child.kill(); };
    signal.addEventListener('abort', cancel, { once: true });
    const collect = (chunks: Buffer[], chunk: Buffer) => {
      size += chunk.length;
      if (size > outputLimit) {
        failure = new PlatformError('OUTPUT_LIMIT', '外部命令输出超过 4 MiB，请缩小查询或读取范围。');
        child.kill();
      } else chunks.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.on('error', error => { failure = new PlatformError('COMMAND_FAILED', `${cleanError(error.message)}；请检查配置的可执行入口。`); });
    child.on('close', code => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(signal.reason);
      else if (failure) reject(failure);
      else accept({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), code });
    });
    if (signal.aborted) cancel();
  });
  let parsed: unknown;
  try { parsed = parseJson(result.stdout); } catch (error) {
    if (result.code === 0) throw error;
    try { parsed = parseJson(result.stderr); } catch {
      const diagnostic = result.stderr.trim().split('\n').slice(-2).join(' ') || `退出码 ${result.code}`;
      const code = diagnostic.match(/\b(NEED_LOGIN|AUTH_REQUIRED|NOT_LOGGED_IN|RATE_LIMITED|PLATFORM_BLOCKED|SECURITY_BLOCK|BUSY)\b/)?.[1] ?? 'COMMAND_FAILED';
      if (['NEED_LOGIN', 'AUTH_REQUIRED', 'NOT_LOGGED_IN'].includes(code)) throw authenticationError(args);
      throw new PlatformError(code, cleanError(diagnostic));
    }
  }
  const envelope = object(parsed);
  const error = object(envelope?.error);
  if (args[0] === 'check' && Array.isArray(envelope?.results) && !error) return parsed;
  if (envelope?.ok === false || error) {
    const code = text(error?.code) || 'UPSTREAM_BROKEN';
    if (['NEED_LOGIN', 'AUTH_REQUIRED', 'NOT_LOGGED_IN'].includes(code)) throw authenticationError(args);
    const hint = text(error?.hint);
    const retry = error?.retry_after_seconds ?? object(envelope?.meta)?.retry_after_seconds;
    throw new PlatformError(code, cleanError(`${text(error?.message) || '平台返回错误'}${hint ? `；${hint}` : ''}`), typeof retry === 'number' ? retry : undefined);
  }
  if (result.code !== 0) throw new PlatformError('COMMAND_FAILED', cleanError(result.stderr.trim() || `外部命令退出码 ${result.code}`));
  return parsed;
}

function checkedUrl(value: unknown): string | undefined {
  try { const url = new URL(text(value)); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

function explicitDate(value: unknown): string | undefined {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(date) || !Number.isFinite(Date.parse(date))) return undefined;
  const calendarDate = date.slice(0, 10);
  return new Date(`${calendarDate}T00:00:00Z`).toISOString().slice(0, 10) === calendarDate ? date : undefined;
}

function hits(rows: unknown[], source: SourceName, limit: number, platform: string): SearchHit[] {
  return rows.flatMap(value => {
    const row = object(value);
    const url = checkedUrl(row?.url);
    if (!row || !url) return [];
    const publicationTimeRaw = row.published_at ?? row.publish_time ?? row.published ?? row.created_at;
    const publishedAt = explicitDate(publicationTimeRaw);
    return [{ source, url, title: text(row.title ?? row.name ?? row.desc) || url, snippet: text(row.text ?? row.summary ?? row.description ?? row.selftext ?? row.desc), ...(publishedAt ? { publishedAt } : {}), metadata: { platform, author: text(row.author ?? row.authors), ...(publicationTimeRaw !== undefined ? { publicationTimeRaw } : {}) } }];
  }).slice(0, limit);
}

function document(rows: unknown[], source: SourceName, url: string, platform: string, action: string, backend?: string): Document {
  if (!rows.length) throw new PlatformError('CONTENT_INCOMPLETE', '平台没有返回正文。请读取原始链接，或检查该内容的访问状态。');
  const values = rows.map(object).filter((row): row is Record<string, unknown> => Boolean(row));
  const folded = values.length && values.every(row => typeof row.field === 'string' && 'value' in row)
    ? [Object.fromEntries(values.map(row => [String(row.field), row.value]))] : values;
  const incompleteKinds = new Set(['summary', 'snippet', 'search_results', 'track-only', 'tracks', 'subtitle_tracks', 'subtitle_track_list']);
  const body = folded.map(row => {
    const raw = object(row.raw);
    if ([row.content_kind, row.content_scope, raw?.content_kind, raw?.content_scope].some(value => incompleteKinds.has(text(value).toLowerCase()))) return '';
    const value = row.content ?? row.text ?? row.selftext;
    const content = typeof value === 'string' ? value : '';
    if (!content.trim()) return '';
    if (folded.length === 1) return content;
    return [text(row.title), checkedUrl(row.url), text(row.author), content].filter(Boolean).join('\n');
  }).filter(Boolean);
  if (!body.length) throw new PlatformError('CONTENT_INCOMPLETE', '已取得标题或元数据，但没有正文；摘要与字幕轨道列表不能作为原文证据。');
  const first = folded[0]!;
  const publicationTimeRaw = first.published_at ?? first.publish_time ?? first.created_at;
  const publishedAt = folded.length === 1 ? explicitDate(publicationTimeRaw) : undefined;
  const raw = object(first.raw);
  const declaredKind = text(first.content_kind ?? raw?.content_kind).toLowerCase();
  const scope = text(first.content_scope ?? raw?.content_scope).toLowerCase();
  const scopeKinds: Record<string, ContentKind> = { subtitles: 'subtitle', subtitle_text: 'subtitle', transcript: 'subtitle', page_text: 'page', post_text: 'post', comments: 'post', metadata: 'metadata' };
  const hint = ['page', 'post', 'subtitle', 'metadata'].includes(declaredKind) ? declaredKind as ContentKind : scopeKinds[scope];
  // read 动作也可能返回字幕；只在缺少类型声明时按正文和平台推断。
  const isWebVtt = body.some(content => /^WEBVTT[^\r\n]*\r?\n/m.test(content) && /(?:^|\n)(?:\d{2}:)?\d{2}:\d{2}\.\d{3}\s+-->/.test(content));
  const contentKind: ContentKind = hint ?? (isWebVtt || action === 'subtitle' || action === 'transcribe' ? 'subtitle'
    : ['bilibili', 'youtube', 'douyin'].includes(platform) ? 'metadata'
    : platform === 'web' || platform === 'weixin' ? 'page' : 'post');
  const completeness = first.completeness_verified ?? raw?.completeness_verified;
  return { source, url: folded.length === 1 ? checkedUrl(first.url) ?? url : url, title: text(first.title ?? first.question_title) || url, content: body.join('\n\n'), contentKind, ...(publishedAt ? { publishedAt } : {}), metadata: { platform, action, items: folded.length, ...(backend ? { backend } : {}), ...(scope ? { contentScope: scope } : {}), ...(typeof completeness === 'boolean' ? { completenessVerified: completeness } : {}), ...(publicationTimeRaw !== undefined ? { publicationTimeRaw } : {}) } };
}

function siteForUrl(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  const domains: Record<string, string[]> = {
    weixin: ['mp.weixin.qq.com'], zhihu: ['zhihu.com'], xiaohongshu: ['xiaohongshu.com', 'xhslink.com'],
    bilibili: ['bilibili.com', 'b23.tv'], youtube: ['youtube.com', 'youtu.be'], reddit: ['reddit.com', 'redd.it'],
    twitter: ['x.com', 'twitter.com'], douyin: ['douyin.com'], v2ex: ['v2ex.com'], github: ['github.com'],
  };
  return Object.entries(domains).find(([, list]) => list.some(domain => host === domain || host.endsWith(`.${domain}`)))?.[0] ?? 'web';
}

function searchPlatform(request: SearchRequest, defaultSite?: string): string {
  if (request.domains?.length || request.since) throw new PlatformError('UNSUPPORTED_FILTER', '该平台适配不支持统一域名或日期过滤，请使用平台原生查询语法或网页 API。');
  const site = request.platform ?? defaultSite;
  if (!site || !platformIdPattern.test(site)) throw new PlatformError('BAD_INPUT', '平台检索需要 --platform，例如 xiaohongshu、zhihu 或 arxiv。');
  return site;
}

interface RegistryArg { name: string; positional?: boolean; required?: boolean; help?: string }
interface RegistryCommand {
  site: string; name: string; access: string; args: RegistryArg[]; columns: string[];
  browser?: boolean; strategy?: string;
}

function registryEntries(value: unknown): RegistryCommand[] {
  if (!Array.isArray(value)) throw new PlatformError('BAD_REGISTRY', 'OpenCLI 注册表必须返回命令数组。');
  return value.map(object).filter((row): row is Record<string, unknown> => Boolean(row && typeof row.site === 'string' && typeof row.name === 'string' && ['read', 'write'].includes(String(row.access)) && Array.isArray(row.args) && Array.isArray(row.columns)))
    .map(row => ({ site: String(row.site), name: String(row.name), access: String(row.access), args: (row.args as unknown[]).map(object).filter((arg): arg is Record<string, unknown> => Boolean(arg && typeof arg.name === 'string')) as unknown as RegistryArg[], columns: row.columns as string[], browser: row.browser === true, strategy: text(row.strategy) }));
}

function requiredArguments(command: RegistryCommand, known: string[]): void {
  if (command.args.some(arg => arg.required && !known.includes(arg.name))) throw new PlatformError('UNSUPPORTED_COMMAND', `${command.site}/${command.name} 需要额外参数，请先查看 OpenCLI 实时帮助。`);
}

function searchable(entry: RegistryCommand): boolean {
  const query = entry.args.find(arg => ['query', 'keyword'].includes(arg.name) && arg.positional);
  return entry.access === 'read' && entry.name === 'search' && Boolean(query) && entry.args.every(arg => !arg.required || arg.name === query!.name);
}

function loggedIn(value: unknown): boolean {
  const envelope = object(value);
  if (envelope?.logged_in === true) return true;
  const values = Array.isArray(value) ? value : Array.isArray(envelope?.items) ? envelope.items : [];
  return values.some(item => {
    const row = object(item), raw = object(row?.raw);
    return row?.logged_in === true || raw?.logged_in === true || row?.field === 'logged_in' && (row.value === true || row.value === 'true');
  });
}

function publicReach(platform: string, channel?: Record<string, unknown>): boolean {
  if (['web', 'github', 'bilibili', 'youtube', 'v2ex'].includes(platform)) return true;
  return channel?.login === null || channel?.login === undefined && !['twitter', 'reddit', 'xiaohongshu', 'instagram', 'facebook', 'boss', 'linkedin', 'xueqiu'].includes(platform);
}

function needsOpenCliLogin(entry: RegistryCommand): boolean { return Boolean(entry.strategy && entry.strategy !== 'public'); }

function requireRecord(config: Config, source: SourceName, platform: string) {
  if (!credential(config, source, platform)) throw new NotLoggedInError(platform);
}

function readable(site: string, entries: RegistryCommand[]): boolean {
  if (site === 'weixin') return entries.some(entry => entry.name === 'download'
    && ['url', 'output', 'download-images'].every(name => entry.args.some(arg => arg.name === name))
    && entry.args.every(arg => !arg.required || arg.name === 'url'));
  const names = site === 'zhihu' ? ['question', 'answer-detail'] : site === 'xiaohongshu' ? ['note'] : site === 'bilibili' ? ['video']
    : ['youtube', 'reddit', 'twitter', 'douyin', 'v2ex', 'github'].includes(site) ? ['read'] : [];
  return entries.some(entry => {
    const required = entry.args.filter(arg => arg.required);
    return names.includes(entry.name) && required.length === 1 && required[0]!.positional === true
      && (site === 'zhihu' && entry.name === 'question' || /url|link|链接/i.test(required[0]!.help ?? ''));
  });
}

function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new PlatformError('BAD_OUTPUT', 'OpenCLI 内容命令必须返回 JSON 数组。');
  return value;
}

async function weixinDocument(config: Config, command: CommandConfig, entry: RegistryCommand, url: string, signal: AbortSignal): Promise<Document> {
  requiredArguments(entry, ['url']);
  if (!['url', 'output', 'download-images'].every(name => entry.args.some(arg => arg.name === name))) throw new PlatformError('UNSUPPORTED_COMMAND', '当前微信读取入口缺少可控制的输出目录或图片选项，请检查 OpenCLI 帮助。');
  const parent = resolve(config.home, 'platform-tmp');
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(join(parent, 'weixin-'));
  const actualParent = await realpath(parent);
  const actualTemporary = await realpath(temporary);
  try {
    const result = rows(await invoke(command, ['weixin', entry.name, '--url', url, '--output', temporary, '--download-images', 'false', '-f', 'json'], signal, temporary, openCliEnv(config)));
    const files = (await readdir(temporary, { recursive: true })).filter(name => name.endsWith('.md'));
    const content: string[] = [];
    for (const file of files) {
      signal.throwIfAborted();
      const path = await realpath(join(temporary, file));
      if (!path.startsWith(actualTemporary + sep)) throw new PlatformError('BAD_OUTPUT', '微信输出文件不在本次读取目录内。');
      content.push(await readFile(path, 'utf8'));
    }
    const first = object(result[0]);
    return document([{ title: text(first?.title), publish_time: first?.publish_time, content: content.join('\n\n') }], 'opencli', url, 'weixin', 'download');
  } finally {
    const current = await realpath(temporary).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (current && (current !== actualTemporary || !current.startsWith(actualParent + sep))) throw new PlatformError('BAD_OUTPUT', '本次临时目录的真实路径发生变化，请检查读取输出。');
    if (current) await rm(temporary, { recursive: true, force: true });
  }
}

function openCliEnv(config: Config): NodeJS.ProcessEnv {
  return { ...process.env, OPENCLI_CONFIG_DIR: process.env.OPENCLI_CONFIG_DIR ?? join(config.home, 'opencli'), OPENCLI_CACHE_DIR: process.env.OPENCLI_CACHE_DIR ?? join(config.home, 'opencli', 'cache') };
}

export function createPlatformSources(config: Config): Source[] {
  const reach = config.agentReach;
  const opencli = config.opencli;
  const withTimeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]);
  let registry: RegistryCommand[] | undefined;
  let reachChannels: Record<string, unknown>[] | undefined;
  const callOpenCli = (args: string[], signal: AbortSignal) => {
    if (!opencli) throw new PlatformError('NEED_SETUP', '请配置 OpenCLI 的 command 与 args。');
    return invoke(opencli, args, signal, undefined, openCliEnv(config));
  };
  const getRegistry = async (signal: AbortSignal) => {
    if (!opencli) throw new PlatformError('NEED_SETUP', '请配置 OpenCLI 的 command 与 args。');
    registry ??= registryEntries(await callOpenCli(['list', '-f', 'json'], signal));
    return registry;
  };
  const getReachChannels = async (signal: AbortSignal) => {
    if (!reach) throw new PlatformError('NEED_SETUP', '请配置 Agent Reach 的 command 与 args。');
    if (!reachChannels) {
      const value = object(await invoke(reach, ['channels'], signal));
      if (value?.ok !== true || !Array.isArray(value.channels)) throw new PlatformError('UNSUPPORTED_VERSION', 'Agent Reach 未返回当前统一 CLI 的 channels 清单，请核对配置的版本。');
      reachChannels = value.channels.map(object).filter((channel): channel is Record<string, unknown> => Boolean(channel));
    }
    return reachChannels;
  };
  const checkReachRecord = async (platform: string, signal: AbortSignal) => {
    if (['web', 'github', 'bilibili', 'youtube', 'v2ex'].includes(platform)) return;
    const channel = (await getReachChannels(signal)).find(item => item.name === platform);
    if (!channel) throw new PlatformError('UNSUPPORTED_COMMAND', `Agent Reach 未注册 ${platform} 渠道。`);
    if (!publicReach(platform, channel)) requireRecord(config, 'agent-reach', platform);
  };
  return [
    {
      capability: { name: 'agent-reach', search: true, read: true, configured: Boolean(reach && reach.enabled !== false), requirement: '用户自行配置当前统一 CLI 入口及平台账号；运行时按实际响应验收。' },
      channels: async signal => {
        return (await getReachChannels(withTimeout(signal))).flatMap(channel => {
          if (!platformIdPattern.test(text(channel.name)) || !Array.isArray(channel.actions)) return [];
          const actions = channel.actions.map(object).filter((action): action is Record<string, unknown> => Boolean(action));
          const search = actions.find(action => action.name === 'search');
          const params = Array.isArray(search?.params) ? search.params.map(object).filter((param): param is Record<string, unknown> => Boolean(param)) : [];
          const required = params.filter(param => param.required === true);
          const isPublic = publicReach(text(channel.name), channel);
          const configured = isPublic || Boolean(credential(config, 'agent-reach', text(channel.name)));
          return [{ source: 'agent-reach', platform: text(channel.name), description: text(channel.description),
            search: Boolean(search && required.length === 1 && required[0]!.type === 'str' && params.some(param => param.name === 'limit' && param.required !== true)),
            read: actions.some(action => action.name === 'read'), configured, status: configured ? isPublic ? '公开可用' : '已记录' : notLoggedIn }] as Channel[];
        });
      },
      login: async (platform, suppliedSignal) => {
        if (!reach) throw new PlatformError('NEED_SETUP', '请配置 Agent Reach 的 command 与 args。');
        const signal = withTimeout(suppliedSignal);
        const channel = (await getReachChannels(signal)).find(item => item.name === platform);
        if (!channel) throw new PlatformError('UNSUPPORTED_COMMAND', `Agent Reach 未注册 ${platform} 渠道。`);
        if (publicReach(platform, channel)) return;
        try {
          // 普通 login 会安装渠道；同步已有登录不会触发安装或账户迁移。
          if (loggedIn(await invoke(reach, ['login', platform, '--sync'], signal))) return;
        } catch (error) {
          if (!(error instanceof PlatformError) || error.code !== 'BAD_INPUT') throw error;
        }
        reachChannels = undefined;
        const current = (await getReachChannels(signal)).find(item => item.name === platform);
        if (object(current?.login)?.logged_in === true) return;
        const checked = object(await invoke(reach, ['check', platform, '--search', '--timeout', String(Math.max(1, Math.floor(config.timeoutMs / 1000)))], signal));
        if (Array.isArray(checked?.results) && checked.results.some(value => {
          const row = object(value);
          return row?.channel === platform && row.passed === true && text(row.backend) && row.backend !== 'public-web';
        })) return;
        throw new NotLoggedInError();
      },
      logout: async (platform, signal) => {
        if (!reach) throw new PlatformError('NEED_SETUP', '请配置 Agent Reach 的 command 与 args。');
        requireRecord(config, 'agent-reach', platform);
        const value = object(await invoke(reach, ['logout', platform], withTimeout(signal)));
        if (value?.ok !== true || value.action !== 'logout') throw new PlatformError('BAD_OUTPUT', 'Agent Reach 没有确认退出登录。');
      },
      search: async request => {
        if (!reach) throw new PlatformError('NEED_SETUP', '请配置 Agent Reach 的 command 与 args。');
        const platform = searchPlatform(request, 'web');
        await checkReachRecord(platform, withTimeout(request.signal));
        const value = object(await invoke(reach, [platform, 'search', '--limit', String(request.limit), '--', request.query], withTimeout(request.signal)));
        if (value?.ok !== true || !Array.isArray(value.items)) throw new PlatformError('UNSUPPORTED_VERSION', 'Agent Reach 未返回当前统一 CLI 的 ok/items 结果，请配置提供该协议的版本并查看 channels。');
        return hits(value.items, 'agent-reach', request.limit, platform);
      },
      read: async (url, signal) => {
        if (!reach) throw new PlatformError('NEED_SETUP', '请配置 Agent Reach 的 command 与 args。');
        await checkReachRecord(siteForUrl(url), withTimeout(signal));
        const value = object(await invoke(reach, ['read', '--', url], withTimeout(signal)));
        if (value?.ok !== true || !Array.isArray(value.items)) throw new PlatformError('UNSUPPORTED_VERSION', 'Agent Reach 未返回当前统一 CLI 的 ok/items 结果，请配置提供该协议的版本并查看 channels。');
        return document(value.items, 'agent-reach', url, text(value.channel) || siteForUrl(url), text(value.action) || 'read', text(value.backend));
      },
    },
    {
      capability: { name: 'opencli', search: true, read: true, configured: Boolean(opencli && opencli.enabled !== false), requirement: '用户自行配置 OpenCLI 入口；实际站点与浏览器需求以实时注册表为准。' },
      channels: async suppliedSignal => {
        const entries = (await getRegistry(withTimeout(suppliedSignal))).filter(entry => entry.access === 'read');
        return [...new Set(entries.map(entry => entry.site))].flatMap(site => {
          const commands = entries.filter(entry => entry.site === site);
          const search = commands.find(searchable);
          const read = readable(site, commands);
          const requiresLogin = search ? needsOpenCliLogin(search) : commands.some(entry => needsOpenCliLogin(entry));
          const configured = !requiresLogin || Boolean(credential(config, 'opencli', site));
          return search || read ? [{ source: 'opencli', platform: site, search: Boolean(search), read, configured, status: configured ? requiresLogin ? '已记录' : '公开可用' : notLoggedIn,
            ...(search ? { browser: search.browser, strategy: search.strategy } : {}) }] as Channel[] : [];
        });
      },
      login: async (platform, suppliedSignal) => {
        const signal = AbortSignal.any([suppliedSignal, AbortSignal.timeout(300000)]);
        const commands = (await getRegistry(signal)).filter(entry => entry.site === platform);
        if (!commands.length) throw new PlatformError('UNSUPPORTED_COMMAND', `OpenCLI 未注册 ${platform} 站点。`);
        if (!commands.some(needsOpenCliLogin)) return;
        const identity = commands.find(entry => entry.name === 'whoami' && entry.access === 'read' && entry.args.every(arg => !arg.required));
        const identify = async () => {
          if (!identity) return false;
          try { return loggedIn(await callOpenCli([platform, 'whoami', '-f', 'json'], signal)); }
          catch (error) { if (error instanceof NotLoggedInError) return false; throw error; }
        };
        if (await identify()) return;
        const entry = commands.find(command => command.name === 'login' && command.access === 'write' && command.args.every(arg => !arg.required));
        if (!entry) throw new NotLoggedInError();
        const args = [platform, 'login', '-f', 'json'];
        if (entry.browser) args.push('--window', 'foreground');
        if (entry.args.some(arg => arg.name === 'timeout')) args.push('--timeout', '300');
        if (loggedIn(await callOpenCli(args, signal))) return;
        if (await identify()) return;
        throw new NotLoggedInError();
      },
      logout: async (platform, signal) => {
        requireRecord(config, 'opencli', platform);
        const entry = (await getRegistry(withTimeout(signal))).find(command => command.site === platform && command.name === 'logout' && command.access === 'write' && command.args.every(arg => !arg.required));
        if (!entry) throw new PlatformError('UNSUPPORTED_COMMAND', '该平台后端没有退出登录命令，请在官方页面退出；SERA 可单独移除登录记录。');
        await callOpenCli([platform, 'logout', '-f', 'json'], withTimeout(signal));
      },
      search: async request => {
        if (!opencli) throw new PlatformError('NEED_SETUP', '请配置 OpenCLI 的 command 与 args。');
        const platform = searchPlatform(request);
        const signal = withTimeout(request.signal);
        const entry = (await getRegistry(signal)).find(row => row.site === platform && row.name === 'search' && row.access === 'read');
        if (!entry) throw new PlatformError('UNSUPPORTED_COMMAND', `实时注册表没有 ${platform} 的只读 search 命令。`);
        if (!searchable(entry)) throw new PlatformError('UNSUPPORTED_COMMAND', `${platform}/search 的查询参数不同或需要额外参数，请查看实时帮助。`);
        if (needsOpenCliLogin(entry)) requireRecord(config, 'opencli', platform);
        const args = [platform, 'search', '-f', 'json'];
        if (entry.args.some(arg => arg.name === 'limit' && !arg.positional)) args.push('--limit', String(request.limit));
        args.push('--', request.query);
        const result = hits(rows(await callOpenCli(args, signal)), 'opencli', request.limit, platform);
        return result.map(hit => ({ ...hit, metadata: { ...hit.metadata, browser: entry.browser, strategy: entry.strategy } }));
      },
      read: async (url, suppliedSignal) => {
        if (!opencli) throw new PlatformError('NEED_SETUP', '请配置 OpenCLI 的 command 与 args。');
        const signal = withTimeout(suppliedSignal);
        const site = siteForUrl(url);
        const commands = (await getRegistry(signal)).filter(entry => entry.access === 'read');
        if (site === 'weixin') {
          const entry = commands.find(row => row.site === site && row.name === 'download');
          if (!entry) throw new PlatformError('UNSUPPORTED_COMMAND', '实时注册表没有微信只读 download 命令。');
          if (needsOpenCliLogin(entry)) requireRecord(config, 'opencli', site);
          return weixinDocument(config, opencli, entry, url, signal);
        }
        const targetUrl = new URL(url);
        const name = site === 'zhihu' ? (/\/answer\/\d+/.test(targetUrl.pathname) ? 'answer-detail' : 'question')
          : site === 'xiaohongshu' ? 'note' : site === 'bilibili' ? 'video' : 'read';
        const entry = commands.find(row => row.site === site && row.name === name);
        if (!entry) throw new PlatformError('UNSUPPORTED_COMMAND', `实时注册表没有可映射此链接的 ${site} 只读命令。`);
        if (needsOpenCliLogin(entry)) requireRecord(config, 'opencli', site);
        const positional = entry.args.filter(arg => arg.positional && arg.required);
        if (positional.length !== 1) throw new PlatformError('UNSUPPORTED_COMMAND', `${site}/${name} 需要不同参数，请查看实时帮助。`);
        let target = url;
        if (site === 'zhihu' && name === 'question') {
          target = targetUrl.pathname.match(/^\/question\/(\d+)\/?$/)?.[1] ?? '';
          if (!target) throw new PlatformError('UNSUPPORTED_COMMAND', '此知乎链接不是问题或答案链接，请选择对应原文读取入口。');
        } else if (!/url|link|链接/i.test(positional[0]!.help ?? '')) {
          throw new PlatformError('UNSUPPORTED_COMMAND', `${site}/${name} 未声明接受完整链接，请查看实时帮助。`);
        }
        requiredArguments(entry, [positional[0]!.name]);
        const result = rows(await callOpenCli([site, name, '-f', 'json', '--', target], signal));
        return document(result, 'opencli', url, site, name);
      },
    },
  ];
}
