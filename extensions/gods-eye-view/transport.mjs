import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { Agent, ProxyAgent } from 'undici';
import { getProxyForUrl } from 'proxy-from-env';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export const callContext = new AsyncLocalStorage();
const nativeFetch = globalThis.fetch;
const base = 'http://127.0.0.1:4173';
const directory = new URL('./vendor/src/data/local_data/', import.meta.url);
const closers = new Set();
const loaded = new Map();
const dispatchers = new Map();
const socketAgents = new Map();
const providers = [
  ['/api/flights/track', 'aircraft/tracks', 'trackBackfillProxies'],
  ['/api/military/track', 'aircraft/tracks', 'trackBackfillProxies'],
  ['/api/flights', 'aircraft/opensky', 'openSkyProxy'],
  ['/api/military', 'aircraft/adsb-lol', 'adsbLolProxy'],
  ['/api/adsbdb', 'aircraft/enrichment', 'adsbdbProxy'],
  ['/api/celestrak', 'space/celestrak', 'celestrakProxy'],
  ['/api/launches', 'space/launch-library', 'rocketLaunchesProxy'],
  ['/api/rocket-launches', 'space/launch-library', 'rocketLaunchesProxy'],
  ['/api/firms', 'firms', 'firmsProxy'],
  ['/api/geocode', 'regional/place', 'geocodeProxy'],
  ['/api/weather-effects', 'regional/weather-effects', 'weatherEffectsProxy'],
  ['/api/regional-brief', 'regional/briefing', 'regionalBriefProxy'],
  ['/api/google', 'places/google', 'googlePlacesContextProxy'],
  ['/api/route', 'places/routes', 'installRouteMiddleware'],
  ['/api/terrain/heights', 'terrain', 'terrainHeightsProxy'],
  ['/api/tomtom', 'traffic', 'tomtomProxy'],
  ['/api/gbfs', 'gbfs', 'gbfsProxy'],
  ['/api/overpass', 'overpass', 'overpassProxy'],
  ['/api/military-installations', 'military-installations', 'militaryInstallationsProxy'],
  ['/api/weather', 'weather', 'weatherProxy'],
  ['/api/wind', 'wind', 'windProxy'],
  ['/api/cyclones', 'cyclones', 'cycloneProxy'],
  ['/api/fire-perimeters', 'firePerimeters', 'firePerimetersProxy'],
  ['/api/transit', 'transit', 'transitProxy'],
  ['/api/radio', 'radio', 'radioBrowserProxy'],
];

export function scrub(value) {
  let result = String(value);
  for (const [name, secret] of Object.entries(process.env)) {
    if (secret && /KEY|TOKEN|PASSWORD|SECRET/i.test(name)) result = result.split(secret).join('[隐藏]');
  }
  return result;
}

function dispatcherFor(address) {
  const proxy = getProxyForUrl(address);
  if (!proxy) return undefined;
  if (!dispatchers.has(proxy)) {
    if (/^socks/i.test(proxy)) {
      const agent = new SocksProxyAgent(proxy);
      dispatchers.set(proxy, new Agent({ connect(options, callback) {
        agent.connect({ destroy() {} }, { host: options.hostname, port: Number(options.port || (options.protocol === 'https:' ? 443 : 80)), secureEndpoint: options.protocol === 'https:', servername: options.servername || options.hostname })
          .then(socket => callback(null, socket), error => callback(error, null));
      } }));
    } else dispatchers.set(proxy, new ProxyAgent(proxy));
  }
  return dispatchers.get(proxy);
}

export function socketAgent(address) {
  const proxy = getProxyForUrl(address.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'));
  if (!proxy) return undefined;
  if (!socketAgents.has(proxy)) socketAgents.set(proxy, /^socks/i.test(proxy) ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy));
  return socketAgents.get(proxy);
}

// 上游模块使用原生 fetch；把本轮取消与网络来源一起传到真实请求边界。
globalThis.fetch = async (input, init = {}) => {
  const context = callContext.getStore();
  const signals = [init.signal, input instanceof Request ? input.signal : null, context?.signal].filter(Boolean);
  const address = input instanceof Request ? input.url : String(input);
  const dispatcher = dispatcherFor(address);
  let response;
  try { response = await nativeFetch(input, { ...init, ...(dispatcher ? { dispatcher } : {}), ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) }); }
  catch (error) {
    if (context && context.requests.length < 128) context.requests.push({ url: scrub(address), error: scrub(error.cause?.code || error.message), retrievedAt: new Date().toISOString() });
    throw error;
  }
  if (context && context.requests.length < 128) {
    context.requests.push({ url: scrub(response.url || (input instanceof Request ? input.url : input)), status: response.status, retrievedAt: new Date().toISOString(), ...(response.headers.get('retry-after') ? { retryAfter: response.headers.get('retry-after') } : {}) });
  }
  return response;
};

