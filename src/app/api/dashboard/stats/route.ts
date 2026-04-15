import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

// GET /api/dashboard/stats — สถิติภาพรวม
export async function GET() {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['BOSS', 'DOCCON', 'SUPER_BOSS', 'SUPER_ADMIN']);

    const admin = await createServiceRoleClient();
    const roleSet = new Set(user.roles);
    const canSeeAllTasks =
      roleSet.has('DOCCON') || roleSet.has('SUPER_BOSS') || roleSet.has('SUPER_ADMIN');

    let query = admin
      .from('tasks')
      .select('status, created_by');
    if (!canSeeAllTasks) {
      query = query.eq('created_by', user.id);
    }

    const { data: tasks, error } = await query;
    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const t of tasks ?? []) {
      if (!t.status) continue;
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    }
    const completed = counts.COMPLETED ?? 0;
    const cancelled = counts.CANCELLED ?? 0;
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const pending = Math.max(total - completed - cancelled, 0);

    return NextResponse.json({
      total,
      byStatus: counts,
      pending,
      waitingApproval: (counts['WAITING_BOSS_APPROVAL'] ?? 0) + (counts['WAITING_SUPER_BOSS_APPROVAL'] ?? 0),
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
