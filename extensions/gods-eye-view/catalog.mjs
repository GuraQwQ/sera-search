import { composeCatalog, defineTool, ToolError } from './vendor/src/tools/catalog.js';
import { createToolServices } from './vendor/src/tools/services.js';
import { AREA_SCHEMA, resolveArea } from './vendor/src/tools/area.js';
import { providerFetch, callContext, scrub } from './transport.mjs';
import { createCameraService, createVesselService, cameraRegions } from './live.mjs';
import * as aviation from './vendor/src/tools/queries/aviation.js';
import * as atmosphere from './vendor/src/tools/queries/atmosphere.js';
import * as brief from './vendor/src/tools/queries/brief.js';
import * as environment from './vendor/src/tools/queries/environment.js';
import * as hazards from './vendor/src/tools/queries/hazards.js';
import * as imagery from './vendor/src/tools/queries/imagery.js';
import * as infrastructure from './vendor/src/tools/queries/infrastructure.js';
import * as maritime from './vendor/src/tools/queries/maritime.js';
import * as mobility from './vendor/src/tools/queries/mobility.js';
import * as places from './vendor/src/tools/queries/places.js';
import * as media from './vendor/src/tools/queries/media.js';
import * as space from './vendor/src/tools/queries/space.js';
import * as surveillance from './vendor/src/tools/queries/surveillance.js';

export const upstreamCommit = '39d47a99ab791bf16ada4ce9778d32cc31e3d549';

function evidenceData(value) {
  if (Array.isArray(value)) return value.map(evidenceData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'view').map(([key, item]) => [key, evidenceData(item)]));
}

export function createCatalog({ fetchImpl = providerFetch, vesselService } = {}) {
  const services = createToolServices({ fetchImpl, appUrl: 'http://127.0.0.1:4173' });
  services.cctv = createCameraService();
  services.vessels = vesselService || createVesselService();
  delete services.summary;
  const definitions = Object.values({ ...aviation, ...atmosphere, ...brief, ...environment, ...hazards, ...imagery, ...infrastructure, ...maritime, ...mobility, ...places, ...media, ...space, ...surveillance })
    .filter(tool => tool?.name && typeof tool.run === 'function' && tool.name !== 'get_hud_caption');
  const tools = definitions.map(tool => {
    const properties = { ...tool.inputSchema.properties };
    if (['vessels_in_area', 'find_vessel'].includes(tool.name)) {
      properties.collect_seconds = { type: 'integer', minimum: 1, maximum: 60, description: '本次区域 AIS 订阅持续秒数，默认 5；采样不表示全量船舶。' };
      properties.area = AREA_SCHEMA;
    }
    if (tool.name === 'find_cctv_cameras') properties.camera_regions = { type: 'array', items: { type: 'string', enum: cameraRegions.map(([name]) => name) }, minItems: 1, maxItems: cameraRegions.length, description: '选择本轮加载的目录区域；省略时按 area 选择相交区域。' };
    return defineTool({ ...tool, inputSchema: { ...tool.inputSchema, properties } });
  });
  tools.push(defineTool({
    name: 'list_camera_regions', title: '摄像头目录区域', description: '发现公开摄像头目录区域及粗略覆盖边界，选择下一轮要加载的目录。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() { return { summary: `已接入 ${cameraRegions.length} 个摄像头目录区域`, data: { regions: cameraRegions.map(([name, bbox]) => ({ name, bbox, bboxScope: 'catalog-selection-envelope' })) } }; },
  }));
  return composeCatalog({
    tools,
    services,
    interceptors: [async (call, next) => {
      const inherited = callContext.getStore();
      const context = {
        signal: call.signal,
        requests: inherited?.requests || [],
        collections: inherited?.collections || [],
        startedAt: inherited?.startedAt || new Date().toISOString(),
        area: inherited?.area || null,
        collectSeconds: call.args.collect_seconds || inherited?.collectSeconds || 5,
        cameraRegions: call.args.camera_regions || inherited?.cameraRegions,
      };
      return callContext.run(context, async () => {
        if (call.args.area) context.area = await resolveArea(call.args.area, { services, signal: call.signal });
        let result;
        try { result = await next(call); }
        catch (error) {
          if (call.signal?.aborted) throw call.signal.reason;
          if (error instanceof ToolError) throw error;
          if (error.message === 'fetch failed' || /^HTTP \d+|HTTP \d+|source HTTP|proxy HTTP/.test(error.message)) {
            throw new ToolError('unavailable', scrub(`${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`));
          }
          throw error;
        }
        const data = evidenceData(result.data);
        if (call.tool.name === 'find_cctv_cameras') {
          data.complete = false;
          data.catalog_scope = 'selected regional public catalogs';
        }
        if (!inherited) data.provenance = {
          extension: 'gods-eye-view', upstreamCommit,
          startedAt: context.startedAt, retrievedAt: new Date().toISOString(),
          requests: context.requests, collections: context.collections,
          ...(call.tool.name.includes('satellite') ? { calculation: 'orbital-prediction-from-TLE' } : {}),
        };
        return { ...result, data };
      });
    }],
  });
}
