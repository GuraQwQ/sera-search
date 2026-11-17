#!/usr/bin/env node
import { sourceNameSchema } from './source-schema.js';
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Engine } from './core.js';
import { install, loadConfig, errorMessage } from './config.js';
import { sourceNames, catalogGroups, intents } from './types.js';
import type { SourceName } from './types.js';
import { authStatus, login, logout } from './auth.js';
import { credentialsSchema, notLoggedIn } from './credentials.js';
import { writeAtomic } from './files.js';
import { backendSchema } from './backends.js';
import { componentNames, cleanIntegrationCache } from './components.js';
import { migrateResearchState } from './research.js';
import { contentHash } from './evidence.js';
import { configureSources } from './configuration.js';

const help = `SERA — Search, Extract, Research for Agents

用法：sera <命令> [内容] [选项]

命令：
  install              创建配置；可链接项目 Skill，重复执行保留已有配置
  config               查看运行配置；用 --input JSON文件 校验并更新
  login <来源>         记录 API Key／API 账号，或验证已配置平台的登录
  logout <来源>        清除登录记录，可配 --platform 退出平台
  auth [来源]          查看登录记录，平台记录用 --platform 筛选
  capabilities         列出来源、操作和配置状态
  connectors           导出结构化连接器配置，支持 --sources 筛选
  backend <来源> [工具] 发现或调用仓库、浏览器、账号与地理扩展工具
  channels             发现可匹配的平台，支持 --sources 和 --platform 筛选
  search <查询>        自动选路；指定来源时并行聚合，保留换源记录
  comments <URL>       读取歌曲、视频或授权媒体评论及回复页
  image-search <查询>  关键词图片检索，保留图片及来源页
  reverse-image <URL>  反向识图，查来源页或动画帧匹配
  research <查询>      检索、按发布者分散读取原文并整理证据
  migrate-state        迁移 --state 文件，保留原文件备份
  record --input <文件> 保存外部工具实际取得的材料、原始URL、方法与观察时间
  read <URL或ID>       获取原文，保存证据并定位相关片段
  read-many <URL...>   批量读取，最多20个地址，三路并行
  evidence <ID>        定位或分页读取已保存证据
  clean                清理 SERA 管理的证据与组件缓存
  mcp                  启动使用同一核心的 stdio MCP 服务

通用选项：
  --home <目录>        数据目录；也可设置 SERA_HOME
  --config <文件>      配置文件；也可设置 SERA_CONFIG
  --catalog <文件>     独立站点目录，如 catalogs/galgame.json
  --group <分组>       default、game-wikis、galgame，按需加载目录
  --json               输出机器可读 JSON
  --help               显示帮助
  --version            显示版本
  --stdin              login 从标准输入读取凭据 JSON 或 API Key
  --from-env <变量名>  login 从指定环境变量读取 API Key
  --session-only       login --platform 仅验证已有会话
  --setup              install 引导配置本机组件、环境凭据与平台会话
  --yes                install 无人值守补齐配置，保留待确认项
  --confirm-free-tier <来源列表> install 明确确认指定账号使用免费档
  --mcp-client <列表>  install 注册 codex、pi、omp、claude-code、hermes、openclaw、antigravity
  --mcp-command <路径> 单客户端注册使用指定的已有 CLI 入口
  --mcp-config <文件>  单客户端注册使用指定的 MCP JSON 配置文件

检索与读取：
  --sources <列表>     逗号分隔的来源；read 按所列顺序尝试
  --platform <平台>    目标平台；install 使用 后端:平台，多个用逗号分隔
  --limit <数量>       每个来源的结果数量，默认 5，最大 20
  --github-type <类型> repositories、code 或 issues
  --domain <域名>      可重复，按提供者支持的域名过滤检索
  --since <日期>       YYYY-MM-DD，按提供者支持的发布时间过滤
  --until <日期>       YYYY-MM-DD，查询时间上界；具体时间含义见动作说明
  --content-type <类型> 可重复，按目标材料选择来源，如 subtitle、live-danmaku、paper
  --operation <动作>   从 channels 返回的动作与参数 Schema 选择
  --params <JSON>      动作的结构化参数；也可用 search --input 读取请求文件
  --strategy <策略>    fallback 分阶段换源；cross-check 查询互补来源
  --max-sources <数量> 本轮最多调用的来源数
  --locator <JSON>     read 的片段／事件定位；research 自动传递命中定位
  --at <时间>          Wayback 目标时间，YYYYMMDD 或 YYYYMMDDhhmmss
  --intent <意图>      general、official、feedback、historical、game、galgame、academic、code、images
  --alias <别名>       可重复，补充实体别名；无有效结果时尝试首个不同别名
  --term <词>          可重复，指定发现用词，独立于任务条件
  --exclude-url <URL>  可重复，已知链接不计入搜索新增结果预算
  --query <问题>       read/read-many/evidence 的正文定位问题
  --keyword <关键词>  可重复，定位原文；同义或跨语言词由调用方补充
  --goal <判据>        research 必需判据，可重复；对象与偏好用 --input
  --state <JSON文件>   research 读取并更新 state；新文件按 goals 建立
  --discovery-query <查询> research 本轮发现查询，独立于完整任务
  --target-count <数量> research 需要满足必需条件的对象数量
  --refresh            强制重新读取，跳过 URL 缓存
  --max-age <毫秒>     read/read-many 可复用缓存的最大时长
  --read-limit <数量>  research 的原文预算，默认 5，最大 20
  --read-sources <列表> research 另选正文读取来源，默认遵守 --sources
  --cursor <值>        comments 的下一页游标
  --parent <ID>        comments 的父评论 ID，读取楼中楼
  --order <值>         评论排序，按来源支持的值
  --offset <位置>      evidence 的字符起点，默认 0
  --length <数量>      返回字符预算，read 默认2000，evidence 默认4000，最大20000
  --skill-dir <目录>   install 时链接 sera-search 到此技能根目录
  --components <列表>  install 可选组件：ghgrab,scrapling,metadata-parser,aliens-eye,sherlock,gods-eye-view
  --python <路径>      install 使用已有 Python 创建工具环境
  --browser <路径>     install 或读取时复用已有 Chromium / Edge
  --node <路径>        install 地理扩展使用已有 Node.js 24+
  --input <JSON文件>   config、search、backend、record 或 research 的结构化参数
  --timeout-ms <毫秒>  backend/read/read-many/research 单次调用预算，最大300000
  --raw               web 直接取得原始 HTML/JSON/文本，跳过 Jina

示例：
  sera search "MCP 文档" --sources exa,tavily,brave --json
  sera research "检索增强生成" --sources exa,github --read-limit 4
  sera search "咖啡" --platform xiaohongshu --sources agent-reach
  sera read https://github.com/morluto/rea
`;

