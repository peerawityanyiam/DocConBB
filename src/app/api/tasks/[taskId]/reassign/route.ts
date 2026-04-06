import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, AuthError, handleAuthError } from '@/lib/auth/guards';

// PATCH /api/tasks/[taskId]/reassign — โอนงาน (BOSS only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    requireRole(user, ['BOSS']);

    const { taskId } = await params;
    const { field, new_user_id } = await request.json() as {
      field: 'officer_id' | 'reviewer_id';
      new_user_id: string;
    };

    if (!['officer_id', 'reviewer_id'].includes(field)) {
      return NextResponse.json({ error: 'field ไม่ถูกต้อง' }, { status: 400 });
    }
    if (!new_user_id) {
      return NextResponse.json({ error: 'ไม่ระบุผู้ใช้ใหม่' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();

    // หา DB user
    const { data: dbUser } = await admin
      .from('users')
      .select('id, display_name')
      .eq('email', user!.email)
      .single();
    if (!dbUser) throw new AuthError('ไม่พบข้อมูลผู้ใช้', 404);

    // ดึง task
    const { data: task } = await admin.from('tasks').select('*').eq('id', taskId).single();
    if (!task) return NextResponse.json({ error: 'ไม่พบงาน' }, { status: 404 });

    // ต้องเป็น BOSS ที่สร้างงานนี้
    if (task.created_by !== dbUser.id) throw new AuthError('ไม่ใช่ผู้สร้างงานนี้', 403);

    // ห้ามโอนงานที่จบแล้ว
    if (['COMPLETED', 'CANCELLED'].includes(task.status)) {
      throw new AuthError('ไม่สามารถโอนงานที่จบแล้วได้', 400);
    }

    // ห้ามเปลี่ยน Reviewer หลังผ่าน review ไปแล้ว
    const reviewerLocked = ['WAITING_BOSS_APPROVAL', 'BOSS_REJECTED', 'WAITING_SUPER_BOSS_APPROVAL', 'SUPER_BOSS_REJECTED'];
    if (field === 'reviewer_id' && reviewerLocked.includes(task.status)) {
      throw new AuthError('ไม่สามารถเปลี่ยนผู้ตรวจสอบได้ในขั้นตอนนี้', 400);
    }

    // หาชื่อ user เก่าและใหม่
    const oldUserId = task[field];
    const { data: newUser } = await admin.from('users').select('display_name, email').eq('id', new_user_id).single();
    const { data: oldUser } = await admin.from('users').select('display_name, email').eq('id', oldUserId).single();

    const label = field === 'officer_id' ? 'เจ้าหน้าที่' : 'ผู้ตรวจสอบ';
    const now = new Date().toISOString();

    // เพิ่ม REASSIGNED entry ใน status_history
    const statusHistory = [...(task.status_history ?? []), {
      status: 'REASSIGNED',
      changedAt: now,
      changedBy: user!.email,
      changedByName: dbUser.display_name,
      note: `โอน${label} จาก ${oldUser?.display_name ?? oldUser?.email ?? '?'} → ${newUser?.display_name ?? newUser?.email ?? '?'}`,
    }];

    const { error: updateErr } = await admin
      .from('tasks')
      .update({
        [field]: new_user_id,
        status_history: statusHistory,
        updated_at: now,
      })
      .eq('id', taskId);

    if (updateErr) throw updateErr;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err);
  }
}
