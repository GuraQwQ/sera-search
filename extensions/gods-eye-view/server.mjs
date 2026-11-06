import { createInterface } from 'node:readline';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createCatalog } from './catalog.mjs';
import { createMcpServer, parseErrorResponse } from './vendor/src/tools/mcp/protocol.js';
import { closeProviders, checkProviders, scrub } from './transport.mjs';

const info = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('地理扩展的 GRIB/WASM 解码需要 Node.js 24 或更高版本');
const catalog = createCatalog();
if (process.argv.includes('--check')) {
  for (const dependency of Object.keys(info.dependencies)) await import(dependency);
  await checkProviders();
  await (await import('@meri-imperiumi/eccodes-wasm')).createEccodes();
  process.stdout.write(JSON.stringify({ status: 'ready', version: info.version, tools: catalog.list().length }) + '\n');
} else {
  // 上游 provider 的磁盘缓存统一放在 SERA 管理的缓存根目录下。
  const cache = resolve(process.env.XDG_CACHE_HOME || join(process.cwd(), 'cache', 'integrations', 'runtime'), 'gods-eye-view');
  await mkdir(cache, { recursive: true });
  process.chdir(cache);
  const diagnostic = console.error.bind(console);
  for (const name of ['log', 'info', 'debug', 'warn', 'error']) console[name] = (...args) => diagnostic(...args.map(arg => scrub(typeof arg === 'string' ? arg : JSON.stringify(arg))));
  const server = createMcpServer({
    catalog, name: 'sera-gods-eye-view', version: info.version,
    instructions: '按任务选择数据查询工具和区域。综合简报会查询多个来源；AIS 仅收集指定区域内的短时样本。结果中的时间、来源、stale、missing 与截断范围用于后续核验。',
  });
  const running = new Map();
  const work = new Set();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const shutdown = () => { for (const controller of running.values()) controller.abort(); closeProviders(); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', () => { shutdown(); lines.close(); });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch {
      process.stdout.write(JSON.stringify(parseErrorResponse()) + '\n');
      continue;
    }
    if (message.method === 'notifications/cancelled') { running.get(message.params?.requestId)?.abort(); continue; }
    const controller = new AbortController();
    if (message.id != null) running.set(message.id, controller);
    const pending = server.handle(message, { signal: controller.signal }).then(response => {
      if (response && !controller.signal.aborted) process.stdout.write(JSON.stringify(response) + '\n');
    }).catch(error => console.error(error.message)).finally(() => { running.delete(message.id); work.delete(pending); });
    work.add(pending);
  }
  shutdown();
  await Promise.allSettled(work);
}
