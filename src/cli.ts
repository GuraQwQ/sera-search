#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Engine } from './core.js';
import { install, loadConfig, errorMessage } from './config.js';
import { sourceNames, catalogGroups, intents } from './types.js';
import type { SourceName } from './types.js';
import { authStatus, login, logout } from './auth.js';
import { credentialsSchema, notLoggedIn } from './credentials.js';

const help = `SERA — Search, Extract, Research for Agents

用法：sera <命令> [内容] [选项]

命令：
  install              创建配置；可链接项目 Skill，重复执行保留已有配置
  login <来源>         记录 API Key／API 账号，或验证已配置平台的登录
  logout <来源>        清除登录记录，可配 --platform 退出平台
  auth [来源]          查看登录记录，平台记录用 --platform 筛选
  capabilities         列出来源、操作和配置状态
  channels             发现可匹配的平台，支持 --sources 和 --platform 筛选
  search <查询>        自动选路；指定来源时并行聚合，保留换源记录
  comments <URL>       读取歌曲、视频或授权媒体评论及回复页
  image-search <查询>  关键词图片检索，保留图片及来源页
  reverse-image <URL>  反向识图，查来源页或动画帧匹配
  research <查询>      检索、按发布者分散读取原文并整理证据
  read <URL或ID>       获取原文，保存证据并定位相关片段
  read-many <URL...>   批量读取，最多20个地址，三路并行
  evidence <ID>        定位或分页读取已保存证据
  clean                清理 SERA 管理的证据缓存，保留配置和其他文件
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

检索与读取：
  --sources <列表>     逗号分隔的来源；read 按所列顺序尝试
  --platform <平台>    通过 Agent Reach / OpenCLI 进行站内搜索
  --limit <数量>       每个来源的结果数量，默认 5，最大 20
  --github-type <类型> repositories、code 或 issues
  --domain <域名>      可重复，按提供者支持的域名过滤检索
  --since <日期>       YYYY-MM-DD，按提供者支持的发布时间过滤
  --at <时间>          Wayback 目标时间，YYYYMMDD 或 YYYYMMDDhhmmss
  --intent <意图>      general、official、feedback、historical、game、galgame、academic、code、images
  --alias <别名>       可重复，补充实体别名；无有效结果时尝试首个不同别名
  --query <问题>       read/read-many/evidence 的正文定位问题
  --keyword <关键词>  可重复，定位原文；同义或跨语言词由调用方补充
  --goal <字段>        research 待核验字段，可重复
  --state <JSON文件>   research 上轮返回的 state，已确认字段停止补查
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
  return value === undefined ? undefined : z.array(z.enum(sourceNames)).min(1).parse(value.split(',').map(item => item.trim()));
}

function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => {
    if (!('name' in item)) return `${item.source}${item.platform ? ' / ' + item.platform : ''}: ${item.status}`;
    const source = item as { name: string; search: boolean; read: boolean; configured: boolean; requirement?: string };
    if ((item as { status?: string }).status === notLoggedIn) return `${source.name}: ${notLoggedIn}`;
    return `${source.name}: 搜索=${source.search ? '支持' : '—'}，读取=${source.read ? '支持' : '—'}，配置=${source.configured ? '已配置；调用时检查可用性' : source.requirement ?? '待配置'}`;
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
    if (!report.hits.length) lines.push('本次查询没有获得匹配结果，请检查来源记录或调整查询。');
    for (const run of report.runs) if (!['ok', 'empty'].includes(run.status)) lines.push(`\n${run.source}: ${run.message ?? run.status}`);
    if (report.documents) {
      lines.push(`\n已读取 ${report.comparison.documentsRead} 份证据：`);
      for (const document of report.documents) {
        if (document.evidence) lines.push(`${document.evidence.id}\n${document.evidence.title} (${document.evidence.contentKind})\n${document.evidence.url}\n${document.content ?? ''}`);
        else if (document.document) lines.push(`${document.document.title}\n${document.document.url}\n${document.content ?? ''}\n${document.cacheWarnings?.join('\n') ?? ''}`);
        else lines.push(document.runs.map((run: any) => `${run.source}: ${run.message ?? run.status}`).join('\n'));
      }
      lines.push(...report.comparison.nextSteps);
    }
    return lines.join('\n');
  }
  if (report.evidence) return `${report.evidence.title}\n${report.evidence.url}\n类型：${report.evidence.contentKind}\n证据：${report.evidence.id}\n\n${report.content ?? ''}${report.cacheWarnings?.length ? '\n\n' + report.cacheWarnings.join('\n') : ''}`;
  if (report.content !== undefined) return `${report.document?.title ?? report.title}\n${report.document?.url ?? report.url}\n\n${report.content}${report.nextOffset !== null && report.id ? `\n\n下一段：--offset ${report.nextOffset}` : ''}${report.cacheWarnings?.length ? '\n\n' + report.cacheWarnings.join('\n') : ''}`;
  return JSON.stringify(value, null, 2);
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    home: { type: 'string' }, config: { type: 'string' }, catalog: { type: 'string' }, group: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
    query: { type: 'string' }, keyword: { type: 'string', multiple: true }, alias: { type: 'string', multiple: true }, intent: { type: 'string' }, goal: { type: 'string', multiple: true }, state: { type: 'string' }, refresh: { type: 'boolean' }, 'max-age': { type: 'string' },
    cursor: { type: 'string' }, parent: { type: 'string' }, order: { type: 'string' },
    sources: { type: 'string' }, platform: { type: 'string' }, stdin: { type: 'boolean' }, 'from-env': { type: 'string' }, limit: { type: 'string' }, 'github-type': { type: 'string' },
    domain: { type: 'string', multiple: true }, since: { type: 'string' }, at: { type: 'string' }, 'read-limit': { type: 'string' }, 'read-sources': { type: 'string' }, offset: { type: 'string' }, length: { type: 'string' }, 'skill-dir': { type: 'string' },
  } });
  if (values.help || (!positionals.length && !values.version)) { process.stdout.write(help); return; }
  if (values.version) { process.stdout.write(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version + '\n'); return; }
  const command = positionals[0], text = positionals.slice(1).join(' ');
  const location = { home: values.home, file: values.config, catalog: values.catalog, group: values.group === undefined ? undefined : z.enum(catalogGroups).parse(values.group) };
  if (command === 'install') { process.stdout.write(JSON.stringify(await install({ ...location, skillDir: values['skill-dir'] }), null, 2) + '\n'); return; }
  const config = await loadConfig(location);
  if (command === 'mcp') { const { startMcp } = await import('./mcp.js'); await startMcp(config); return; }
  const engine = new Engine(config);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  try {
    let result: unknown;
    const selected = sources(values.sources);
    const search = { query: text, sources: selected, platform: values.platform, limit: integer(values.limit, 5), githubType: values['github-type'] as any, domains: values.domain, since: values.since, at: values.at, aliases: values.alias, intent: values.intent === undefined ? undefined : z.enum(intents).parse(values.intent), signal: controller.signal };
    const read = { sources: selected, query: values.query, keywords: values.keyword, length: integer(values.length, 2000), refresh: values.refresh, maxAgeMs: values['max-age'] === undefined ? undefined : integer(values['max-age'], 0), signal: controller.signal };
    switch (command) {
      case 'login': {
        const source = z.enum(sourceNames).parse(text);
        let credentials;
        if (values.stdin) {
          let input = '';
          process.stdin.setEncoding('utf8');
          for await (const chunk of process.stdin) { input += chunk.toString('utf8'); if (Buffer.byteLength(input, 'utf8') > 65536) throw new Error('凭据输入过长'); }
          input = input.trim();
          if (input.startsWith('{')) { try { credentials = credentialsSchema.parse(JSON.parse(input)); } catch { throw new Error('凭据需要有效 JSON：apiKey 或 username/password'); } }
          else credentials = credentialsSchema.parse({ apiKey: input });
        } else if (values['from-env']) credentials = credentialsSchema.parse({ apiKey: process.env[values['from-env']] });
        result = await login(config, source, credentials, values.platform, controller.signal);
        break;
      }
      case 'logout': result = await logout(config, z.enum(sourceNames).parse(text), values.platform, controller.signal); break;
      case 'auth': result = await authStatus(config, text ? z.enum(sourceNames).parse(text) : undefined, values.platform); break;
      case 'capabilities': result = engine.capabilities(selected); break;
      case 'channels': result = await engine.channels({ sources: selected, platform: values.platform, signal: controller.signal }); break;
      case 'search': result = await engine.search(search); break;
      case 'comments': result = await engine.comments({ url: text, sources: selected, limit: integer(values.limit, 20), cursor: values.cursor, parentId: values.parent, order: values.order, signal: controller.signal }); break;
      case 'image-search': result = await engine.images({ query: text, sources: selected, platform: values.platform, limit: integer(values.limit, 5), signal: controller.signal }); break;
      case 'reverse-image': result = await engine.images({ imageUrl: text, sources: selected, platform: values.platform, limit: integer(values.limit, 5), signal: controller.signal }); break;
      case 'research': result = await engine.research({ ...search, readLimit: integer(values['read-limit'], 5), readSources: sources(values['read-sources']), goals: values.goal, state: values.state ? JSON.parse(await readFile(values.state, 'utf8')) : undefined, keywords: values.keyword, length: read.length, refresh: values.refresh }); break;
      case 'read': result = await engine.read(text, read); break;
      case 'read-many': result = await engine.readMany(positionals.slice(1), read); break;
      case 'evidence': result = await engine.store.get(text, integer(values.offset, 0), integer(values.length, 4000), { query: values.query, keywords: values.keyword }); break;
      case 'clean': result = await engine.store.clean(); break;
      default: throw new Error(`未知命令：${command}，使用 sera --help 查看用法`);
    }
    process.stdout.write((values.json ? JSON.stringify(result, null, 2) : display(result)) + '\n');
    if (controller.signal.aborted) process.exitCode = 130;
    else if ((result as { status?: string }).status === 'error') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: errorMessage(error, config) }) + '\n');
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally { process.removeListener('SIGINT', cancel); }
}

main().catch(error => { process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n'); process.exitCode = 1; });
