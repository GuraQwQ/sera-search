import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './files.js';
import { object, response } from './providers/shared.js';

export const componentNames = ['ghgrab', 'scrapling', 'metadata-parser'] as const;
export type ComponentName = typeof componentNames[number];
interface InstallOptions {
  home: string;
  file: string;
  components: ComponentName[];
  python?: string;
  browser?: string;
  signal?: AbortSignal;
}
export interface ComponentResult { name: ComponentName; status: 'ready' | 'error'; version?: string; message?: string }
const markerName = '.sera-managed-cache.json';
const markerKind = 'sera-integration-cache';
const cacheSetups = new Map<string, Promise<string>>();

function inside(home: string, target: string): boolean {
  const path = relative(home, target);
  return Boolean(path) && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function directory(home: string, ...segments: string[]): Promise<string> {
  let current = home;
  for (const segment of segments) {
    current = join(current, segment);
    await mkdir(current, { recursive: true });
    current = await realpath(current);
    if (!inside(home, current)) throw new Error('组件目录实际路径超出 SERA home');
  }
  return current;
}

function managedCache(home: string): Promise<string> {
  const setup = cacheSetups.get(home) ?? prepareCache(home).finally(() => cacheSetups.delete(home));
  cacheSetups.set(home, setup);
  return setup;
}

async function prepareCache(home: string): Promise<string> {
  const cache = await directory(home, 'cache', 'integrations'), marker = join(cache, markerName);
  try {
    const value = JSON.parse(await readFile(marker, 'utf8')) as { kind?: unknown };
    if (value?.kind !== markerKind) throw new Error('组件缓存目录缺少有效的 SERA 管理标记');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if ((await readdir(cache)).length) throw new Error('已有组件缓存目录尚未由 SERA 管理，请保留其内容并另选 home');
    await writeAtomic(marker, JSON.stringify({ kind: markerKind, version: 1 }) + '\n', true);
    if (JSON.parse(await readFile(marker, 'utf8')).kind !== markerKind) throw new Error('组件缓存管理标记不一致');
  }
  return cache;
}

export async function integrationEnvironment(home: string): Promise<Record<string, string>> {
  await mkdir(resolve(home), { recursive: true });
  const root = await realpath(resolve(home));
  await managedCache(root);
  const paths = {
    TEMP: await directory(root, 'cache', 'integrations', 'tmp'),
    XDG_CACHE_HOME: await directory(root, 'cache', 'integrations', 'runtime'),
    PIP_CACHE_DIR: await directory(root, 'cache', 'integrations', 'pip'),
    PYTHONPYCACHEPREFIX: await directory(root, 'cache', 'integrations', 'python'),
    PLAYWRIGHT_BROWSERS_PATH: await directory(root, 'tools', 'browsers'),
    XDG_CONFIG_HOME: await directory(root, 'tools', 'state', 'config'),
    XDG_DATA_HOME: await directory(root, 'tools', 'state', 'data'),
    APPDATA: await directory(root, 'tools', 'state', 'roaming'),
    LOCALAPPDATA: await directory(root, 'tools', 'state', 'local'),
  };
  const overrides = { ...paths, TMP: paths.TEMP, TMPDIR: paths.TEMP, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  const replaced = new Set(Object.keys(overrides).map(key => key.toUpperCase()));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !replaced.has(entry[0].toUpperCase())));
  return { ...env, ...overrides };
}

export async function cleanIntegrationCache(home: string): Promise<{ removed: boolean; path: string }> {
  const cache = join(resolve(home), 'cache', 'integrations');
  try {
    const root = await realpath(resolve(home)), actual = await realpath(cache);
    if (!inside(root, actual)) throw new Error('组件缓存实际路径超出 SERA home');
    for (const path of [join(resolve(home), 'cache'), cache]) if ((await lstat(path)).isSymbolicLink()) throw new Error('组件缓存路径包含符号链接，已保留内容');
    if (JSON.parse(await readFile(join(cache, markerName), 'utf8')).kind !== markerKind) throw new Error('组件缓存目录缺少有效的 SERA 管理标记');
    const check = async (path: string): Promise<void> => {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !inside(root, await realpath(path))) throw new Error('组件缓存包含符号链接或外部路径，已保留内容');
      if (info.isDirectory()) for (const name of await readdir(path)) await check(join(path, name));
    };
    await check(cache);
    await rm(cache, { recursive: true });
    return { removed: true, path: cache };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try { await lstat(cache); } catch (missing) { if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return { removed: false, path: cache }; }
    }
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function run(command: string, args: string[], env: Record<string, string>, cwd: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, env, cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString('utf8')).slice(-262144); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-262144); });
    child.once('error', reject);
    child.once('close', code => {
      if (signal?.aborted) reject(signal.reason);
      else if (code !== 0) reject(new Error(`${command} 执行失败：${stderr.trim().slice(-2000) || `退出码 ${String(code)}`}`));
      else accept(stdout.trim());
    });
  });
}

