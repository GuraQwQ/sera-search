import { sourceNameSchema } from './source-schema.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { canonicalUrl } from './evidence.js';
import type { EvidenceStore } from './evidence.js';
import { intents, sourceNames } from './types.js';
import type { Evidence, ResearchAssessment, ResearchOptions, ResearchReport, ResearchState } from './types.js';

const id = z.string().trim().min(1).max(256);
const evidenceId = z.string().regex(/^[a-f0-9]{64}$/);
const scope = z.record(z.string(), z.string());
export const subjectSchema = z.object({ id, name: id, aliases: z.array(id).optional(), urls: z.array(z.string().url()).optional() });
export const criterionSchema = z.object({ id, description: id, kind: z.enum(['required', 'preference']).default('required'), intent: z.enum(intents).optional(), scope: scope.optional(), keywords: z.array(id).optional() });
export const assessmentSchema = z.object({
  subjectId: id, criterionId: id, status: z.enum(['pending', 'supported', 'conflict']).default('pending'),
  outcome: z.enum(['unknown', 'satisfied', 'violated']).default('unknown'), conclusion: z.string().optional(), scope: scope.optional(),
  citations: z.array(z.object({ evidenceId, offset: z.number().int().nonnegative().optional(), endOffset: z.number().int().nonnegative().optional() })).default([]),
  reviewedEvidenceIds: z.array(evidenceId).default([]),
  measurement: z.object({ value: z.number().finite(), unit: id, normalization: z.object({ factor: z.number().finite(), unit: id, note: id }).optional() }).optional(),
});
export const researchStateSchema = z.object({
  version: z.literal(2), subjects: z.array(subjectSchema).max(100), criteria: z.array(criterionSchema).max(100),
  assessments: z.array(assessmentSchema).max(10000).default([]), targetCount: z.number().int().min(1).max(100).optional(),
  evidenceIds: z.array(evidenceId).default([]), discoveredUrls: z.array(z.string().url()).default([]), examinedUrls: z.array(z.string().url()).default([]),
  candidates: z.array(z.object({ subjectId: id, criterionId: id, evidenceId, url: z.string().url(), itemKey: z.string().optional() })).default([]),
  discoveredItems: z.array(z.string()).optional(), examinedItems: z.array(z.string()).optional(),
  accessFailures: z.array(z.object({ url: z.string().url(), codes: z.array(z.string()), retryAt: z.string().datetime({ offset: true }).optional() })).default([]),
  history: z.array(z.object({ query: z.string(), sources: z.array(sourceNameSchema), newUrls: z.number().int().nonnegative(), newItems: z.number().int().nonnegative().optional(), newEvidence: z.number().int().nonnegative(), resolved: z.number().int().nonnegative() })).max(100).default([]),
  resolvedCount: z.number().int().nonnegative().default(0),
  nextAction: z.enum(['continue', 'review-evidence', 'change-query', 'change-source', 'waiting', 'complete']).optional(),
  nextQuery: z.string().optional(), nextSources: z.array(sourceNameSchema).optional(),
});

export function prepareResearch(input: ResearchOptions): ResearchState {
  const state: ResearchState = input.state ? structuredClone(input.state) : {
    version: 2, subjects: input.subjects ?? (input.targetCount ? [] : [{ id: 'task', name: input.query.slice(0, 256) }]),
    criteria: [], assessments: [], evidenceIds: [], discoveredUrls: [], examinedUrls: [], candidates: [], accessFailures: [], history: [], resolvedCount: 0,
  };
  if (input.subjects) state.subjects = [...new Map([...state.subjects, ...input.subjects].map(item => [item.id, item])).values()];
  if (input.criteria) state.criteria = [...new Map([...state.criteria, ...input.criteria].map(item => [item.id, item])).values()];
  for (const description of input.goals ?? []) if (!state.criteria.some(item => item.description === description)) {
    state.criteria.push({ id: stableId('criterion', description), description, kind: 'required' });
  }
  if (!state.criteria.length) state.criteria.push({ id: 'answer', description: input.query.slice(0, 256), kind: 'required' });
  if (input.targetCount !== undefined) state.targetCount = input.targetCount;
  const existing = new Set(state.assessments.map(assessmentKey));
  for (const subject of state.subjects) for (const criterion of state.criteria) {
    const key = assessmentKey({ subjectId: subject.id, criterionId: criterion.id });
    if (!existing.has(key)) {
      state.assessments.push({ subjectId: subject.id, criterionId: criterion.id, status: 'pending', outcome: 'unknown', citations: [], reviewedEvidenceIds: [] });
      existing.add(key);
    }
  }
  return researchStateSchema.parse(state);
}

