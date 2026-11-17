import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { resolveMcpClientCommand, runMcpClient, updateMcpJsonConfig } from './mcp-registration.js';
import type { McpRegistrationOptions, McpServerLauncher } from './mcp-registration.js';
import type { Config } from './types.js';

type Entry = Record<string, unknown>;
const transportFields = ['url', 'serverUrl', 'httpUrl', 'headers', 'httpHeaders', 'transport', 'auth', 'oauth', 'sslVerify', 'clientCert', 'clientKey', 'ssl_verify', 'client_cert', 'client_key'];
function object(value: unknown, label: string): Entry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 需要 JSON 对象，原配置已保留`);
  return value as Entry;
}

function parse(value: string, label: string): Entry {
  try { return object(JSON.parse(value), label); }
  catch { throw new Error(`${label} 未返回有效 JSON 对象，请检查客户端版本或配置后重试`); }
}

async function writableLocation(file: string, explicit = false): Promise<string> {
  let path = resolve(file), suffix: string[] = [], exists = false;
  try { exists = (await stat(path)).isFile(); if (!exists) throw new Error('配置位置需要文件路径'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  while (true) {
    try { path = join(await realpath(path), ...suffix); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(path); if (parent === path) throw error;
      suffix.unshift(basename(path)); path = parent;
    }
  }
  if (process.platform === 'win32' && /^c:[\\/]/i.test(path) && !exists && !explicit) throw new Error('默认客户端配置尚未建立且位于 C 盘；JSON 客户端请用 --mcp-config 指定 F 盘位置，Hermes/OpenClaw 请先将客户端配置目录指向 F 盘');
  return path;
}

function stdioEntry(previous: Entry, server: McpServerLauncher, client: string): Entry {
  const next = { ...previous };
  for (const key of transportFields) delete next[key];
  next.command = server.command; next.args = server.args;
  if (client === 'claude-code') { next.type = 'stdio'; delete next.disabled; }
  else { delete next.type; if (client === 'antigravity') { next.disabled = false; delete next.enabled; } else { next.enabled = true; delete next.disabled; } }
  return next;
}

function matches(entry: Entry, server: McpServerLauncher, client: string): boolean {
  return entry.command === server.command && JSON.stringify(entry.args) === JSON.stringify(server.args)
    && (client === 'antigravity' ? entry.disabled !== true : entry.enabled !== false && entry.disabled !== true)
    && (client !== 'claude-code' || entry.type === 'stdio')
    && !transportFields.some(key => key in entry && !(key === 'transport' && entry[key] === 'stdio'));
}

export async function registerAgentClient(_config: Config, options: McpRegistrationOptions, server: McpServerLauncher, signal: AbortSignal, toolCount: number) {
  const client = options.client;
  signal.throwIfAborted();
  let changed = false, configFile: string | undefined;
  if (client === 'claude-code' || client === 'antigravity') {
    if (options.command) throw new Error(`${client} 通过官方 JSON 配置注册，请用 --mcp-config 指定配置文件`);
    const target = options.configFile ?? (client === 'claude-code' ? join(process.env.CLAUDE_CONFIG_DIR ?? homedir(), '.claude.json') : join(homedir(), '.gemini', 'config', 'mcp_config.json'));
    configFile = await writableLocation(target, Boolean(options.configFile));
    changed = await updateMcpJsonConfig(configFile, raw => {
      const servers = raw.mcpServers === undefined ? {} : object(raw.mcpServers, 'mcpServers');
      const previous = servers.sera === undefined ? {} : object(servers.sera, 'sera MCP 配置');
      raw.mcpServers = { ...servers, sera: stdioEntry(previous, server, client) };
    }, signal);
    const saved = parse(await readFile(configFile, 'utf8'), '客户端配置');
    if (!matches(object(object(saved.mcpServers, 'mcpServers').sera, 'sera MCP 配置'), server, client)) throw new Error('客户端的 SERA MCP 配置回读不一致，请检查配置后重试');
  } else if (client === 'hermes' || client === 'openclaw') {
    if (options.configFile) throw new Error(`${client} 使用原生 CLI 管理配置；请通过客户端环境变量或 profile 选择位置`);
    const guess = client === 'hermes'
      ? join(process.env.HERMES_HOME ?? (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'hermes' + (process.env.HERMES_DATA_DIR_SUFFIX ?? '')) : join(homedir(), '.hermes' + (process.env.HERMES_DATA_DIR_SUFFIX ?? ''))), 'config.yaml')
      : process.env.OPENCLAW_CONFIG_PATH ?? join(process.env.OPENCLAW_STATE_DIR ?? join(homedir(), '.openclaw'), 'openclaw.json');
    await writableLocation(guess);
    const launcher = await resolveMcpClientCommand(client, options.command, client === 'openclaw' ? ['openclaw'] : []);
    let existing: Entry | undefined;
    if (client === 'hermes') {
      const path = (await runMcpClient(launcher, ['config', 'path'], signal)).trim();
      if (!isAbsolute(path)) throw new Error('Hermes 未返回绝对配置路径，请检查 CLI 版本后重试');
      configFile = await writableLocation(path);
      const output = await runMcpClient(launcher, ['config', 'get', 'mcp_servers.sera', '--json'], signal, /Config key not set: mcp_servers\.sera(?:\r?\n|$)/);
      if (output !== undefined) existing = parse(output, 'Hermes sera MCP 配置');
    } else {
      const status = parse(await runMcpClient(launcher, ['mcp', 'status', '--json'], signal), 'OpenClaw MCP 状态');
      if (typeof status.path !== 'string' || !isAbsolute(status.path)) throw new Error('OpenClaw 未返回绝对配置路径，请检查 CLI 版本后重试');
      configFile = await writableLocation(status.path);
      const servers = parse(await runMcpClient(launcher, ['mcp', 'list', '--json'], signal), 'OpenClaw MCP 清单');
      if (servers.sera !== undefined) existing = object(servers.sera, 'OpenClaw sera MCP 配置');
    }
    if (!existing || !matches(existing, server, client)) {
      // 客户端的查看接口会脱敏并展开环境引用；只写本次运行字段，保留原始 env 与超时设置。
      if (client === 'hermes' && existing) {
        for (const key of [...transportFields, 'type', 'disabled'].filter(key => key in existing!)) await runMcpClient(launcher, ['config', 'unset', `mcp_servers.sera.${key}`], signal);
        for (const [key, value] of Object.entries({ ...server, enabled: true })) await runMcpClient(launcher, ['config', 'set', `mcp_servers.sera.${key}`, typeof value === 'string' ? value : JSON.stringify(value)], signal);
      } else if (client === 'openclaw' && existing) {
        if (transportFields.some(key => key in existing! && !(key === 'transport' && existing![key] === 'stdio'))) throw new Error('OpenClaw 已有 sera 使用其他传输；请先在客户端移除该条目的 HTTP 设置，再重试注册');
        await runMcpClient(launcher, ['config', 'set', 'mcp.servers.sera', JSON.stringify({ ...server, enabled: true }), '--strict-json', '--merge'], signal);
      } else {
        await runMcpClient(launcher, client === 'hermes' ? ['config', 'set', 'mcp_servers.sera', JSON.stringify({ ...server, enabled: true })] : ['mcp', 'set', 'sera', JSON.stringify({ ...server, enabled: true })], signal);
      }
      changed = true;
      const output = await runMcpClient(launcher, client === 'hermes' ? ['config', 'get', 'mcp_servers.sera', '--json'] : ['mcp', 'show', 'sera', '--json'], signal);
      if (!matches(parse(output, `${client} sera MCP 配置`), server, client)) throw new Error(`${client} 的 SERA MCP 配置回读不一致，请检查客户端配置后重试`);
    }
  } else throw new Error('此客户端没有对应的注册入口');
  return { name: 'sera' as const, client, status: changed ? 'registered' as const : 'unchanged' as const, verified: true, toolCount, ...server, ...(configFile ? { configFile } : {}) };
}
