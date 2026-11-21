import type { ConnectorDefinition } from './connectors.js';
import type { BatchReadReport, Capability, Channel, CommentReport, Document, Evidence, ReadReport, ResearchReport, SearchReport, SourceRun } from './types.js';
import { assessmentKey } from './research.js';
import type { CallToolResult } from '@modelcontextprotocol/server';

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? '');

function preview(value: string, limit: number) {
  if (value.length <= limit) return value;
  const points = Array.from(value);
  return points.length > limit ? points.slice(0, limit - 1).join('') + '…' : value;
}

function metadataView(metadata: Document['metadata'], maximum: number) {
  if (!metadata) return {};
  // 优先保留检索、回读和继续分页所需的字段，按完整字段投影。
  const priority = /^(?:relevance|raw|readRequest|bodyAvailable|partial|contentType|contentScope|originSource|acquisition|captureAt|requestedTimestamp|imageUrl|thumbnail|nextCursor|nextOffset|totalResults|platform|operation|scope|truncated)$/;
  const entries = Object.entries(metadata).sort(([a], [b]) => Number(priority.test(b)) - Number(priority.test(a)));
  const fields: [string, unknown][] = [];
  let used = 2, truncated = false;
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    const size = bytes(key) + 1 + bytes(value) + Number(fields.length > 0);
    if (used + size > maximum) { truncated = true; continue; }
    fields.push([key, value]); used += size;
  }
  return { metadata: Object.fromEntries(fields), ...(truncated ? { metadataTruncated: true as const } : {}) };
}

function evidenceView<T extends Omit<Document, 'content'> & Partial<Pick<Evidence, 'observations'>>>(value: T) {
  const { observations, metadata, ...rest } = value;
  return { ...rest, ...metadataView(metadata, 4096), ...(observations?.length ? { observationCount: observations.length } : {}) };
}

export function runView(run: SourceRun) {
  const { network, attempts, coverage, ...rest } = run;
  const { requested, ...range } = coverage ?? {};
  return { ...rest,
    ...(network?.requestCount ? { network: { requestCount: network.requestCount, ...(network.redirectResponseCount ? { redirectResponseCount: network.redirectResponseCount } : {}) } } : {}),
    ...(attempts && (attempts.length > 1 || attempts.some(item => item.reason && item.reason !== 'EMPTY_RESULTS')
      || (run.status !== 'ok' && run.status !== 'empty')) ? { attempts } : {}),
    ...(coverage ? { coverage: { ...range, ...(requested && Object.values(requested).some(value => value !== undefined) ? { requested } : {}) } } : {}),
  };
}

export function readView<T extends { content?: string; fragments?: ReadReport['fragments']; runs?: SourceRun[] }>(value: T) {
  const { fragments, runs, ...rest } = value;
  return { ...rest, ...(fragments?.length ? { fragments: fragments.map(({ content: _content, ...range }) => range) } : {}),
    ...(runs?.length ? { runs: runs.map(runView) } : {}) };
}

export function readReportView(report: ReadReport) {
  const { evidence, document, ...rest } = readView(report);
  return { ...rest, ...(evidence ? { evidence: evidenceView(evidence) } : {}), ...(document ? { document: evidenceView(document) } : {}) };
}

export function storedEvidenceView<T extends Omit<Evidence, 'content'> & { content?: string; fragments?: ReadReport['fragments'] }>(value: T) {
  return evidenceView(readView(value));
}

export function batchReadView(report: BatchReadReport) {
  const first = new Map<ReadReport, number>();
  return { ...report, documents: report.documents.map((document, index) => {
    const duplicateOf = first.get(document);
    if (duplicateOf !== undefined) return { status: document.status, duplicateOf, cacheHit: document.cacheHit,
      ...(document.evidence ? { evidence: { id: document.evidence.id, observationId: document.evidence.observationId } } : {}) };
    first.set(document, index);
    return readReportView(document);
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
      retrievals: hit.retrievals.map(({ snippet: original, metadata, ...retrieval }) => ({
        ...retrieval, ...(original !== hit.snippet && original !== '' ? { snippet: preview(original, 300) } : {}),
        ...metadataView(metadata, Math.min(2048, Math.floor(32768 / hit.retrievals.length))),
      })) };
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
  return { ...rest, documents: documents.map(readReportView),
    ...(stateFile ? { stateFile } : compactState ? { state: compactState, ...(pending ? { implicitPendingAssessments: pending } : {}) } : {}),
    ...(coverage ? { coverage: { ...coverage, gaps: coverage.gaps.slice(0, 50),
      ...(coverage.gaps.length > 50 ? { totalGaps: coverage.gaps.length } : {}) } } : {}) };
}

function operationList(item: { operations?: Capability['operations'] }) {
  return item.operations?.map(({ name, entrypoint, contentTypes }) => ({ name, entrypoint, contentTypes }));
}

export function capabilityView(item: Capability & { status?: string }) {
  const { name, platforms, configured, status, search, read, comments, images, backend, automatic } = item;
  return { name, platforms, configured, status, search, read, comments, images, backend, automatic,
    operationNames: item.operations?.map(operation => operation.name) };
}

export function channelView(report: { channels: Channel[]; runs: SourceRun[]; status: string }, scoped = false) {
  return { ...report, channels: report.channels.map(({ source, platform, configured, status, search, read, comments, images, browser, automatic, operations }) =>
    ({ source, platform, configured, status, search, read, comments, images, browser, automatic,
      ...(scoped ? { operations: operationList({ operations }) } : { operationNames: operations?.map(operation => operation.name) }) })),
    runs: report.runs.filter(run => (run.status !== 'ok' && run.status !== 'empty') || run.network?.requestCount).map(runView) };
}

export function connectorView({ id, label, type, platforms, operations, read }: ConnectorDefinition) {
  return { id, label, type, platforms, operations: Object.keys(operations), read: Boolean(read) };
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
