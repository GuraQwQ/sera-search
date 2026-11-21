import { readFile, mkdir, lstat, readlink, realpath, symlink, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Config } from './types.js';
import { platformIdPattern, catalogGroups, specialistSourceNames } from './types.js';
import type { CatalogGroup } from './types.js';
import { serializeFile, writeAtomic } from './files.js';
import { apiSources, loadCredentials, migrateCredentials, notLoggedIn } from './credentials.js';
import { specialistSites } from './provider-catalog.js';
import { connectorDefinitionSchema } from './connectors.js';
import { sourceNameSchema } from './source-schema.js';

const api = z.object({
  baseUrl: z.string().url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol), '接口地址需要 HTTP 或 HTTPS').optional(),
  engine: z.string().optional(),
  languageCode: z.string().optional(),
  locationCode: z.number().int().positive().optional(),
  userAgent: z.string().min(1).optional(), clientId: z.string().min(1).optional(), accountId: z.string().min(1).optional(),
  guildId: z.string().regex(/^\d+$/).optional(), channelId: z.string().regex(/^\d+$/).optional(),
  enabled: z.boolean().optional(),
  freeTierConfirmed: z.boolean().optional(),
}).default({});
const command = z.object({ command: z.string().min(1), args: z.array(z.string()).default([]), enabled: z.boolean().optional() });
export const sourceSettingsSchema = api.unwrap().strict();
export const commandSettingsSchema = command.strict();
const schema = z.object({
  home: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(300000).default(20000),
  retentionDays: z.number().positive().max(3650).default(7),
  sources: z.record(sourceNameSchema, api).default({}),
  connectorFiles: z.array(z.string().min(1)).default([]),
  connectors: z.array(connectorDefinitionSchema).default([]),
  exa: api, tavily: api, brave: api, github: api, bilibili: api, v2ex: api, web: api,
  zhipu: api, doubao: api, crossref: api, openalex: api, pubmed: api, serpapi: api, dataforseo: api,
  skills: api, bangumi: api, anilist: api, jikan: api, mangadex: api, vndb: api,
  musicbrainz: api, lastfm: api, listenbrainz: api, discogs: api, youtube: api, netease: api,
  'baidu-images': api, 'sogou-images': api, 'trace-moe': api, saucenao: api, twitch: api, discord: api, instagram: api, bing: api, sites: api,
  wayback: api, archive: api,
  linuxdo: api, heybox: api, steam: api, nicovideo: api, iptv: api,
  ...Object.fromEntries(specialistSourceNames.map(name => [name, api])),
  'google-news': api.unwrap().extend({ country: z.string().min(2).optional(), edition: z.string().min(1).optional(), topicId: z.string().min(1).optional() }).default({}),
  catalogFile: z.string().optional(),
  wiki: api.unwrap().extend({ sites: z.record(z.string().regex(platformIdPattern), z.object({ apiUrl: z.string().url(), pageBaseUrl: z.string().url(), label: z.string().optional() })).optional() }).default({}),
  agentReach: command.optional(), opencli: command.optional(), ghgrab: command.optional(), scrapling: command.optional(), 'metadata-parser': command.optional(),
  'aliens-eye': command.optional(), sherlock: command.optional(), 'gods-eye-view': command.optional(),
});

export function parseConfig(input: unknown) { return schema.parse(input); }

export interface ConfigLocation { home?: string; file?: string; catalog?: string; group?: CatalogGroup }

export function configLocation(options: ConfigLocation = {}) {
  const home = resolve(options.home ?? process.env.SERA_HOME ?? join(homedir(), '.sera'));
  return { home, file: resolve(options.file ?? process.env.SERA_CONFIG ?? join(home, 'config.json')) };
}

async function readConfigFile(options: ConfigLocation) {
  const location = configLocation(options);
  return serializeFile(location.file, async () => {
    let input: unknown = {}, original = '';
    try { original = await readFile(location.file, 'utf8'); input = JSON.parse(original); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`无法读取配置 ${location.file}，请检查 UTF-8 JSON 格式`);
    }
    return { input, original, location };
  });
}

