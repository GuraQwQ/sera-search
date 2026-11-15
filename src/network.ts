import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { errorMessage } from './config.js';
import type { Config, NetworkRequest, NetworkTrace } from './types.js';

export const httpTrace = new AsyncLocalStorage<NetworkRequest[]>();
const pending = new WeakMap<object, NetworkRequest>();

channel('undici:request:create').subscribe(value => {
  const requests = httpTrace.getStore();
  if (!requests) return;
  const { request } = value as { request: { origin: string; path: string; method: string } };
  const item: NetworkRequest = { url: new URL(request.path, request.origin).href, method: request.method, startedAt: new Date().toISOString() };
  requests.push(item);
  pending.set(request, item);
});
channel('undici:request:headers').subscribe(value => {
  const { request, response } = value as { request: object; response: { statusCode: number } };
  const item = pending.get(request);
  if (item) { item.status = response.statusCode; item.elapsedMs = Date.now() - Date.parse(item.startedAt); }
});
channel('undici:request:error').subscribe(value => {
  const { request, error } = value as { request: object; error: { code?: string; name?: string } };
  const item = pending.get(request);
  if (item) { item.error = error.code ?? error.name ?? 'NETWORK_ERROR'; item.elapsedMs = Date.now() - Date.parse(item.startedAt); }
});

export function networkReport(requests: NetworkRequest[], config: Config): NetworkTrace {
  const records = requests.map(item => {
    const url = new URL(item.url);
    for (const [key, value] of url.searchParams) {
      const redacted = errorMessage(value, config);
      if (redacted !== value) url.searchParams.set(key, redacted);
    }
    return { ...item, url: errorMessage(url.href, config) };
  });
  return { scope: 'sera-http', requestCount: records.length, redirectResponseCount: records.filter(item => [301, 302, 303, 307, 308].includes(item.status ?? 0)).length, requests: records, upstreamRequestCount: null };
}
