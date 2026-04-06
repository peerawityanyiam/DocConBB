import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

export async function GET() {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['BOSS', 'SUPER_BOSS']);

    const admin = await createServiceRoleClient();

    // Fetch all tasks (not just non-archived)
    const { data: tasks, error } = await admin
      .from('tasks')
      .select('id, status, officer_id, created_at, completed_at, updated_at, status_history');

    if (error) throw error;

    // Fetch all users who are officers
    const officerIds = [...new Set((tasks ?? []).map(t => t.officer_id).filter(Boolean))];

    const { data: usersData } = await admin
      .from('users')
      .select('id, display_name, email')
      .in('id', officerIds);

    const usersMap = Object.fromEntries((usersData ?? []).map(u => [u.id, u]));

    // Per-officer stats
    const officerStatsMap: Record<string, {
      display_name: string;
      email: string;
      activeTasks: number;
      completedTasks: number;
      cancelledTasks: number;
      totalDaysToComplete: number;
      completedCount: number;
    }> = {};

    let totalActive = 0;
    let totalCompleted = 0;
    let totalCancelled = 0;

    // Pipeline stage time accumulators
    const stageTimeMap: Record<string, { totalMs: number; count: number }> = {};

    for (const task of tasks ?? []) {
      const oid = task.officer_id;
      if (!oid) continue;

      // Initialize officer entry
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

      if (task.status === 'COMPLETED') {
        entry.completedTasks++;
        totalCompleted++;
        if (task.created_at && task.completed_at) {
          const days =
            (new Date(task.completed_at).getTime() - new Date(task.created_at).getTime()) /
            (1000 * 60 * 60 * 24);
          entry.totalDaysToComplete += days;
          entry.completedCount++;
        }
      } else if (task.status === 'CANCELLED') {
        entry.cancelledTasks++;
        totalCancelled++;
      } else {
        entry.activeTasks++;
        totalActive++;
      }

      // Calculate time spent in each pipeline stage from status_history
      const history: { status: string; changedAt: string }[] = Array.isArray(task.status_history)
        ? task.status_history
        : [];
      for (let i = 0; i < history.length; i++) {
        const current = history[i];
        const next = history[i + 1];
        const startTime = new Date(current.changedAt).getTime();
        const endTime = next
          ? new Date(next.changedAt).getTime()
          : (task.status === 'COMPLETED' || task.status === 'CANCELLED'
              ? new Date(task.completed_at ?? task.updated_at ?? current.changedAt).getTime()
              : Date.now());

        const diffMs = endTime - startTime;
        if (diffMs >= 0) {
          if (!stageTimeMap[current.status]) {
            stageTimeMap[current.status] = { totalMs: 0, count: 0 };
          }
          stageTimeMap[current.status].totalMs += diffMs;
          stageTimeMap[current.status].count++;
        }
      }
    }

    // Build officers array
    const officers = Object.values(officerStatsMap).map(o => ({
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

    // Build pipeline averages
    const pipelineAverages = Object.entries(stageTimeMap).map(([status, { totalMs, count }]) => ({
      status,
      avgDays: Math.round((totalMs / count / (1000 * 60 * 60 * 24)) * 10) / 10,
      count,
    }));

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