function baseConfig(input: unknown, options: ConfigLocation): Config {
  const location = configLocation(options);
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error(`配置字段有误：${parsed.error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).join('；')}`);
  return { ...parsed.data, home: resolve(options.home ?? process.env.SERA_HOME ?? parsed.data.home ?? location.home), configFile: location.file,
    group: z.enum(catalogGroups).parse(options.group ?? 'default'),
    ...(options.catalog ? { catalogOverride: resolve(options.catalog) } : {}),
    catalogFile: options.catalog ? resolve(options.catalog) : options.group === 'galgame' ? fileURLToPath(new URL('../catalogs/galgame.json', import.meta.url)) : parsed.data.catalogFile ? resolve(dirname(location.file), parsed.data.catalogFile) : fileURLToPath(new URL('../catalogs/sites.json', import.meta.url)) };
}

async function attachCredentials(config: Config) {
  config.credentials = await loadCredentials(config.home);
  for (const name of apiSources) {
    const record = config.credentials[name];
    if (record?.status === 'active') Object.assign(config[name] ??= {}, record.credentials);
  }
  return config;
}

// 配置修复和 MCP 启动只取得主配置与固定位置；业务调用仍完整校验外部引用。
export async function loadConfigBootstrap(options: ConfigLocation = {}): Promise<Config> {
  const { input } = await readConfigFile(options);
  return attachCredentials(baseConfig(input, options));
}

export async function resolveConfig(input: unknown, options: ConfigLocation = {}): Promise<Config> {
  const config = baseConfig(input, options), location = configLocation(options);
  for (const file of config.connectorFiles ?? []) {
    const path = resolve(dirname(location.file), file);
    let data: unknown;
    try { data = JSON.parse(await readFile(path, 'utf8')); } catch { throw new Error(`无法读取 Connector 配置 ${path}，请检查 UTF-8 JSON`); }
    const definitions = z.array(connectorDefinitionSchema).parse(Array.isArray(data) ? data : [data]);
    config.connectors!.push(...definitions);
  }
  config.connectors = [...new Map(config.connectors!.map(item => [item.id, item])).values()];
  if (config.group === 'game-wikis') {
    const group = schema.parse(JSON.parse(await readFile(new URL('../catalogs/game-wikis.json', import.meta.url), 'utf8')));
    config.wiki = { ...config.wiki, sites: { ...group.wiki.sites, ...config.wiki?.sites } };
  }
  const catalogSchema = z.object({ sites: z.record(z.string().regex(platformIdPattern), z.object({ domains: z.array(z.string().min(1)).min(1), label: z.string().min(1), description: z.string().optional() })) });
  try { config.catalog = catalogSchema.parse(JSON.parse(await readFile(config.catalogFile!, 'utf8'))); if (config.group === 'default') config.catalog.sites = { ...specialistSites, ...config.catalog.sites }; }
  catch { throw new Error('站点目录需要有效 UTF-8 JSON 与 sites/domains/label 字段'); }
  return attachCredentials(config);
}

export async function loadConfig(options: ConfigLocation = {}): Promise<Config> {
  const { input, original, location } = await readConfigFile(options);
  const config = await resolveConfig(input, options);
  if (original) await migrateCredentials(config.home, location.file);
  return attachCredentials(config);
}

