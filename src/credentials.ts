import { sourceNameSchema } from './source-schema.js';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { mutateJsonFile, serializeFile, writeAtomic } from './files.js';
import { platformIdPattern, specialistSourceNames } from './types.js';
import type { AuthRecord, Config, SavedCredentials, SourceName } from './types.js';

export const notLoggedIn = '未登录，不可用';
export const apiSources = ['exa', 'tavily', 'brave', 'github', 'zhipu', 'doubao', 'openalex', 'pubmed', 'serpapi', 'dataforseo', 'bangumi', 'anilist', 'mangadex', 'vndb', 'lastfm', 'listenbrainz', 'discogs', 'youtube', 'netease', 'saucenao', 'twitch', 'discord', 'instagram', 'linuxdo', 'heybox', 'steam', ...specialistSourceNames] as const;
export const credentialsSchema = z.object({ apiKey: z.string().min(1).optional(), username: z.string().min(1).optional(), password: z.string().min(1).optional(), clientId: z.string().min(1).optional() });
const recordSchema = z.object({
  kind: z.literal('sera-credential'), source: sourceNameSchema, platform: z.string().regex(platformIdPattern).optional(),
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
  sourceNameSchema.parse(source);
  if (platform) z.string().regex(platformIdPattern).parse(platform);
  return join(home, 'credentials', `${source}${platform ? '__' + platform : ''}.json`);
}

async function readRecord(path: string) {
  let original: string;
  try { original = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  let parsed: unknown;
  try { parsed = JSON.parse(original); } catch { parsed = undefined; }
  const result = recordSchema.safeParse(parsed);
  return { original, record: result.success ? result.data : undefined };
}

function recordMatches(record: AuthRecord | undefined, source: SourceName, platform?: string): record is AuthRecord {
  return record?.source === source && record.platform === platform;
}

export async function loadCredentials(home: string): Promise<Record<string, AuthRecord>> {
  let names: string[];
  try { names = await readdir(join(home, 'credentials')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  const records: Record<string, AuthRecord> = {};
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const path = join(home, 'credentials', name), record = await serializeFile(path, async () => (await readRecord(path))?.record);
      if (!record) continue;
      if (name === `${record.source}${record.platform ? '__' + record.platform : ''}.json`) records[authKey(record.source, record.platform)] = record;
    } catch { /* 不可读取的记录保留原文件，本次按未登录处理。 */ }
  }
  return records;
}

export function credential(config: Config, source: SourceName, platform?: string): AuthRecord | undefined {
  const record = config.credentials?.[authKey(source, platform)];
  return record?.status === 'active' ? record : undefined;
}

function validateCredentials(source: SourceName, value: SavedCredentials, platform?: string) {
  const credentials = credentialsSchema.parse(value);
  if (!platform && (source === 'dataforseo' ? !(credentials.username && credentials.password) : !credentials.apiKey)) throw new Error(source === 'dataforseo' ? '需要 API 账号 username 和 password' : '需要 apiKey');
  return credentials;
}

async function writeRecord(home: string, source: SourceName, credentials: SavedCredentials, platform: string | undefined, previous: Awaited<ReturnType<typeof readRecord>>) {
  if (previous && !recordMatches(previous.record, source, platform)) {
    await writeAtomic(join(home, 'migrations', `credential-${createHash('sha256').update(previous.original).digest('hex')}.json`), previous.original, true);
  }
  const record: AuthRecord = { kind: 'sera-credential', source, ...(platform ? { platform } : {}), credentials, status: 'active', updatedAt: new Date().toISOString() };
  await writeAtomic(recordPath(home, source, platform), JSON.stringify(record, null, 2) + '\n');
  return { source, ...(platform ? { platform } : {}), status: '已记录', updatedAt: record.updatedAt };
}

export async function saveCredential(home: string, source: SourceName, value: SavedCredentials, platform?: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const credentials = validateCredentials(source, value, platform), path = recordPath(home, source, platform);
  return serializeFile(path, async () => {
    signal?.throwIfAborted();
    return writeRecord(home, source, credentials, platform, await readRecord(path));
  });
}

export async function invalidateCredential(home: string, source: SourceName, platform?: string, expected?: AuthRecord) {
  const path = recordPath(home, source, platform);
  await serializeFile(path, async () => {
    const record = (await readRecord(path))?.record;
    if (recordMatches(record, source, platform) && (!expected || isDeepStrictEqual(record, expected))) {
      await writeAtomic(path, JSON.stringify({ ...record, status: 'invalid', updatedAt: new Date().toISOString() }, null, 2) + '\n');
    }
  });
}

export async function removeCredential(home: string, source: SourceName, platform?: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const path = recordPath(home, source, platform);
  await serializeFile(path, async () => { signal?.throwIfAborted(); await rm(path, { force: true }); });
  return { source, ...(platform ? { platform } : {}), status: notLoggedIn };
}

export async function migrateCredentials(home: string, file: string) {
  await mutateJsonFile(file, async (input, original) => {
    const custom = input.sources && typeof input.sources === 'object' && !Array.isArray(input.sources) ? input.sources as Record<string, unknown> : {};
    const legacy = [...new Set<string>([...apiSources, ...Object.keys(custom).filter(name => sourceNameSchema.safeParse(name).success)])].flatMap(source => {
      return [input[source], custom[source]].flatMap(config => {
        if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
        const value = config as Record<string, unknown>;
        const keys = ['apiKey', 'username', 'password'].filter(key => typeof value[key] === 'string' && value[key]);
        return keys.length ? [{ source, value, keys }] : [];
      });
    });
    if (!legacy.length) return;
    // 先保留可校验的原配置，再逐文件迁移；中断后重复执行不会覆盖新登录。
    await writeAtomic(join(home, 'migrations', `config-${createHash('sha256').update(original).digest('hex')}.json`), original, true);
    for (const source of new Set(legacy.map(item => item.source))) {
      const path = recordPath(home, source);
      await serializeFile(path, async () => {
        const previous = await readRecord(path);
        if (recordMatches(previous?.record, source)) return;
        const value = Object.assign({}, ...legacy.filter(item => item.source === source).map(({ value, keys }) => Object.fromEntries(keys.map(key => [key, value[key]])))) as SavedCredentials;
        await writeRecord(home, source, validateCredentials(source, value), undefined, previous);
      });
    }
    const migrated = await loadCredentials(home);
    for (const { source, value, keys } of legacy) {
      if (!migrated[source]) throw new Error('登录记录迁移未完成，原配置已保留');
      for (const key of keys) delete value[key];
    }
  });
}
