import { createHash } from 'node:crypto';
import { readFile, readdir, rm, realpath, lstat, mkdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { writeAtomic } from './files.js';
import { sourceNames } from './types.js';
import type { Config, Document, Evidence, SourceName } from './types.js';

export function canonicalUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('内容地址需要 HTTP 或 HTTPS');
  if (url.hostname === 'web.archive.org' && url.pathname.startsWith('/web/')) { url.hash = ''; return url.href; }
  if (url.hostname === 'music.163.com' && /^#\/(song|album|playlist|djradio)\?/.test(url.hash)) {
    const resource = new URL(url.hash.slice(1), url.origin);
    url.pathname = resource.pathname;
    url.search = resource.search;
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
  }
  return url.href;
}

export function publisher(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'github.com' || host === 'raw.githubusercontent.com') return `github:${url.pathname.split('/')[1]?.toLowerCase() ?? host}`;
  if (host.endsWith('.github.io')) return `github:${host.slice(0, -10)}`;
  return host;
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function textPage(content: string, offset: number, length: number) {
  const characters = Array.from(content);
  const end = Math.min(offset + length, characters.length);
  return { content: characters.slice(offset, end).join(''), offset, totalCharacters: characters.length, nextOffset: end < characters.length ? end : null };
}

export interface FocusOptions { query?: string; keywords?: string[] }

export function focusText(content: string, options: FocusOptions, length = 4000) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 20000) throw new Error('正文长度需要 1–20000 的整数');
  const characters = Array.from(content), unitOffsets = [0];
  for (const character of characters) unitOffsets.push(unitOffsets[unitOffsets.length - 1]! + character.length);
  const codePointOffset = (unit: number) => {
    let low = 0, high = unitOffsets.length - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (unitOffsets[middle]! <= unit) low = middle; else high = middle - 1; }
    return low;
  };
  const ignored = new Set(['the', 'and', 'for', 'with', 'from', 'what', 'when', 'where', 'which', 'does', 'have', 'this', 'that', 'into', 'about', 'please']);
  const queryTerms = options.query?.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
  // shortcut: 使用词面和中文双字匹配，需要理解同义表述时由 agent 显式补充 keywords。
  const hanTerms = [...(options.query ?? '').matchAll(/\p{Script=Han}{2,}/gu)].flatMap(match => {
    const text = Array.from(match[0]);
    return text.slice(1).map((character, index) => text[index]! + character);
  });
  const terms = [...new Set([...(options.keywords ?? []).map(value => value.trim()).filter(Boolean),
    ...queryTerms.filter(value => Array.from(value).length > 1), ...hanTerms].map(value => value.toLowerCase()).filter(value => !ignored.has(value)))].slice(0, 32);
  const sections: { title: string; offset: number }[] = [];
  let lineOffset = 0;
  for (const line of content.split('\n')) {
    const title = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (title && sections.length < 50) sections.push({ title, offset: lineOffset });
    lineOffset += Array.from(line).length + 1;
  }
  const candidates: { start: number; end: number; anchor: number; terms: Set<string>; count: number }[] = [];
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(escaped, 'giu');
    let count = 0;
    for (const match of content.matchAll(expression)) {
      if (count++ >= 100) break;
      const anchor = codePointOffset(match.index), end = codePointOffset(match.index + match[0].length);
      let start = Math.max(0, anchor - 180), stop = Math.min(characters.length, end + 300);
      for (let at = start; at > Math.max(0, start - 80); at--) if (characters[at - 1] === '\n') { start = at; break; }
      for (let at = stop; at < Math.min(characters.length, stop + 80); at++) if (characters[at] === '\n') { stop = at + 1; break; }
      candidates.push({ start, end: stop, anchor, terms: new Set([term]), count: 1 });
    }
  }
  candidates.sort((a, b) => a.start - b.start);
  const merged: typeof candidates = [];
  for (const item of candidates) {
    const previous = merged.at(-1);
    if (previous && item.start <= previous.end && Math.max(previous.end, item.end) - previous.start <= Math.min(1600, length)) {
      previous.end = Math.max(previous.end, item.end); previous.count += item.count;
      for (const term of item.terms) previous.terms.add(term);
    } else merged.push(item);
  }
  if (!merged.length) return { ...textPage(content, 0, length), selection: 'leading' as const, fragments: [], sections };
  merged.sort((a, b) => b.terms.size - a.terms.size || b.count - a.count || a.start - b.start);
  const fragments: { content: string; offset: number; endOffset: number; matchedTerms: string[] }[] = [];
  let used = 0;
  for (const candidate of merged) {
    if (fragments.length >= 3) break;
    const available = length - used - (fragments.length ? 5 : 0);
    if (available < 1) break;
    const size = Math.min(candidate.end - candidate.start, available);
    const start = candidate.end - candidate.start > available ? Math.max(candidate.start, Math.min(candidate.anchor - Math.floor(size / 3), candidate.end - size)) : candidate.start;
    if (fragments.some(fragment => start < fragment.endOffset && start + size > fragment.offset)) continue;
    const text = characters.slice(start, start + size).join('');
    const matchedTerms = [...candidate.terms].filter(term => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu').test(text));
    fragments.push({ content: text, offset: start, endOffset: start + size, matchedTerms });
    used += size + (fragments.length > 1 ? 5 : 0);
  }
  fragments.sort((a, b) => a.offset - b.offset);
  return { content: fragments.map(item => item.content).join('\n\n…\n\n'), offset: fragments[0]?.offset ?? 0, totalCharacters: characters.length, nextOffset: null,
    selection: 'focused' as const, fragments, sections };
}

