import { readFile, mkdir, realpath, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Config } from './types.js';
import { platformIdPattern, catalogGroups } from './types.js';
import type { CatalogGroup } from './types.js';
import { writeAtomic } from './files.js';
import { apiSources, loadCredentials, migrateCredentials, notLoggedIn } from './credentials.js';

const api = z.object({
  baseUrl: z.string().url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol), '接口地址需要 HTTP 或 HTTPS').optional(),
  engine: z.string().optional(),
  languageCode: z.string().optional(),
  locationCode: z.number().int().positive().optional(),
  userAgent: z.string().min(1).optional(), clientId: z.string().min(1).optional(), accountId: z.string().min(1).optional(),
  guildId: z.string().regex(/^\d+$/).optional(), channelId: z.string().regex(/^\d+$/).optional(),
  enabled: z.boolean().optional(),
}).default({});
const command = z.object({ command: z.string().min(1), args: z.array(z.string()).default([]), enabled: z.boolean().optional() });
const schema = z.object({
  home: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(300000).default(20000),
  retentionDays: z.number().positive().max(3650).default(7),
  exa: api, tavily: api, brave: api, github: api, bilibili: api, v2ex: api, web: api,
  zhipu: api, doubao: api, crossref: api, openalex: api, pubmed: api, serpapi: api, dataforseo: api,
  skills: api, bangumi: api, anilist: api, jikan: api, mangadex: api, vndb: api,
  musicbrainz: api, lastfm: api, listenbrainz: api, discogs: api, youtube: api, netease: api,
  'baidu-images': api, 'sogou-images': api, 'trace-moe': api, saucenao: api, twitch: api, discord: api, instagram: api, bing: api, sites: api,
  wayback: api, archive: api,
  linuxdo: api, heybox: api, steam: api, nicovideo: api,
  catalogFile: z.string().optional(),
  wiki: api.unwrap().extend({ sites: z.record(z.string().regex(platformIdPattern), z.object({ apiUrl: z.string().url(), pageBaseUrl: z.string().url(), label: z.string().optional() })).optional() }).default({}),
  agentReach: command.optional(), opencli: command.optional(),
});

export interface ConfigLocation { home?: string; file?: string; catalog?: string; group?: CatalogGroup }

export function configLocation(options: ConfigLocation = {}) {
  const home = resolve(options.home ?? process.env.SERA_HOME ?? join(homedir(), '.sera'));
  return { home, file: resolve(options.file ?? process.env.SERA_CONFIG ?? join(home, 'config.json')) };
}

export async function loadConfig(options: ConfigLocation = {}): Promise<Config> {
  const location = configLocation(options);
  let input: unknown = {}, original = '';
  try { original = await readFile(location.file, 'utf8'); input = JSON.parse(original); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`无法读取配置 ${location.file}，请检查 UTF-8 JSON 格式`);
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error(`配置字段有误：${parsed.error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).join('；')}`);
  const config: Config = { ...parsed.data, home: resolve(options.home ?? process.env.SERA_HOME ?? parsed.data.home ?? location.home) };
  if (original && input && typeof input === 'object' && !Array.isArray(input)) await migrateCredentials(config.home, location.file, input as Record<string, unknown>, original);
  config.credentials = await loadCredentials(config.home);
  config.configFile = location.file;
  config.group = z.enum(catalogGroups).parse(options.group ?? 'default');
  if (config.group === 'game-wikis') {
    const group = schema.parse(JSON.parse(await readFile(new URL('../catalogs/game-wikis.json', import.meta.url), 'utf8')));
    config.wiki = { ...config.wiki, sites: { ...config.wiki?.sites, ...group.wiki.sites } };
  }
  config.catalogFile = options.catalog ? resolve(options.catalog) : config.group === 'galgame' ? fileURLToPath(new URL('../catalogs/galgame.json', import.meta.url)) : parsed.data.catalogFile ? resolve(dirname(location.file), parsed.data.catalogFile) : fileURLToPath(new URL('../catalogs/sites.json', import.meta.url));
  const catalogSchema = z.object({ sites: z.record(z.string().regex(platformIdPattern), z.object({ domains: z.array(z.string().min(1)).min(1), label: z.string().min(1), description: z.string().optional() })) });
  try { config.catalog = catalogSchema.parse(JSON.parse(await readFile(config.catalogFile, 'utf8'))); }
  catch { throw new Error('站点目录需要有效 UTF-8 JSON 与 sites/domains/label 字段'); }
  for (const name of apiSources) {
    const record = config.credentials[name];
    if (record?.status === 'active') Object.assign(config[name]!, record.credentials);
  }
  return config;
}

export async function install(options: ConfigLocation & { skillDir?: string } = {}) {
  const location = configLocation(options);
  const template = await readFile(new URL('../config.example.json', import.meta.url), 'utf8');
  const created = await writeAtomic(location.file, template, true);
  let skill: string | undefined;
  if (options.skillDir) {
    const target = join(resolve(options.skillDir), 'sera-search');
    const source = await realpath(fileURLToPath(new URL('../skills/sera-search', import.meta.url)));
    await mkdir(dirname(target), { recursive: true });
    try {
      const existing = await realpath(target);
      if (existing !== source) throw new Error(`技能位置已被其他内容占用：${target}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
    }
    skill = target;
  }
  return { home: location.home, config: location.file, configCreated: created, skill };
}

export function errorMessage(error: unknown, config: Config): string {
  if (['NOT_LOGGED_IN', 'NEED_LOGIN', 'AUTH_REQUIRED', 'HTTP_401'].includes(String((error as { code?: unknown })?.code))) return notLoggedIn;
  let message = error instanceof Error ? error.message : String(error);
  const secrets = Object.values(config.credentials ?? {}).flatMap(record => Object.values(record.credentials));
  for (const name of apiSources) secrets.push(config[name]?.apiKey, config[name]?.username, config[name]?.password);
  for (const key of secrets) {
    if (key) message = message.split(key).join('[已隐藏]');
  }
  return message;
}
