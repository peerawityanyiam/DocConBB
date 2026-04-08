import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, AuthError, handleAuthError } from '@/lib/auth/guards';
import type { AppRole } from '@/lib/auth/guards';
import type { TaskStatus } from '@/lib/constants/status';
import { deleteFilePermanent } from '@/lib/google-drive/files';

type StatusAction =
  | 'submit'
  | 'doccon_approve'
  | 'doccon_reject'
  | 'reviewer_approve'
  | 'reviewer_reject'
  | 'boss_approve'
  | 'boss_reject'
  | 'boss_send_to_doccon'
  | 'super_boss_approve'
  | 'super_boss_reject'
  | 'super_boss_send_to_doccon'
  | 'cancel';

const ACTION_ROLES: Record<StatusAction, AppRole[]> = {
  submit: ['STAFF'],
  doccon_approve: ['DOCCON'],
  doccon_reject: ['DOCCON'],
  reviewer_approve: ['REVIEWER'],
  reviewer_reject: ['REVIEWER'],
  boss_approve: ['BOSS'],
  boss_reject: ['BOSS'],
  boss_send_to_doccon: ['BOSS'],
  super_boss_approve: ['SUPER_BOSS'],
  super_boss_reject: ['SUPER_BOSS'],
  super_boss_send_to_doccon: ['SUPER_BOSS'],
  cancel: ['BOSS'],
};