function owned(value: unknown): value is Evidence {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Evidence>;
  return item.kind === 'sera-evidence' && typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id)
    && typeof item.content === 'string' && typeof item.retrievedAt === 'string' && Array.isArray(item.retrievedBy);
}

interface UrlReference { kind: 'sera-url-cache'; key: string; url: string; source: SourceName; id: string; retrievedAt: string }
const referenceKey = (url: string, source: SourceName) => contentHash(canonicalUrl(url) + '\n' + source);
function ownedReference(value: unknown): value is UrlReference {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<UrlReference>;
  if (item.kind !== 'sera-url-cache' || typeof item.url !== 'string' || !sourceNames.includes(item.source as SourceName)
    || typeof item.id !== 'string' || !/^[a-f0-9]{64}$/.test(item.id) || typeof item.retrievedAt !== 'string') return false;
  try { return item.key === referenceKey(item.url, item.source as SourceName); } catch { return false; }
}
const cleanupTasks = new Map<string, Promise<{ removed: number; preserved: number; failures: { file: string; code: string }[] }>>();

export class EvidenceStore {
  readonly directory: string;
  constructor(private config: Config) { this.directory = join(resolve(config.home), 'cache', 'evidence'); }

  private async prepare() {
    await mkdir(this.config.home, { recursive: true });
    const home = await realpath(this.config.home);
    let current = home;
    for (const segment of ['cache', 'evidence']) {
      const path = join(current, segment);
      try { current = await realpath(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await mkdir(path, { recursive: true });
        current = await realpath(path);
      }
      const inside = relative(home, current);
      if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('缓存实际路径不在 SERA 数据目录内');
    }
  }

  async save(document: Document): Promise<Evidence> {
    if (!document.content.trim()) throw new Error('读取结果未包含正文或有效元数据');
    await this.prepare();
    const url = canonicalUrl(document.url);
    const hash = contentHash(document.content);
    const id = createHash('sha256').update(url + '\n' + hash + '\n' + document.source).digest('hex');
    const path = join(this.directory, `${id}.json`);
    let previous: Evidence | undefined;
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!owned(value)) throw new Error('证据位置已被其他文件占用');
      previous = value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const evidence: Evidence = {
      ...document, url, kind: 'sera-evidence', id, contentHash: hash,
      retrievedAt: new Date().toISOString(),
      retrievedBy: [...new Set([...(previous?.retrievedBy ?? []), document.source])],
    };
    await writeAtomic(path, JSON.stringify(evidence, null, 2) + '\n');
    await this.remember(url, evidence);
    return evidence;
  }

