import { z } from 'zod';
import type { DataCoverage, SearchRequest, SourceOperation } from '../types.js';

const dateTime = z.iso.datetime({ offset: true });
export const dateTimeSchema = z.string().refine(value => dateTime.safeParse(value).success, '需要有效的 ISO 8601 日期时间').meta({ format: 'date-time' });

export const locatorSchema = z.object({ kind: z.enum(['segment', 'event', 'record']), id: z.string().min(1).max(1024), parentUrl: z.string().url().optional(), startSeconds: z.number().finite().nonnegative().optional(), endSeconds: z.number().finite().nonnegative().optional(), occurredAt: dateTimeSchema.optional() }).refine(value => value.endSeconds === undefined || value.startSeconds === undefined || value.endSeconds >= value.startSeconds, '片段结束时间不能早于开始时间');

export function describeOperation(name: string, description: string, contentTypes: string[], schema: z.ZodType, accessMethod: SourceOperation['accessMethod'] = 'api'): SourceOperation {
  return { name, description, contentTypes, inputSchema: z.toJSONSchema(schema), accessMethod, entrypoint: 'search' };
}

export function selectOperation(request: SearchRequest, operations: SourceOperation[]): string {
  const name = request.operation ?? operations[0]?.name;
  if (!name || !operations.some(item => item.name === name)) throw Object.assign(new Error(`操作不可用，请查看 channels：${request.operation ?? ''}`), { code: 'UNSUPPORTED_OPERATION' });
  return name;
}

export function reportCoverage(request: SearchRequest, scope: string, extra: Partial<DataCoverage> = {}): DataCoverage {
  const coverage: DataCoverage = { scope, completeness: 'unknown', requested: { ...(request.since ? { since: request.since } : {}), ...(request.until ? { until: request.until } : {}), ...request.params }, ...extra };
  request.onCoverage?.(coverage);
  return coverage;
}
