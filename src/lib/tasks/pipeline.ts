import type { TaskStatus } from '@/lib/constants/status';

export type PipelineStageStatus =
  | 'ASSIGNED'
  | 'SUBMITTED_TO_DOCCON'
  | 'PENDING_REVIEW'
  | 'WAITING_BOSS_APPROVAL'
  | 'WAITING_SUPER_BOSS_APPROVAL'
  | 'COMPLETED'
  | 'CANCELLED';

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STAGE = new Set<PipelineStageStatus>(['COMPLETED', 'CANCELLED']);

const STATUS_TO_PIPELINE_STAGE: Record<string, PipelineStageStatus | null> = {
  ASSIGNED: 'ASSIGNED',
  SUBMITTED_TO_DOCCON: 'SUBMITTED_TO_DOCCON',
  DOCCON_REJECTED: 'SUBMITTED_TO_DOCCON',
  PENDING_REVIEW: 'PENDING_REVIEW',
  REVIEWER_REJECTED: 'PENDING_REVIEW',
  WAITING_BOSS_APPROVAL: 'WAITING_BOSS_APPROVAL',
  BOSS_REJECTED: 'WAITING_BOSS_APPROVAL',
  WAITING_SUPER_BOSS_APPROVAL: 'WAITING_SUPER_BOSS_APPROVAL',
  SUPER_BOSS_REJECTED: 'WAITING_SUPER_BOSS_APPROVAL',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REASSIGNED: null,
};

export interface StatusHistoryLike {
  status?: string | null;
  changedAt?: string | null;
}

interface ParsedHistoryEntry {
  index: number;
  status: string;
  stage: PipelineStageStatus;
  changedAtMs: number;
}

export interface StageSegment {
  stage: PipelineStageStatus;
  sourceStatus: string;
  sourceIndex: number;
  startMs: number;
  endMs: number;
}

interface StageSegmentOptions {
  currentStatus?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  nowMs?: number;
}

export interface CurrentStageStuckInfo {
  stage: PipelineStageStatus;
  days: number;
  enteredAt: string;
}

function parseIsoMs(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function safeNonNegativeDiffDays(diffMs: number): number {
  const normalizedMs = Math.max(0, diffMs);
  return Number((normalizedMs / DAY_MS).toFixed(1));
}

function getTerminalTimeMs(options: StageSegmentOptions, nowMs: number): number {
  const stage = normalizeStatusToPipelineStage(options.currentStatus);
  if (stage && TERMINAL_STAGE.has(stage)) {
    return parseIsoMs(options.completedAt) ?? parseIsoMs(options.updatedAt) ?? nowMs;
  }
  return nowMs;
}

function parseHistoryEntries(history: StatusHistoryLike[] | null | undefined): ParsedHistoryEntry[] {
  const rows = Array.isArray(history) ? history : [];
  return rows
    .map((entry, index) => {
      const stage = normalizeStatusToPipelineStage(entry.status);
      const changedAtMs = parseIsoMs(entry.changedAt);
      if (!stage || changedAtMs === null) return null;
      return {
        index,
        status: String(entry.status ?? ''),
        stage,
        changedAtMs,
      } satisfies ParsedHistoryEntry;
    })
    .filter((entry): entry is ParsedHistoryEntry => entry !== null)
    .sort((a, b) => (a.changedAtMs - b.changedAtMs) || (a.index - b.index));
}

export function normalizeStatusToPipelineStage(status?: string | null): PipelineStageStatus | null {
  if (!status) return null;
  return STATUS_TO_PIPELINE_STAGE[status] ?? null;
}

export function getStageSegmentsFromHistory(
  history: StatusHistoryLike[] | null | undefined,
  options: StageSegmentOptions = {},
): StageSegment[] {
  const nowMs = options.nowMs ?? Date.now();
  const terminalMs = getTerminalTimeMs(options, nowMs);
  const parsed = parseHistoryEntries(history);
  const segments: StageSegment[] = [];

  if (parsed.length > 0) {
    for (let i = 0; i < parsed.length; i += 1) {
      const current = parsed[i];
      const next = parsed[i + 1];
      const startMs = current.changedAtMs;
      const endMs = next ? next.changedAtMs : terminalMs;
      segments.push({
        stage: current.stage,
        sourceStatus: current.status,
        sourceIndex: current.index,
        startMs,
        endMs: Math.max(startMs, endMs),
      });
    }

    const currentStage = normalizeStatusToPipelineStage(options.currentStatus);
    const lastStage = parsed[parsed.length - 1]?.stage ?? null;
    if (currentStage && currentStage !== lastStage) {
      const syntheticStart = parseIsoMs(options.updatedAt) ?? nowMs;
      const syntheticEnd = TERMINAL_STAGE.has(currentStage)
        ? parseIsoMs(options.completedAt) ?? parseIsoMs(options.updatedAt) ?? nowMs
        : nowMs;
      segments.push({
        stage: currentStage,
        sourceStatus: String(options.currentStatus ?? currentStage),
        sourceIndex: -1,
        startMs: syntheticStart,
        endMs: Math.max(syntheticStart, syntheticEnd),
      });
    }
    return segments;
  }

  const currentStage = normalizeStatusToPipelineStage(options.currentStatus);
  if (!currentStage) return [];

  const startMs = parseIsoMs(options.updatedAt) ?? nowMs;
  const endMs = TERMINAL_STAGE.has(currentStage)
    ? parseIsoMs(options.completedAt) ?? parseIsoMs(options.updatedAt) ?? nowMs
    : nowMs;

  return [{
    stage: currentStage,
    sourceStatus: String(options.currentStatus ?? currentStage),
    sourceIndex: -1,
    startMs,
    endMs: Math.max(startMs, endMs),
  }];
}

export function getStageDurationDaysByHistoryIndex(
  history: StatusHistoryLike[] | null | undefined,
  options: StageSegmentOptions = {},
): Record<number, number> {
  const map: Record<number, number> = {};
  const segments = getStageSegmentsFromHistory(history, options);
  for (const segment of segments) {
    if (segment.sourceIndex < 0) continue;
    map[segment.sourceIndex] = safeNonNegativeDiffDays(segment.endMs - segment.startMs);
  }
  return map;
}

export function getCurrentStageStuckInfo(params: {
  status: TaskStatus | string;
  statusHistory?: StatusHistoryLike[] | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  nowMs?: number;
}): CurrentStageStuckInfo | null {
  const nowMs = params.nowMs ?? Date.now();
  const currentStage = normalizeStatusToPipelineStage(params.status);
  if (!currentStage || TERMINAL_STAGE.has(currentStage)) return null;

  const segments = getStageSegmentsFromHistory(params.statusHistory, {
    currentStatus: params.status,
    updatedAt: params.updatedAt,
    completedAt: params.completedAt,
    nowMs,
  });

  const currentSegment = [...segments].reverse().find((segment) => segment.stage === currentStage);
  const enteredMs = currentSegment?.startMs ?? parseIsoMs(params.updatedAt) ?? nowMs;
  return {
    stage: currentStage,
    days: safeNonNegativeDiffDays(nowMs - enteredMs),
    enteredAt: new Date(enteredMs).toISOString(),
  };
}