export async function install(options: ConfigLocation & { skillDir?: string; components?: import('./components.js').ComponentName[]; python?: string; browser?: string; node?: string; signal?: AbortSignal } = {}) {
  const location = configLocation(options);
  const template = await readFile(new URL('../config.example.json', import.meta.url), 'utf8');
  const created = await writeAtomic(location.file, template, true);
  let skill: string | undefined;
  if (options.skillDir) {
    const target = join(resolve(options.skillDir), 'sera-search');
    const source = await realpath(fileURLToPath(new URL('../skills/sera-search', import.meta.url)));
    await mkdir(dirname(target), { recursive: true });
    await serializeFile(target, async () => {
      const type = process.platform === 'win32' ? 'junction' : 'dir';
      let entry: Awaited<ReturnType<typeof lstat>>;
      try { entry = await lstat(target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        options.signal?.throwIfAborted();
        await symlink(source, target, type); return;
      }
      let existing: string | undefined;
      try { existing = await realpath(target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (existing && !relative(existing, source)) return;
      if (!entry.isSymbolicLink()) throw new Error(`技能位置已被其他内容占用：${target}`);
      const previous = await readlink(target), previousPath = resolve(dirname(target), previous);
      const packageLayout = basename(previousPath) === 'sera-search' && basename(dirname(previousPath)) === 'skills';
      let owned = !existing && packageLayout;
      if (existing && packageLayout) {
        try {
          const manifest = JSON.parse(await readFile(join(dirname(dirname(existing)), 'package.json'), 'utf8'));
          const skill = await readFile(join(existing, 'SKILL.md'), 'utf8');
          const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
          owned = manifest.name === 'sera-search' && /^name:\s*(['"]?)sera-search\1\s*$/m.test(frontmatter);
        } catch { /* 无法核实归属时保留原链接。 */ }
      }
      if (!owned) throw new Error(`技能链接归属无法确认，原链接已保留：${target} → ${previous}`);
      options.signal?.throwIfAborted();
      // 仅替换已识别的链接，原包内容保留；中断后可重新安装。
      await unlink(target);
      try { options.signal?.throwIfAborted(); await symlink(source, target, type); }
      catch (error) {
        try { await symlink(previous, target, type); }
        catch (restoreError) { throw new AggregateError([error, restoreError], `技能链接更新未完成，请重试安装：${target}`); }
        throw error;
      }
    });
    skill = target;
  }
  const components = options.components?.length ? await (await import('./components.js')).installComponents({ ...location, components: options.components, python: options.python, browser: options.browser, node: options.node, signal: options.signal }) : undefined;
  return { home: location.home, config: location.file, configCreated: created, skill, ...components, ...(components?.components.some(item => item.status === 'error') ? { status: 'error' } : {}) };
}

export function errorMessage(error: unknown, config: Config): string {
  if (['NOT_LOGGED_IN', 'NEED_LOGIN', 'AUTH_REQUIRED'].includes(String((error as { code?: unknown })?.code))) return notLoggedIn;
  const message = error instanceof z.ZodError ? validationMessage(error) : error instanceof Error ? error.message : String(error);
  const secrets = Object.values(config.credentials ?? {}).flatMap(record => Object.values(record.credentials));
  for (const settings of Object.values(config.sources ?? {})) secrets.push(settings.apiKey, settings.username, settings.password);
  for (const name of apiSources) secrets.push(config[name]?.apiKey, config[name]?.username, config[name]?.password);
  const patterns = [...new Set(secrets.filter((key): key is string => Boolean(key)))].sort((a, b) => b.length - a.length).map(key => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return key.length < 4 ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
  });
  return patterns.length ? message.replace(new RegExp(patterns.join('|'), 'gu'), '[已隐藏]') : message;
}

export function validationMessage(error: z.ZodError): string {
  const issues = error.issues.slice(0, 4).map(issue => {
    const path = issue.path.map(String).join('.').slice(0, 100);
    const reason = issue.code === 'unrecognized_keys' ? `不支持字段 ${issue.keys.slice(0, 8).map(key => key.slice(0, 60)).join('、')}` : issue.message.replace(/\s+/g, ' ').slice(0, 180);
    return path ? `${path}：${reason}` : reason;
  });
  if (error.issues.length > issues.length) issues.push(`还有 ${error.issues.length - issues.length} 项`);
  return issues.join('；');
}