async function pythonEnvironment(options: InstallOptions, env: Record<string, string>): Promise<string> {
  const root = await realpath(resolve(options.home)), path = await directory(root, 'tools', 'python');
  const python = join(path, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const probe = async () => {
    if (!await exists(python) || !await exists(join(path, 'pyvenv.cfg'))) return false;
    try { return resolve(await run(python, ['-c', 'import sys; assert sys.prefix != sys.base_prefix; print(sys.prefix)'], env, root, options.signal)) === path; }
    catch (error) { if (options.signal?.aborted) throw error; return false; }
  };
  if (!await probe()) {
    let base: string | undefined;
    for (const candidate of options.python ? [options.python] : ['python', 'python3']) {
      try { await run(candidate, ['-c', 'import sys; assert sys.version_info >= (3, 10); print(sys.executable)'], env, root, options.signal); base = candidate; break; }
      catch (error) { if (options.signal?.aborted) throw error; }
    }
    if (!base) throw new Error('未找到可用的 Python 3.10+，请用 --python 指定已有解释器');
    await run(base, ['-m', 'venv', '--without-pip', path], env, root, options.signal);
    if (!await probe()) throw new Error('Python 虚拟环境尚未完整建立，请检查解释器后重试 install');
  }
  try { await run(python, ['-m', 'pip', '--version'], env, root, options.signal); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    await run(python, ['-m', 'ensurepip', '--upgrade'], env, root, options.signal);
    await run(python, ['-m', 'pip', '--version'], env, root, options.signal);
  }
  return python;
}

async function pythonComponent(name: 'scrapling' | 'metadata-parser', options: InstallOptions, env: Record<string, string>) {
  const python = await pythonEnvironment(options, env), home = await realpath(resolve(options.home));
  const bin = join(home, 'tools', 'python', process.platform === 'win32' ? 'Scripts' : 'bin');
  const bridge = fileURLToPath(new URL('../bridges/metadata_parser.py', import.meta.url));
  const command = name === 'scrapling' ? join(bin, process.platform === 'win32' ? 'scrapling-mcp.exe' : 'scrapling-mcp') : python;
  const args = name === 'scrapling' ? options.browser ? ['--executable-path', resolve(options.browser)] : [] : [bridge];
  if (name === 'scrapling' && options.browser && !await exists(resolve(options.browser))) throw new Error('指定的浏览器可执行文件不存在');
  if (name === 'metadata-parser' && !await exists(bridge)) throw new Error('metadata_parser 桥接入口文件不存在');
  const verify = async () => {
    const version = await run(python, ['-c', `import importlib.metadata; import ${name === 'scrapling' ? 'scrapling' : 'metadata_parser'}; print(importlib.metadata.version(${JSON.stringify(name === 'scrapling' ? 'scrapling' : 'metadata-parser')}))`], env, home, options.signal);
    if (!(name === 'scrapling' ? /^0\.5(?:\.|$)/ : /^2(?:\.|$)/).test(version)) throw new Error(`${name} ${version} 不在当前接口兼容范围内`);
    if (!await exists(command)) throw new Error(`${name} 后端入口尚未完整建立`);
    if (name === 'scrapling') await run(command, ['--help'], env, home, options.signal);
    return version;
  };
  let version: string;
  try { version = await verify(); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--cache-dir', env.PIP_CACHE_DIR!, '--force-reinstall',
      name === 'scrapling' ? 'scrapling[ai]>=0.5,<0.6' : 'metadata-parser>=2,<3'], env, home, options.signal);
    version = await verify();
  }
  if (name === 'scrapling' && !options.browser) {
    const browser = async () => run(python, ['-c', 'from patchright.sync_api import sync_playwright\nwith sync_playwright() as p: print(p.chromium.executable_path)'], env, home, options.signal);
    let installed = false;
    try { installed = await exists(await browser()); } catch (error) { if (options.signal?.aborted) throw error; }
    if (!installed) {
      const cli = join(bin, process.platform === 'win32' ? 'scrapling.exe' : 'scrapling');
      if (!await exists(cli)) throw new Error('Scrapling 浏览器安装入口不存在，请重试 install');
      await run(cli, ['install', '--force'], env, home, options.signal);
      // Scrapling CLI 安装 Playwright；版本不同时补齐实际使用的 Patchright 浏览器。
      if (!await exists(await browser())) await run(python, ['-m', 'patchright', 'install', 'chromium'], env, home, options.signal);
      if (!await exists(await browser())) throw new Error('Scrapling 浏览器安装尚未完成，请重试 install');
    }
  }
  return { command, args, version };
}

