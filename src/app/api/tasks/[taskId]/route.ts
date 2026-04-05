import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';

// GET /api/tasks/[taskId] — ดู task พร้อม history และชื่อผู้ใช้
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { taskId } = await params;
    const admin = await createServiceRoleClient();

    const { data: task, error } = await admin
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (error || !task) return NextResponse.json({ error: 'ไม่พบงาน' }, { status: 404 });

    // ดึงชื่อผู้ใช้
    const userIds = [task.officer_id, task.reviewer_id, task.created_by].filter(Boolean);
    const { data: usersData } = await admin
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds);

    const usersMap = Object.fromEntries((usersData ?? []).map(u => [u.id, u]));

    return NextResponse.json({
      ...task,
      officer: usersMap[task.officer_id] ?? null,
      reviewer: usersMap[task.reviewer_id] ?? null,
      creator: usersMap[task.created_by] ?? null,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
