import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { writeAtomic } from './files.js';
import { sourceNames, platformIdPattern } from './types.js';
import type { AuthRecord, Config, SavedCredentials, SourceName } from './types.js';

export const notLoggedIn = '未登录，不可用';
export const apiSources = ['exa', 'tavily', 'brave', 'github', 'zhipu', 'doubao', 'openalex', 'pubmed', 'serpapi', 'dataforseo', 'bangumi', 'anilist', 'mangadex', 'vndb', 'lastfm', 'listenbrainz', 'discogs', 'youtube', 'netease', 'saucenao', 'twitch', 'discord', 'instagram', 'linuxdo', 'heybox'] as const;
export const credentialsSchema = z.object({ apiKey: z.string().min(1).optional(), username: z.string().min(1).optional(), password: z.string().min(1).optional(), clientId: z.string().min(1).optional() });
const recordSchema = z.object({
  kind: z.literal('sera-credential'), source: z.enum(sourceNames), platform: z.string().regex(platformIdPattern).optional(),
  credentials: credentialsSchema, status: z.enum(['active', 'invalid']), updatedAt: z.string(),
}).refine(record => record.platform || !(apiSources as readonly string[]).includes(record.source)
  || (record.source === 'dataforseo' ? Boolean(record.credentials.username && record.credentials.password) : Boolean(record.credentials.apiKey)));

export class NotLoggedInError extends Error {
  readonly code = 'NOT_LOGGED_IN';
  readonly terminal = true;
  constructor(readonly platform?: string) { super(notLoggedIn); }
}

export function authKey(source: SourceName, platform?: string) { return platform ? `${source}:${platform}` : source; }
function recordPath(home: string, source: SourceName, platform?: string) {
  z.enum(sourceNames).parse(source);
  if (platform) z.string().regex(platformIdPattern).parse(platform);
  return join(home, 'credentials', `${source}${platform ? '__' + platform : ''}.json`);
}

export async function loadCredentials(home: string): Promise<Record<string, AuthRecord>> {
  let names: string[];
  try { names = await readdir(join(home, 'credentials')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  const records: Record<string, AuthRecord> = {};
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = recordSchema.parse(JSON.parse(await readFile(join(home, 'credentials', name), 'utf8')));
      if (name === `${record.source}${record.platform ? '__' + record.platform : ''}.json`) records[authKey(record.source, record.platform)] = record;
    } catch { /* 不可读取的记录保留原文件，本次按未登录处理。 */ }
  }
  return records;
}

export function credential(config: Config, source: SourceName, platform?: string): AuthRecord | undefined {
  const record = config.credentials?.[authKey(source, platform)];
  return record?.status === 'active' ? record : undefined;
}

export async function saveCredential(home: string, source: SourceName, value: SavedCredentials, platform?: string) {
  const credentials = credentialsSchema.parse(value);
  if (!platform && (source === 'dataforseo' ? !(credentials.username && credentials.password) : !credentials.apiKey)) throw new Error(source === 'dataforseo' ? '需要 API 账号 username 和 password' : '需要 apiKey');
  const path = recordPath(home, source, platform);
  try {
    const previous = await readFile(path, 'utf8');
    let parsed: unknown;
    try { parsed = JSON.parse(previous); } catch { parsed = undefined; }
    const existing = recordSchema.safeParse(parsed);
    if (!existing.success || existing.data.source !== source || existing.data.platform !== platform) {
      await writeAtomic(join(home, 'migrations', `credential-${createHash('sha256').update(previous).digest('hex')}.json`), previous, true);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const record: AuthRecord = { kind: 'sera-credential', source, ...(platform ? { platform } : {}), credentials, status: 'active', updatedAt: new Date().toISOString() };
  await writeAtomic(path, JSON.stringify(record, null, 2) + '\n');
  return { source, ...(platform ? { platform } : {}), status: '已记录', updatedAt: record.updatedAt };
}

export async function invalidateCredential(home: string, source: SourceName, platform?: string, expected?: AuthRecord) {
  const records = await loadCredentials(home), record = records[authKey(source, platform)];
  if (record && (!expected || record.updatedAt === expected.updatedAt)) await writeAtomic(recordPath(home, source, platform), JSON.stringify({ ...record, status: 'invalid', updatedAt: new Date().toISOString() }, null, 2) + '\n');
}

export async function removeCredential(home: string, source: SourceName, platform?: string) {
  await rm(recordPath(home, source, platform), { force: true });
  return { source, ...(platform ? { platform } : {}), status: notLoggedIn };
}

export async function migrateCredentials(home: string, file: string, input: Record<string, unknown>, original: string) {
  const records = await loadCredentials(home);
  const legacy = apiSources.flatMap(source => {
    const config = input[source];
    if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
    const value = config as Record<string, unknown>;
    const keys = ['apiKey', 'username', 'password'].filter(key => typeof value[key] === 'string' && value[key]);
    return keys.length ? [{ source, value, keys }] : [];
  });
  if (!legacy.length) return;
  // 先保留可校验的原配置，再逐文件迁移；中断后重复执行不会覆盖新登录。
  await writeAtomic(join(home, 'migrations', `config-${createHash('sha256').update(original).digest('hex')}.json`), original, true);
  for (const { source, value, keys } of legacy) {
    if (!records[source]) {
      const credentials = Object.fromEntries(keys.map(key => [key, value[key]])) as SavedCredentials;
      await saveCredential(home, source, credentials);
    }
  }
  const migrated = await loadCredentials(home);
  for (const { source, value, keys } of legacy) {
    if (!migrated[source]) throw new Error('登录记录迁移未完成，原配置已保留');
    for (const key of keys) delete value[key];
  }
  await writeAtomic(file, JSON.stringify(input, null, 2) + '\n');
}
