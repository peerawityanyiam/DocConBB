import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { getRequestIdFromHeaders } from '@/lib/ops/observability';

// POST /api/tasks/[taskId]/comment — เพิ่มความคิดเห็น
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  let taskId = '';
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const resolvedParams = await params;
    taskId = resolvedParams.taskId;
    const { text } = await request.json();

    if (!text?.trim()) return NextResponse.json({ error: 'กรุณากรอกข้อความ' }, { status: 400 });

    const admin = await createServiceRoleClient();

    // หา display_name
    const { data: dbUser } = await admin
      .from('users')
      .select('display_name')
      .eq('email', user.email)
      .single();

    const { data: task } = await admin
      .from('tasks')
      .select('comment_history')
      .eq('id', taskId)
      .single();

    if (!task) return NextResponse.json({ error: 'ไม่พบงาน' }, { status: 404 });

    const newEntry = {
      text: text.trim(),
      by: user.email,
      byName: dbUser?.display_name ?? user.email,
      at: new Date().toISOString(),
    };

    const newHistory = [...(task.comment_history ?? []), newEntry];

    const { error } = await admin
      .from('tasks')
      .update({
        comment_history: newHistory,
        latest_comment: text.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);

    if (error) throw error;
    return NextResponse.json({ ok: true, entry: newEntry });
  } catch (err) {
    return handleAuthError(err, {
      scope: 'tasks.comment',
      requestId,
      meta: { taskId },
    });
  }
}