  async remember(value: string, evidence: Evidence) {
    await this.prepare();
    const url = canonicalUrl(value), key = referenceKey(url, evidence.source), path = join(this.directory, `url-${key}.json`);
    try {
      const previous: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!ownedReference(previous)) throw new Error('URL 缓存位置已被其他文件占用');
      if (Date.parse(previous.retrievedAt) > Date.parse(evidence.retrievedAt)) return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const reference: UrlReference = { kind: 'sera-url-cache', key, url, source: evidence.source, id: evidence.id, retrievedAt: evidence.retrievedAt };
    await writeAtomic(path, JSON.stringify(reference) + '\n');
  }

  async forget(value: string, source: SourceName, id: string) {
    const key = referenceKey(value, source), path = join(this.directory, `url-${key}.json`);
    let reference: unknown;
    try { reference = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!ownedReference(reference) || reference.key !== key) throw new Error('URL 缓存位置已被其他文件占用');
    if (reference.id === id) await rm(path, { force: true });
  }

  async find(value: string, sources?: SourceName[], maxAgeMs?: number, accept?: (evidence: Evidence) => boolean): Promise<Evidence | undefined> {
    const url = canonicalUrl(value);
    if (maxAgeMs !== undefined && (!Number.isFinite(maxAgeMs) || maxAgeMs < 0)) throw new Error('缓存时长需要非负毫秒数');
    if (maxAgeMs === 0) return undefined;
    const address = new URL(url), retentionMs = this.config.retentionDays * 86400000;
    const snapshot = address.hostname === 'web.archive.org' && /^\/web\/\d{14}(?:[a-z_]+)?\//i.test(address.pathname);
    for (const source of [...new Set(sources ?? sourceNames)]) {
      const immutable = snapshot || source === 'wiki' && /^\d+$/.test(address.searchParams.get('oldid') ?? '');
      const freshness = Math.min(maxAgeMs ?? (immutable ? retentionMs : 15 * 60000), retentionMs);
      const key = referenceKey(url, source);
      let reference: unknown, evidence: unknown;
      try {
        reference = JSON.parse(await readFile(join(this.directory, `url-${key}.json`), 'utf8'));
        if (!ownedReference(reference) || reference.key !== key || reference.source !== source || reference.url !== url) continue;
        evidence = JSON.parse(await readFile(join(this.directory, `${reference.id}.json`), 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) continue;
        throw error;
      }
      if (!owned(evidence) || evidence.id !== reference.id || evidence.source !== source) continue;
      if (accept && !accept(evidence)) { await this.forget(url, source, evidence.id); continue; }
      const now = Date.now(), age = now - Date.parse(evidence.retrievedAt), referenceAge = now - Date.parse(reference.retrievedAt);
      if (Number.isFinite(age) && Number.isFinite(referenceAge) && age >= 0 && referenceAge >= 0 && Math.max(age, referenceAge) < freshness) return evidence;
    }
    return undefined;
  }

  async get(id: string, offset = 0, length = 4000, focus?: FocusOptions) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('证据 ID 应为 64 位十六进制字符串');
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 20000) throw new Error('分页需要非负 offset 和 1–20000 的 length');
    let evidence: unknown;
    try { evidence = JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('证据不存在或已过期，请重新读取原始链接');
      throw error;
    }
    if (!owned(evidence)) throw new Error('证据文件格式不正确');
    const { content, ...metadata } = evidence;
    return { ...metadata, ...(focus?.query || focus?.keywords?.length ? focusText(content, focus, length) : textPage(content, offset, length)) };
  }

  async cleanIfDue() {
    const existing = cleanupTasks.get(this.directory);
    if (existing) return existing;
    const pending = (async () => {
      const marker = join(this.directory, '.cleanup.json');
      let writableMarker = true;
      try {
        const value = JSON.parse(await readFile(marker, 'utf8')) as { kind?: string; cleanedAt?: string };
        if (value?.kind !== 'sera-cache-cleanup') writableMarker = false;
        const age = typeof value?.cleanedAt === 'string' ? Date.now() - Date.parse(value.cleanedAt) : NaN;
        if (writableMarker && age >= 0 && age < 3600000)
          return { removed: 0, preserved: 0, failures: [] };
      } catch (error) {
        if (error instanceof SyntaxError) writableMarker = false;
        else if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await this.prepare();
      const result = await this.clean(true);
      if (writableMarker) await writeAtomic(marker, JSON.stringify({ kind: 'sera-cache-cleanup', cleanedAt: new Date().toISOString() }) + '\n');
      else result.failures.push({ file: '.cleanup.json', code: 'CACHE_OCCUPIED' });
      return result;
    })();
    cleanupTasks.set(this.directory, pending);
    try { return await pending; } finally { cleanupTasks.delete(this.directory); }
  }

  async clean(expiredOnly = false) {
    let names: string[];
    try {
      const actual = await realpath(this.directory);
      const actualHome = await realpath(this.config.home);
      const inside = relative(actualHome, actual);
      if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('缓存实际路径不在 SERA 数据目录内');
      names = await readdir(this.directory);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { removed: 0, preserved: 0, failures: [] }; throw error; }
    let removed = 0, preserved = 0;
    const failures: { file: string; code: string }[] = [];
    const cutoff = Date.now() - this.config.retentionDays * 86400000;
    const evidenceIds = new Set<string>();
    const references: { name: string; value: UrlReference }[] = [];
    for (const name of names) {
      const path = join(this.directory, name);
      if (!/^(?:url-)?[a-f0-9]{64}\.json$/.test(name) && name !== '.cleanup.json') { preserved++; continue; }
      try { if ((await lstat(path)).isSymbolicLink()) { preserved++; continue; } }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        preserved++; failures.push({ file: name, code: (error as NodeJS.ErrnoException).code ?? 'CACHE_BUSY' }); continue;
      }
      let value: unknown;
      try { value = JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { preserved++; failures.push({ file: name, code: (error as NodeJS.ErrnoException).code ?? 'BAD_CACHE' }); continue; }
      if (ownedReference(value) && name === `url-${value.key}.json`) { references.push({ name, value }); continue; }
      if (name === '.cleanup.json' && (value as { kind?: string })?.kind === 'sera-cache-cleanup') {
        if (!expiredOnly) try { await rm(path, { force: true }); } catch (error) { preserved++; failures.push({ file: name, code: (error as NodeJS.ErrnoException).code ?? 'CACHE_BUSY' }); }
        continue;
      }
      if (!owned(value) || name !== `${value.id}.json`) { preserved++; continue; }
      if (expiredOnly && Number.isFinite(Date.parse(value.retrievedAt)) && Date.parse(value.retrievedAt) >= cutoff) { evidenceIds.add(value.id); continue; }
      try { await rm(path, { force: true }); removed++; }
      catch (error) { evidenceIds.add(value.id); preserved++; failures.push({ file: name, code: (error as NodeJS.ErrnoException).code ?? 'CACHE_BUSY' }); }
    }
    for (const { name, value } of references) {
      if (expiredOnly && evidenceIds.has(value.id) && Date.parse(value.retrievedAt) >= cutoff) continue;
      if (expiredOnly && Date.parse(value.retrievedAt) >= cutoff) {
        try {
          const evidence: unknown = JSON.parse(await readFile(join(this.directory, `${value.id}.json`), 'utf8'));
          if (owned(evidence) && evidence.id === value.id && Date.parse(evidence.retrievedAt) >= cutoff) continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            preserved++; failures.push({ file: name, code: (error as NodeJS.ErrnoException).code ?? 'BAD_CACHE' }); continue;
          }
        }
      }
      try { await rm(join(this.directory, name), { force: true }); }
      catch (error) { preserved++; failures.push({ file: name, code: (error as NodeJS.ErrnoException).code ?? 'CACHE_BUSY' }); }
    }
    return { removed, preserved, failures };
  }
}
