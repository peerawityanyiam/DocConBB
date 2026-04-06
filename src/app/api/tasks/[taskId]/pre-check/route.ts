import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    requireRole(user, ['SUPER_BOSS']);

    const { taskId } = await params;
    const admin = await createServiceRoleClient();

    const { data: task } = await admin
      .from('tasks')
      .select('doc_ref, status')
      .eq('id', taskId)
      .single();

    if (!task || task.status !== 'WAITING_SUPER_BOSS_APPROVAL') {
      return NextResponse.json({ hasDuplicate: false, docRef: '' });
    }

    const docRef = (task.doc_ref ?? '').trim();
    if (!docRef) return NextResponse.json({ hasDuplicate: false, docRef: '' });

    const { data: existing } = await admin
      .from('tasks')
      .select('id, title, completed_at')
      .eq('doc_ref', docRef)
      .eq('status', 'COMPLETED')
      .neq('id', taskId);

    const existingTasks = (existing ?? []).map(t => ({
      taskId: t.id,
      title: t.title,
      completedAt: t.completed_at ?? '',
    }));

    return NextResponse.json({
      hasDuplicate: existingTasks.length > 0,
      docRef,
      existingTasks,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
