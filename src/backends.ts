import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { backendNames } from './types.js';
import type { BackendName, Config, Source } from './types.js';
import { integrationEnvironment } from './components.js';
import { document, hit, object, permitted, rows, string } from './providers/shared.js';

export const backendSchema = z.object({ source: z.enum(backendNames), tool: z.string().min(1).optional(), arguments: z.record(z.string(), z.unknown()).optional() });
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

// MCP 服务复用连接，让浏览器会话跨工具调用存活；配置改变时替换对应连接。
export class BackendPool {
  private connections = new Map<BackendName, { key: string; client: Client; ready: Promise<void>; controller: AbortController }>();

  private async connect(config: Config, source: BackendName, signal: AbortSignal) {
    signal.throwIfAborted();
    const command = config[source];
    if (!command || command.enabled === false) throw failure('NEED_SETUP', `请先 install --components ${source}，或配置其 MCP 命令`);
    const key = JSON.stringify([config.home, command, source === 'ghgrab' ? config.github.apiKey : undefined]);
    let connection = this.connections.get(source);
    if (connection && connection.key !== key) {
      this.connections.delete(source);
      connection.controller.abort();
      await connection.client.close();
      connection = undefined;
    }
    if (!connection) {
      const client = new Client({ name: 'sera-backend', version: '1.0.0' });
      const controller = new AbortController();
      const connecting = AbortSignal.any([signal, controller.signal]);
      const ready = (async () => {
        const env = await integrationEnvironment(config.home);
        if (source === 'ghgrab' && config.github.apiKey) env.GITHUB_TOKEN = config.github.apiKey;
        connecting.throwIfAborted();
        const transport = new StdioClientTransport({ command: command.command, args: command.args, env, cwd: config.home, stderr: 'pipe' });
        let diagnostics = '';
        transport.stderr?.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString('utf8')).slice(-4000); });
        try { await client.connect(transport, { signal: connecting, timeout: config.timeoutMs }); }
        catch (error) {
          if (connecting.aborted) throw connecting.reason;
          throw failure('BACKEND_START_FAILED', `${source} 启动失败：${error instanceof Error ? error.message : String(error)}${diagnostics.trim() ? '\n' + diagnostics.trim() : ''}`);
        }
        if (source === 'ghgrab') {
          const receive = transport.onmessage;
          transport.onmessage = message => {
            // ghgrab 2.3 的列表结果使用裸数组，进入 SDK 前转为 MCP 要求的对象。
            if ('result' in message && Array.isArray(message.result.structuredContent)) {
              message = { ...message, result: { ...message.result, structuredContent: { items: message.result.structuredContent } } };
            }
            receive?.(message);
          };
        }
      })();
      connection = { key, client, ready, controller };
      this.connections.set(source, connection);
      const current = connection;
      client.onclose = () => { if (this.connections.get(source) === current) this.connections.delete(source); };
      ready.catch(() => { if (this.connections.get(source) === current) this.connections.delete(source); void client.close(); });
    }
    await connection.ready;
    signal.throwIfAborted();
    return connection.client;
  }

  async run(config: Config, input: z.input<typeof backendSchema>, parent?: AbortSignal) {
    const { source, tool, arguments: args } = backendSchema.parse(input);
    const signal = AbortSignal.any([AbortSignal.timeout(config.timeoutMs), ...(parent ? [parent] : [])]);
    const client = await this.connect(config, source, signal);
    if (!tool) {
      const tools = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, { signal, timeout: config.timeoutMs });
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ source, tools }) }], structuredContent: { source, tools } };
    }
    return client.callTool({ name: tool, arguments: args ?? {} }, { signal, timeout: config.timeoutMs });
  }

  async data(config: Config, source: BackendName, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const result = await this.run(config, { source, tool, arguments: args }, signal);
    const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    if (result.isError) throw failure('BACKEND_ERROR', `${source} ${tool}：${text || '上游工具执行失败'}`);
    if (result.structuredContent) return result.structuredContent;
    try { return JSON.parse(text); } catch { throw failure('BAD_OUTPUT', `${source} ${tool} 未返回结构化结果`); }
  }

  async close() {
    const connections = [...this.connections.values()];
    this.connections.clear();
    for (const connection of connections) connection.controller.abort();
    await Promise.allSettled(connections.map(connection => connection.client.close()));
  }
}

