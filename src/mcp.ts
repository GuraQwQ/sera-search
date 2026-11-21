import { sourceNameSchema } from './source-schema.js';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Engine, searchSchema, commentsSchema, imagesSchema, researchSchema, readSchema, focusSchema, recordSchema } from './core.js';
import { errorMessage, install, loadConfig, loadConfigBootstrap } from './config.js';
import { login, logout, authStatus } from './auth.js';
import { credentialsSchema, notLoggedIn } from './credentials.js';
import { platformIdPattern, catalogGroups } from './types.js';
import type { Config, CatalogGroup, SavedCredentials } from './types.js';
import { BackendPool, backendSchema } from './backends.js';
import { migrateResearchState, researchStateSchema } from './research.js';
import { configureSetup } from './setup.js';
import { componentNames } from './components.js';
import { configurationInputSchema, configureSources } from './configuration.js';

import { backendView, batchReadView, capabilityView, channelView, commentView, connectorView, readReportView, recordView, researchView, searchView, storedEvidenceView } from './output.js';

function inputSchema<T extends z.ZodType>(schema: T, advertised: z.ZodType = schema) {
  const standard = schema['~standard'];
  return { '~standard': { ...standard, jsonSchema: {
    ...standard.jsonSchema,
    input: () => { const { $schema, ...definition } = z.toJSONSchema(advertised, { io: 'input' }); return definition; },
  } } };
}

