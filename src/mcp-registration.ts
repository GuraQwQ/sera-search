import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { Config } from './types.js';
import { writeAtomic } from './files.js';

const execute = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
export const mcpClientNames = ['codex', 'pi', 'omp', 'claude-code', 'hermes', 'openclaw', 'antigravity'] as const;
export type McpClientName = typeof mcpClientNames[number];
export interface McpServerLauncher { command: string; args: string[] }
export interface McpRegistrationOptions { client: McpClientName; command?: string; configFile?: string; signal?: AbortSignal }
export interface McpRegistration extends McpServerLauncher {
  name: 'sera'; client: McpClientName; status: 'registered' | 'unchanged' | 'pending'; verified: boolean; toolCount: number; configFile?: string; nextSteps?: string[];
}
interface CodexServer { enabled?: boolean; transport?: { type?: string; command?: string; args?: string[] } }

async function exists(path: string, executable = false): Promise<boolean> {
  try { await access(path, executable && process.platform !== 'win32' ? constants.X_OK : constants.F_OK); return (await stat(path)).isFile(); }
  catch { return false; }
}

export async function resolveMcpClientCommand(name: string, explicit?: string, packageNames: readonly string[] = []): Promise<McpServerLauncher> {
  const command = explicit ?? name;
  const paths = isAbsolute(command) || /[\\/]/.test(command) ? [resolve(command)] : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map(directory => join(directory.replace(/^"|"$/g, ''), command));
  const suffixes = process.platform === 'win32' && !extname(command) ? ['.exe', '.cmd', '.ps1', ''] : [''];
  for (const path of [...new Set(paths.flatMap(path => suffixes.map(suffix => path + suffix)))]) {
    if (!await exists(path, true)) continue;
    if (/\.[cm]?js$/i.test(path)) return { command: process.execPath, args: [path] };
    if (/\.[cm]?ts$/i.test(path)) return { ...await resolveMcpClientCommand('bun'), args: [path] };
    if (/\.(?:cmd|ps1|bat)$/i.test(path) || process.platform === 'win32' && !/\.(?:exe|com)$/i.test(path)) {
      const base = dirname(path);
      // npm 的本地和全局入口只解析相邻已知包，不执行 shell 包装器。
      for (const packageName of packageNames) for (const packageRoot of [join(base, '..', packageName), join(base, 'node_modules', packageName)]) {
        let bin: unknown;
        try { const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')); bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[name]; }
        catch { continue; }
        if (typeof bin !== 'string') continue;
        const entry = resolve(packageRoot, bin);
        if (!await exists(entry)) continue;
        if (name === 'codex' && process.platform === 'win32') {
          const triple = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`;
          for (const native of [join(packageRoot, '..', `codex-win32-${process.arch}`, 'vendor', triple, 'bin', 'codex.exe'), join(packageRoot, 'vendor', triple, 'bin', 'codex.exe')]) {
            if (await exists(native)) return { command: resolve(native), args: [] };
          }
        }
        if (/\.[cm]?ts$/i.test(entry)) return { ...await resolveMcpClientCommand('bun'), args: [entry] };
        return { command: process.execPath, args: [entry] };
      }
      continue;
    }
    return { command: path, args: [] };
  }
  throw new Error(`未找到可执行的 ${name} 入口；请先准备客户端，或使用 --mcp-command 指定已有原生入口`);
}

export function runMcpClient(launcher: McpServerLauncher, args: string[], signal: AbortSignal): Promise<string>;
export function runMcpClient(launcher: McpServerLauncher, args: string[], signal: AbortSignal, missing: RegExp): Promise<string | undefined>;
export async function runMcpClient(launcher: McpServerLauncher, args: string[], signal: AbortSignal, missing?: RegExp): Promise<string | undefined> {
  signal.throwIfAborted();
  try {
    const { stdout } = await execute(launcher.command, [...launcher.args, ...args], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, signal });
    return stdout;
  } catch (error) {
    signal.throwIfAborted();
    if (missing?.test(String((error as { stderr?: unknown }).stderr ?? ''))) return undefined;
    throw Object.assign(new Error('MCP 客户端命令未完成，请检查入口和客户端配置后重试'), { code: (error as { code?: unknown }).code });
  }
}

async function readServer(launcher: McpServerLauncher, signal: AbortSignal): Promise<CodexServer | undefined> {
  const output = await runMcpClient(launcher, ['mcp', 'get', 'sera', '--json'], signal, /No MCP server named 'sera' found\./);
  if (output === undefined) return undefined;
  try { return JSON.parse(output) as CodexServer; }
  catch { throw new Error('Codex 未返回有效的 sera MCP 配置，请检查 CLI 版本后重试'); }
}

function matches(server: CodexServer | undefined, launcher: McpServerLauncher): boolean {
  return server?.enabled === true && server.transport?.type === 'stdio' && server.transport.command === launcher.command && JSON.stringify(server.transport.args) === JSON.stringify(launcher.args);
}

export async function verifyMcpServer(launcher: McpServerLauncher, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  const client = new Client({ name: 'sera-mcp-registration', version: '1' });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const transport = new StdioClientTransport({ ...launcher, env, stderr: 'pipe' });
  transport.stderr?.on('data', () => {});
  const cancel = () => { void client.close(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const options = { signal, timeout: 15000 };
    await client.connect(transport, options);
    const tools = await client.listTools(undefined, options);
    const result = await client.callTool({ name: 'sera_capabilities', arguments: { sources: ['bing', 'web'] } }, options);
    const sources = (result.structuredContent as { sources?: { name?: string }[] } | undefined)?.sources;
    if (result.isError || !Array.isArray(sources) || !['bing', 'web'].every(name => sources.some(source => source?.name === name))) throw new Error('CAPABILITIES_UNAVAILABLE');
    return tools.tools.length;
  } catch {
    signal.throwIfAborted();
    throw new Error('SERA MCP 启动或工具验证失败，请检查配置与启动入口后重试');
  } finally {
    signal.removeEventListener('abort', cancel);
    await client.close();
  }
}

export async function createMcpServer(config: Config): Promise<McpServerLauncher> {
  const portable = await exists(join(root, 'bundle.json')) && await exists(join(root, 'portable.mjs'));
  return { command: process.execPath, args: [join(root, portable ? 'portable.mjs' : 'dist/cli.js'), 'mcp', '--home', resolve(config.home), ...(config.configFile ? ['--config', resolve(config.configFile)] : [])] };
}

export async function updateMcpJsonConfig(file: string, patch: (input: Record<string, any>) => void, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  let input: unknown;
  try { input = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('MCP 配置需要有效 UTF-8 JSON，请修正后重试'); input = {}; }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('MCP 配置需要 JSON 对象');
  const before = JSON.stringify(input);
  patch(input as Record<string, any>);
  if (JSON.stringify(input) === before) return false;
  signal.throwIfAborted();
  await writeAtomic(file, JSON.stringify(input, null, 2) + '\n');
  return true;
}

async function onSystemDrive(file: string): Promise<boolean> {
  if (process.platform !== 'win32' || await exists(file)) return false;
  let parent = resolve(file);
  while (true) {
    try { return /^C:\\/i.test(await realpath(parent)); }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    const next = dirname(parent); if (next === parent) return /^C:\\/i.test(parent); parent = next;
  }
}

async function registerCodex(server: McpServerLauncher, command: string | undefined, signal: AbortSignal, toolCount: number): Promise<McpRegistration> {
  const codex = await resolveMcpClientCommand('codex', command, ['@openai/codex']);
  const existing = await readServer(codex, signal), unchanged = matches(existing, server);
  if (!unchanged) {
    if (await onSystemDrive(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml'))) return { name: 'sera', client: 'codex', status: 'pending', verified: true, toolCount, ...server, nextSteps: ['请先将 CODEX_HOME 指向选定的数据目录，再重试注册。'] };
    await runMcpClient(codex, ['mcp', 'add', 'sera', '--', server.command, ...server.args], signal);
    if (!matches(await readServer(codex, signal), server)) throw new Error('Codex 的 sera MCP 配置尚未生效，请检查配置后重试');
  }
  return { name: 'sera' as const, client: 'codex' as const, status: unchanged ? 'unchanged' as const : 'registered' as const, verified: true, toolCount, ...server };
}

function agentConfigFile(client: 'pi' | 'omp'): string {
  if (client === 'pi') return join(resolve(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')), 'mcp.json');
  const profile = (process.env.OMP_PROFILE ?? process.env.PI_PROFILE)?.trim(), base = join(homedir(), process.env.PI_CONFIG_DIR || '.omp');
  if (profile && profile !== 'default') {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(profile) || ['.', '..'].includes(profile) || profile.endsWith('.')) throw new Error('OMP profile 格式有误，请检查 OMP_PROFILE／PI_PROFILE');
    return join(base, 'profiles', profile, 'agent', 'mcp.json');
  }
  return join(resolve(process.env.PI_CODING_AGENT_DIR ?? join(base, 'agent')), 'mcp.json');
}

async function registerPiOrOmp(options: McpRegistrationOptions, server: McpServerLauncher, signal: AbortSignal, toolCount: number): Promise<McpRegistration> {
  const client = options.client as 'pi' | 'omp', file = resolve(options.configFile ?? agentConfigFile(client));
  const report = { name: 'sera' as const, client, verified: true, toolCount, ...server, configFile: file };
  if (!options.configFile && await onSystemDrive(file)) return { ...report, status: 'pending', nextSteps: ['使用 --mcp-config 指定已选定的 MCP 配置文件位置，或设置客户端的数据目录后重试。'] };
  if (!options.configFile || options.command) {
    let launcher: McpServerLauncher;
    try { launcher = await resolveMcpClientCommand(client, options.command, [client === 'pi' ? '@earendil-works/pi-coding-agent' : '@oh-my-pi/pi-coding-agent']); }
    catch { return { ...report, status: 'pending', nextSteps: ['请提供已有原生客户端入口，或使用 --mcp-config 指定该客户端实际读取的 MCP 配置文件。'] }; }
    let help: string;
    try { help = await runMcpClient(launcher, client === 'pi' ? ['mcp', '--help'] : ['--version'], signal); }
    catch (error) { signal.throwIfAborted(); if (client !== 'pi') throw error; return { ...report, status: 'pending', nextSteps: ['当前 pi 入口未通过 MCP 帮助探测；请检查入口版本，或指定已配置 MCP 扩展实际读取的配置文件。'] }; }
    if (client === 'pi' && !/mcp add/.test(help)) return { ...report, status: 'pending', nextSteps: ['当前 pi 入口未声明原生 MCP 支持；请更新客户端，或指定已配置 MCP 扩展实际读取的配置文件。'] };
  }
  const changed = await updateMcpJsonConfig(file, input => {
    if (input.mcpServers !== undefined && (!input.mcpServers || typeof input.mcpServers !== 'object' || Array.isArray(input.mcpServers))) throw new Error('MCP 配置的 mcpServers 需要 JSON 对象');
    const previous = input.mcpServers?.sera;
    if (previous !== undefined && (!previous || typeof previous !== 'object' || Array.isArray(previous))) throw new Error('sera MCP 配置需要 JSON 对象，原配置已保留');
    const entry = { ...previous, type: 'stdio', ...server, enabled: true };
    for (const key of ['url', 'serverUrl', 'httpUrl', 'headers', 'httpHeaders', 'transport', 'auth', 'oauth', 'disabled']) delete entry[key];
    input.mcpServers = { ...input.mcpServers, sera: entry };
    if (client === 'omp') {
      input.$schema ??= 'https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json';
      if (input.disabledServers !== undefined && !Array.isArray(input.disabledServers)) throw new Error('OMP disabledServers 需要数组，原配置已保留');
      if (Array.isArray(input.disabledServers)) input.disabledServers = input.disabledServers.filter((name: unknown) => name !== 'sera');
    }
  }, signal);
  const saved = JSON.parse(await readFile(file, 'utf8')), entry = saved.mcpServers?.sera;
  if (!entry || entry.type !== 'stdio' || entry.command !== server.command || JSON.stringify(entry.args) !== JSON.stringify(server.args) || entry.enabled !== true || entry.disabled === true || client === 'omp' && saved.disabledServers?.includes('sera')) throw new Error('客户端的 sera MCP 配置回读不一致，请检查配置后重试');
  return { ...report, status: changed ? 'registered' : 'unchanged', nextSteps: [client === 'pi' ? '在 pi 会话运行 /reload 后使用 /mcp 查看 sera；替代 MCP 扩展启用时，请确认它读取此配置文件。' : '在 OMP 会话运行 /mcp reload 后用 /mcp test sera 验证。'] };
}

export async function registerMcp(config: Config, options: McpRegistrationOptions): Promise<McpRegistration> {
  if (!(mcpClientNames as readonly string[]).includes(options.client)) throw new Error('MCP 客户端名称不受支持');
  if (options.client === 'codex' && options.configFile) throw new Error('Codex 使用 CODEX_HOME 定位配置；请设置 CODEX_HOME 后重试');
  const signal = AbortSignal.any([AbortSignal.timeout(60000), ...(options.signal ? [options.signal] : [])]);
  signal.throwIfAborted();
  const server = await createMcpServer(config), toolCount = await verifyMcpServer(server, signal);
  if (options.client === 'codex') return registerCodex(server, options.command, signal, toolCount);
  if (options.client === 'pi' || options.client === 'omp') return registerPiOrOmp(options, server, signal, toolCount);
  const { registerAgentClient } = await import('./mcp-agent-clients.js');
  return registerAgentClient(config, options, server, signal, toolCount);
}