const stableId = (kind: string, name: string) => `${kind}-${createHash('sha256').update(name).digest('hex').slice(0, 16)}`;
export const assessmentKey = (item: Pick<ResearchAssessment, 'subjectId' | 'criterionId'>) => JSON.stringify([item.subjectId, item.criterionId]);

export function migrateResearchState(value: unknown): { state: ResearchState; changed: boolean; warnings: string[] } {
  if (value && typeof value === 'object' && 'version' in value && value.version === 2) return { state: researchStateSchema.parse(value), changed: false, warnings: [] };
  const old = z.object({
    fields: z.array(z.object({ name: id, status: z.enum(['pending', 'supported', 'conflict']), evidenceIds: z.array(evidenceId).default([]), note: z.string().optional() })),
    examinedUrls: z.array(z.string().url()).default([]),
    candidates: z.array(z.object({ field: z.string(), evidenceId, url: z.string().url() })).default([]),
    accessFailures: researchStateSchema.shape.accessFailures,
  }).parse(value);
  const state: ResearchState = { version: 2, subjects: [], criteria: [], assessments: [], evidenceIds: [], discoveredUrls: [...old.examinedUrls], examinedUrls: [...old.examinedUrls], candidates: [], accessFailures: old.accessFailures, history: [], resolvedCount: 0 };
  const warnings: string[] = [];
  for (const field of old.fields) {
    const split = field.name.match(/^([^：:]+)[：:]\s*(.+)$/);
    const name = split?.[1]?.trim() ?? '研究对象', description = split?.[2]?.trim() ?? field.name;
    const subjectId = stableId('subject', name), criterionId = stableId('criterion', description);
    if (!state.subjects.some(item => item.id === subjectId)) state.subjects.push({ id: subjectId, name });
    if (!state.criteria.some(item => item.id === criterionId)) state.criteria.push({ id: criterionId, description, kind: 'required' });
    state.assessments.push({ subjectId, criterionId, status: field.status, outcome: 'unknown', conclusion: field.note, citations: field.evidenceIds.map(evidenceId => ({ evidenceId })), reviewedEvidenceIds: [] });
    for (const candidate of old.candidates.filter(item => item.field === field.name)) state.candidates.push({ subjectId, criterionId, evidenceId: candidate.evidenceId, url: candidate.url });
  }
  state.evidenceIds = [...new Set([...state.assessments.flatMap(item => item.citations.map(cite => cite.evidenceId)), ...old.candidates.map(item => item.evidenceId)])];
  state.discoveredUrls = [...new Set([...state.discoveredUrls, ...old.candidates.map(item => item.url)].map(canonicalUrl))];
  if (old.candidates.some(item => !old.fields.some(field => field.name === item.field))) warnings.push('部分旧候选缺少对应字段，原 URL 与证据 ID 已保留，可重新关联对象和判据。');
  warnings.push('旧状态已迁移为 version:2；原结论和证据 ID 保留，补充 outcome 与原文坐标后才能通过完成检查。');
  return { state: researchStateSchema.parse(state), changed: true, warnings };
}

