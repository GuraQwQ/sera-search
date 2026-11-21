import { sourceNameSchema } from './source-schema.js';
import { createHash } from 'node:crypto';
import { readFile, readdir, rm, realpath, lstat, mkdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { serializeFile, writeAtomic } from './files.js';
import { sourceNames, extensionNames, wikiPreview } from './types.js';
import type { Config, Document, Evidence, EvidenceObservation, SourceName, EvidenceSource, ContentLocator } from './types.js';

export function canonicalUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === 'sera:' && url.hostname === 'extensions' && extensionNames.some(name => new RegExp(`^/${name}/[a-f0-9]{64}$`).test(url.pathname)) && !url.search && !url.hash && !url.username && !url.password && !url.port) return url.href;
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

export function retrievalKey(item: { url: string; locator?: ContentLocator }): string {
  const url = canonicalUrl(item.url);
  return item.locator ? `${url}\n${item.locator.kind}:${item.locator.id}` : url;
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function textPage(content: string, offset: number, length: number) {
  const characters = Array.from(content);
  const end = Math.min(offset + length, characters.length);
  return { content: characters.slice(offset, end).join(''), offset, totalCharacters: characters.length, nextOffset: end < characters.length ? end : null };
}

export function renderWikiPreview(content: string, page: { content: string; offset: number; fragments?: { offset: number; endOffset: number }[] }) {
  // 按原文遮住引注再截窗，跨页引注的偏移也按原始码点计算。
  const masked = content.replace(/<ref\b(?:[^>"']|"[^"]*"|'[^']*')*?(?:\/\s*>|>[\s\S]*?<\/ref\s*>)/gi,
    reference => '\0'.repeat(Array.from(reference).length));
  const characters = Array.from(masked);
  const ranges = page.fragments?.length ? page.fragments : [{ offset: page.offset, endOffset: page.offset + Array.from(page.content).length }];
  return ranges.map(({ offset, endOffset }) => characters.slice(offset, endOffset).join('').replaceAll('\0', '')
    .replace(/\[\[(?:Category|分類|分类):[^\[\]\n]*(?:\]{1,2}|(?=\n|$))/gi, '')
    .replace(/\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]+))?\]\]/g, (link, target: string, label: string | undefined) =>
      /^(?:File|Image|文件|图像):/i.test(target) ? link : label ?? target)
    .trim()).filter(Boolean).join('\n\n…\n\n');
}

export interface FocusOptions { query?: string; keywords?: string[] }

function sectionHeading(line: string) {
  const markdown = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
  const wiki = markdown ? undefined : line.match(/^\s*(={2,6})\s*(.+?)\s*\1\s*$/);
  const heading = markdown ?? wiki;
  return heading ? { depth: heading[1]!.length, title: heading[2]! } : undefined;
}

export function wikiLeadOffset(content: string) {
  let offset = 0;
  // 只越过首部格式块，保持正文和引用坐标指向同一份 wikitext。
  while (offset < content.length) {
    const whitespace = /^\s*/.exec(content.slice(offset))![0].length;
    const start = offset + whitespace;
    const marker = /^(?:<!--[\s\S]*?-->|__[A-Z]+__|\[\[(?:File|Image|文件|图像):[^\n]+\]\])\s*/i.exec(content.slice(start));
    if (marker) { offset = start + marker[0].length; continue; }
    if (!content.startsWith('{{', start)) break;
    let depth = 0, end: number | undefined;
    for (const match of content.slice(start, start + 65536).matchAll(/\{\{|\}\}/g)) {
      depth += match[0] === '{{' ? 1 : -1;
      if (!depth) { end = start + match.index + 2; break; }
    }
    if (end === undefined) break;
    const lineEnd = content.indexOf('\n', end);
    if (content.slice(end, lineEnd === -1 ? undefined : lineEnd).trim()) break;
    offset = end;
  }
  const start = offset + (/^\s*/.exec(content.slice(offset))?.[0].length ?? 0);
  return start < content.length ? Array.from(content.slice(0, start)).length : 0;
}