export async function startMcp(config: Config, profile: 'full' | 'search' = 'full', output: 'dual' | 'structured' = 'dual') {
  const admin = profile === 'full';
  const structuredOnly = output === 'structured';
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  const server = new McpServer({ name: 'sera-search', version });
  const backends = new BackendPool();
  server.server.onclose = () => { void backends.close(); };
  const current = (group?: CatalogGroup) => loadConfig({ home: config.home, file: config.configFile, group: group ?? config.group, catalog: config.catalogOverride });
  const configuration = () => loadConfigBootstrap({ home: config.home, file: config.configFile, group: config.group, catalog: config.catalogOverride });
  const fresh = async (group?: CatalogGroup) => new Engine(await current(group), undefined, backends);
  const group = z.enum(catalogGroups).optional(), full = z.boolean().optional().describe('展开完整数据与诊断');
  const discovery = z.object({ sources: z.array(sourceNameSchema).min(1).optional(), query: z.string().trim().min(1).max(256).optional().describe('按来源、平台、材料或动作筛选'), group, full });
  const hitLimit = (input: { limit?: number; sources?: string[] }) => Math.min(100, (input.limit ?? 5) * (input.sources?.length ?? 1));
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const failure = async (error: unknown, sensitive?: SavedCredentials) => {
    const latest = await current().catch(() => config);
    const redaction = sensitive ? { ...latest, credentials: { ...latest.credentials, 'mcp-input': { kind: 'sera-credential' as const, source: 'mcp-input', credentials: sensitive, status: 'active' as const, updatedAt: new Date().toISOString() } } } : latest;
    return { content: [{ type: 'text' as const, text: errorMessage(error, redaction) }], isError: true };
  };
  const result = async (run: () => Promise<unknown> | unknown, sensitive?: SavedCredentials) => {
    try {
      const value = await run();
      const structuredContent = Array.isArray(value) ? { sources: value } : value as Record<string, unknown>;
      const runs = (value as { runs?: { code?: string }[] }).runs;
      const unavailable = runs?.length && runs.every(run => run.code === 'NOT_LOGGED_IN');
      const isError = (value as { status?: string }).status === 'error';
      return { content: structuredOnly && !unavailable && !isError ? [] : [{ type: 'text' as const, text: unavailable ? notLoggedIn : JSON.stringify(value) }], structuredContent, isError };
    } catch (error) { return failure(error, sensitive); }
  };
  const setupSchema = z.strictObject({ sources: z.array(sourceNameSchema).min(1).optional(), platforms: z.array(z.string().regex(/^(?:opencli|agent-reach):[a-z0-9][a-z0-9_-]*$/i)).min(1).optional(),
    confirmFreeTier: z.array(sourceNameSchema).min(1).optional(), components: z.array(z.enum(componentNames)).min(1).optional(), python: z.string().min(1).optional(), browser: z.string().min(1).optional(), node: z.string().min(1).optional() });
  if (admin) server.registerTool('sera_setup', { description: '在当前服务器的固定 home/config 中补齐配置：检测已有本地入口、从服务器环境登记 Key，并返回缺项。Key 只登记，实际调用时验证；非交互流程只验证已有平台会话，不打开登录页。仅 components 显式选择的组件会下载安装；confirmFreeTier 仅在用户明确确认免费账户后填写，不限制服务端扣费。', inputSchema: inputSchema(setupSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, (input, context) => result(async () => {
    const installation = await install({ home: config.home, file: config.configFile, components: input.components, python: input.python, browser: input.browser, node: input.node, signal: context.mcpReq.signal });
    const setup = await configureSetup(await current(), { sources: input.sources, platforms: input.platforms, confirmFreeTier: input.confirmFreeTier, configCreated: installation.configCreated, signal: context.mcpReq.signal });
    return { ...setup, status: installation.status === 'error' && setup.status === 'ready' ? 'partial' : setup.status, installation };
  }));
  if (admin) server.registerTool('sera_config', { description: '查看或更新当前服务器的来源配置，固定使用当前 home/config；返回脱敏设置与保存结果。凭据通过 sera_login 登记。', inputSchema: inputSchema(configurationInputSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, input => result(async () => configureSources(await configuration(), input)));
  server.registerTool('sera_connectors', { description: '连接器清单。指定 sources 或 full:true 导出协议、动作、认证与映射。', inputSchema: inputSchema(discovery), annotations: { ...annotations, openWorldHint: false } }, input => result(async () => {
    const connectors = (await fresh(input.group)).connectors(input.sources, input.query);
    return { connectors: (input.full ?? Boolean(input.sources)) ? connectors : connectors.map(connectorView) };
  }));
  server.registerTool('sera_capabilities', { description: '来源与状态。指定 sources 或 full:true 查看完整操作定义。', inputSchema: inputSchema(discovery), annotations }, input => result(async () => {
    const sources = (await fresh(input.group)).capabilities(input.sources, input.query);
    return (input.full ?? Boolean(input.sources)) ? sources : sources.map(capabilityView);
  }));
  server.registerTool('sera_channels', { description: '按 platform 查来源和动作。指定 sources 或 full:true 查看参数 Schema。无筛选时列静态渠道。', inputSchema: inputSchema(discovery.extend({ platform: z.string().optional() })), annotations }, (input, context) => result(async () => {
    const detailed = input.full ?? Boolean(input.sources);
    const report = await (await fresh(input.group)).channels({ ...input, live: detailed || Boolean(input.platform || input.sources), signal: context.mcpReq.signal });
    return detailed ? report : channelView(report, Boolean(input.platform));
  }));
  server.registerTool('sera_backend', { description: '只传 source 查看工具 Schema，再传 tool 与 arguments。扩展大结果可按证据 ID 回读，图片保持原内容。', inputSchema: inputSchema(backendSchema.extend({ full })), annotations: { openWorldHint: true } }, async (input, context) => {
    try {
      const response = await backends.run((await fresh()).config, input, context.mcpReq.signal);
      return input.full ? response : backendView(response);
    }
    catch (error) { return failure(error); }
  });
  server.registerTool('sera_search', { description: '按目标contentTypes选择材料；先看channels动作Schema，再传operation/params，各源覆盖用sourceOptions。plan.pendingActions列出待补参数或专用入口，comments/images动作交给对应工具。since/until含义由动作声明。默认分阶段换源，strategy:cross-check查询互补来源，maxSources限制调用预算。保留片段/事件locator与runs.coverage；收录范围和无命中不能证明事件未发生。terms/aliases辅助发现，excludeItems标记已知片段。显式sources最多三路并发。', inputSchema: inputSchema(searchSchema.extend({ group, full })), annotations }, (input, context) => result(async () => ((await fresh(input.group)).search({ ...input, signal: context.mcpReq.signal })).then(report => input.full ? report : searchView(report, hitLimit(input)))));
  server.registerTool('sera_comments', { description: '读取歌曲、视频或授权媒体评论。返回评论 ID、父子关系和续页游标。', inputSchema: inputSchema(commentsSchema.extend({ full })), annotations },
    (input, context) => result(async () => {
      const report = await (await fresh()).comments({ ...input, signal: context.mcpReq.signal });
      return input.full ? report : commentView(report);
    }));
  server.registerTool('sera_images', { description: '关键词图片检索或反向识图，使用 query 或 imageUrl；operation 按 channels 的 images 动作选择，SerpAPI 支持 google_images、bing_images、google_lens。保留图片、来源页和匹配类型。', inputSchema: inputSchema(imagesSchema.extend({ full })), annotations }, (input, context) => result(async () => ((await fresh()).images({ ...input, signal: context.mcpReq.signal })).then(report => input.full ? report : searchView(report, input.limit))));
  const researchInput = researchSchema.extend({ group, full, raw: z.boolean().optional() });
  const researchWire = researchInput.extend({
    state: researchStateSchema.pick({ version: true, subjects: true, criteria: true, assessments: true })
      .loose().describe('续查时传回上轮 state，保留已有字段，按需更新 assessments').optional(),
  });
  server.registerTool('sera_research', { description: '按subjects与criteria取证，kind区分必需条件和偏好，targetCount检查数量。先复用已有证据，再补缺口；discoveryQuery独立于任务。更新state.assessments的结论、outcome、适用scope及citations原文坐标后续查。coverage检查覆盖与引用，nextAction/nextSources由进展和重试状态驱动。', inputSchema: inputSchema(researchInput, researchWire), annotations }, (input, context) => result(async () => ((await fresh(input.group)).research({ ...input, signal: context.mcpReq.signal })).then(report => input.full ? report : researchView(report, hitLimit(input)))));
  if (admin) server.registerTool('sera_migrate_state', { description: '将旧fields研究状态一次性转换为version:2，保留原结论与证据ID；返回新state，不写调用方文件。', inputSchema: inputSchema(z.object({ state: z.record(z.string(), z.unknown()) })), annotations: { ...annotations, openWorldHint: false } }, input => result(() => migrateResearchState(input.state)));
  const readInput = readSchema.extend({ length: focusSchema.shape.length.unwrap().optional(), group, full });
  const wantsPreview = (input: z.infer<typeof readInput>) => !input.raw && input.length === undefined && !input.query && !input.keywords?.length;
  server.registerTool('sera_read', { description: '按URL/ID读取原文或公开数据；contentTypes要求实际材料，operation/params选择channels的read动作。query/keywords定位片段，length指定原文窗口，raw保留原始格式。Steam商店和维基默认可返回清洗预览；用证据ID回读原文。refresh取得新观察，timeoutMs设置单次预算。', inputSchema: inputSchema(readInput.extend({ url: z.string().min(1) })), annotations }, (input, context) => result(async () => ((await fresh(input.group)).read(input.url, { ...input, signal: context.mcpReq.signal })).then(report => input.full ? report : readReportView(report, wantsPreview(input)))));
  server.registerTool('sera_read_many', { description: '一次读取最多20个 URL/已知 ID，三路并行并合并重复请求；逐项返回证据、相关片段和失败，使用同一组读取参数。', inputSchema: inputSchema(readInput.extend({ urls: z.array(z.string().min(1)).min(1).max(20) })), annotations }, (input, context) => result(async () => ((await fresh(input.group)).readMany(input.urls, { ...input, signal: context.mcpReq.signal })).then(report => input.full ? report : batchReadView(report, wantsPreview(input)))));
  server.registerTool('sera_evidence', { description: '从已保存全文按 query/keywords 定位证据，或用 offset/length 按 Unicode 字符续读，保留时间与版本元数据。', inputSchema: inputSchema(focusSchema.extend({ id: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().min(0).default(0), length: z.number().int().min(1).max(20000).default(4000), full })), annotations: { ...annotations, openWorldHint: false } }, input => result(async () => ((await fresh()).store.get(input.id, input.offset, input.length, input)).then(report => input.full ? report : storedEvidenceView(report))));
  const authSchema = z.strictObject({ source: sourceNameSchema, platform: z.string().regex(platformIdPattern).optional() });
  const loginSchema = authSchema.extend({ credentials: credentialsSchema.strict().refine(value => Object.keys(value).length > 0, '凭据需要至少一个字段').optional(), fromEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(), sessionOnly: z.boolean().optional() }).superRefine((input, context) => {
    if ([input.credentials, input.fromEnv, input.platform].filter(value => value !== undefined).length !== 1) context.addIssue({ code: 'custom', message: 'credentials、fromEnv、platform 需要且只能选择一项' });
    if (input.sessionOnly !== undefined && !input.platform) context.addIssue({ code: 'custom', path: ['sessionOnly'], message: 'sessionOnly 仅用于平台会话验证' });
  });
  server.registerTool('sera_record', { description: '保存宿主搜索、浏览器或其他工具实际取得的材料；必填原始URL、内容、方法与观察时间，source为external，保留采集和导入时间。证据ID不表示主张已核验。', inputSchema: inputSchema(recordSchema.extend({ full })), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, input => result(async () => ((await fresh()).record(input)).then(report => input.full ? report : recordView(report))));
  if (admin) server.registerTool('sera_login', { description: '登记明确提供的 credentials，或用 fromEnv 读取服务器环境中的 Key；两者与 platform 互斥。Key 仅保存，实际调用时验证，结果不回显。platform 通过已配置后端登录；sessionOnly:true 仅验证已有会话，不打开登录页。', inputSchema: inputSchema(loginSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, (input, context) => {
    const credentials = input.fromEnv ? { apiKey: process.env[input.fromEnv]?.trim() } : input.credentials;
    return result(async () => {
      if (input.fromEnv && !credentials?.apiKey) throw new Error('服务器环境中未找到非空 Key，请先设置对应环境变量');
      const latest = await current();
      return login(latest, input.source, credentials, input.platform, context.mcpReq.signal, { sessionOnly: input.sessionOnly, preserveCredentials: Boolean(input.fromEnv) });
    }, credentials);
  });
  if (admin) server.registerTool('sera_logout', { description: '清除指定来源的登录记录，平台会话同时尝试交由对应后端退出。', inputSchema: inputSchema(authSchema), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } }, (input, context) => result(async () => logout((await fresh()).config, input.source, input.platform, context.mcpReq.signal)));
  if (admin) server.registerTool('sera_auth', { description: '查看登录记录状态，不返回任何密钥或密码。', inputSchema: inputSchema(authSchema.partial()), annotations: { ...annotations, openWorldHint: false } }, input => result(async () => authStatus((await fresh()).config, input.source, input.platform)));
  await server.connect(new StdioServerTransport());
  return server;
}