async function ghgrab(options: InstallOptions, env: Record<string, string>) {
  const asset = process.platform === 'win32' && process.arch === 'x64' ? 'ghgrab-win32.exe'
    : ['linux', 'darwin'].includes(process.platform) && ['x64', 'arm64'].includes(process.arch)
      ? `ghgrab-${process.platform}${process.arch === 'arm64' ? '-arm64' : ''}` : undefined;
  if (!asset) throw new Error(`ghgrab v2.3.0 不支持当前平台 ${process.platform}/${process.arch}`);
  const home = await realpath(resolve(options.home)), directoryPath = await directory(home, 'tools', 'ghgrab');
  const command = join(directoryPath, process.platform === 'win32' ? 'ghgrab.exe' : 'ghgrab');
  const verify = async (path: string) => {
    const output = await run(path, ['--version'], env, home, options.signal);
    if (!/\b2\.3\.0\b/.test(output)) throw new Error('ghgrab 版本不符合 v2.3.0 接口兼容要求');
  };
  try { if (await exists(command)) { await verify(command); return { command, args: ['mcp'], version: '2.3.0' }; } }
  catch (error) { if (options.signal?.aborted) throw error; }
  const release = 'https://github.com/abhixdd/ghgrab/releases/download/v2.3.0';
  const checksums = object(await (await response(`${release}/checksums.json`, { signal: options.signal }, 'ghgrab 校验清单')).json(), 'ghgrab 校验清单');
  const checksum = checksums[asset];
  if (typeof checksum !== 'string' || !/^[a-f\d]{64}$/i.test(checksum)) throw new Error('ghgrab 发行校验清单缺少该平台的 SHA-256');
  const temporary = join(env.TEMP!, `.sera-download-${randomUUID()}${process.platform === 'win32' ? '.exe' : ''}`);
  try {
    const result = await response(`${release}/${asset}`, { signal: options.signal }, 'ghgrab 下载');
    const bytes = Buffer.from(await result.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== checksum.toLowerCase()) throw new Error('ghgrab 下载 SHA-256 与发行清单不一致');
    options.signal?.throwIfAborted();
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o755 });
    await chmod(temporary, 0o755);
    await verify(temporary);
    options.signal?.throwIfAborted();
    await rename(temporary, command);
    return { command, args: ['mcp'], version: '2.3.0' };
  } finally { await rm(temporary, { force: true }); }
}

export async function installComponents(options: InstallOptions): Promise<{ components: ComponentResult[] }> {
  const names = [...new Set(options.components)], components: ComponentResult[] = [];
  if (!names.every(name => componentNames.includes(name))) throw new Error('组件仅支持 ghgrab、scrapling、metadata-parser');
  if (!names.length) return { components };
  let env: Record<string, string>;
  try { options.signal?.throwIfAborted(); env = await integrationEnvironment(options.home); }
  catch (error) { return { components: names.map(name => ({ name, status: 'error', message: error instanceof Error ? error.message : String(error) })) }; }
  for (const name of names) {
    try {
      options.signal?.throwIfAborted();
      const installed = name === 'ghgrab' ? await ghgrab(options, env) : await pythonComponent(name, options, env);
      options.signal?.throwIfAborted();
      let config: Record<string, unknown> = {};
      try { config = JSON.parse(await readFile(resolve(options.file), 'utf8')) as Record<string, unknown>; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('用户配置需要 JSON 对象，现有内容已保留');
      const previous = config[name];
      config[name] = { ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}), command: installed.command, args: installed.args, enabled: true };
      await writeAtomic(resolve(options.file), JSON.stringify(config, null, 2) + '\n');
      components.push({ name, status: 'ready', version: installed.version });
    } catch (error) { components.push({ name, status: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }
  return { components };
}
