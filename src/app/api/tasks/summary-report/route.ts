import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';
import {
  getStageSegmentsFromHistory,
  type PipelineStageStatus,
} from '@/lib/tasks/pipeline';

const PIPELINE_STAGE_ORDER: PipelineStageStatus[] = [
  'ASSIGNED',
  'SUBMITTED_TO_DOCCON',
  'PENDING_REVIEW',
  'WAITING_BOSS_APPROVAL',
  'WAITING_SUPER_BOSS_APPROVAL',
];

export async function GET() {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['BOSS', 'SUPER_BOSS', 'DOCCON']);

    const admin = await createServiceRoleClient();

    const { data: tasks, error } = await admin
      .from('tasks')
      .select('id, status, officer_id, created_at, completed_at, updated_at, status_history');

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

      const segments = getStageSegmentsFromHistory(task.status_history, {
        currentStatus: task.status,
        updatedAt: task.updated_at,
        completedAt: task.completed_at,
      });

      for (const segment of segments) {
        if (!PIPELINE_STAGE_ORDER.includes(segment.stage)) continue;

        const diffMs = segment.endMs - segment.startMs;
        if (diffMs < 0) continue;

        if (!stageTimeMap[segment.stage]) {
          stageTimeMap[segment.stage] = { totalMs: 0, count: 0 };
        }

        stageTimeMap[segment.stage].totalMs += diffMs;
        stageTimeMap[segment.stage].count += 1;
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

    const pipelineAverages = PIPELINE_STAGE_ORDER
      .map((status) => {
        const stat = stageTimeMap[status];
        if (!stat || stat.count === 0) return null;
        return {
          status,
          avgDays: Math.round((stat.totalMs / stat.count / (1000 * 60 * 60 * 24)) * 10) / 10,
          count: stat.count,
        };
      })
      .filter((value): value is { status: PipelineStageStatus; avgDays: number; count: number } => value !== null);

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