export function focusText(content: string, options: FocusOptions, length = 4000, offset = 0) {
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
  const lines = content.split('\n'), positions: number[] = [], boilerplate = new Set<number>(), embedded: [number, number][] = [];
  const links = /!?\[[^\]\n]*\]\([^\n)]*\)/g;
  let lineOffset = 0, unitOffset = 0;
  for (const line of lines) {
    positions.push(lineOffset);
    const heading = sectionHeading(line);
    if (heading && sections.length < 50) sections.push({ title: heading.title, offset: lineOffset });
    const nextOffset = lineOffset + Array.from(line).length + 1;
    const inlineData = line.length > 1000 && /^\s*\{"/.test(line) && /_jsxs?\(_components\./.test(line);
    if (inlineData) embedded.push([lineOffset, nextOffset]);
    if (inlineData || /\]\(/.test(line) && /^[\s#*+>\-\d.)|]*$/.test(line.replace(links, ''))) boilerplate.add(unitOffset);
    lineOffset = nextOffset;
    unitOffset += line.length + 1;
  }
  // 替换为等长空白，匹配偏移始终对应保存的原文。
  const searchable = content.replace(/\]\(https?:\/\/[^\s)]+\)/gi, match => ' '.repeat(match.length));
  const candidates: { start: number; end: number; anchor: number; terms: Set<string>; prose: Set<string>; count: number }[] = [];
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(escaped, 'giu');
    expression.lastIndex = unitOffsets[offset] ?? 0;
    let count = 0, menuCount = 0, startOfLine = 0, nextLine = boilerplate.size ? content.indexOf('\n') : -1;
    const searchText = /^https?:\/\//i.test(term) ? content : searchable;
    for (const match of searchText.matchAll(expression)) {
      if (nextLine !== -1 && match.index > nextLine) {
        startOfLine = content.lastIndexOf('\n', match.index - 1) + 1;
        nextLine = content.indexOf('\n', startOfLine);
      }
      const menu = boilerplate.has(startOfLine);
      if (menu ? menuCount++ >= 20 : count++ >= 100) { if (count > 100) break; continue; }
      const anchor = codePointOffset(match.index), end = codePointOffset(match.index + match[0].length);
      let start = Math.max(offset, anchor - 180), stop = Math.min(characters.length, end + 300);
      for (let at = start; at > Math.max(offset, start - 80); at--) if (characters[at - 1] === '\n') { start = at; break; }
      for (let at = stop; at < Math.min(characters.length, stop + 80); at++) if (characters[at] === '\n') { stop = at + 1; break; }
      if (!menu) for (const [first, last] of embedded) {
        if (first >= stop) break;
        if (last <= anchor) start = Math.max(start, last);
        else if (first > anchor) stop = first;
      }
      candidates.push({ start, end: stop, anchor, terms: new Set([term]), prose: new Set(menu ? [] : [term]), count: menu ? 0 : 1 });
    }
  }
  candidates.sort((a, b) => a.start - b.start);
  const merged: typeof candidates = [];
  for (const item of candidates) {
    const previous = merged.at(-1);
    if (previous && Boolean(previous.prose.size) === Boolean(item.prose.size)
      && item.start <= previous.end && Math.max(previous.end, item.end) - previous.start <= Math.min(1600, length)) {
      previous.end = Math.max(previous.end, item.end); previous.count += item.count;
      for (const term of item.terms) previous.terms.add(term);
      for (const term of item.prose) previous.prose.add(term);
    } else merged.push(item);
  }
  if (!merged.length) return { ...textPage(content, offset, length), selection: 'leading' as const, fragments: [], sections };
  merged.sort((a, b) => b.prose.size - a.prose.size || b.terms.size - a.terms.size || b.count - a.count || a.start - b.start);
  const fragments: { content: string; offset: number; endOffset: number; matchedTerms: string[] }[] = [];
  let used = 0;
  const proseFound = merged.some(item => item.prose.size);
  for (const candidate of merged) {
    if (proseFound && !candidate.prose.size) continue;
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
  const contexts: { content: string; offset: number; endOffset: number; kind: 'heading' | 'table-header' }[] = [];
  const addContext = (first: number, last: number, kind: 'heading' | 'table-header') => {
    const offset = positions[first]!, endOffset = Math.min(characters.length, positions[last]! + Array.from(lines[last]!).length);
    if (contexts.some(item => item.offset === offset) || fragments.some(item => item.offset <= offset && item.endOffset >= endOffset)
      || contexts.reduce((sum, item) => sum + Array.from(item.content).length, 0) + endOffset - offset > Math.min(1000, length)) return;
    contexts.push({ content: characters.slice(offset, endOffset).join(''), offset, endOffset, kind });
  };
  for (const fragment of fragments) {
    const start = positions.findLastIndex(offset => offset <= fragment.offset), end = positions.findLastIndex(offset => offset < fragment.endOffset);
    const headings = new Map<number, number>();
    for (let index = 0; index <= start; index++) {
      const depth = sectionHeading(lines[index]!)?.depth;
      if (depth) { for (const key of headings.keys()) if (key >= depth) headings.delete(key); headings.set(depth, index); }
    }
    for (const index of headings.values()) addContext(index, index, 'heading');
    for (let index = start; index <= end; index++) if (/\|/.test(lines[index]!)) {
      let first = index;
      while (first > 0 && /\|/.test(lines[first - 1]!)) first--;
      if (/^\s*\|?\s*:?-{3,}/.test(lines[first + 1] ?? '')) addContext(first, first + 1, 'table-header');
    }
  }
  return { content: fragments.map(item => item.content).join('\n\n…\n\n'), offset: fragments[0]?.offset ?? 0, totalCharacters: characters.length, nextOffset: null,
    selection: 'focused' as const, fragments, contexts, sections };
}

