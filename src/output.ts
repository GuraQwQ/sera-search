import type { ConnectorDefinition } from './connectors.js';
import type { BatchReadReport, Capability, Channel, CommentReport, Document, Evidence, ReadReport, ResearchReport, SearchReport, SourceRun } from './types.js';
import { compactMetadata } from './types.js';
import { assessmentKey } from './research.js';
import type { CallToolResult } from '@modelcontextprotocol/server';

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? '');

function preview(value: string, limit: number) {
  if (value.length <= limit) return value;
  const points = Array.from(value);
  return points.length > limit ? points.slice(0, limit - 1).join('') + '…' : value;
}

function metadataView(metadata: Document['metadata'], maximum: number, showPreview = false) {
  if (!metadata) return {};
  // 优先保留检索、回读和继续分页所需的字段，按完整字段投影。
  const priority = /^(?:summary|externalIdCount|externalIdSample|recordUrl|relevance|raw|readRequest|bodyAvailable|partial|contentType|contentScope|originSource|acquisition|captureAt|requestedTimestamp|imageUrl|thumbnail|nextCursor|nextOffset|totalResults|platform|operation|scope|truncated)$/;
  const entries = Object.entries(metadata).sort(([a], [b]) => Number(priority.test(b)) - Number(priority.test(a)));
  const fields: [string, unknown][] = [];
  let used = 2, truncated = false;
  const omitted: Record<string, unknown> = {};
  const keep = (key: string, value: unknown) => {
    const size = bytes(key) + 1 + bytes(value) + Number(fields.length > 0);
    if (used + size > maximum) return false;
    fields.push([key, value]); used += size;
    return true;
  };
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (!keep(key, value)) {
      truncated = true;
      if (key === 'record' || key === 'externalIds') omitted[key] = value;
    }
  }
  if (Array.isArray(omitted.externalIds)) keep('externalIdSample', omitted.externalIds.slice(0, 3));
  const omittedRecord = omitted.record;
  if (showPreview && !metadata.summary && omittedRecord && typeof omittedRecord === 'object') {
    const sample = Array.isArray(omittedRecord) ? omittedRecord[0] : omittedRecord;
    if (sample && typeof sample === 'object') {
      const values = Object.fromEntries(Object.entries(sample).filter(([, value]) =>
        typeof value === 'string' && value.length <= 100 || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean').slice(0, 5));
      keep('recordPreview', Array.isArray(omittedRecord) ? { items: omittedRecord.length, first: values } : { fields: Object.keys(sample).slice(0, 8), values });
    }
  }
  return { metadata: Object.fromEntries(fields), ...(truncated ? { metadataTruncated: true as const } : {}) };
}

function evidenceView<T extends Omit<Document, 'content'> & Partial<Pick<Evidence, 'observations'>>>(value: T) {
  const { observations, metadata: originalMetadata, ...rest } = value;
  const metadata = originalMetadata && value.source === 'steam'
    ? Object.fromEntries(Object.entries(originalMetadata).filter(([key]) => key !== 'readPreview')) : originalMetadata;
  if (value.source === 'wikidata' && Array.isArray(metadata?.externalIds) && (metadata.externalIds.length > 6 || bytes(metadata.externalIds) > 700)) {
    const { externalIds, ...fields } = metadata;
    const sample: unknown[] = [];
    const preferred = (item: { rank?: unknown } | null) => item?.rank === 'preferred' ? 1 : item?.rank === 'deprecated' ? -1 : 0;
    for (const item of [...externalIds].sort((a, b) => preferred(b) - preferred(a))) {
      if (sample.length >= 6) break;
      if (bytes([...sample, item]) <= 700) sample.push(item);
    }
    return { ...rest, ...metadataView({ ...fields, externalIdCount: fields.externalIdCount ?? externalIds.length, ...(sample.length ? { externalIdSample: sample } : {}) }, 4096),
      metadataTruncated: true as const, ...(observations?.length ? { observationCount: observations.length } : {}) };
  }
  return { ...rest, ...metadataView(metadata, 4096), ...(observations?.length ? { observationCount: observations.length } : {}) };
}

export function runView(run: SourceRun) {
  const { network, attempts, coverage, ...rest } = run;
  const { requested, ...range } = coverage ?? {};
  const redundantError = attempts?.length === 1 && attempts[0]?.code === run.code && attempts[0]?.reason === run.message
    && attempts[0]?.status === run.status && (run.status === 'error' || run.status === 'cancelled');
  const undetermined = coverage?.completeness === 'unknown' && coverage.scope === '本次检索返回范围'
    && coverage.nextCursor === undefined && coverage.observed === undefined && !coverage.truncated
    && coverage.limitations?.length === 1 && coverage.limitations[0] === '检索命中数量不表示数据收录完整';
  return { ...rest,
    ...(network?.requestCount ? { network: { requestCount: network.requestCount, ...(network.redirectResponseCount ? { redirectResponseCount: network.redirectResponseCount } : {}) } } : {}),
    ...(attempts && !redundantError && (attempts.length > 1 || attempts.some(item => item.reason && item.reason !== 'EMPTY_RESULTS')
      || (run.status !== 'ok' && run.status !== 'empty')) ? { attempts } : {}),
    ...(coverage && !(undetermined && (run.status === 'error' || run.status === 'cancelled')) ? { coverage: { ...range, ...(requested && Object.values(requested).some(value => value !== undefined) ? { requested } : {}) } } : {}),
  };
}

export function readView<T extends { content?: string; fragments?: ReadReport['fragments']; runs?: SourceRun[] }>(value: T) {
  const { fragments, runs, ...rest } = value;
  return { ...rest, ...(fragments?.length ? { fragments: fragments.map(({ content: _content, ...range }) => range) } : {}),
    ...(runs?.length ? { runs: runs.map(runView) } : {}) };
}

export function readReportView(report: ReadReport, leadingPreview = false) {
  const { status, evidence, document, ...rest } = readView(report);
  const material = evidence ?? document;
  const view = { status, ...(evidence ? { evidence: evidenceView(evidence) } : {}), ...(document ? { document: evidenceView(document) } : {}), ...rest };
  if (!leadingPreview || !evidence || report.selection !== 'leading' || !report.content) return view;
  const metadata = material?.metadata;
  const wiki = material?.source === 'wiki' && metadata?.format === 'wikitext';
  const steam = material?.source === 'steam' && metadata?.contentScope === 'store-specification';
  const text = steam ? metadata?.readPreview || metadata?.summary : wiki ? report.content.replace(/\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]+))?\]\]/g, (link, target: string, label: string | undefined) =>
    /^(?:File|Image|Category|文件|图像|分類|分类):/i.test(target) ? link : label ?? target) : undefined;
  if (typeof text !== 'string' || !text || text === report.content) return view;
  return { ...view, content: undefined, offset: undefined, preview: text, nextOffset: report.offset ?? 0 };
}

