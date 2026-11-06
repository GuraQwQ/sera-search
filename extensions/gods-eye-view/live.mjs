import WebSocket from 'ws';
import { callContext, socketAgent } from './transport.mjs';
import { ToolError } from './vendor/src/tools/catalog.js';
import { areaContains, resolveArea } from './vendor/src/tools/area.js';
import { vesselSnapshot, normalizeVesselTrack } from './vendor/src/sources/live/vessels.js';
import { ingestAisStreamEnvelope, aisStreamRows, readAisTrack } from './vendor/server/providers/vessels/ais-store.js';
import * as cameraLoaders from './vendor/server/providers/cctv/sources.js';
import { normalizeSourceItem } from './vendor/server/providers/cctv/normalize.js';
import { fetchCctvImageFromUpstream } from './vendor/server/providers/cctv/media.js';

export const cameraRegions = [
  ['austin', [-98, 29, -96, 32], 'loadAustinSourcesFromOpenData'],
  ['california', [-125, 32, -114, 42], 'loadCaltransSourcesFromOpenData'],
  ['london', [-0.6, 51, 0.4, 51.8], 'loadTflSourcesFromOpenData'],
  ['ontario', [-95, 41, -74, 57], 'loadOntarioSourcesFromOpenData'],
  ['finland', [19, 59, 32, 71], 'loadFintrafficSourcesFromOpenData'],
  ['british-columbia', [-140, 48, -114, 61], 'loadDriveBcSourcesFromOpenData'],
  ['texas', [-107, 25, -93, 37], 'loadTxdotSourcesFromOpenData'],
  ['estonia', [21, 57, 29, 60], 'loadTarkteeSourcesFromDatex'],
  ['new-south-wales', [140, -38, 154, -28], 'loadNswSourcesFromOpenData'],
  ['calgary', [-114.4, 50.7, -113.7, 51.3], 'loadCalgarySourcesFromOpenData'],
  ['catalonia', [0, 40, 4, 43], 'loadCataloniaSourcesFromOpenData'],
  ['hong-kong', [113.7, 22, 114.6, 22.7], 'loadHkSourcesFromOpenData'],
  ['delaware', [-76, 38, -75, 40], 'loadDelDOTSourcesFromOpenData'],
  ['king-county', [-123, 46, -120, 49], 'loadKingCountySourcesFromOpenData'],
  ['washington', [-125, 45, -116, 49], 'loadWsdotSourcesFromOpenData'],
  ['norway', [4, 57, 32, 72], 'loadVegvesenSourcesFromOpenData'],
  ['new-york', [-74.5, 40, -73, 41.5], 'loadNycSourcesFromOpenData'],
  ['toronto', [-79.7, 43.5, -79.1, 44], 'loadTorontoSourcesFromOpenData'],
  ['florida', [-88, 24, -80, 32], 'loadFloridaSourcesFromOpenData'],
  ['brenner-a22', [10, 45, 12, 48], 'loadA22SourcesFromOpenDataHub'],
  ['houston', [-96, 29, -94, 31], 'loadHoustonSourcesFromOpenData'],
];

export function overlappingRegions(area) {
  return cameraRegions.filter(([, [west, south, east, north]]) => {
    if (area.south > north || area.north < south) return false;
    return area.west <= area.east ? area.west <= east && area.east >= west : area.west <= east || area.east >= west;
  });
}

export function createCameraService() {
  const cache = new Map();
  const cameras = new Map();
  return {
    async getCatalog({ signal } = {}) {
      const context = callContext.getStore();
      if (!context?.area) return { sources: [...cameras.values()], trimmedPacks: [] };
      const regions = context.cameraRegions?.length
        ? cameraRegions.filter(([name]) => context.cameraRegions.includes(name))
        : overlappingRegions(context.area);
      if (!regions.length) throw new ToolError('unavailable', '该范围暂无已接入的摄像头目录，可先调用 list_camera_regions');
      const failures = [];
      const records = await Promise.all(regions.map(async ([name, , loader]) => {
        signal?.throwIfAborted();
        let entry = cache.get(name);
        if (!entry || Date.now() - entry.at > 300000) {
          try {
            const child = { ...context, requests: [] };
            let rows;
            try { rows = await callContext.run(child, () => cameraLoaders[loader]()); }
            finally { context.requests.push(...child.requests.slice(0, Math.max(0, 128 - context.requests.length))); }
            const failed = child.requests.find(request => request.error || request.status >= 400);
            if (!rows.length && failed) throw new Error(failed.error || `HTTP ${failed.status}`);
            entry = { at: Date.now(), rows: rows.map(row => ({ ...normalizeSourceItem(row), pack: name })), available: Number.isFinite(rows.available) ? rows.available : null, region: rows.region || null };
            cache.set(name, entry);
          } catch (error) {
            failures.push({ region: name, reason: error.message });
            if (!entry) return [];
          }
        }
        context.collections.push({ kind: 'camera-catalog', region: name, returned: entry.rows.length, available: entry.available, fetchedAt: new Date(entry.at).toISOString(), stale: Date.now() - entry.at > 300000 });
        for (const camera of entry.rows) if (camera.id) cameras.set(camera.id, camera);
        return entry.rows;
      }));
      context.collections.push({ kind: 'camera-coverage', regions: regions.map(([name]) => name), missing: failures });
      if (failures.length === regions.length && records.every(rows => !rows.length)) throw new ToolError('unavailable', '所选摄像头目录本次均不可用');
      const trimmed = regions.flatMap(([name]) => {
        const entry = cache.get(name);
        return entry?.available > entry.rows.length ? [{ pack: name, served: entry.rows.length, available: entry.available, region: entry.region }] : [];
      });
      return { sources: records.flat(), trimmedPacks: [...trimmed, ...failures.map(entry => ({ pack: entry.region, served: 0, available: null, reason: entry.reason }))] };
    },
    async getFrame(camera, { signal } = {}) {
      signal?.throwIfAborted();
      const result = await fetchCctvImageFromUpstream(camera.snapshotUrl || camera.url, { maxBytes: 3 * 1024 * 1024 });
      if (!result) throw new ToolError('unavailable', '该摄像头本次未取得有效静态图像');
      return { contentType: result.contentType, bytes: new Uint8Array(result.body), sourceKind: 'upstream-image' };
    },
  };
}