function owned(value: unknown): value is Evidence {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Evidence>;
  return item.kind === 'sera-evidence' && typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id)
    && typeof item.content === 'string' && typeof item.retrievedAt === 'string' && Array.isArray(item.retrievedBy);
}

function observation(document: Omit<Document, 'content'>, retrievedAt: string): EvidenceObservation {
  const value = { url: canonicalUrl(document.url), source: document.source, title: document.title, contentKind: document.contentKind,
    ...(document.publishedAt !== undefined ? { publishedAt: document.publishedAt } : {}), ...(document.locator ? { locator: document.locator } : {}),
    ...(document.metadata ? { metadata: document.metadata } : {}), retrievedAt };
  return { ...value, id: contentHash(JSON.stringify(value)) };
}

function normalizeEvidence(evidence: Evidence): Evidence {
  if (evidence.contentHash !== contentHash(evidence.content)) throw new Error('证据文件格式或正文校验不正确');
  const observations = evidence.observations ?? [observation(evidence, evidence.retrievedAt)];
  if (!observations.length || observations.some(item => !item || typeof item.id !== 'string' || !/^[a-f0-9]{64}$/.test(item.id)
    || typeof item.title !== 'string' || !Number.isFinite(Date.parse(item.retrievedAt)) || item.source !== evidence.source
    || retrievalKey(item) !== retrievalKey(evidence) || !['page', 'post', 'subtitle', 'metadata'].includes(item.contentKind)
    || observation(item, item.retrievedAt).id !== item.id)) throw new Error('证据观测记录格式不正确');
  return { ...evidence, observationId: evidence.observationId ?? observations[0]!.id, observations };
}

function projectObservation(evidence: Evidence, item: EvidenceObservation): Evidence {
  const { id: observationId, ...document } = item;
  return { ...document, content: evidence.content, kind: evidence.kind, id: evidence.id, contentHash: evidence.contentHash,
    retrievedBy: evidence.retrievedBy, observationId, observations: evidence.observations };
}

export function documentObservations(document: Evidence): Evidence[];
export function documentObservations(document: Document): Document[];
export function documentObservations(document: Document): Document[] {
  return owned(document) && document.observations?.length ? document.observations.map(item => projectObservation(document, item)) : [document];
}

const lastObservedAt = (evidence: Evidence) => Math.max(Date.parse(evidence.retrievedAt), ...(evidence.observations ?? []).map(item => Date.parse(item.retrievedAt)));
interface UrlEntry { id: string; retrievedAt: string; observationId?: string }
interface UrlReference extends UrlEntry { kind: 'sera-url-cache'; key: string; url: string; source: EvidenceSource; locator?: ContentLocator; entries?: UrlEntry[] }
const referenceKey = (url: string, source: EvidenceSource, locator?: ContentLocator) => contentHash(retrievalKey({ url, locator }) + '\n' + source);
const validEntry = (item: UrlEntry) => item && typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id) && Number.isFinite(Date.parse(item.retrievedAt))
  && (item.observationId === undefined || typeof item.observationId === 'string' && /^[a-f0-9]{64}$/.test(item.observationId));