export function storedEvidenceView<T extends Omit<Evidence, 'content'> & { content?: string; fragments?: ReadReport['fragments'] }>(value: T) {
  return evidenceView(readView(value));
}

export function batchReadView(report: BatchReadReport, leadingPreview = false) {
  const first = new Map<ReadReport, number>();
  return { ...report, documents: report.documents.map((document, index) => {
    const duplicateOf = first.get(document);
    if (duplicateOf !== undefined) return { status: document.status, duplicateOf, cacheHit: document.cacheHit,
      ...(document.evidence ? { evidence: { id: document.evidence.id, observationId: document.evidence.observationId } } : {}) };
    first.set(document, index);
    return readReportView(document, leadingPreview);
  }) };
}

export function recordView(report: ReadReport) {
  const view = readReportView(report);
  if (!report.evidence) return view;
  const { content: _content, offset: _offset, nextOffset: _nextOffset, ...saved } = view;
  return saved;
}

export function commentView({ evidence, page, runs, ...report }: CommentReport) {
  return { ...report, runs: runs.map(runView), ...(evidence ? { evidence: evidenceView(evidence) } : {}),
    ...(page ? { page: { ...page, ...metadataView(page.metadata, 4096), comments: page.comments.map(comment => {
      const text = preview(comment.text, 600);
      return { ...comment, text, ...(text !== comment.text ? { textTruncated: true } : {}) };
    }) } } : {}) };
}

