import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runFile = promisify(execFile);
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = resolve(root, '.cache/releases', 'v' + manifest.version);
const inputs = resolve(root, '.cache/release-input');
const python = process.env.SERA_BUILD_PYTHON || 'python';
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('当前发布目标是 Windows x64，请在相同平台构建');
await mkdir(output, { recursive: true });
const stage = await mkdtemp(join(output, 'staging-'));
const temporary = join(stage, 'tmp');
await mkdir(temporary);
const env = { ...process.env, TEMP: temporary, TMP: temporary, npm_config_cache: join(root, '.cache/npm') };
const run = async (command, args, cwd = root, overrides = {}) => {
  try { return (await runFile(command, args, { cwd, env: { ...env, ...overrides }, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout.trim(); }
  catch (error) { throw new Error(`${basename(command)} ${args[0]} 失败：${error.stderr || error.message}`); }
};
let npmCli;
for (const candidate of [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]) {
  if (!candidate) continue;
  try { await access(candidate); npmCli = candidate; break; } catch {}
}
if (!npmCli) throw new Error('未找到已有 npm-cli.js');
const npm = (args, cwd = root) => run(process.execPath, [npmCli, ...args], cwd);
const sha256 = async path => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const copy = (source, target) => cp(source, target, { recursive: true, filter: path => !['__pycache__', '.cache', '.gev-cache'].includes(basename(path)) && !path.endsWith('.pyc') });
const components = ['ghgrab', 'scrapling', 'metadata-parser', 'aliens-eye', 'sherlock', 'gods-eye-view'];

try {
  process.stderr.write('构建 SERA 核心并准备两个发布目录\n');
  await npm(['run', 'build']);
  const packed = JSON.parse(await npm(['pack', '--ignore-scripts', '--json', '--pack-destination', stage]))[0];
  if (packed.files.some(file => /(^|\/)(?:tests?|node_modules|\.cache|\.sera)(\/|$)|\.pyc$/.test(file.path))) throw new Error('源码发布清单混入本地依赖或开发资料');
  const archive = join(stage, packed.filename);
  const liteName = `SERA-v${manifest.version}-lite-windows-x64`;
  const fullName = `SERA-v${manifest.version}-full-windows-x64`;
  const lite = join(stage, liteName), full = join(stage, fullName);
  await mkdir(lite);
  await run('tar', ['-xzf', archive, '-C', lite, '--strip-components=1']);
  await cp(join(root, 'package-lock.json'), join(lite, 'package-lock.json'));
  await npm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], lite);
  await writeFile(join(lite, 'bundle.json'), JSON.stringify({ components: [] }, null, 2) + '\n');
  await copy(lite, full);
  process.stderr.write('准备完整版扩展依赖并检查运行环境边界\n');
  await copy(join(inputs, 'python-packages'), join(full, 'dependencies/python'));
  await mkdir(join(full, 'components/ghgrab'), { recursive: true });
  await cp(join(root, '.sera/tools/ghgrab/ghgrab.exe'), join(full, 'components/ghgrab/ghgrab.exe'));
  await npm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], join(full, 'extensions/gods-eye-view'));
  await writeFile(join(full, 'bundle.json'), JSON.stringify({ components }, null, 2) + '\n');
  for (const [directory, expected] of [[lite, []], [full, components]]) {
    const version = await run(process.execPath, [join(directory, 'dist/cli.js'), '--version'], directory);
    if (version !== manifest.version) throw new Error('发布包版本与 package.json 不符');
    const setup = JSON.parse(await readFile(join(directory, 'bundle.json'), 'utf8'));
    if (JSON.stringify(setup.components) !== JSON.stringify(expected)) throw new Error('发布包组件清单不符');
    for (const name of ['data', '.sera', '.cache', 'tests', 'test', 'credentials']) {
      try { await access(join(directory, name)); throw new Error('发布包包含用户状态或开发资料：' + name); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const inspect = async path => {
      for (const item of await readdir(path, { withFileTypes: true })) {
        const target = join(path, item.name);
        if (/^(?:pythonw?|node|chrome|msedge)\.exe$/i.test(item.name)) throw new Error('发布包混入环境程序：' + target);
        if (item.isDirectory()) await inspect(target);
      }
    };
    await inspect(directory);
  }
  await run(python, ['-c', 'import sys; assert sys.version_info[:2] == (3,13); import aliens_eye.api, sherlock_project.sherlock, scrapling, metadata_parser, PIL; from mcp.server.mcpserver import MCPServer; print(sys.prefix)'], full,
    { PYTHONPATH: [join(full, 'dependencies/python'), process.env.PYTHONPATH].filter(Boolean).join(delimiter), PYTHONDONTWRITEBYTECODE: '1' });
  const pythonInfo = JSON.parse(await readFile(join(full, 'dependencies/python/SERA_PACKAGES.json'), 'utf8'));
  for (const directory of [lite, full]) {
    const packages = {
      platform: 'windows-x64', requirements: { node: directory === full ? '>=24' : '>=22', ...(directory === full ? { python: '3.13 x64', browser: 'Chromium / Edge / Chrome' } : {}) },
      components: directory === full ? components : [],
      ...(directory === full ? { python: pythonInfo, ghgrabSha256: await sha256(join(full, 'components/ghgrab/ghgrab.exe')) } : {}),
    };
    await writeFile(join(directory, 'DEPENDENCIES.json'), JSON.stringify(packages, null, 2) + '\n');
  }
  const compression = join(stage, 'zip.py');
  await writeFile(compression, 'import pathlib, sys, zipfile\nsource, target = map(pathlib.Path, sys.argv[1:])\nwith zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:\n    for path in sorted(source.rglob("*")):\n        if path.is_file(): archive.write(path, path.relative_to(source.parent).as_posix())\nwith zipfile.ZipFile(target) as archive:\n    bad = archive.testzip()\n    if bad: raise RuntimeError("ZIP checksum failed: " + bad)\n', 'utf8');
  const assets = [];
  for (const directory of [lite, full]) {
    process.stderr.write(`压缩并校验 ${basename(directory)}\n`);
    const name = basename(directory) + '.zip', pending = join(stage, name), target = join(output, name);
    await run(python, [compression, directory, pending]);
    // 输出目录只覆盖同名构建产物，构建输入和用户数据保持独立。
    if (dirname(target) !== output) throw new Error('发布包目标路径无效');
    await rm(target, { force: true });
    await rename(pending, target);
    assets.push({ name, path: target, sha256: await sha256(target), bytes: (await stat(target)).size });
  }
  await writeFile(join(output, 'SHA256SUMS.txt'), assets.map(asset => `${asset.sha256}  ${asset.name}`).join('\n') + '\n');
  process.stdout.write(JSON.stringify({ version: manifest.version, assets }, null, 2) + '\n');
} catch (error) {
  throw error;
} finally {
  const relativeStage = relative(output, stage);
  if (!relativeStage.startsWith('staging-') || relativeStage.includes('..') || isAbsolute(relativeStage)) throw new Error('临时构建目录无效');
  await rm(stage, { recursive: true });
}
