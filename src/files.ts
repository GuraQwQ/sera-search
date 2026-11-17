import { mkdir, readFile, writeFile, rename, link, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const pendingFiles = new Map<string, Promise<unknown>>();
export async function serializeFile<T>(path: string, action: () => Promise<T>): Promise<T> {
  const absolute = resolve(path), key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const previous = pendingFiles.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  pendingFiles.set(key, next);
  try { return await next; }
  finally { if (pendingFiles.get(key) === next) pendingFiles.delete(key); }
}

export async function mutateJsonFile<T>(path: string, mutate: (input: Record<string, any>, original: string) => Promise<T> | T): Promise<T> {
  return serializeFile(path, async () => {
    let input: unknown = {}, original = '';
    try { original = await readFile(path, 'utf8'); input = JSON.parse(original); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置文件需要 JSON 对象，原文件已保留');
    const before = JSON.stringify(input), result = await mutate(input as Record<string, any>, original);
    if (JSON.stringify(input) !== before) await writeAtomic(path, JSON.stringify(input, null, 2) + '\n');
    return result;
  });
}

export async function writeAtomic(path: string, value: string, exclusive = false): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.sera-write-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    if (exclusive) {
      try { await link(temporary, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
    } else await rename(temporary, path);
    return true;
  } finally { await rm(temporary, { force: true }); }
}
