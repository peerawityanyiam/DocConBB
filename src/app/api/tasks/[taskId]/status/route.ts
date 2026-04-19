import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, AuthError, handleAuthError } from '@/lib/auth/guards';
import type { AppRole } from '@/lib/auth/guards';
import type { TaskStatus } from '@/lib/constants/status';
import { deleteFilePermanent, trashFile } from '@/lib/google-drive/files';

type StatusAction =
  | 'submit'
  | 'doccon_approve'
  | 'doccon_reject'
  | 'doccon_reopen_completed'
  | 'reviewer_approve'
  | 'reviewer_reject'
  | 'boss_approve'
  | 'boss_reject'
  | 'boss_send_to_doccon'
  | 'boss_reopen_completed'
  | 'super_boss_approve'
  | 'super_boss_reject'
  | 'super_boss_send_to_doccon'
  | 'super_boss_reopen_completed'
  | 'cancel';

const ACTION_ROLES: Record<StatusAction, AppRole[]> = {
  submit: ['STAFF'],
  doccon_approve: ['DOCCON'],
  doccon_reject: ['DOCCON'],
  doccon_reopen_completed: ['DOCCON'],
  reviewer_approve: ['REVIEWER'],
  reviewer_reject: ['REVIEWER'],
  boss_approve: ['BOSS'],
  boss_reject: ['BOSS'],
  boss_send_to_doccon: ['BOSS'],
  boss_reopen_completed: ['BOSS'],
  super_boss_approve: ['SUPER_BOSS'],
  super_boss_reject: ['SUPER_BOSS'],
  super_boss_send_to_doccon: ['SUPER_BOSS'],
  super_boss_reopen_completed: ['SUPER_BOSS'],
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
    const normalizedUserEmail = user.email.trim().toLowerCase();

    const { taskId } = await params;
    const { action, comment, doc_ref } = await request.json() as {
      action: StatusAction;
      comment?: string;
      doc_ref?: string;
    };

    if (!action) return NextResponse.json({ error: 'ไม่ระบุ action' }, { status: 400 });

    requireRole(user, ACTION_ROLES[action] ?? []);

    const admin = await createServiceRoleClient();

    const { data: dbUser } = await admin
      .from('users')
      .select('id, display_name')
      .eq('id', user.id)
      .single();
    if (!dbUser) throw new AuthError('ไม่พบข้อมูลผู้ใช้', 404);

    const { data: task, error: taskErr } = await admin
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();
    if (taskErr || !task) return NextResponse.json({ error: 'ไม่พบงาน' }, { status: 404 });

    const now = new Date().toISOString();
    let newStatus: TaskStatus = task.status;
    const updates: Record<string, unknown> = {};
    const fileHistory = (task.file_history as Array<{
      uploadedAt?: string;
      uploadedBy?: string;
      isPdf?: boolean;
      driveFileId?: string;
    }> | null) ?? [];

    const removeFileFromDrive = async (fileId: string) => {
      try {
        await deleteFilePermanent(fileId);
        return;
      } catch {
        // fallback below
      }
      try {
        await trashFile(fileId);
      } catch {
        // ignore drive cleanup failures
      }
    };

    switch (action) {
      case 'submit': {
        if (task.officer_id !== dbUser.id) throw new AuthError('ไม่ใช่ผู้รับผิดชอบงานนี้', 403);
        const submitFrom: TaskStatus[] = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];
        if (!submitFrom.includes(task.status)) throw new AuthError('ไม่สามารถส่งงานได้ในสถานะนี้', 400);
        if (!task.drive_file_id) throw new AuthError('กรุณาอัปโหลดไฟล์ Word ก่อนส่งงาน', 400);

        if (task.status === 'SUPER_BOSS_REJECTED') {
          newStatus = 'WAITING_SUPER_BOSS_APPROVAL';
        } else if (task.status === 'BOSS_REJECTED') {
          const statusHistory = (task.status_history as Array<{ status?: string; note?: string }> | null) ?? [];
          const latestBossRejected = [...statusHistory].reverse().find((entry) => entry.status === 'BOSS_REJECTED');
          const isReopenFromCompletedByBoss = latestBossRejected?.note?.includes('reopenFromCompletedBy:BOSS') ?? false;
          newStatus = isReopenFromCompletedByBoss ? 'WAITING_SUPER_BOSS_APPROVAL' : 'WAITING_BOSS_APPROVAL';
        }
        else if (task.status === 'DOCCON_REJECTED') {
          const statusHistory = (task.status_history as Array<{ status?: string; note?: string }> | null) ?? [];
          const latestDocconRejected = [...statusHistory].reverse().find((entry) => entry.status === 'DOCCON_REJECTED');
          const isReopenFromCompletedByDoccon = latestDocconRejected?.note?.includes('reopenFromCompletedBy:DOCCON') ?? false;
          newStatus = isReopenFromCompletedByDoccon
            ? 'WAITING_SUPER_BOSS_APPROVAL'
            : (task.doccon_checked ? 'PENDING_REVIEW' : 'SUBMITTED_TO_DOCCON');
        } else newStatus = task.doccon_checked ? 'PENDING_REVIEW' : 'SUBMITTED_TO_DOCCON';
        break;
      }

      case 'doccon_approve': {
        if (task.status !== 'SUBMITTED_TO_DOCCON') throw new AuthError('สถานะต้องเป็น "รอ DocCon ตรวจ"', 400);
        if (!doc_ref && !task.doc_ref) throw new AuthError('กรุณาระบุรหัสเอกสาร (doc_ref) ก่อนอนุมัติ', 400);

        const history = (task.status_history as Array<{ status?: string; note?: string; changedAt?: string }>) ?? [];
        const latestSubmitted = [...history].reverse().find((entry) => entry.status === 'SUBMITTED_TO_DOCCON');
        const latestSubmitNote = latestSubmitted?.note ?? '';
        const sentBackBy = latestSubmitNote.startsWith('sentBackToDocconBy:') ? latestSubmitNote : '';
        const sentBackAt = latestSubmitted?.changedAt ?? '';
        const isReopenFromCompletedByDoccon = latestSubmitNote.startsWith('reopenFromCompletedBy:DOCCON');

        if (sentBackBy) {
          const latestFile = fileHistory[fileHistory.length - 1];
          if (!latestFile || latestFile.isPdf) {
            throw new AuthError('กรุณาอัปโหลดไฟล์ Word (.docx) ก่อนส่งกลับไปอนุมัติ', 400);
          }
          if (latestFile.uploadedBy && latestFile.uploadedBy.toLowerCase() !== normalizedUserEmail) {
            throw new AuthError('ต้องอัปโหลดไฟล์ Word ด้วยบัญชี DocCon คนปัจจุบันก่อนส่งกลับไปอนุมัติ', 400);
          }
          if (
            sentBackAt
            && latestFile.uploadedAt
            && new Date(latestFile.uploadedAt).getTime() < new Date(sentBackAt).getTime()
          ) {
            throw new AuthError('กรุณาอัปโหลดไฟล์ Word ใหม่หลังได้รับงานตีกลับ ก่อนส่งกลับไปอนุมัติ', 400);
          }
        }

        if (isReopenFromCompletedByDoccon) newStatus = 'WAITING_SUPER_BOSS_APPROVAL';
        else if (sentBackBy.includes('SUPER_BOSS')) newStatus = 'WAITING_SUPER_BOSS_APPROVAL';
        else if (sentBackBy.includes('BOSS')) newStatus = 'WAITING_BOSS_APPROVAL';
        else newStatus = 'PENDING_REVIEW';

        updates.doccon_checked = true;
        if (doc_ref) updates.doc_ref = doc_ref;
        break;
      }

      case 'doccon_reject': {
        if (task.status !== 'SUBMITTED_TO_DOCCON') throw new AuthError('สถานะต้องเป็น "รอ DocCon ตรวจ"', 400);
        if (!comment?.trim()) throw new AuthError('กรุณาระบุเหตุผลการตีกลับ', 400);
        newStatus = 'DOCCON_REJECTED';
        break;
      }

      case 'doccon_reopen_completed': {
        if (task.status !== 'COMPLETED') throw new AuthError('อนุญาตให้ดึงกลับได้เฉพาะงานที่เสร็จแล้ว', 400);
        if (!comment?.trim()) throw new AuthError('กรุณาระบุเหตุผลการดึงกลับมาแก้ไข', 400);
        newStatus = 'SUBMITTED_TO_DOCCON';
        updates.is_archived = false;
        updates.completed_at = null;
        updates.drive_uploaded = false;
        updates.sent_to_branch = false;
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
        if (!comment?.trim()) throw new AuthError('กรุณาระบุเหตุผลการตีกลับ', 400);
        newStatus = 'REVIEWER_REJECTED';
        break;
      }

      case 'boss_approve': {
        if (task.created_by !== dbUser.id) throw new AuthError('ไม่ใช่ผู้สั่งงานของงานนี้', 403);
        if (task.status !== 'WAITING_BOSS_APPROVAL') throw new AuthError('สถานะต้องเป็น "รอผู้สั่งงานอนุมัติ"', 400);
        newStatus = 'WAITING_SUPER_BOSS_APPROVAL';
        break;
      }

      case 'boss_reject': {
        if (task.created_by !== dbUser.id) throw new AuthError('ไม่ใช่ผู้สั่งงานของงานนี้', 403);
        if (task.status !== 'WAITING_BOSS_APPROVAL') throw new AuthError('สถานะต้องเป็น "รอผู้สั่งงานอนุมัติ"', 400);
        if (!comment?.trim()) throw new AuthError('กรุณาระบุเหตุผลการตีกลับ', 400);
        newStatus = 'BOSS_REJECTED';
        break;
      }

      case 'boss_send_to_doccon': {
        if (task.created_by !== dbUser.id) throw new AuthError('ไม่ใช่ผู้สั่งงานของงานนี้', 403);
        if (task.status !== 'WAITING_BOSS_APPROVAL') throw new AuthError('สถานะต้องเป็น "รอผู้สั่งงานอนุมัติ"', 400);
        if (!comment?.trim()) throw new AuthError('กรุณาระบุเหตุผลการส่ง DocCon ตรวจใหม่', 400);
        newStatus = 'SUBMITTED_TO_DOCCON';
        break;
      }

      case 'boss_reopen_completed': {
        if (task.created_by !== dbUser.id) throw new AuthError('ไม่ใช่ผู้สั่งงานของงานนี้', 403);
        if (task.status !== 'COMPLETED') throw new AuthError('อนุญาตให้ดึงกลับได้เฉพาะงานที่เสร็จแล้ว', 400);
        if (!comment?.trim()) throw new AuthError('กรุณาระบุเหตุผลการดึงกลับมาแก้ไข', 400);
        newStatus = 'WAITING_BOSS_APPROVAL';
        updates.is_archived = false;
        updates.completed_at = null;
        updates.drive_uploaded = false;
        updates.sent_to_branch = false;
        break;
      }

      case 'super_boss_approve': {
        if (task.status !== 'WAITING_SUPER_BOSS_APPROVAL') throw new AuthError('สถานะต้องเป็น "รอหัวหน้างานอนุมัติ"', 400);
        newStatus = 'COMPLETED';
        updates.completed_at = now;
        updates.is_archived = true;
        if (task.doc_ref) {
          await admin.from('tasks').update({ superseded_by: taskId }).eq('doc_ref', task.doc_ref).neq('id', taskId);
        }
        break;
      }

      case 'super_boss_reject': {
        if (task.status !== 'WAITING_SUPER_BOSS_APPROVAL') throw new AuthError('สถานะต้องเป็น "รอหัวหน้างานอนุมัติ"', 400);
        if (!comment?.trim()) throw new AuthError('กรุณาระบุเหตุผลการตีกลับ', 400);
        newStatus = 'SUPER_BOSS_REJECTED';
        break;
      }

      case 'super_boss_send_to_doccon': {
        if (task.status !== 'WAITING_SUPER_BOSS_APPROVAL') throw new AuthError('สถานะต้องเป็น "รอหัวหน้างานอนุมัติ"', 400);
        if (!comment?.trim()) throw new AuthError('กรุณาระบุเหตุผลการส่ง DocCon ตรวจใหม่', 400);
        newStatus = 'SUBMITTED_TO_DOCCON';
        break;
      }

      case 'super_boss_reopen_completed': {
        if (task.status !== 'COMPLETED') throw new AuthError('อนุญาตให้ดึงกลับได้เฉพาะงานที่เสร็จแล้ว', 400);
        if (!comment?.trim()) throw new AuthError('กรุณาระบุเหตุผลการดึงกลับมาแก้ไข', 400);
        newStatus = 'WAITING_SUPER_BOSS_APPROVAL';
        updates.is_archived = false;
        updates.completed_at = null;
        updates.drive_uploaded = false;
        updates.sent_to_branch = false;
        break;
      }

      case 'cancel': {
        if (task.created_by !== dbUser.id) throw new AuthError('ไม่ใช่ผู้สั่งงานของงานนี้', 403);
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

    const noteMap: Partial<Record<StatusAction, string>> = {
      boss_send_to_doccon: 'sentBackToDocconBy:BOSS',
      super_boss_send_to_doccon: 'sentBackToDocconBy:SUPER_BOSS',
      doccon_reopen_completed: 'reopenFromCompletedBy:DOCCON',
      boss_reopen_completed: 'reopenFromCompletedBy:BOSS',
      super_boss_reopen_completed: 'reopenFromCompletedBy:SUPER_BOSS',
    };

    const normalizedComment = comment?.trim() ?? '';
    const reopenCommentMap: Partial<Record<StatusAction, string>> = {
      doccon_reopen_completed: normalizedComment
        ? `DocCon ดึงงานที่เสร็จแล้วกลับมาแก้ไข: ${normalizedComment}`
        : 'DocCon ดึงงานที่เสร็จแล้วกลับมาแก้ไข',
      boss_reopen_completed: normalizedComment
        ? `ผู้สั่งงานดึงงานที่เสร็จแล้วกลับมาแก้ไข: ${normalizedComment}`
        : 'ผู้สั่งงานดึงงานที่เสร็จแล้วกลับมาแก้ไข',
      super_boss_reopen_completed: normalizedComment
        ? `หัวหน้างานดึงงานที่เสร็จแล้วกลับมาแก้ไข: ${normalizedComment}`
        : 'หัวหน้างานดึงงานที่เสร็จแล้วกลับมาแก้ไข',
    };
    const commentEntryValue = reopenCommentMap[action] ?? normalizedComment;
    const latestCommentValue = commentEntryValue || task.latest_comment;

    const statusEntry = {
      status: newStatus,
      changedAt: now,
      changedBy: normalizedUserEmail,
      changedByName: dbUser.display_name,
      note: noteMap[action] ?? normalizedComment,
    };

    const newStatusHistory = [...(task.status_history ?? []), statusEntry];
    const newCommentHistory = commentEntryValue
      ? [...(task.comment_history ?? []), { text: commentEntryValue, by: normalizedUserEmail, byName: dbUser.display_name, at: now }]
      : task.comment_history;

    const clearRefPdfOnForward = new Set<StatusAction>([
      'submit',
      'doccon_approve',
      'reviewer_approve',
      'boss_approve',
      'super_boss_approve',
    ]);

    if (clearRefPdfOnForward.has(action) && updates.ref_file_id === undefined) {
      const refPdfIds = new Set<string>();
      if (typeof task.ref_file_id === 'string' && task.ref_file_id) {
        refPdfIds.add(task.ref_file_id);
      }
      for (const file of fileHistory) {
        if (file?.isPdf && typeof file.driveFileId === 'string' && file.driveFileId) {
          refPdfIds.add(file.driveFileId);
        }
      }
      for (const refPdfId of refPdfIds) {
        await removeFileFromDrive(refPdfId);
      }
      if (refPdfIds.size > 0 || task.ref_file_id) {
        updates.ref_file_id = null;
        updates.ref_file_name = null;
      }
    }

    if (newStatus === 'COMPLETED' || newStatus === 'CANCELLED') {
      try {
        const { data: privateDrafts } = await admin
          .from('task_private_files')
          .select('id, drive_file_id')
          .eq('task_id', taskId)
          .eq('is_deleted', false);

        const privateDraftRows = (privateDrafts ?? []) as Array<{ id: string; drive_file_id: string }>;
        if (privateDraftRows.length > 0) {
          const nowDelete = new Date().toISOString();
          const privateDraftIds = privateDraftRows.map((row) => row.id);
          const privateDriveIds = privateDraftRows.map((row) => row.drive_file_id).filter(Boolean);

          await admin
            .from('task_private_files')
            .update({
              is_deleted: true,
              deleted_at: nowDelete,
              deleted_by: dbUser.id,
            })
            .in('id', privateDraftIds);

          for (const driveId of privateDriveIds) {
            await removeFileFromDrive(driveId);
          }
        }
      } catch {
        // keep main status transition working even if migration is not applied yet
      }
    }

    const { error: updateErr } = await admin
      .from('tasks')
      .update({
        status: newStatus,
        status_history: newStatusHistory,
        comment_history: newCommentHistory,
        latest_comment: latestCommentValue,
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
