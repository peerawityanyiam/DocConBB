import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError, handleAuthError } from '@/lib/auth/guards';
import { deleteFilePermanent, trashFile } from '@/lib/google-drive/files';

function errorResponse(status: number, error: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, message, ...(extra ?? {}) }, { status });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return errorResponse(401, 'unauthorized', 'Please sign in first.');
    const normalizedUserEmail = user.email.trim().toLowerCase();

    const { taskId } = await params;
    const uploadBatchId = request.nextUrl.searchParams.get('upload_batch_id')?.trim();
    const driveFileIdsParam = request.nextUrl.searchParams.get('drive_file_ids')?.trim();
    if (!uploadBatchId && !driveFileIdsParam) {
      return errorResponse(400, 'missing_rollback_selector', 'Missing upload_batch_id or drive_file_ids.');
    }

    const admin = await createServiceRoleClient();
    const { data: task } = await admin.from('tasks').select('ref_file_id, file_history').eq('id', taskId).single();
    if (!task) return errorResponse(404, 'task_not_found', 'Task not found.');

    type FileHistoryEntry = {
      driveFileId?: string;
      isPdf?: boolean;
      uploadBatchId?: string;
      uploadedBy?: string;
    };
    const fileHistory = (task.file_history as FileHistoryEntry[] | null) ?? [];
    const targetDriveIds = new Set(
      (driveFileIdsParam ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    );

    const toRollback = fileHistory.filter((entry) => {
      if (!entry.isPdf) return false;
      if ((entry.uploadedBy ?? '').toLowerCase() !== normalizedUserEmail) return false;
      if (typeof entry.driveFileId !== 'string' || entry.driveFileId.length === 0) return false;
      if (uploadBatchId && entry.uploadBatchId === uploadBatchId) return true;
      if (targetDriveIds.has(entry.driveFileId)) return true;
      return false;
    });

    if (toRollback.length === 0) {
      return NextResponse.json({ ok: true, removed: 0 });
    }

    const rollbackIds = Array.from(new Set(toRollback.map((entry) => entry.driveFileId as string)));

    const rollbackIdSet = new Set(rollbackIds);
    const filteredHistory = fileHistory.filter((entry) => {
      if (!entry.isPdf) return true;
      if ((entry.uploadedBy ?? '').toLowerCase() !== normalizedUserEmail) return true;
      if (typeof entry.driveFileId !== 'string' || entry.driveFileId.length === 0) return true;
      return !rollbackIdSet.has(entry.driveFileId);
    });

    const updates: Record<string, unknown> = {
      file_history: filteredHistory,
      updated_at: new Date().toISOString(),
    };
    if (typeof task.ref_file_id === 'string' && rollbackIds.includes(task.ref_file_id)) {
      updates.ref_file_id = null;
      updates.ref_file_name = null;
    }

    await admin.from('tasks').update(updates).eq('id', taskId);
    await admin
      .from('uploaded_files')
      .delete()
      .eq('task_id', taskId)
      .in('drive_file_id', rollbackIds);

    const cleanupWarnings: string[] = [];
    for (const fileId of rollbackIds) {
      try {
        await deleteFilePermanent(fileId);
      } catch {
        try {
          await trashFile(fileId);
        } catch {
          cleanupWarnings.push(fileId);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      removed: rollbackIds.length,
      cleanupWarnings,
    });
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    console.error('[FILE_UPLOAD_ROLLBACK_ERROR]', err);
    return errorResponse(500, 'rollback_failed', 'Unable to rollback partial uploaded files.');
  }
}
