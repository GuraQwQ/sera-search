import { mkdir, writeFile, rename, link, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

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
