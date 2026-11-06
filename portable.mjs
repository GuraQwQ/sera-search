import { readFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { install, configLocation } from './dist/config.js';
import { writeAtomic } from './dist/files.js';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : args.find(value => value.startsWith(name + '='))?.slice(name.length + 1);
};
const locate = (candidates, probe) => {
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try { const path = probe(candidate); if (path) return path; } catch {}
  }
};
const execute = (command, parameters) => execFileSync(command, parameters, { encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commands = name => {
  try { return execute('where.exe', [name]).split(/\r?\n/); } catch { return []; }
};

try {
  const manifest = JSON.parse(await readFile(resolve(root, 'bundle.json'), 'utf8'));
  const full = manifest.components.length > 0;
  const node = locate([process.env.SERA_NODE, process.execPath, ...commands('node'), process.env.NODE_HOME && join(process.env.NODE_HOME, 'node.exe')], candidate => {
    const result = JSON.parse(execute(candidate, ['-e', 'console.log(JSON.stringify({path:process.execPath,major:Number(process.versions.node.split(".")[0])}))']));
    return result.major >= 24 ? result.path : undefined;
  });
  const python = full && locate([process.env.SERA_PYTHON, ...commands('python'), ...commands('python3'), ...commands('py')], candidate => {
    const prefix = /(?:^|[\\/])py\.exe$/i.test(candidate) ? ['-3.13'] : [];
    return execute(candidate, [...prefix, '-c', 'import sys,struct; assert sys.version_info[:2] == (3,13) and struct.calcsize("P") == 8; print(sys.executable)']);
  });
  const browser = full && locate([process.env.SERA_BROWSER, ...commands('msedge'), ...commands('chrome'), ...commands('chromium'),
    ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(base => [join(base, 'Microsoft/Edge/Application/msedge.exe'), join(base, 'Google/Chrome/Application/chrome.exe'), join(base, 'Chromium/Application/chrome.exe')])], candidate => existsSync(candidate) ? resolve(candidate) : undefined);
  const missing = full ? [
    ...(!python ? [{ program: 'Python 3.13 x64', download: 'https://www.python.org/downloads/windows/', override: 'SERA_PYTHON' }] : []),
    ...(!browser ? [{ program: 'Chromium / Microsoft Edge / Google Chrome', download: 'https://www.microsoft.com/edge/download', override: 'SERA_BROWSER' }] : []),
    ...(!node ? [{ program: 'Node.js 24+', download: 'https://nodejs.org/en/download', override: 'SERA_NODE' }] : []),
  ] : [];
  if (args.includes('--check-env')) {
    process.stdout.write(JSON.stringify({ coreNode: process.execPath, node24: node || null, python: python || null, browser: browser || null, missing }, null, 2) + '\n');
    if (missing.length) process.exitCode = 1;
  } else {
    if (missing.length) process.stderr.write(JSON.stringify({ missingPrograms: missing }) + '\n');
    if (full) {
      process.env.PYTHONPATH = [resolve(root, 'dependencies/python'), process.env.PYTHONPATH].filter(Boolean).join(delimiter);
      process.env.PLAYWRIGHT_NODEJS_PATH = node || process.execPath;
    }
    const home = resolve(option('--home') ?? process.env.SERA_HOME ?? resolve(root, 'data'));
    const location = configLocation({ home, file: option('--config') });
    const initialized = await install(location);
    const config = JSON.parse(await readFile(location.file, 'utf8'));
    const template = JSON.parse(await readFile(resolve(root, 'config.example.json'), 'utf8'));
    const markerPath = resolve(home, '.sera-portable.json');
    let previous = {};
    try { previous = JSON.parse(await readFile(markerPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const defaults = {
      ghgrab: { command: resolve(root, 'components/ghgrab/ghgrab.exe'), args: ['mcp'], enabled: true },
      scrapling: { command: python || 'python', args: ['-c', 'from scrapling.cli import mcp; mcp()', ...(browser ? ['--executable-path', browser] : [])], enabled: Boolean(python && browser) },
      'metadata-parser': { command: python || 'python', args: [resolve(root, 'bridges/metadata_parser.py')], enabled: Boolean(python) },
      'aliens-eye': { command: python || 'python', args: [resolve(root, 'bridges/accounts.py'), '--engine', 'aliens-eye'], enabled: Boolean(python) },
      sherlock: { command: python || 'python', args: [resolve(root, 'bridges/accounts.py'), '--engine', 'sherlock'], enabled: Boolean(python) },
      'gods-eye-view': { command: node || process.execPath, args: [resolve(root, 'extensions/gods-eye-view/server.mjs')], enabled: Boolean(node) },
    };
    const saved = { ...previous };
    let changed = false;
    for (const name of manifest.components) {
      const entry = defaults[name];
      if (!entry) throw new Error(`发布包组件标识无效：${name}`);
      const current = config[name], old = previous[name];
      const matches = value => value && current?.command === value.command && JSON.stringify(current.args) === JSON.stringify(value.args);
      const generated = initialized.configCreated || matches(template[name]) || matches(old?.desired) || matches(old?.previous) || matches(old);
      if (generated) {
        const pending = old?.previous && JSON.stringify(current) === JSON.stringify(old.previous) && JSON.stringify(old.previous) !== JSON.stringify(old.desired);
        let userDisabled = old?.userDisabled ?? false;
        if (!pending && matches(old?.desired) && current?.enabled !== old.desired.enabled) userDisabled = current?.enabled === false;
        const updated = { ...entry, enabled: userDisabled ? false : entry.enabled };
        saved[name] = { previous: current, desired: updated, available: entry.enabled, userDisabled };
        config[name] = updated;
        changed ||= JSON.stringify(current) !== JSON.stringify(updated);
      }
    }
    // 先保存可重试的路径迁移记录，启动中断后仍能识别原入口。
    if (JSON.stringify(previous) !== JSON.stringify(saved)) await writeAtomic(markerPath, JSON.stringify(saved, null, 2) + '\n');
    if (changed) await writeAtomic(location.file, JSON.stringify(config, null, 2) + '\n');
    process.env.SERA_HOME = home;
    process.argv = [process.execPath, resolve(root, 'dist/cli.js'), ...args];
    await import('./dist/cli.js');
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