const referenceEntries = (reference: UrlReference): UrlEntry[] => reference.entries ?? [{ id: reference.id, retrievedAt: reference.retrievedAt, ...(reference.observationId ? { observationId: reference.observationId } : {}) }];
function ownedReference(value: unknown): value is UrlReference {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<UrlReference>;
  if (item.kind !== 'sera-url-cache' || typeof item.url !== 'string' || item.source !== 'external' && !sourceNameSchema.safeParse(item.source).success
    || !validEntry(item as UrlEntry) || item.entries !== undefined && (!Array.isArray(item.entries) || !item.entries.length || !item.entries.every(validEntry))) return false;
  try { return item.key === referenceKey(item.url, item.source as EvidenceSource, item.locator); } catch { return false; }
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
    const id = createHash('sha256').update(retrievalKey(document) + '\n' + hash + '\n' + document.source).digest('hex');
    const path = join(this.directory, `${id}.json`);
    const observed = observation(document, new Date().toISOString());
    const evidence = await serializeFile(path, async () => {
      let previous: Evidence | undefined;
      try {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (!owned(value) || value.id !== id) throw new Error('证据位置已被其他文件占用');
        previous = normalizeEvidence(value);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const first: Evidence = previous ?? { ...document, url, kind: 'sera-evidence', id, contentHash: hash, retrievedAt: observed.retrievedAt, retrievedBy: [document.source] };
      const observations = [...(previous?.observations ?? [])];
      if (!observations.some(item => item.id === observed.id)) observations.push(observed);
      const saved = { ...first, observationId: first.observationId ?? observed.id, observations };
      await writeAtomic(path, JSON.stringify(saved, null, 2) + '\n');
      return projectObservation(saved, observed);
    });
    await this.remember(url, evidence);
    return evidence;
  }

  async remember(value: string, evidence: Evidence, locator: ContentLocator | null | undefined = evidence.locator) {
    await this.prepare();
    const url = canonicalUrl(value), key = referenceKey(url, evidence.source, locator ?? undefined), path = join(this.directory, `url-${key}.json`);
    await serializeFile(path, async () => {
      let entries: UrlEntry[] = [];
      try {
        const previous: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (!ownedReference(previous)) throw new Error('URL 缓存位置已被其他文件占用');
        entries = referenceEntries(previous);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const entry: UrlEntry = { id: evidence.id, retrievedAt: evidence.retrievedAt, ...(evidence.observationId ? { observationId: evidence.observationId } : {}) };
      entries = [entry, ...entries.filter(item => item.id !== entry.id || item.observationId !== entry.observationId || item.retrievedAt !== entry.retrievedAt)].sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt));
      const reference: UrlReference = { kind: 'sera-url-cache', key, url, source: evidence.source, ...entries[0]!, ...(locator ? { locator } : {}), entries };
      await writeAtomic(path, JSON.stringify(reference) + '\n');
    });
  }

  async forget(value: string, source: EvidenceSource, id: string, locator?: ContentLocator) {
    const key = referenceKey(value, source, locator), path = join(this.directory, `url-${key}.json`);
    await serializeFile(path, async () => {
      let reference: unknown;
      try { reference = JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      if (!ownedReference(reference) || reference.key !== key) throw new Error('URL 缓存位置已被其他文件占用');
      const entries = referenceEntries(reference).filter(item => item.id !== id);
      if (!entries.length) await rm(path, { force: true });
      else await writeAtomic(path, JSON.stringify({ ...reference, ...entries[0]!, entries }) + '\n');
    });
  }

  async find(value: string, sources?: EvidenceSource[], maxAgeMs?: number, accept?: (evidence: Evidence) => boolean, locator?: ContentLocator): Promise<Evidence | undefined> {
    const url = canonicalUrl(value);
    if (maxAgeMs !== undefined && (!Number.isFinite(maxAgeMs) || maxAgeMs < 0)) throw new Error('缓存时长需要非负毫秒数');
    if (maxAgeMs === 0) return undefined;
    const address = new URL(url), retentionMs = this.config.retentionDays * 86400000;
    const snapshot = address.hostname === 'web.archive.org' && /^\/web\/\d{14}(?:[a-z_]+)?\//i.test(address.pathname);
    for (const source of [...new Set<EvidenceSource>(sources ?? [...sourceNames, ...(this.config.connectors ?? []).map(item => item.id), 'external'])]) {
      const immutable = snapshot || source === 'wiki' && /^\d+$/.test(address.searchParams.get('oldid') ?? '');
      const freshness = Math.min(maxAgeMs ?? (immutable ? retentionMs : 15 * 60000), retentionMs);
      const key = referenceKey(url, source, locator);
      let reference: unknown;
      try {
        reference = JSON.parse(await readFile(join(this.directory, `url-${key}.json`), 'utf8'));
        if (!ownedReference(reference) || reference.key !== key || reference.source !== source || reference.url !== url) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) continue;
        throw error;
      }
      const loaded = new Map<string, Evidence>();
      for (const entry of referenceEntries(reference)) {
        const referenceAge = Date.now() - Date.parse(entry.retrievedAt);
        if (!Number.isFinite(referenceAge) || referenceAge < 0 || referenceAge >= freshness) continue;
        let evidence = loaded.get(entry.id);
        if (!evidence) {
          try { evidence = await this.load(entry.id); loaded.set(entry.id, evidence); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) continue; throw error; }
        }
        if (evidence.source !== source) continue;
        const selected = evidence.observations!.find(item => entry.observationId ? item.id === entry.observationId : item.retrievedAt === entry.retrievedAt);
        if (!selected) continue;
        const projected = projectObservation(evidence, selected), age = Date.now() - Date.parse(projected.retrievedAt);
        if (age >= 0 && age < freshness && (!accept || accept(projected))) return projected;
      }
    }
    return undefined;
  }

  async load(id: string): Promise<Evidence> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('证据 ID 应为 64 位十六进制字符串');
    let evidence: unknown;
    try { evidence = JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Object.assign(new Error('证据不存在或已过期，请重新读取原始链接'), { code: 'ENOENT' });
      throw error;
    }
    if (!owned(evidence) || evidence.id !== id) throw new Error('证据文件格式或正文校验不正确');
    return normalizeEvidence(evidence);
  }

  async get(id: string, offset = 0, length = 4000, focus?: FocusOptions, preview = false) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 20000) throw new Error('分页需要非负 offset 和 1–20000 的 length');
    const evidence = await this.load(id);
    const { content, ...metadata } = evidence;
    const page = focus?.query || focus?.keywords?.length ? focusText(content, focus, length) : textPage(content, offset, length);
    return { ...metadata, ...page, ...(preview && evidence.source === 'wiki' && evidence.metadata?.format === 'wikitext'
      ? { [wikiPreview]: renderWikiPreview(content, page) } : {}) };
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
      try {
        await serializeFile(path, async () => {
          const current: unknown = JSON.parse(await readFile(path, 'utf8'));
          if (!owned(current) || name !== `${current.id}.json`) { preserved++; return; }
          if (expiredOnly) {
            let evidence: Evidence;
            try { evidence = normalizeEvidence(current); }
            catch { preserved++; failures.push({ file: name, code: 'BAD_CACHE' }); return; }
            if (lastObservedAt(evidence) >= cutoff) { evidenceIds.add(evidence.id); return; }
          }
          await rm(path, { force: true }); removed++;
        });
      }
      catch (error) { evidenceIds.add(value.id); preserved++; failures.push({ file: name, code: (error as NodeJS.ErrnoException).code ?? 'CACHE_BUSY' }); }
    }
    for (const { name } of references) {
      const path = join(this.directory, name);
      try {
        await serializeFile(path, async () => {
          const current: unknown = JSON.parse(await readFile(path, 'utf8'));
          if (!ownedReference(current)) throw Object.assign(new Error('URL 缓存格式不正确'), { code: 'BAD_CACHE' });
          const entries: UrlEntry[] = [];
          if (expiredOnly) for (const entry of referenceEntries(current)) {
            if (Date.parse(entry.retrievedAt) < cutoff) continue;
            if (evidenceIds.has(entry.id)) { entries.push(entry); continue; }
            try {
              const evidence: unknown = JSON.parse(await readFile(join(this.directory, `${entry.id}.json`), 'utf8'));
              if (owned(evidence) && evidence.id === entry.id && lastObservedAt(normalizeEvidence(evidence)) >= cutoff) entries.push(entry);
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          }
          if (!entries.length) await rm(path, { force: true });
          else if (JSON.stringify(entries) !== JSON.stringify(current.entries)) await writeAtomic(path, JSON.stringify({ ...current, ...entries[0]!, entries }) + '\n');
        });
      }
      catch (error) { preserved++; failures.push({ file: name, code: (error as NodeJS.ErrnoException).code ?? 'CACHE_BUSY' }); }
    }
    return { removed, preserved, failures };
  }
}