export function createBackendSources(config: Config, pool: BackendPool): Source[] {
  const configured = (source: BackendName) => Boolean(config[source] && config[source]?.enabled !== false);
  return [{
    capability: { name: 'ghgrab', search: true, read: true, configured: configured('ghgrab'), category: 'code', platforms: ['github', 'gitlab', 'codeberg', 'gitea', 'forgejo'], requirement: '安装 ghgrab；关键词搜索 GitHub，目录与文件读取支持多种 Git forge' },
    async channels() {
      return ['github', 'gitlab', 'codeberg', 'gitea', 'forgejo'].map(platform => ({ source: 'ghgrab' as const, platform, search: platform === 'github', read: true, configured: configured('ghgrab'), browser: false }));
    },
    async search(request) {
      if (request.platform && request.platform !== 'github') throw failure('UNSUPPORTED_OPERATION', 'ghgrab 关键词检索仅支持 GitHub；其他 forge 请提供仓库或文件 URL');
      if (!permitted(request.domains, 'github.com')) return [];
      if (request.githubType && request.githubType !== 'repositories') throw failure('UNSUPPORTED_OPERATION', 'ghgrab 关键词检索支持仓库；代码或 issue 检索请使用 github 来源');
      const result = await pool.data(config, 'ghgrab', 'search_repos', { query: request.query + (request.since ? ` pushed:>=${request.since}` : '') }, request.signal);
      const data = Array.isArray(result) ? result : object(result, 'ghgrab');
      const items = Array.isArray(data) ? data : data.items ?? data.result ?? data.results ?? data.repositories;
      return rows(items, 'ghgrab').flatMap(item => hit('ghgrab', { title: string(item.full_name) || string(item.name), url: string(item.html_url) || string(item.url), snippet: string(item.description), metadata: { kind: 'repositories', searchScope: 'github', stars: item.stargazers_count, updatedAt: item.updated_at } })).slice(0, request.limit);
    },
    async read(url, signal) {
      const target = new URL(url);
      if (!['http:', 'https:'].includes(target.protocol)) throw failure('BAD_INPUT', '仓库读取需要 HTTP 或 HTTPS 链接');
      if (target.hostname === 'raw.githubusercontent.com') {
        const [owner, repo, ...tail] = target.pathname.split('/').filter(Boolean);
        target.hostname = 'github.com'; target.pathname = `/${owner}/${repo}/blob/${tail.join('/')}`;
      }
      const file = /\/(?:blob|raw)\/|\/src\/(?:branch|tag|commit)\//.test(target.pathname);
      if (file) {
        const info = object(await pool.data(config, 'ghgrab', 'repo_info', { url: target.href }, signal), 'ghgrab');
        const path = string(info.url_path);
        if (!path) throw failure('BAD_INPUT', '仓库链接缺少文件路径');
        const data = object(await pool.data(config, 'ghgrab', 'read_file', { url: target.href, path }, signal), 'ghgrab');
        if (typeof data.content !== 'string') throw failure('BAD_OUTPUT', 'ghgrab 未返回文件正文');
        return document('ghgrab', url, string(data.path) || path, data.content, { metadata: { extraction: 'repository-file', platform: info.platform, branch: info.url_branch ?? info.default_branch, path } });
      }
      const data = object(await pool.data(config, 'ghgrab', 'repo_tree', { url: target.href }, signal), 'ghgrab');
      rows(data.entries, 'ghgrab 目录');
      return document('ghgrab', url, `${string(data.owner)}/${string(data.repo)}`, JSON.stringify(data, null, 2), { contentKind: 'metadata', metadata: { extraction: 'repository-tree', contentScope: 'directory', branch: data.branch, path: data.path, truncated: data.truncated } });
    },
  }, {
    capability: { name: 'scrapling', search: false, read: true, configured: configured('scrapling'), category: 'web', requirement: '安装 Scrapling 与浏览器；渲染网页正文，交互与截图通过 backend 入口发现' },
    async read(url, signal) {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw failure('BAD_INPUT', '浏览器读取需要 HTTP 或 HTTPS 链接');
      const data = object(await pool.data(config, 'scrapling', 'browser_fetch_once', { url, extraction_type: 'markdown', timeout: config.timeoutMs }, signal), 'Scrapling');
      if (typeof data.status !== 'number' || !Number.isInteger(data.status)) throw failure('BAD_OUTPUT', 'Scrapling 未返回 HTTP 状态');
      if (data.status < 200 || data.status >= 400) throw failure(`HTTP_${data.status}`, `Scrapling 页面返回 HTTP ${data.status}`);
      const actualUrl = string(data.url) || url;
      if (actualUrl !== url && /\/(?:login|signin|sign-in)(?:\/|$)/i.test(new URL(actualUrl).pathname)) throw failure('AUTH_REQUIRED', '浏览器被重定向到登录页面');
      if (!Array.isArray(data.content) || !data.content.every(item => typeof item === 'string')) throw failure('BAD_OUTPUT', 'Scrapling 未返回正文文本列表');
      const content = data.content.join('\n\n');
      return document('scrapling', actualUrl, content.match(/^#\s+(.+)$/m)?.[1] ?? actualUrl, content, { metadata: { extraction: 'browser-rendered-markdown', contentScope: 'rendered-page', renderedScripts: true, httpStatus: data.status, requestedUrl: url, bodyAvailable: Boolean(content.trim()) } });
    },
  }];
}