class MemoryResponse extends Writable {
  statusCode = 200;
  headersSent = false;
  headers = new Headers();
  chunks = [];
  size = 0;
  constructor() { super({ autoDestroy: false }); }
  setHeader(name, value) { this.headers.set(name, String(value)); return this; }
  getHeader(name) { return this.headers.get(name); }
  removeHeader(name) { this.headers.delete(name); }
  writeHead(status, headers) {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers || {})) this.setHeader(name, value);
    this.headersSent = true;
    return this;
  }
  _write(chunk, encoding, done) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.size += buffer.length;
    if (this.size > 64 * 1024 * 1024) return done(new Error('扩展响应超过 64 MiB'));
    this.chunks.push(buffer);
    done();
  }
}

async function middlewareFor(entry) {
  const [, file, factory] = entry;
  if (!loaded.has(factory)) {
    loaded.set(factory, (async () => {
      const routes = [];
      const events = new EventEmitter();
      const middlewares = { use(path, handler) { routes.push(typeof path === 'function' ? { path: '', handler: path } : { path, handler }); } };
      const module = await import(`./vendor/server/providers/${file}.js`);
      if (factory === 'installRouteMiddleware') module[factory](middlewares);
      else {
        const plugin = module[factory]();
        const server = { middlewares, httpServer: events, config: { server: { host: '127.0.0.1', port: 4173 } } };
        const after = await plugin.configureServer(server);
        if (typeof after === 'function') after();
        closers.add(() => { events.emit('close'); plugin.closeBundle?.(); });
      }
      return routes;
    })().catch(error => { loaded.delete(factory); throw error; }));
  }
  return loaded.get(factory);
}

export async function providerFetch(input, init = {}) {
  const address = input instanceof Request ? input.url : String(input);
  if (address.startsWith('file:')) {
    const url = new URL(address);
    if (!url.href.startsWith(directory.href)) return new Response(null, { status: 404 });
    try { return new Response(await readFile(url)); } catch (error) {
      if (error.code === 'ENOENT') return new Response(null, { status: 404 });
      throw error;
    }
  }
  if (!address.startsWith('/')) return globalThis.fetch(input, init);
  const url = new URL(address, base);
  const entry = providers.find(([prefix]) => url.pathname === prefix || url.pathname.startsWith(prefix + '/'));
  if (!entry) return Response.json({ error: `扩展未提供该数据路由：${url.pathname}` }, { status: 503 });
  const routes = await middlewareFor(entry);
  const signal = init.signal || callContext.getStore()?.signal;
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let done = false;
    const response = new MemoryResponse();
    const body = init.body ? Buffer.from(init.body) : null;
    const request = new Readable({ autoDestroy: false, read() { if (body) this.push(body); this.push(null); } });
    Object.assign(request, {
      method: init.method || 'GET', headers: { host: '127.0.0.1:4173', ...Object.fromEntries(new Headers(init.headers || {})) },
      socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1', localPort: 4173 },
      originalUrl: url.pathname + url.search,
    });
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = error => { if (done) return; done = true; cleanup(); reject(error); };
    const abort = () => { request.emit('aborted'); response.emit('close'); fail(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    response.on('error', fail);
    response.on('finish', () => {
      if (done) return;
      done = true;
      cleanup();
      const bytes = Buffer.concat(response.chunks);
      resolve(new Response([204, 205, 304].includes(response.statusCode) ? null : bytes, { status: response.statusCode, headers: response.headers }));
    });
    let cursor = 0;
    const next = () => {
      if (done) return;
      const route = routes.slice(cursor).find(item => !item.path || url.pathname === item.path || url.pathname.startsWith(item.path + '/'));
      if (!route) { response.statusCode = 404; response.end(); return; }
      cursor = routes.indexOf(route) + 1;
      request.url = (url.pathname.slice(route.path.length) || '/') + url.search;
      Promise.resolve().then(() => route.handler(request, response, next)).catch(fail);
    };
    next();
  });
}

export function closeProviders() {
  for (const close of closers) close();
  closers.clear();
  for (const dispatcher of dispatchers.values()) void dispatcher.destroy();
  dispatchers.clear();
  for (const agent of socketAgents.values()) agent.destroy();
  socketAgents.clear();
}

export async function checkProviders() {
  for (const [, file, factory] of providers) {
    const module = await import(`./vendor/server/providers/${file}.js`);
    if (typeof module[factory] !== 'function') throw new Error(`数据入口缺失：${factory}`);
  }
}
