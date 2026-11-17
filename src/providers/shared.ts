import type { ApiConfig, Document, SearchHit, SourceName } from '../types.js';
import { EnvHttpProxyAgent } from 'undici';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export type Row = Record<string, unknown>;

let proxy: EnvHttpProxyAgent | undefined;
const retryDeadlines = new Map<string, number>();
const anonymousRequests = new AsyncLocalStorage<{ fields: Set<string>; secret?: string }>();
const requestLimits = new AsyncLocalStorage<{ source: string; min_interval_ms?: number; max_response_bytes?: number }>();
const slots = new Map<string, { tail: Promise<void>; lastStart: number }>();
export function withRequestLimits<T>(source: string, limits: { min_interval_ms?: number; max_response_bytes?: number } | undefined, run: () => Promise<T>): Promise<T> {
  if (requestLimits.getStore()?.source === source) return run();
  return requestLimits.run({ source, ...limits }, run);
}
async function pace(key: string, interval: number, signal: AbortSignal) {
  const state = slots.get(key) ?? { tail: Promise.resolve(), lastStart: 0 }; slots.set(key, state);
  const previous = state.tail;
  let release!: () => void; const turn = new Promise<void>(resolve => { release = resolve; });
  state.tail = previous.then(() => turn);
  try {
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { signal.removeEventListener('abort', cancel); reject(signal.reason); };
      signal.addEventListener('abort', cancel, { once: true });
      previous.then(() => { signal.removeEventListener('abort', cancel); resolve(); });
      if (signal.aborted) cancel();
    });
    const wait = state.lastStart + interval - Date.now(); if (wait > 0) await delay(wait, undefined, { signal });
    signal.throwIfAborted(); state.lastStart = Date.now();
  } finally { release(); }
}
function boundedResponse(result: Response, maximum: number): Response {
  if (!result.body) return result;
  let received = 0;
  const body = result.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    received += chunk.byteLength;
    if (received > maximum) throw Object.assign(new Error('结构化响应超过本次字节预算，请缩小范围或继续分页'), { code: 'RESPONSE_BUDGET' });
    controller.enqueue(chunk);
  } }));
  const bounded = new Response(body, { status: result.status, statusText: result.statusText, headers: result.headers });
  Object.defineProperties(bounded, { url: { value: result.url }, redirected: { value: result.redirected }, type: { value: result.type } });
  return bounded;
}
export function withoutAuthentication<T>(apiKey: string | undefined, auth: { header?: string; query?: string; body?: string } | undefined, run: () => Promise<T>): Promise<T> {
  const fields = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key', 'api-key', 'api-username', 'x-subscription-token', 'api_key', 'key', 'access_token', 'token', 'subscription-key', auth?.header, auth?.query, auth?.body].filter((value): value is string => Boolean(value)).map(value => value.toLowerCase()));
  return anonymousRequests.run({ fields, secret: apiKey }, async () => {
    try { return await run(); }
    catch (error) { if (error && typeof error === 'object') Object.assign(error, { credentialUsed: false }); throw error; }
  });
}
export async function fetchResponse(url: URL | string, init: RequestInit): Promise<Response> {
  const anonymous = anonymousRequests.getStore();
  if (anonymous) {
    const address = new URL(url), headers = new Headers(init.headers);
    const credential = (key: string, value: unknown) => anonymous.fields.has(key.toLowerCase()) || Boolean(anonymous.secret && typeof value === 'string' && value.includes(anonymous.secret));
    for (const [key, value] of [...headers]) if (credential(key, value)) headers.delete(key);
    for (const [key, value] of [...address.searchParams]) if (credential(key, value)) address.searchParams.delete(key);
    let body = init.body;
    if (typeof body === 'string') {
      if (headers.get('content-type')?.includes('application/json')) {
        const value = JSON.parse(body);
        if (value && typeof value === 'object' && !Array.isArray(value)) body = JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key, item]) => !credential(key, item))));
      } else if (headers.get('content-type')?.includes('application/x-www-form-urlencoded')) {
        const values = new URLSearchParams(body);
        for (const [key, value] of [...values]) if (credential(key, value)) values.delete(key);
        body = values.toString();
      }
    }
    url = address; init = { ...init, headers, body };
  }
  const host = new URL(url).hostname;
  const configured = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const useProxy = configured && !['localhost', '127.0.0.1', '[::1]'].includes(host);
  const settings = useProxy ? { ...init, dispatcher: proxy ??= new EnvHttpProxyAgent() } : init;
  const limits = requestLimits.getStore();
  if (limits?.min_interval_ms) await pace(limits.source + ':' + new URL(url).origin, limits.min_interval_ms, init.signal ?? new AbortController().signal);
  const result = await fetch(url, settings);
  return limits ? boundedResponse(result, limits.max_response_bytes ?? 8 * 1024 * 1024) : result;
}

