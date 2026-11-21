import { spawn } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandConfig, Config } from './types.js';

const names = ['ghgrab', 'scrapling', 'metadata-parser', 'aliens-eye', 'sherlock', 'gods-eye-view', 'opencli', 'agent-reach'] as const;
type SetupCommandName = typeof names[number];
export interface SetupCommandDiscoveryResult { name: SetupCommandName; command?: CommandConfig; status: 'ready' | 'missing' | 'timeout' | 'cancelled' | 'error'; message: string }
const root = fileURLToPath(new URL('../', import.meta.url));

async function exists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function executablePaths(command: string): Promise<string[]> {
  const paths = isAbsolute(command) || /[\\/]/.test(command) ? [resolve(command)] : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map(directory => join(directory.replace(/^"|"$/g, ''), command));
  const suffixes = process.platform === 'win32' && !extname(command) ? ['.exe', '.com', '.cmd', '.ps1'] : [''];
  const found = await Promise.all(paths.flatMap(path => suffixes.map(async suffix => {
    const full = path + suffix;
    try { await access(full, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return await exists(full) ? full : undefined; } catch { return undefined; }
  })));
  return [...new Set(found.filter((path): path is string => Boolean(path)))];
}

async function normalize(command: CommandConfig, config: Config): Promise<CommandConfig | undefined> {
  if (/^(?:npx|npm|pnpm|yarn|bunx|uvx|uv|pip|cmd|powershell|pwsh|sh|bash)(?:\.(?:exe|cmd|ps1|bat))?$/i.test(basename(command.command))) return undefined;
  const candidate = !isAbsolute(command.command) && /[\\/]/.test(command.command) ? resolve(config.home, command.command) : command.command;
  const candidates = await executablePaths(candidate);
  for (const path of candidates) {
    if (!/\.(cmd|ps1|bat)$/i.test(path)) return { ...command, command: path, args: [...command.args] };
    const source = await readFile(path, 'utf8'), base = dirname(path);
    // 只识别 npm 生成的脚本入口，避免执行命令包装器中的环境修改与任意 shell 语句。
    const nodeEntry = source.match(/["'](?:%dp0%[\\/]|\$basedir[\\/])([^"'\r\n]+\.(?:[cm]?js))["']/i)?.[1];
    if (nodeEntry?.replaceAll('\\', '/').startsWith('node_modules/') && /(?:%\*|\$args)/i.test(source)) {
      const entry = resolve(base, nodeEntry.replace(/[\\/]/g, process.platform === 'win32' ? '\\' : '/'));
      const runtime = await exists(join(base, 'node.exe')) ? join(base, 'node.exe') : process.execPath;
      if (await exists(entry)) return { ...command, command: runtime, args: [entry, ...command.args] };
    }
    const pythonEntry = source.match(/^\s*@?["']([^"'\r\n]*python(?:3(?:\.\d+)?)?\.exe)["']\s+["']([^"'\r\n]+\.py)["']\s+%\*\s*$/im);
    if (pythonEntry && source.trim().split(/\r?\n/).filter(line => line.trim() && !/^@?echo\s+off$/i.test(line.trim())).length === 1
      && await exists(pythonEntry[1]!) && await exists(pythonEntry[2]!)) return { ...command, command: pythonEntry[1]!, args: [pythonEntry[2]!, ...command.args] };
  }
  return undefined;
}

function environment(config: Config): NodeJS.ProcessEnv {
  const home = resolve(config.home), cache = join(home, 'cache', 'integrations');
  return { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
    XDG_CACHE_HOME: join(cache, 'runtime'), XDG_CONFIG_HOME: join(home, 'tools', 'state', 'config'), XDG_DATA_HOME: join(home, 'tools', 'state', 'data'),
    APPDATA: join(home, 'tools', 'state', 'roaming'), LOCALAPPDATA: join(home, 'tools', 'state', 'local'), TEMP: join(cache, 'tmp'), TMP: join(cache, 'tmp'), TMPDIR: join(cache, 'tmp'),
    PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_INDEX: '1', PIP_CACHE_DIR: join(cache, 'pip'), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    PLAYWRIGHT_BROWSERS_PATH: join(home, 'tools', 'browsers'), METADATA_PARSER__DISABLE_TLDEXTRACT: '1' };
}

async function run(command: string, args: string[], config: Config, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let cwd = root; try { if ((await stat(config.home)).isDirectory()) cwd = resolve(config.home); } catch { /* 新 home 尚未建立时仅验证已有绝对入口。 */ }
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: 'ignore', env: environment(config), cwd, signal });
    child.once('error', reject);
    child.once('close', code => signal.aborted ? reject(signal.reason) : code === 0 ? accept() : reject(new Error('PROBE_FAILED')));
  });
}