function integer(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error('数量参数需要非负整数');
  return Number(value);
}

function sources(value?: string): SourceName[] | undefined {
  return value === undefined ? undefined : z.array(sourceNameSchema).min(1).parse(value.split(',').map(item => item.trim()));
}

async function readResearchState(path: string) {
  let original: string;
  try { original = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const migration = migrateResearchState(JSON.parse(original));
  if (migration.changed) {
    const backup = `${path}.v1-${contentHash(original).slice(0, 16)}.json`;
    if (!await writeAtomic(backup, original, true) && await readFile(backup, 'utf8') !== original) throw new Error('迁移备份与原状态不一致，原状态已保留');
    await writeAtomic(path, JSON.stringify(migration.state, null, 2) + '\n');
  }
  return migration;
}

function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => {
    if (!('name' in item)) return `${item.source}${item.platform ? ' / ' + item.platform : ''}: ${item.status}`;
    const source = item as { name: string; search: boolean; read: boolean; backend?: boolean; configured: boolean; requirement?: string };
    if ((item as { status?: string }).status === notLoggedIn) return `${source.name}: ${notLoggedIn}`;
    return `${source.name}: 搜索=${source.search ? '支持' : '—'}，读取=${source.read ? '支持' : '—'}${source.backend ? '，扩展工具=支持' : ''}，配置=${source.configured ? '已配置；调用时检查可用性' : source.requirement ?? '待配置'}`;
  }).join('\n');
  const report = value as Record<string, any>;
  if (report.runs?.length && !report.hits?.length && !report.content && report.runs.every((run: any) => run.code === 'NOT_LOGGED_IN')) return notLoggedIn;
  if (report.channels) return [
    ...report.channels.map((channel: any) => `${channel.source} / ${channel.platform}: 搜索=${channel.search ? '支持' : '—'}，读取=${channel.read ? '支持' : '—'}，状态=${channel.status ?? (channel.configured ? '可调用' : '待配置')}${channel.browser === undefined ? '' : `，搜索浏览器=${channel.browser ? '需要' : '不需要'}`}`),
    ...report.runs.filter((run: any) => !['ok', 'empty'].includes(run.status)).map((run: any) => `${run.source}: ${run.message ?? run.status}`),
  ].join('\n');
  if (report.documents && !report.hits) return report.documents.map(display).join('\n\n');
  if (report.hits) {
    const lines = [`查询：${report.query}；状态：${report.status}`];
    for (const [index, hit] of report.hits.entries()) lines.push(`\n${index + 1}. ${hit.title}\n${hit.url}\n来源：${hit.sources.join(', ')}\n${hit.snippet}`);
    const pending = report.plan?.pendingActions ?? [];
    if (!report.hits.length) lines.push(pending.length && !report.runs.length ? '待补齐动作参数或选择对应入口。' : '本次查询没有获得匹配结果，请检查来源记录或调整查询。');
    for (const action of pending) lines.push(`${action.source} / ${action.entrypoint}:${action.operation}：${action.required.length ? '待补参数 ' + action.required.join(', ') : '请使用对应入口调用'}`);
    for (const run of report.runs) if (!['ok', 'empty'].includes(run.status)) lines.push(`\n${run.source}: ${run.message ?? run.status}`);
    if (report.documents) {
      lines.push(`\n已读取 ${report.comparison.documentsRead} 份证据：`);
      for (const document of report.documents) {
        if (document.evidence) lines.push(`${document.evidence.id}\n${document.evidence.title} (${document.evidence.contentKind})\n${document.evidence.url}\n${document.content ?? ''}`);
        else if (document.document) lines.push(`${document.document.title}\n${document.document.url}\n${document.content ?? ''}\n${document.cacheWarnings?.join('\n') ?? ''}`);
        else lines.push(document.runs.map((run: any) => `${run.source}: ${run.message ?? run.status}`).join('\n'));
      }
      lines.push(...report.comparison.nextSteps);
      if (report.coverage) lines.push(`满足必需条件：${report.coverage.qualified.length}；已排除：${report.coverage.excluded.length}；待查：${report.coverage.unresolved.length}`,
        ...report.coverage.gaps.map((gap: any) => `${gap.subjectId ?? '任务'}${gap.criterionId ? ' / ' + gap.criterionId : ''}：${gap.reason}`));
      if (report.stateWarnings?.length) lines.push(...report.stateWarnings);
    }
    return lines.join('\n');
  }
  if (report.evidence) return `${report.evidence.title}\n${report.evidence.url}\n类型：${report.evidence.contentKind}\n证据：${report.evidence.id}\n\n${report.content ?? ''}${report.nextSteps?.length ? '\n\n' + report.nextSteps.join('\n') : ''}${report.cacheWarnings?.length ? '\n\n' + report.cacheWarnings.join('\n') : ''}`;
  if (report.content !== undefined) return `${report.document?.title ?? report.title}\n${report.document?.url ?? report.url}\n\n${report.content}${report.nextOffset !== null && report.id ? `\n\n下一段：--offset ${report.nextOffset}` : ''}${report.cacheWarnings?.length ? '\n\n' + report.cacheWarnings.join('\n') : ''}`;
  return JSON.stringify(value, null, 2);
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    home: { type: 'string' }, config: { type: 'string' }, catalog: { type: 'string' }, group: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
    query: { type: 'string' }, keyword: { type: 'string', multiple: true }, alias: { type: 'string', multiple: true }, intent: { type: 'string' }, goal: { type: 'string', multiple: true }, state: { type: 'string' }, refresh: { type: 'boolean' }, raw: { type: 'boolean' }, 'max-age': { type: 'string' },
    term: { type: 'string', multiple: true }, 'exclude-url': { type: 'string', multiple: true }, 'discovery-query': { type: 'string' }, 'target-count': { type: 'string' },
    cursor: { type: 'string' }, parent: { type: 'string' }, order: { type: 'string' },
    sources: { type: 'string' }, platform: { type: 'string' }, stdin: { type: 'boolean' }, 'from-env': { type: 'string' }, limit: { type: 'string' }, 'github-type': { type: 'string' },
    domain: { type: 'string', multiple: true }, since: { type: 'string' }, at: { type: 'string' }, 'read-limit': { type: 'string' }, 'read-sources': { type: 'string' }, offset: { type: 'string' }, length: { type: 'string' }, 'skill-dir': { type: 'string' },
    until: { type: 'string' }, operation: { type: 'string' }, params: { type: 'string' }, 'content-type': { type: 'string', multiple: true }, strategy: { type: 'string' }, 'max-sources': { type: 'string' }, locator: { type: 'string' },
    components: { type: 'string' }, python: { type: 'string' }, browser: { type: 'string' }, node: { type: 'string' }, input: { type: 'string' }, 'timeout-ms': { type: 'string' },
    setup: { type: 'boolean' }, yes: { type: 'boolean' }, 'confirm-free-tier': { type: 'string' },
    'mcp-client': { type: 'string' }, 'mcp-command': { type: 'string' }, 'mcp-config': { type: 'string' },
    'session-only': { type: 'boolean' },
  } });
  if (values.help || (!positionals.length && !values.version)) { process.stdout.write(help); return; }
  if (values.version) { process.stdout.write(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version + '\n'); return; }
  const command = positionals[0], text = positionals.slice(1).join(' ');
  if (command === 'read' && positionals.length !== 2) throw new Error('read 需要一个 URL；批量读取请使用 read-many');
  const location = { home: values.home, file: values.config, catalog: values.catalog, group: values.group === undefined ? undefined : z.enum(catalogGroups).parse(values.group) };
  if (command === 'install') {
    const controller = new AbortController(), cancel = () => controller.abort();
    process.once('SIGINT', cancel);
    let prompt: import('node:readline/promises').Interface | undefined;
    try {
      const components = values.components === undefined ? undefined : z.array(z.enum(componentNames)).min(1).parse(values.components.split(',').map(value => value.trim()));
      const result = await install({ ...location, skillDir: values['skill-dir'], components, python: values.python, browser: values.browser, node: values.node, signal: controller.signal });
      const interactive = Boolean(process.stdin.isTTY && process.stderr.isTTY && !values.json && !values.yes);
      const guided = values.setup || values.yes || values.platform || values['confirm-free-tier'] || interactive;
      let setup;
      if (guided) {
        const { configureSetup } = await import('./setup.js');
        if (interactive) {
          const { createInterface } = await import('node:readline/promises');
          prompt = createInterface({ input: process.stdin, output: process.stderr });
          prompt.on('SIGINT', cancel);
          prompt.on('close', cancel);
        }
        const split = (value?: string) => value?.split(',').map(item => item.trim()).filter(Boolean);
        setup = await configureSetup(await loadConfig({ ...location, home: result.home, file: result.config }), {
          configCreated: result.configCreated, sources: sources(values.sources), platforms: split(values.platform), confirmFreeTier: split(values['confirm-free-tier']), signal: controller.signal,
          ...(prompt ? { ask: (question: string) => prompt!.question(question, { signal: controller.signal }) } : {}),
          ...(!values.json ? { progress: (message: string) => process.stderr.write(message + '\n') } : {}),
        });
      }
      let mcp;
      if (values['mcp-client'] && !controller.signal.aborted) {
        const { registerMcp, mcpClientNames } = await import('./mcp-registration.js');
        const clients = [...new Set(z.array(z.enum(mcpClientNames)).min(1).parse(values['mcp-client'].split(',').map(value => value.trim())))];
        if (clients.length > 1 && (values['mcp-command'] || values['mcp-config'])) throw new Error('--mcp-command 与 --mcp-config 仅适用于单客户端注册');
        const registrations = [];
        const config = await loadConfig({ ...location, home: result.home, file: result.config });
        for (const client of clients) {
          if (controller.signal.aborted) break;
          try { registrations.push(await registerMcp(config, { client, command: values['mcp-command'], configFile: values['mcp-config'], signal: controller.signal })); }
          catch (error) { registrations.push({ client, status: controller.signal.aborted ? 'cancelled' : 'pending', verified: false, message: errorMessage(error, config) }); }
        }
        mcp = { registrations, status: controller.signal.aborted ? 'cancelled' : registrations.some(item => item.status === 'pending') ? 'partial' : 'ready' };
      }
      process.stdout.write(JSON.stringify({ ...result, ...(setup ? { setup } : {}), ...(mcp ? { mcp } : {}) }, null, 2) + '\n');
      if (controller.signal.aborted) process.exitCode = 130;
      else if (result.status === 'error') process.exitCode = 1;
    } finally { prompt?.removeListener('close', cancel); prompt?.close(); process.removeListener('SIGINT', cancel); }
    return;
  }
  const config = await loadConfig(location);
  if (command === 'mcp') { const { startMcp } = await import('./mcp.js'); await startMcp(config); return; }
  const engine = new Engine(config);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  try {
    let result: unknown;
    const selected = sources(values.sources);
    const task = command === 'search' && values.input ? JSON.parse(await readFile(values.input, 'utf8')) : {};
    const search = { ...task, query: text || task.query, sources: selected ?? task.sources, platform: values.platform ?? task.platform, limit: integer(values.limit, task.limit ?? 5), githubType: values['github-type'] ?? task.githubType, domains: values.domain ?? task.domains, since: values.since ?? task.since, until: values.until ?? task.until, at: values.at ?? task.at, aliases: values.alias ?? task.aliases, terms: values.term ?? task.terms, excludeUrls: values['exclude-url'] ?? task.excludeUrls, intent: values.intent === undefined ? task.intent : z.enum(intents).parse(values.intent),
      operation: values.operation ?? task.operation, params: values.params === undefined ? task.params : JSON.parse(values.params), contentTypes: values['content-type'] ?? task.contentTypes, maxSources: values['max-sources'] === undefined ? task.maxSources : integer(values['max-sources'], 1), strategy: values.strategy ?? task.strategy, signal: controller.signal };
    const read = { sources: selected, query: values.query, keywords: values.keyword, length: integer(values.length, 2000), refresh: values.refresh, maxAgeMs: values['max-age'] === undefined ? undefined : integer(values['max-age'], 0), timeoutMs: values['timeout-ms'] === undefined ? undefined : integer(values['timeout-ms'], 20000), browser: values.browser, raw: values.raw, locator: values.locator === undefined ? undefined : JSON.parse(values.locator), contentTypes: values['content-type'], operation: values.operation, params: search.params, signal: controller.signal };
    switch (command) {
      case 'config': result = await configureSources(config, { ...(values.input ? JSON.parse(await readFile(values.input, 'utf8')) : {}), ...(selected ? { sources: selected } : {}) }); break;
      case 'login': {
        const source = sourceNameSchema.parse(text);
        let credentials;
        if (values.stdin) {
          let input = '';
          process.stdin.setEncoding('utf8');
          for await (const chunk of process.stdin) { input += chunk.toString('utf8'); if (Buffer.byteLength(input, 'utf8') > 65536) throw new Error('凭据输入过长'); }
          input = input.trim();
          if (input.startsWith('{')) { try { credentials = credentialsSchema.parse(JSON.parse(input)); } catch { throw new Error('凭据需要有效 JSON：apiKey 或 username/password'); } }
          else credentials = credentialsSchema.parse({ apiKey: input });
        } else if (values['from-env']) credentials = credentialsSchema.parse({ apiKey: process.env[values['from-env']] });
        if (values['session-only'] && !values.platform) throw new Error('--session-only 需要指定 --platform');
        result = await login(config, source, credentials, values.platform, controller.signal, { sessionOnly: values['session-only'] });
        break;
      }
      case 'logout': result = await logout(config, sourceNameSchema.parse(text), values.platform, controller.signal); break;
      case 'auth': result = await authStatus(config, text ? sourceNameSchema.parse(text) : undefined, values.platform); break;
      case 'capabilities': result = engine.capabilities(selected); break;
      case 'connectors': result = { connectors: engine.connectors(selected) }; break;
      case 'backend': {
        const input = values.input ? JSON.parse(await readFile(values.input, 'utf8')) : undefined;
        const request = backendSchema.parse({ source: positionals[1], tool: positionals[2], arguments: input, timeoutMs: values['timeout-ms'] === undefined ? undefined : integer(values['timeout-ms'], 20000) });
        result = await engine.backends.run(config, request, controller.signal);
        break;
      }
      case 'channels': result = await engine.channels({ sources: selected, platform: values.platform, signal: controller.signal }); break;
      case 'search': result = await engine.search(search); break;
      case 'comments': result = await engine.comments({ url: text, sources: selected, limit: integer(values.limit, 20), cursor: values.cursor, parentId: values.parent, order: values.order, signal: controller.signal }); break;
      case 'image-search': result = await engine.images({ query: text, sources: selected, platform: values.platform, operation: values.operation, limit: integer(values.limit, 5), signal: controller.signal }); break;
      case 'reverse-image': result = await engine.images({ imageUrl: text, sources: selected, platform: values.platform, operation: values.operation, limit: integer(values.limit, 5), signal: controller.signal }); break;
      case 'research': {
        const task = values.input ? JSON.parse(await readFile(values.input, 'utf8')) : {};
        let state = task.state, migrationWarnings: string[] = [];
        if (values.state) {
          const migration = await readResearchState(values.state);
          if (migration) { state = migration.state; migrationWarnings = migration.warnings; }
        }
        const report = await engine.research({ ...search, ...task, query: text || task.query, sources: selected ?? task.sources, signal: controller.signal,
          limit: integer(values.limit, task.limit ?? 5), aliases: values.alias ?? task.aliases, terms: values.term ?? task.terms, excludeUrls: values['exclude-url'] ?? task.excludeUrls,
          platform: values.platform ?? task.platform, githubType: values['github-type'] ?? task.githubType, domains: values.domain ?? task.domains, since: values.since ?? task.since, at: values.at ?? task.at, intent: search.intent ?? task.intent,
          until: values.until ?? task.until, operation: values.operation ?? task.operation, params: search.params ?? task.params, contentTypes: values['content-type'] ?? task.contentTypes, maxSources: search.maxSources ?? task.maxSources, strategy: search.strategy ?? task.strategy,
          sourceOptions: task.sourceOptions,
          discoveryQuery: values['discovery-query'] ?? task.discoveryQuery, targetCount: values['target-count'] === undefined ? task.targetCount : integer(values['target-count'], 1),
          readLimit: integer(values['read-limit'], task.readLimit ?? 5), readSources: sources(values['read-sources']) ?? task.readSources, goals: values.goal ?? task.goals, state,
          keywords: values.keyword ?? task.keywords, length: integer(values.length, task.length ?? 2000), refresh: values.refresh ?? task.refresh, timeoutMs: read.timeoutMs ?? task.timeoutMs, browser: read.browser ?? task.browser, raw: read.raw ?? task.raw });
        if (migrationWarnings.length) report.stateWarnings = [...migrationWarnings, ...(report.stateWarnings ?? [])];
        if (values.state && report.state) {
          try { await writeAtomic(values.state, JSON.stringify(report.state, null, 2) + '\n'); }
          catch (error) { if (report.status !== 'error') report.status = 'partial'; report.stateWarnings = [`状态文件未保存：${errorMessage(error, config)}`]; }
        }
        result = report; break;
      }
      case 'migrate-state': {
        if (!values.state) throw new Error('migrate-state 需要 --state JSON文件');
        const migration = await readResearchState(values.state);
        if (!migration) throw new Error('研究状态文件尚不存在，首次研究会创建状态');
        result = { status: 'ok', ...migration }; break;
      }
      case 'read': result = await engine.read(text, read); break;
      case 'read-many': result = await engine.readMany(positionals.slice(1), read); break;
      case 'record': {
        if (!values.input) throw new Error('record 需要 --input JSON文件');
        result = await engine.record(JSON.parse(await readFile(values.input, 'utf8'))); break;
      }
      case 'evidence': result = await engine.store.get(text, integer(values.offset, 0), integer(values.length, 4000), { query: values.query, keywords: values.keyword }); break;
      case 'clean': {
        const evidence = await engine.store.clean();
        try { result = { ...evidence, integrations: await cleanIntegrationCache(config.home) }; }
        catch (error) { result = { ...evidence, status: 'partial', cacheWarnings: [errorMessage(error, config)] }; }
        break;
      }
      default: throw new Error(`未知命令：${command}，使用 sera --help 查看用法`);
    }
    process.stdout.write((values.json ? JSON.stringify(result, null, 2) : display(result)) + '\n');
    if (controller.signal.aborted) process.exitCode = 130;
    else if ((result as { status?: string }).status === 'error' || (result as { isError?: boolean }).isError) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: errorMessage(error, config) }) + '\n');
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally { process.removeListener('SIGINT', cancel); await engine.backends.close(); }
}

main().catch(error => { process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n'); process.exitCode = 1; });
