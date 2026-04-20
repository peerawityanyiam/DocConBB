import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';
import type { TaskStatus } from '@/lib/constants/status';

// Report covers every raw status the task can enter. Statuses with no
// recorded occurrences still appear with count = 0 so the table shape is
// stable and "missing" statuses don't silently disappear.
const ALL_REPORTED_STATUSES: TaskStatus[] = [
  'ASSIGNED',
  'SUBMITTED_TO_DOCCON',
  'DOCCON_REJECTED',
  'PENDING_REVIEW',
  'REVIEWER_REJECTED',
  'WAITING_BOSS_APPROVAL',
  'BOSS_REJECTED',
  'WAITING_SUPER_BOSS_APPROVAL',
  'SUPER_BOSS_REJECTED',
  'COMPLETED',
  'CANCELLED',
];
const TERMINAL_STATUSES = new Set<TaskStatus>(['COMPLETED', 'CANCELLED']);

interface HistoryEntry {
  status?: string | null;
  changedAt?: string | null;
}

function parseIsoMs(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export async function GET() {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['BOSS', 'SUPER_BOSS', 'DOCCON', 'SUPER_ADMIN']);

    const admin = await createServiceRoleClient();
    const roleSet = new Set(user.roles);
    const canSeeAllTasks =
      roleSet.has('DOCCON') || roleSet.has('SUPER_BOSS') || roleSet.has('SUPER_ADMIN');

    let query = admin
      .from('tasks')
      .select('id, status, officer_id, created_at, completed_at, updated_at, status_history');
    if (!canSeeAllTasks) {
      query = query.eq('created_by', user.id);
    }

    const { data: tasks, error } = await query;

    if (error) throw error;

    const officerIds = [...new Set((tasks ?? []).map((t) => t.officer_id).filter(Boolean))];

    const { data: usersData } = await admin
      .from('users')
      .select('id, display_name, email')
      .in('id', officerIds);

    const usersMap = Object.fromEntries((usersData ?? []).map((u) => [u.id, u]));

    const officerStatsMap: Record<string, {
      display_name: string;
      email: string;
      activeTasks: number;
      completedTasks: number;
      cancelledTasks: number;
      totalDaysToComplete: number;
      completedCount: number;
    }> = {};

    const stageTimeMap: Record<string, { totalMs: number; count: number }> = {};

    let totalActive = 0;
    let totalCompleted = 0;
    let totalCancelled = 0;

    for (const task of tasks ?? []) {
      const oid = task.officer_id;
      const isCompleted = task.status === 'COMPLETED';
      const isCancelled = task.status === 'CANCELLED';

      // Global totals should include every task regardless of officer_id
      if (isCompleted) totalCompleted += 1;
      else if (isCancelled) totalCancelled += 1;
      else totalActive += 1;

      if (oid) {
        if (!officerStatsMap[oid]) {
          const u = usersMap[oid];
          officerStatsMap[oid] = {
            display_name: u?.display_name ?? 'ไม่ทราบชื่อ',
            email: u?.email ?? '',
            activeTasks: 0,
            completedTasks: 0,
            cancelledTasks: 0,
            totalDaysToComplete: 0,
            completedCount: 0,
          };
        }

        const entry = officerStatsMap[oid];

        if (isCompleted) {
          entry.completedTasks += 1;
          if (task.created_at && task.completed_at) {
            const days =
              (new Date(task.completed_at).getTime() - new Date(task.created_at).getTime()) /
              (1000 * 60 * 60 * 24);
            entry.totalDaysToComplete += days;
            entry.completedCount += 1;
          }
        } else if (isCancelled) {
          entry.cancelledTasks += 1;
        } else {
          entry.activeTasks += 1;
        }
      }

      // Compute per-status dwell time directly from the raw history, so that
      // every TaskStatus (including *_REJECTED) is counted separately rather
      // than collapsed onto its pipeline parent.
      const rawHistory = Array.isArray(task.status_history)
        ? (task.status_history as HistoryEntry[])
        : [];
      const entries = rawHistory
        .map((e) => ({ status: String(e.status ?? ''), ms: parseIsoMs(e.changedAt) }))
        .filter((e): e is { status: string; ms: number } => e.ms !== null && e.status.length > 0)
        .sort((a, b) => a.ms - b.ms);

      const nowMs = Date.now();
      const terminalTimeMs =
        TERMINAL_STATUSES.has(task.status as TaskStatus)
          ? parseIsoMs(task.completed_at) ?? parseIsoMs(task.updated_at) ?? nowMs
          : nowMs;

      for (let i = 0; i < entries.length; i += 1) {
        const current = entries[i];
        const next = entries[i + 1];
        const endMs = next ? next.ms : terminalTimeMs;
        const diffMs = endMs - current.ms;
        if (diffMs < 0) continue;
        if (!stageTimeMap[current.status]) {
          stageTimeMap[current.status] = { totalMs: 0, count: 0 };
        }
        stageTimeMap[current.status].totalMs += diffMs;
        stageTimeMap[current.status].count += 1;
      }
    }

    const officers = Object.values(officerStatsMap).map((o) => ({
      display_name: o.display_name,
      email: o.email,
      activeTasks: o.activeTasks,
      completedTasks: o.completedTasks,
      cancelledTasks: o.cancelledTasks,
      avgDaysToComplete:
        o.completedCount > 0
          ? Math.round((o.totalDaysToComplete / o.completedCount) * 10) / 10
          : null,
    }));

    const pipelineAverages = ALL_REPORTED_STATUSES.map((status) => {
      const stat = stageTimeMap[status];
      if (!stat || stat.count === 0) {
        return { status, avgDays: 0, count: 0 };
      }
      return {
        status,
        avgDays: Math.round((stat.totalMs / stat.count / (1000 * 60 * 60 * 24)) * 10) / 10,
        count: stat.count,
      };
    });

    return NextResponse.json({
      officers,
      totals: {
        active: totalActive,
        completed: totalCompleted,
        cancelled: totalCancelled,
      },
      pipelineAverages,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