export function searchView<T extends SearchReport>(report: T, limit: number) {
  const hits = [];
  let used = 0;
  for (const hit of report.hits.slice(0, limit)) {
    const snippet = preview(hit.snippet, 600);
    const item = { ...hit, title: preview(hit.title, 240), snippet,
      retrievals: hit.retrievals.map(({ snippet: original, metadata, ...retrieval }) => {
        const compact = metadata?.[compactMetadata];
        return { ...retrieval, ...(original !== hit.snippet && original !== '' ? { snippet: preview(original, 300) } : {}),
          ...metadataView(compact ? { ...compact, relevance: metadata?.relevance } : metadata, Math.min(2048, Math.floor(32768 / hit.retrievals.length)), !original.trim()) };
      }) };
    const size = bytes(item);
    if (size > 64 * 1024) continue;
    if (used + size > 64 * 1024) break;
    hits.push(item); used += size;
  }
  return { ...report, hits, runs: report.runs.map(runView),
    ...(hits.length < report.hits.length ? { hitsTruncated: true, totalHits: report.hits.length } : {}) };
}

export function researchView(report: ResearchReport, limit: number, stateFile?: string) {
  const { state, coverage, documents, ...rest } = searchView(report, limit);
  let compactState = state;
  let pending = 0;
  if (state && state.assessments.length > 100) {
    const counts = new Map<string, number>();
    for (const item of state.assessments) {
      const key = assessmentKey(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const subjects = new Set(state.subjects.map(item => item.id)), criteria = new Set(state.criteria.map(item => item.id));
    // 空白单元由 subjects × criteria 重建，保留所有审阅、引用及冲突记录。
    const assessments = state.assessments.filter(item => counts.get(assessmentKey(item)) !== 1 || !subjects.has(item.subjectId) || !criteria.has(item.criterionId)
      || item.status !== 'pending' || item.outcome !== 'unknown' || item.conclusion !== undefined || item.scope !== undefined
      || item.citations.length || item.reviewedEvidenceIds.length || item.measurement !== undefined);
    pending = state.assessments.length - assessments.length;
    compactState = { ...state, assessments };
  }
  return { ...rest, documents: documents.map(document => readReportView(document)),
    ...(stateFile ? { stateFile } : compactState ? { state: compactState, ...(pending ? { implicitPendingAssessments: pending } : {}) } : {}),
    ...(coverage ? { coverage: { ...coverage, gaps: coverage.gaps.slice(0, 50),
      ...(coverage.gaps.length > 50 ? { totalGaps: coverage.gaps.length } : {}) } } : {}) };
}

function operationList(item: { operations?: Capability['operations'] }) {
  return item.operations?.map(({ name, entrypoint, contentTypes }) => ({ name, entrypoint, contentTypes }));
}

export function capabilityView(item: Capability & { status?: string }) {
  const { name, platforms, configured, status, search, read, comments, images, backend, automatic } = item;
  return { name, platforms, configured, status: status === '可调用' ? undefined : status, search: search || undefined, read: read || undefined,
    comments: comments || undefined, images: images || undefined, backend: backend || undefined, automatic,
    operationNames: item.operations?.map(operation => operation.name) };
}

export function channelView(report: { channels: Channel[]; runs: SourceRun[]; status: string }, scoped = false) {
  return { ...report, channels: report.channels.map(({ source, platform, configured, status, search, read, comments, images, browser, automatic, operations }) =>
    ({ source, platform, configured, status: status === '可调用' ? undefined : status, search: search || undefined, read: read || undefined,
      comments: comments || undefined, images: images || undefined, browser, automatic,
      ...(scoped ? { operations: operationList({ operations }) } : { operationNames: operations?.map(operation => operation.name) }) })),
    runs: report.runs.filter(run => (run.status !== 'ok' && run.status !== 'empty') || run.network?.requestCount).map(runView) };
}

export function connectorView({ id, label, type, platforms, operations, read }: ConnectorDefinition) {
  return { id, label, type, platforms, operations: Object.keys(operations), read: read ? true : undefined };
}

export function backendView(result: CallToolResult): CallToolResult {
  const data = result.structuredContent as Record<string, unknown> | undefined;
  const evidence = data?.seraEvidence as Omit<Evidence, 'content'> | undefined;
  if (!data || !evidence?.id || result.isError || bytes(data) <= 16 * 1024) return result;
  const summary = { status: data.status ?? 'ok', seraEvidence: evidenceView(evidence), resultTruncated: true,
    nextSteps: ['通过 evidence 按 ID 分页回读完整结果，或用 full 直接展开。'] };
  return { ...result, structuredContent: summary, content: [{ type: 'text', text: JSON.stringify(summary) },
    ...result.content.filter(item => item.type !== 'text')] };
}
