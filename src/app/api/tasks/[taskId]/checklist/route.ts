import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, AuthError, handleAuthError } from '@/lib/auth/guards';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    requireRole(user, ['DOCCON']);

    const { taskId } = await params;
    const { drive_uploaded, sent_to_branch } = await request.json();

    const admin = await createServiceRoleClient();
    const { data: task } = await admin
      .from('tasks')
      .select('status')
      .eq('id', taskId)
      .single();

    if (!task) return NextResponse.json({ error: 'ไม่พบงาน' }, { status: 404 });
    if (task.status !== 'COMPLETED') throw new AuthError('ใช้ได้เฉพาะงานที่เสร็จแล้ว', 400);

    const updates: Record<string, unknown> = {};
    if (drive_uploaded !== undefined) updates.drive_uploaded = drive_uploaded;
    if (sent_to_branch !== undefined) updates.sent_to_branch = sent_to_branch;

    const { error } = await admin.from('tasks').update(updates).eq('id', taskId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err);
  }
}