export async function inspectResearch(state: ResearchState, store: EvidenceStore) {
  const evidence = new Map<string, Evidence>(), warnings: string[] = [];
  const ids = new Set([...state.evidenceIds, ...state.candidates.map(item => item.evidenceId), ...state.assessments.flatMap(item => item.citations.map(cite => cite.evidenceId))]);
  for (const id of ids) {
    try { evidence.set(id, await store.load(id)); }
    catch (error) { warnings.push(`${id}：${error instanceof Error ? error.message : String(error)}`); }
  }
  const coverage: NonNullable<ResearchReport['coverage']> = { qualified: [], excluded: [], unresolved: [], verified: [], gaps: [], complete: false };
  const verified = new Set<string>();
  const duplicate = (items: { id: string }[]) => new Set(items.filter((item, index) => items.findIndex(other => other.id === item.id) !== index).map(item => item.id));
  const subjectDuplicates = duplicate(state.subjects), criterionDuplicates = duplicate(state.criteria);
  const subjects = new Map(state.subjects.map(item => [item.id, item])), criteria = new Map(state.criteria.map(item => [item.id, item]));
  const assessments = new Map<string, ResearchAssessment>(), counts = new Map<string, number>();
  for (const item of state.assessments) { const key = assessmentKey(item); assessments.set(key, item); counts.set(key, (counts.get(key) ?? 0) + 1); }
  const characters = new Map([...evidence].map(([id, item]) => [id, Array.from(item.content)]));
  for (const assessment of state.assessments) {
    const subject = subjects.get(assessment.subjectId), criterion = criteria.get(assessment.criterionId);
    const gap = (reason: string) => coverage.gaps.push({ subjectId: assessment.subjectId, criterionId: assessment.criterionId, reason });
    if (!subject || !criterion) { gap('核验结果指向尚未登记的对象或判据'); continue; }
    if (subjectDuplicates.has(subject.id) || criterionDuplicates.has(criterion.id) || counts.get(assessmentKey(assessment)) !== 1) { gap('对象、判据或核验结果 ID 重复，需要合并'); continue; }
    if (assessment.status !== 'supported' || assessment.outcome === 'unknown' || !assessment.conclusion?.trim()) { gap('结论尚未核验，或仍有冲突'); continue; }
    if (!assessment.citations.length) { gap('结论缺少原文引用'); continue; }
    if (Object.entries(criterion.scope ?? {}).some(([key, value]) => assessment.scope?.[key] !== value)) { gap('结论适用条件尚未与判据对齐'); continue; }
    let valid = true;
    for (const citation of assessment.citations) {
      const document = evidence.get(citation.evidenceId);
      if (!document || document.metadata?.bodyAvailable === false) { gap('引用的目标材料不存在或尚未取得'); valid = false; continue; }
      const text = characters.get(citation.evidenceId)!;
      if (citation.offset === undefined || citation.endOffset === undefined || citation.offset >= citation.endOffset || citation.endOffset > text.length
        || !text.slice(citation.offset, citation.endOffset).join('').trim()) { gap('引用缺少有效的原文片段坐标'); valid = false; }
    }
    const measurement = assessment.measurement;
    if (measurement?.normalization && !Number.isFinite(measurement.value * measurement.normalization.factor)) { gap('数值换算超出可表示范围'); valid = false; }
    if (valid) { verified.add(assessmentKey(assessment)); coverage.verified.push({ subjectId: subject.id, criterionId: criterion.id }); }
  }
  const required = state.criteria.filter(item => item.kind === 'required');
  const qualification = required.length ? required : state.criteria;
  for (const subject of state.subjects) {
    const results = qualification.map(criterion => assessments.get(assessmentKey({ subjectId: subject.id, criterionId: criterion.id })));
    if (required.length && results.some(item => item && verified.has(assessmentKey(item)) && item.outcome === 'violated')) coverage.excluded.push(subject.id);
    else if (results.length && results.every(item => item && verified.has(assessmentKey(item)) && (!required.length || item.outcome === 'satisfied'))) coverage.qualified.push(subject.id);
    else coverage.unresolved.push(subject.id);
  }
  if (!state.subjects.length) coverage.gaps.push({ reason: '尚未登记候选对象' });
  if (state.targetCount !== undefined && coverage.qualified.length < state.targetCount) coverage.gaps.push({ reason: `需要 ${state.targetCount} 个满足必需条件的对象，当前核验 ${coverage.qualified.length} 个` });
  coverage.complete = state.subjects.length > 0 && state.criteria.length > 0 && (state.targetCount !== undefined
    ? coverage.qualified.length >= state.targetCount
    : coverage.qualified.length + coverage.excluded.length === state.subjects.length
      && state.subjects.filter(subject => coverage.qualified.includes(subject.id)).every(subject => state.criteria.filter(item => item.kind === 'preference').every(criterion => verified.has(assessmentKey({ subjectId: subject.id, criterionId: criterion.id })))))
    && !subjectDuplicates.size && !criterionDuplicates.size;
  const groups: NonNullable<ResearchReport['comparison']['groups']> = [];
  const indexedGroups = new Map<string, typeof groups[number]>();
  for (const assessment of state.assessments.filter(item => verified.has(assessmentKey(item)))) {
    const conditions = Object.fromEntries(Object.entries(assessment.scope ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    const raw = assessment.measurement, unit = raw?.normalization?.unit ?? raw?.unit;
    const key = JSON.stringify([assessment.criterionId, unit, conditions]);
    let group = indexedGroups.get(key);
    if (!group) { group = { criterionId: assessment.criterionId, scope: conditions, ...(unit ? { unit } : {}), values: [] }; groups.push(group); indexedGroups.set(key, group); }
    group.values.push({ subjectId: assessment.subjectId, conclusion: assessment.conclusion!, ...(raw ? { value: raw.value * (raw.normalization?.factor ?? 1), originalValue: raw.value, originalUnit: raw.unit, ...(raw.normalization ? { conversion: raw.normalization.note } : {}) } : {}) });
  }
  return { evidence, warnings, coverage, verified, groups };
}
