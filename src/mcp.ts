import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Engine, searchSchema, commentsSchema, imagesSchema, researchSchema, readSchema, focusSchema } from './core.js';
import { errorMessage, loadConfig } from './config.js';
import { login, logout, authStatus } from './auth.js';
import { credentialsSchema, notLoggedIn } from './credentials.js';
import { sourceNames, platformIdPattern, catalogGroups } from './types.js';
import type { Config, CatalogGroup } from './types.js';

export async function startMcp(config: Config) {
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  const server = new McpServer({ name: 'sera-search', version });
  const fresh = async (group?: CatalogGroup) => new Engine(await loadConfig({ home: config.home, file: config.configFile, group: group ?? config.group, catalog: group && group !== config.group ? undefined : config.catalogFile }));
  const group = z.enum(catalogGroups).optional();
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const result = async (run: () => Promise<unknown> | unknown) => {
    try {
      const value = await run();
      const structuredContent = Array.isArray(value) ? { sources: value } : value as Record<string, unknown>;
      const runs = (value as { runs?: { code?: string }[] }).runs;
      const unavailable = runs?.length && runs.every(run => run.code === 'NOT_LOGGED_IN');
      return { content: [{ type: 'text' as const, text: unavailable ? notLoggedIn : JSON.stringify(value) }], structuredContent, isError: (value as { status?: string }).status === 'error' };
    } catch (error) { return { content: [{ type: 'text' as const, text: errorMessage(error, config) }], isError: true }; }
  };
  server.registerTool('sera_capabilities', { description: '首次查询先查看来源、动作与登录状态；未登录渠道不可用，实际网络与配额调用时检查。group 按需选游戏 Wiki 或 Galgame 目录。', inputSchema: z.object({ sources: z.array(z.enum(sourceNames)).min(1).optional(), group }), annotations }, input => result(async () => (await fresh(input.group)).capabilities(input.sources)));
  server.registerTool('sera_channels', { description: '按来源、平台和 group 发现可匹配渠道及状态；发现成功不代表已读取帖子或评论。', inputSchema: z.object({ sources: z.array(z.enum(sourceNames)).min(1).optional(), platform: z.string().optional(), group }), annotations }, (input, context) => result(async () => (await fresh(input.group)).channels({ ...input, signal: context.mcpReq.signal })));
  server.registerTool('sera_search', { description: '检索候选与摘要。默认按 intent 选路，空或无关结果换源；显式 sources 并行聚合。aliases 补充实体别名，已知 URL/ID 可直接 research 或 read。', inputSchema: searchSchema.extend({ group }), annotations }, (input, context) => result(async () => (await fresh(input.group)).search({ ...input, signal: context.mcpReq.signal })));
  server.registerTool('sera_comments', { description: '读取歌曲、视频或授权媒体评论。返回评论ID、父子关系、下一页游标及范围，不将首批结果解释成完整评论区。', inputSchema: commentsSchema, annotations }, (input, context) => result(async () => (await fresh()).comments({ ...input, signal: context.mcpReq.signal })));
  server.registerTool('sera_images', { description: '关键词图片检索或反向识图，使用 query 或 imageUrl；保留图片、来源页和匹配类型，按来源判断能力。', inputSchema: imagesSchema, annotations }, (input, context) => result(async () => (await fresh()).images({ ...input, signal: context.mcpReq.signal })));
  server.registerTool('sera_research', { description: '按预算取原文或结构化记录，已知 URL/ID 直接读取。query/keywords 定位正文，goals/state 仅补待查或冲突字段；候选证据需核验后更新状态。搜索来源不读正文时指定 readSources。', inputSchema: researchSchema.extend({ group }), annotations }, (input, context) => result(async () => (await fresh(input.group)).research({ ...input, signal: context.mcpReq.signal })));
  server.registerTool('sera_read', { description: '按 URL/已知 ID 取原文或元数据并保存证据；query/keywords 返回相关片段，保留全文 ID。默认复用新鲜缓存，refresh 强制联网。', inputSchema: readSchema.extend({ url: z.string().min(1), group }), annotations }, (input, context) => result(async () => (await fresh(input.group)).read(input.url, { ...input, signal: context.mcpReq.signal })));
  server.registerTool('sera_read_many', { description: '一次读取最多20个 URL/已知 ID，三路并行并合并重复请求；逐项返回证据、相关片段和失败，使用同一组读取参数。', inputSchema: readSchema.extend({ urls: z.array(z.string().min(1)).min(1).max(20), group }), annotations }, (input, context) => result(async () => (await fresh(input.group)).readMany(input.urls, { ...input, signal: context.mcpReq.signal })));
  server.registerTool('sera_evidence', { description: '从已保存全文按 query/keywords 定位证据，或用 offset/length 按 Unicode 字符续读，保留时间与版本元数据。', inputSchema: focusSchema.extend({ id: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().min(0).default(0), length: z.number().int().min(1).max(20000).default(4000) }), annotations: { ...annotations, openWorldHint: false } }, input => result(async () => (await fresh()).store.get(input.id, input.offset, input.length, input)));
  const authSchema = z.object({ source: z.enum(sourceNames), platform: z.string().regex(platformIdPattern).optional() });
  server.registerTool('sera_login', { description: '记录用户明确提供的 API Key／API 账号，或通过已配置后端验证平台登录。凭据只写工具数据目录，结果不回显。', inputSchema: authSchema.extend({ credentials: credentialsSchema.optional() }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, (input, context) => result(async () => login((await fresh()).config, input.source, input.credentials, input.platform, context.mcpReq.signal)));
  server.registerTool('sera_logout', { description: '清除指定来源的登录记录，平台会话同时尝试交由对应后端退出。', inputSchema: authSchema, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } }, (input, context) => result(async () => logout((await fresh()).config, input.source, input.platform, context.mcpReq.signal)));
  server.registerTool('sera_auth', { description: '查看登录记录状态，不返回任何密钥或密码。', inputSchema: authSchema.partial(), annotations: { ...annotations, openWorldHint: false } }, input => result(async () => authStatus((await fresh()).config, input.source, input.platform)));
  await server.connect(new StdioServerTransport());
  return server;
}