// PATCH /api/tasks/[taskId]/status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { taskId } = await params;
    const { action, comment, doc_ref } = await request.json() as {
      action: StatusAction;
      comment?: string;
      doc_ref?: string;
    };

    if (!action) return NextResponse.json({ error: 'ไม่ระบุ action' }, { status: 400 });

    // ตรวจสิทธิ์ตาม action
    requireRole(user, ACTION_ROLES[action] ?? []);

    const admin = await createServiceRoleClient();

    // หา DB user
    const { data: dbUser } = await admin
      .from('users')
      .select('id, display_name')
      .eq('email', user.email)
      .single();
    if (!dbUser) throw new AuthError('ไม่พบข้อมูลผู้ใช้', 404);

    // ดึง task ปัจจุบัน
    const { data: task, error: taskErr } = await admin
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();
    if (taskErr || !task) return NextResponse.json({ error: 'ไม่พบงาน' }, { status: 404 });

    const now = new Date().toISOString();
    let newStatus: TaskStatus = task.status;
    const updates: Record<string, unknown> = {};

    // ─── คำนวณ status ใหม่ ──────────────────────────────────────────────
    switch (action) {
      case 'submit': {
        if (task.officer_id !== dbUser.id) throw new AuthError('ไม่ใช่ผู้รับผิดชอบงานนี้', 403);
        const submitFrom: TaskStatus[] = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];
        if (!submitFrom.includes(task.status)) throw new AuthError('ไม่สามารถส่งงานได้ในสถานะนี้', 400);
        // ต้องมีไฟล์ word แนบก่อนส่ง
        if (!task.drive_file_id) throw new AuthError('กรุณาอัปโหลดไฟล์ Word ก่อนส่งงาน', 400);
        // ตาม reference: SBOSS_REJ→WAIT_SBOSS, BOSS_REJ→WAIT_BOSS (ข้าม DocCon/Reviewer)
        if (task.status === 'SUPER_BOSS_REJECTED') newStatus = 'WAITING_SUPER_BOSS_APPROVAL';
        else if (task.status === 'BOSS_REJECTED') newStatus = 'WAITING_BOSS_APPROVAL';
        else newStatus = task.doccon_checked ? 'PENDING_REVIEW' : 'SUBMITTED_TO_DOCCON';
        // เมื่อส่งงานใหม่ ลบ PDF อ้างอิงที่เคยแนบมา (PDF ใช้ประกอบตีกลับเท่านั้น)
        if (task.ref_file_id) {
          try { await deleteFilePermanent(task.ref_file_id); } catch { /* ignore drive errors */ }
          updates.ref_file_id = null;
          updates.ref_file_name = null;
        }
        break;
      }
      case 'doccon_approve': {
        if (task.status !== 'SUBMITTED_TO_DOCCON') throw new AuthError('สถานะต้องเป็น "ส่งตรวจรูปแบบ"', 400);
        // ต้องใส่รหัสเอกสาร (ยกเว้นมีอยู่แล้ว)
        if (!doc_ref && !task.doc_ref) throw new AuthError('กรุณาระบุรหัสเอกสาร (doc_ref) ก่อนอนุมัติ', 400);
        // ค้นย้อนหลังใน status_history หา note sentBackToDocconBy:*
        const history = (task.status_history as Array<{status?: string; note?: string}>) ?? [];
        let sentBackBy = '';
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          if (h.status === 'SUBMITTED_TO_DOCCON' && h.note?.startsWith('sentBackToDocconBy:')) {
            sentBackBy = h.note;
            break;
          }
        }
        if (sentBackBy.includes('SUPER_BOSS')) newStatus = 'WAITING_SUPER_BOSS_APPROVAL';
        else if (sentBackBy.includes('BOSS')) newStatus = 'WAITING_BOSS_APPROVAL';
        else newStatus = 'PENDING_REVIEW';
        updates.doccon_checked = true;
        if (doc_ref) updates.doc_ref = doc_ref;
        break;
      }
      case 'doccon_reject': {
        if (task.status !== 'SUBMITTED_TO_DOCCON') throw new AuthError('สถานะต้องเป็น "ส่งตรวจรูปแบบ"', 400);
        newStatus = 'DOCCON_REJECTED';
        break;
      }
      case 'reviewer_approve': {
        if (task.reviewer_id !== dbUser.id) throw new AuthError('ไม่ใช่ผู้ตรวจสอบงานนี้', 403);
        if (task.status !== 'PENDING_REVIEW') throw new AuthError('สถานะต้องเป็น "รอตรวจสอบเนื้อหา"', 400);
        newStatus = 'WAITING_BOSS_APPROVAL';
        break;
      }
      case 'reviewer_reject': {
        if (task.reviewer_id !== dbUser.id) throw new AuthError('ไม่ใช่ผู้ตรวจสอบงานนี้', 403);
        if (task.status !== 'PENDING_REVIEW') throw new AuthError('สถานะต้องเป็น "รอตรวจสอบเนื้อหา"', 400);
        newStatus = 'REVIEWER_REJECTED';
        break;
      }
      case 'boss_approve': {
        if (task.created_by !== dbUser.id) throw new AuthError('ไม่ใช่ผู้สร้างงานนี้', 403);
        if (task.status !== 'WAITING_BOSS_APPROVAL') throw new AuthError('สถานะต้องเป็น "รออนุมัติหัวหน้า"', 400);
        newStatus = 'WAITING_SUPER_BOSS_APPROVAL';
        break;
      }
      case 'boss_reject': {
        if (task.created_by !== dbUser.id) throw new AuthError('ไม่ใช่ผู้สร้างงานนี้', 403);
        if (task.status !== 'WAITING_BOSS_APPROVAL') throw new AuthError('สถานะต้องเป็น "รออนุมัติหัวหน้า"', 400);
        newStatus = 'BOSS_REJECTED';
        break;
      }
      case 'boss_send_to_doccon': {
        if (task.created_by !== dbUser.id) throw new AuthError('ไม่ใช่ผู้สร้างงานนี้', 403);
        if (task.status !== 'WAITING_BOSS_APPROVAL') throw new AuthError('สถานะต้องเป็น "รออนุมัติหัวหน้า"', 400);
        newStatus = 'SUBMITTED_TO_DOCCON';
        break;
      }
      case 'super_boss_approve': {
        if (task.status !== 'WAITING_SUPER_BOSS_APPROVAL') throw new AuthError('สถานะต้องเป็น "รออนุมัติผู้บริหาร"', 400);
        newStatus = 'COMPLETED';
        updates.completed_at = now;
        updates.is_archived = true;
        // ตรวจสอบ supersession (doc_ref ซ้ำ)
        if (task.doc_ref) {
          await admin.from('tasks').update({ superseded_by: taskId }).eq('doc_ref', task.doc_ref).neq('id', taskId);
        }
        break;
      }
      case 'super_boss_reject': {
        if (task.status !== 'WAITING_SUPER_BOSS_APPROVAL') throw new AuthError('สถานะต้องเป็น "รออนุมัติผู้บริหาร"', 400);
        newStatus = 'SUPER_BOSS_REJECTED';
        break;
      }
      case 'super_boss_send_to_doccon': {
        if (task.status !== 'WAITING_SUPER_BOSS_APPROVAL') throw new AuthError('สถานะต้องเป็น "รออนุมัติผู้บริหาร"', 400);
        newStatus = 'SUBMITTED_TO_DOCCON';
        break;
      }
      case 'cancel': {
        if (task.created_by !== dbUser.id) throw new AuthError('ไม่ใช่ผู้สร้างงานนี้', 403);
        if (['COMPLETED', 'CANCELLED'].includes(task.status)) throw new AuthError('ไม่สามารถยกเลิกงานที่เสร็จแล้วได้', 400);
        if (!comment?.trim()) throw new AuthError('กรุณาระบุเหตุผลการยกเลิก', 400);
        newStatus = 'CANCELLED';
        updates.is_archived = true;
        updates.completed_at = now;
        break;
      }
      default:
        return NextResponse.json({ error: 'action ไม่ถูกต้อง' }, { status: 400 });
    }

    // ─── สร้าง history entry ────────────────────────────────────────────
    const noteMap: Partial<Record<StatusAction, string>> = {
      boss_send_to_doccon: 'sentBackToDocconBy:BOSS',
      super_boss_send_to_doccon: 'sentBackToDocconBy:SUPER_BOSS',
    };

    const statusEntry = {
      status: newStatus,
      changedAt: now,
      changedBy: user.email,
      changedByName: dbUser.display_name,
      note: noteMap[action] ?? (comment ?? ''),
    };

    const newStatusHistory = [...(task.status_history ?? []), statusEntry];
    const newCommentHistory = comment?.trim()
      ? [...(task.comment_history ?? []), { text: comment.trim(), by: user.email, byName: dbUser.display_name, at: now }]
      : task.comment_history;

    // ─── อัปเดต ─────────────────────────────────────────────────────────
    const { error: updateErr } = await admin
      .from('tasks')
      .update({
        status: newStatus,
        status_history: newStatusHistory,
        comment_history: newCommentHistory,
        latest_comment: comment?.trim() || task.latest_comment,
        updated_at: now,
        ...updates,
      })
      .eq('id', taskId);

    if (updateErr) throw updateErr;
    return NextResponse.json({ ok: true, newStatus });
  } catch (err) {
    return handleAuthError(err);
  }
}