export function createVesselService({ Socket = WebSocket } = {}) {
  let active = Promise.resolve();
  let lastCollection = null;
  const observations = new Map();
  const receivedAt = new Map();
  async function collect(area, seconds, signal) {
    // 一个 API Key 同时只维持一条连接；每轮结束立即释放订阅。
    const previous = active;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    active = previous.then(() => gate);
    try {
      await new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
        previous.then(() => { signal?.removeEventListener('abort', abort); resolve(); });
        if (signal?.aborted) abort();
      });
      signal?.throwIfAborted();
      const key = process.env.AISSTREAM_API_KEY;
      if (!key) throw new ToolError('unavailable', '需要配置 AISSTREAM_API_KEY');
      const startedAt = Date.now();
      let messages = 0;
      let status = 'connecting';
      await new Promise((resolve, reject) => {
        const address = 'wss://stream.aisstream.io/v0/stream';
        const socket = new Socket(address, { maxPayload: 1024 * 1024, handshakeTimeout: 10000, agent: socketAgent(address) });
        let done = false;
        const finish = error => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          socket.close();
          const kill = setTimeout(() => socket.terminate(), 1000);
          kill.unref?.();
          error ? reject(error) : resolve();
        };
        const abort = () => finish(signal.reason);
        const timer = setTimeout(() => finish(status === 'connecting' ? new ToolError('unavailable', 'AIS 订阅连接未建立') : null), seconds * 1000);
        signal?.addEventListener('abort', abort, { once: true });
        socket.on('open', () => {
          status = 'connected';
          const spans = area.west <= area.east ? [[area.west, area.east]] : [[area.west, 180], [-180, area.east]];
          socket.send(JSON.stringify({ APIKey: key, BoundingBoxes: spans.map(([west, east]) => [[area.south, west], [area.north, east]]), FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData', 'StaticDataReport'] }));
        });
        socket.on('message', bytes => {
          let envelope;
          try { envelope = JSON.parse(bytes.toString()); } catch { return; }
          if (envelope.error || envelope.Error) return finish(new ToolError('unavailable', 'AIS 上游拒绝订阅，请核对凭据与订阅条件'));
          if (ingestAisStreamEnvelope(envelope)) {
            messages += 1;
          }
        });
        socket.on('error', error => finish(new ToolError('unavailable', `AIS 连接失败：${error.message}`)));
        socket.on('close', () => finish(status === 'connecting' ? new ToolError('unavailable', 'AIS 连接提前关闭') : null));
      });
      for (const row of aisStreamRows(50000)) {
        if (areaContains(area, { lat: row.lat, lon: row.lon })) {
          const id = String(row.mmsi);
          const existing = observations.get(id);
          observations.set(id, row);
          if (!existing || existing.last_position_UTC !== row.last_position_UTC) receivedAt.set(id, Date.now());
        }
      }
      lastCollection = { kind: 'ais-subscription', area: { west: area.west, south: area.south, east: area.east, north: area.north }, startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(), seconds, messages, complete: false };
      return lastCollection;
    } finally { release(); }
  }
  return {
    async getSnapshot(query = {}, { signal } = {}) {
      const context = callContext.getStore();
      const area = context?.area || (query.area ? await resolveArea({ lat: query.area.lat, lon: query.area.lon, radius_km: query.area.radiusKm }) : null);
      if (area) context?.collections.push(await collect(area, context?.collectSeconds || 5, signal));
      else if (!lastCollection) throw new ToolError('unavailable', '请提供 area 进行区域订阅，或先调用 vessels_in_area 建立本轮观测');
      const cutoff = Date.now() - 30 * 60 * 1000;
      for (const [id, row] of observations) {
        const observed = Number.isFinite(row.last_position_epoch) ? row.last_position_epoch * 1000 : Date.parse(row.last_position_UTC);
        if ((Number.isFinite(observed) ? observed : receivedAt.get(id) || 0) < cutoff) { observations.delete(id); receivedAt.delete(id); }
      }
      const rows = [...observations.values()].filter(row => !area || areaContains(area, { lat: row.lat, lon: row.lon }));
      const result = vesselSnapshot({ rows }, { source: 'AISStream', coverage: 'explicit regional subscriptions in this process; incomplete live samples' });
      return { ...result, complete: false, collection: lastCollection };
    },
    async getTrack(reference, { signal } = {}) { signal?.throwIfAborted(); return { records: normalizeVesselTrack(readAisTrack(reference)), complete: false }; },
  };
}
