import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

// GET /api/dashboard/stats — สถิติภาพรวม
export async function GET() {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = await createServiceRoleClient();

    const { data: tasks } = await admin
      .from('tasks')
      .select('status');

    const counts: Record<string, number> = {};
    for (const t of tasks ?? []) {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    }

    return NextResponse.json({
      total: tasks?.length ?? 0,
      byStatus: counts,
      pending:
        (tasks?.length ?? 0)
        - (counts['COMPLETED'] ?? 0)
        - (counts['CANCELLED'] ?? 0),
      waitingApproval: (counts['WAITING_BOSS_APPROVAL'] ?? 0) + (counts['WAITING_SUPER_BOSS_APPROVAL'] ?? 0),
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