export function object(value: unknown, name: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 响应缺少对象数据`);
  return value as Row;
}

export function rows(value: unknown, name: string): Row[] {
  if (!Array.isArray(value)) throw new Error(`${name} 响应缺少结果列表`);
  return value.filter((item): item is Row => !!item && typeof item === 'object' && !Array.isArray(item));
}

export function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function decoded(value: unknown): string {
  return string(value).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (!code.startsWith('#')) return named[code.toLowerCase()] ?? entity;
    const n = Number.parseInt(code.slice(code[1]?.toLowerCase() === 'x' ? 2 : 1), code[1]?.toLowerCase() === 'x' ? 16 : 10);
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
  }).trim();
}

export function plain(value: unknown): string {
  return decoded(string(value).replace(/<[^>]*>/g, ''));
}

export function htmlText(value: string, baseUrl: string): string {
  return decoded(value.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_tag, _quote, href: string, text: string) => {
      try { const target = new URL(decoded(href), baseUrl); return ['http:', 'https:'].includes(target.protocol) ? `${text} (${target.href})` : text; }
      catch { return text; }
    })
    .replace(/<span\b[^>]*class=["'][^"']*glyphicon-ok[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, ' ✓ ')
    .replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*>/gi, '$1')
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n').replace(/<\/(?:td|th)>/gi, ' | ').replace(/<[^>]+>/g, ''));
}

export async function textResponse(result: Response): Promise<{ text: string; encoding: string }> {
  const bytes = new Uint8Array(await result.arrayBuffer());
  const header = result.headers.get('content-type') ?? '';
  const prefix = Buffer.from(bytes.subarray(0, 8192)).toString('latin1');
  const declared = header.match(/charset\s*=\s*["']?([\w.-]+)/i)?.[1];
  const isHtml = /html/i.test(header) || /^\s*(?:<!doctype\s+html|<html|<head|<meta)\b/i.test(prefix);
  const meta = isHtml ? prefix.match(/charset\s*=\s*["']?([\w.-]+)/i)?.[1] : undefined;
  const xml = prefix.match(/^\s*<\?xml[^>]*encoding=["']([^"']+)/i)?.[1];
  for (const encoding of [...new Set([declared, meta, xml, 'utf-8'].filter((value): value is string => Boolean(value)))]) {
    try { return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding }; }
    catch { /* 按正文声明重试，保留旧网页的实际文字。 */ }
  }
  throw new Error('响应字符编码无法解码');
}

export function date(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

export function epoch(value: unknown): string | undefined {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(n) && n > 0 && n <= 8.64e12 ? new Date(n * 1000).toISOString() : undefined;
}

export function hit(source: SourceName, row: Omit<SearchHit, 'source'>): SearchHit[] {
  try {
    if (!['http:', 'https:'].includes(new URL(row.url).protocol)) return [];
  } catch { return []; }
  return [{ ...row, source, title: plain(row.title) || row.url, snippet: source === 'github' ? row.snippet.trim() : source === 'brave' || source === 'bilibili' ? plain(row.snippet) : decoded(row.snippet) }];
}

export function endpoint(config: ApiConfig, fallback: string, path: string): URL {
  return new URL(path, `${(config.baseUrl ?? fallback).replace(/\/$/, '')}/`);
}

export async function response(url: URL | string, init: RequestInit, name: string): Promise<Response> {
  const address = new URL(url), key = address.origin + address.pathname, deadline = retryDeadlines.get(key);
  if (deadline && deadline > Date.now()) throw Object.assign(new Error(`${name} 仍在 Retry-After 等待期，请先使用其他入口`), {
    code: 'RATE_LIMITED', retryAfterSeconds: Math.ceil((deadline - Date.now()) / 1000), retryAt: new Date(deadline).toISOString(),
  });
  if (deadline) retryDeadlines.delete(key);
  const result = await fetchResponse(url, init);
  if (!result.ok) {
    const detail = result.status === 401 || result.status === 403 ? '，请核对访问权限或来源配置' : '';
    const retry = result.status === 429 && result.headers.get('retry-after');
    const retryAfterSeconds = retry ? (/^\d+$/.test(retry) ? Number(retry) : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000))) : undefined;
    const retryTime = Date.now() + (retryAfterSeconds ?? NaN) * 1000;
    const retryAt = Number.isFinite(new Date(retryTime).getTime()) ? retryTime : undefined;
    if (retryAt && retryAt > Date.now()) retryDeadlines.set(key, retryAt);
    throw Object.assign(new Error(`${name} 请求返回 HTTP ${result.status}${detail}${retry ? `，Retry-After: ${retry}` : ''}`), {
      code: result.status === 429 ? 'RATE_LIMITED' : result.status === 412 ? 'PLATFORM_BLOCKED' : `HTTP_${result.status}`,
      ...(Number.isFinite(retryAfterSeconds) ? { retryAfterSeconds } : {}),
      ...(retryAt ? { retryAt: new Date(retryAt).toISOString() } : {}),
    });
  }
  return result;
}

export async function json(url: URL | string, init: RequestInit, name: string): Promise<Row> {
  const result = await response(url, init, name);
  try { return object(await result.json(), name); }
  catch (error) {
    if ((error as { code?: string })?.code === 'RESPONSE_BUDGET') throw error;
    throw new Error(`${name} 响应不是有效 JSON 对象`);
  }
}

export function document(source: SourceName, url: string, title: string, content: unknown, extra: Partial<Document> = {}): Document {
  if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(`${source} 返回了无效的原文链接`);
  const text = string(content);
  if (!text.trim()) throw new Error(`${source} 未返回正文，摘要或结果标题不能代替原文`);
  return { source, url, title: plain(title) || url, content: text, contentKind: 'page', ...extra };
}

export function apiHeaders(config: ApiConfig, header: string, bearer = false): Record<string, string> {
  return { 'Content-Type': 'application/json', [header]: `${bearer ? 'Bearer ' : ''}${config.apiKey ?? ''}` };
}

export function permitted(domains: string[] | undefined, hostname: string): boolean {
  return !domains?.length || domains.some((domain) => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`));
}