async function browser(): Promise<string | undefined> {
  const candidates = [process.env.SERA_BROWSER, ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter((value): value is string => Boolean(value)).flatMap(base => [join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')]),
    ...(await Promise.all(['msedge', 'chrome', 'chromium', 'chromium-browser'].map(executablePaths))).flat(), '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const candidate of candidates) if (candidate && await exists(candidate)) return resolve(candidate);
  return undefined;
}

async function probe(name: SetupCommandName, command: CommandConfig, config: Config, signal: AbortSignal): Promise<void> {
  const executable = basename(command.command).toLowerCase();
  if (/^(?:npx|npm|pnpm|yarn|bunx|uvx|uv|pip)(?:\.exe)?$/.test(executable) || command.args.includes('pip')) throw new Error('INSTALL_COMMAND');
  const entry = command.args.find(arg => /\.(?:py|[cm]?js)$/i.test(arg));
  if (entry && /^(?:npm-cli|npx-cli|pnpm|yarn)\.(?:[cm]?js)$/i.test(basename(entry))) throw new Error('INSTALL_COMMAND');
  if (entry && !await exists(isAbsolute(entry) ? entry : resolve(config.home, entry))) throw new Error('ENTRY_MISSING');
  if (name === 'scrapling') {
    const index = command.args.indexOf('--executable-path'), path = index >= 0 ? command.args[index + 1] : await browser();
    if (!path || !await exists(path)) throw new Error('BROWSER_MISSING');
    if (index < 0) command.args.push('--executable-path', path);
  }
  const pythonOptions = entry ? command.args.slice(0, command.args.indexOf(entry)) : [];
  if (name === 'metadata-parser' && entry && basename(entry) === 'metadata_parser.py') {
    await run(command.command, [...pythonOptions, '-B', '-c', 'import metadata_parser; assert hasattr(metadata_parser, "MetadataParser")'], config, signal); return;
  }
  if ((name === 'aliens-eye' || name === 'sherlock') && entry && basename(entry) === 'accounts.py') {
    const engineArgs = command.args.slice(command.args.indexOf(entry) + 1);
    if (engineArgs.length !== 2 || engineArgs[0] !== '--engine' || engineArgs[1] !== name) throw new Error('BRIDGE_ARGUMENTS');
    const module = name === 'aliens-eye' ? 'aliens_eye.api' : 'sherlock_project.sherlock';
    await run(command.command, [...pythonOptions, '-B', '-c', `import ${module}; from mcp.server.mcpserver import MCPServer${name === 'aliens-eye' ? '; import PIL' : ''}`], config, signal); return;
  }
  const args = name === 'ghgrab' ? [...command.args.filter(arg => arg !== 'mcp'), '--version'] : [...command.args, name === 'gods-eye-view' ? '--check' : '--help'];
  await run(command.command, args, config, signal);
}

function configured(config: Config, name: SetupCommandName): CommandConfig | undefined { return config[name === 'agent-reach' ? 'agentReach' : name]; }
function placeholder(command: CommandConfig): boolean { return command.args.some(arg => /(?:^|[\\/])absolute[\\/]path[\\/]to(?:[\\/]|$)/i.test(arg)); }
function template(name: SetupCommandName, command: CommandConfig): boolean {
  return placeholder(command) || name === 'ghgrab' && command.command === name && command.args.join(' ') === 'mcp' || name === 'scrapling' && command.command === 'scrapling-mcp' && !command.args.length;
}

async function candidates(name: SetupCommandName, config: Config, enabled: boolean | undefined): Promise<CommandConfig[]> {
  const home = resolve(config.home), result: CommandConfig[] = [], python = join(home, 'tools', 'python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const interpreters = [python, process.env.SERA_PYTHON, ...(await executablePaths('python')), ...(await executablePaths('python3'))].filter((value): value is string => Boolean(value));
  if (name === 'ghgrab') result.push({ command: join(home, 'tools', 'ghgrab', process.platform === 'win32' ? 'ghgrab.exe' : 'ghgrab'), args: ['mcp'] });
  else if (name === 'scrapling') {
    const executable = join(home, 'tools', 'python', process.platform === 'win32' ? 'Scripts/scrapling-mcp.exe' : 'bin/scrapling-mcp'), installedBrowser = await browser();
    const args = installedBrowser ? ['--executable-path', installedBrowser] : [];
    result.push({ command: executable, args }, { command: 'scrapling-mcp', args });
  } else if (name === 'metadata-parser' || name === 'aliens-eye' || name === 'sherlock') {
    const bridge = join(root, 'bridges', name === 'metadata-parser' ? 'metadata_parser.py' : 'accounts.py');
    for (const command of [...new Set(interpreters)]) result.push({ command, args: [bridge, ...(name === 'metadata-parser' ? [] : ['--engine', name])] });
  } else if (name === 'gods-eye-view') {
    const nodes = [process.env.SERA_NODE, join(home, 'tools', 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node'), process.execPath, ...(await executablePaths('node24')), ...(await executablePaths('node'))].filter((value): value is string => Boolean(value));
    for (const command of [...new Set(nodes)]) result.push({ command, args: [join(home, 'tools', name, 'server.mjs')] });
  } else result.push({ command: name, args: [] });
  return result.map(command => ({ ...command, ...(enabled === undefined ? {} : { enabled }) }));
}

export async function discoverSetupCommands(config: Config, suppliedSignal?: AbortSignal, selectedNames?: string[]): Promise<SetupCommandDiscoveryResult[]> {
  const selected = names.filter(name => !selectedNames || selectedNames.includes(name));
  const discover = async (name: SetupCommandName): Promise<SetupCommandDiscoveryResult> => {
    const signal = AbortSignal.any([AbortSignal.timeout(config.timeoutMs), ...(suppliedSignal ? [suppliedSignal] : [])]), current = configured(config, name);
    try {
      signal.throwIfAborted();
      const explicit = current && !template(name, current), choices = explicit ? [current] : [...(current && !placeholder(current) ? [current] : []), ...await candidates(name, config, current?.enabled)];
      let present = false;
      for (const choice of choices) {
        signal.throwIfAborted(); const command = await normalize(choice, config); if (!command) continue;
        present = true;
        try {
          await probe(name, command, config, signal);
          return { name, command, status: 'ready', message: command.enabled === false ? '已验证现有入口；当前已停用，可在确认后启用' : '已验证现有本地入口' };
        } catch { if (signal.aborted) signal.throwIfAborted(); }
      }
      return { name, ...(current ? { command: current } : {}), status: present || explicit ? 'error' : 'missing', message: present || explicit ? '现有命令未通过本地验证，请检查入口、运行时与依赖' : '未找到已安装入口，可在安装步骤补齐' };
    } catch {
      return { name, ...(current ? { command: current } : {}), status: suppliedSignal?.aborted ? 'cancelled' : signal.aborted ? 'timeout' : 'error', message: suppliedSignal?.aborted ? '探测已取消' : signal.aborted ? `本地验证超过 ${config.timeoutMs} 毫秒预算，可调整 timeoutMs 后重试` : '本地入口探测失败，请检查现有配置' };
    }
  };
  let next = 0; const results: SetupCommandDiscoveryResult[] = new Array(selected.length);
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
    while (next < selected.length) { const index = next++; results[index] = await discover(selected[index]!); }
  }));
  return results;
}
