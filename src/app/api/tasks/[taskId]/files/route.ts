import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError, handleAuthError } from '@/lib/auth/guards';
import { uploadFile, getOrCreateFolder, deleteFilePermanent, checkFolderExists, trashFile } from '@/lib/google-drive/files';
import { setFilePublic } from '@/lib/google-drive/permissions';
import { MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES, MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL } from '@/lib/files/upload-limits';

const UPLOAD_FOLDER_ID = process.env.GOOGLE_UPLOAD_FOLDER_ID || process.env.GOOGLE_SHARED_FOLDER_ID!;

function toPositiveInt(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string') return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function errorResponse(status: number, error: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, message, ...(extra ?? {}) }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return errorResponse(401, 'unauthorized', 'Please sign in first.');

    const { taskId } = await params;
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const uploadBatchIdRaw = formData.get('upload_batch_id');
    const uploadBatchLabelRaw = formData.get('upload_batch_label');
    const uploadBatchIndex = toPositiveInt(formData.get('upload_batch_index'));
    const uploadBatchTotal = toPositiveInt(formData.get('upload_batch_total'));

    if (!file) return errorResponse(400, 'file_required', 'No file was provided.');
    const uploadBatchId = typeof uploadBatchIdRaw === 'string' ? uploadBatchIdRaw.trim() : '';
    const uploadBatchLabel = typeof uploadBatchLabelRaw === 'string' ? uploadBatchLabelRaw.trim() : '';
    const hasPdfBatchMeta = Boolean(
      uploadBatchId &&
      uploadBatchTotal &&
      uploadBatchTotal > 1 &&
      uploadBatchIndex &&
      uploadBatchIndex <= uploadBatchTotal,
    );

    const ext = file.name.toLowerCase().split('.').pop();
    if (!['docx', 'pdf'].includes(ext ?? '')) {
      return errorResponse(400, 'unsupported_file_type', 'Only .docx and .pdf are supported.');
    }

    if (file.size > MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES) {
      return errorResponse(400, 'file_too_large', `File exceeds ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}.`);
    }

    const admin = await createServiceRoleClient();

    const { data: dbUser } = await admin
      .from('users')
      .select('id, display_name')
      .eq('email', user.email)
      .single();
    if (!dbUser) throw new AuthError('User profile not found.', 404);

    const { data: task } = await admin.from('tasks').select('*').eq('id', taskId).single();
    if (!task) return errorResponse(404, 'task_not_found', 'Task not found.');

    const { data: userRoleRows } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', dbUser.id);
    const userRolesSet = new Set((userRoleRows ?? []).map(r => r.role));

    const s = task.status;
    const isOfficer = task.officer_id === dbUser.id;
    const isReviewer = task.reviewer_id === dbUser.id;
    const isCreator = task.created_by === dbUser.id;

    const officerStatuses = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];

    let canUpload = false;
    const authRolesSet = new Set(user.roles);

    if (isOfficer && officerStatuses.includes(s)) canUpload = true;
    if (isCreator && (s === 'ASSIGNED' || s === 'WAITING_BOSS_APPROVAL')) canUpload = true;
    if ((userRolesSet.has('DOCCON') || authRolesSet.has('DOCCON')) && s === 'SUBMITTED_TO_DOCCON') canUpload = true;
    if (isReviewer && s === 'PENDING_REVIEW') canUpload = true;
    if ((userRolesSet.has('SUPER_BOSS') || authRolesSet.has('SUPER_BOSS')) && s === 'WAITING_SUPER_BOSS_APPROVAL') canUpload = true;
    if (userRolesSet.has('SUPER_ADMIN') || authRolesSet.has('SUPER_ADMIN')) canUpload = true;

    if (!canUpload) {
      const rolesStr = Array.from(userRolesSet).join(', ') || 'none';
      return errorResponse(
        403,
        'forbidden_upload_state',
        'You do not have permission to upload files in this status.',
        {
          debug: {
            roles: rolesStr,
            status: s,
            officer: isOfficer,
            reviewer: isReviewer,
            creator: isCreator,
          },
        },
      );
    }

    const isPdfFile = ext === 'pdf';
    if (isPdfFile) {
      const pdfAllowedStatuses = ['SUBMITTED_TO_DOCCON', 'PENDING_REVIEW', 'WAITING_BOSS_APPROVAL', 'WAITING_SUPER_BOSS_APPROVAL'];
      const isCreatorUploadingAtAssigned = isCreator && s === 'ASSIGNED';
      if (!pdfAllowedStatuses.includes(s) && !isCreatorUploadingAtAssigned) {
        return errorResponse(
          400,
          'pdf_not_allowed_in_status',
          'This status accepts only .docx files (PDF is for rejection reference).',
        );
      }
      if (s === 'SUBMITTED_TO_DOCCON' && (userRolesSet.has('DOCCON') || authRolesSet.has('DOCCON')) && !isCreator) {
        const history = (task.status_history as Array<{status?: string; note?: string}>) ?? [];
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          if (h.status === 'SUBMITTED_TO_DOCCON' && h.note?.startsWith('sentBackToDocconBy:')) {
            return errorResponse(
              400,
              'doccon_word_only_after_boss_sendback',
              'When sent back from Boss/Super Boss, only .docx upload is allowed.',
            );
          }
          if (h.status === 'SUBMITTED_TO_DOCCON') break;
        }
      }
    }

    let taskFolderId = task.task_folder_id;
    let needNewFolder = !taskFolderId;

    if (taskFolderId) {
      const folderOk = await checkFolderExists(taskFolderId);
      if (!folderOk) {
        console.warn('[FILE_UPLOAD] Existing task_folder_id is invalid/inaccessible:', taskFolderId);
        needNewFolder = true;
      }
    }

    if (needNewFolder) {
      console.log('[FILE_UPLOAD] Creating new folder in Shared Drive. Parent:', UPLOAD_FOLDER_ID, 'Task:', task.task_code);
      taskFolderId = await getOrCreateFolder(UPLOAD_FOLDER_ID, task.task_code);
      await admin.from('tasks').update({ task_folder_id: taskFolderId }).eq('id', taskId);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let driveFileId: string;
    let driveFileName: string;
    try {
      const result = await uploadFile(
        taskFolderId,
        file.name,
        file.type || 'application/octet-stream',
        buffer
      );
      driveFileId = result.id;
      driveFileName = result.name;
    } catch (uploadErr: unknown) {
      const errMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
      if (errMsg.includes('storage quota') || errMsg.includes('storageQuotaExceeded')) {
        console.warn('[FILE_UPLOAD] Quota error! Force recreating folder in Shared Drive. Old:', taskFolderId);
        taskFolderId = await getOrCreateFolder(UPLOAD_FOLDER_ID, task.task_code);
        await admin.from('tasks').update({ task_folder_id: taskFolderId }).eq('id', taskId);
        const result = await uploadFile(
          taskFolderId,
          file.name,
          file.type || 'application/octet-stream',
          buffer
        );
        driveFileId = result.id;
        driveFileName = result.name;
      } else {
        throw uploadErr;
      }
    }

    await setFilePublic(driveFileId);

    const isPdf = ext === 'pdf';
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };
    const cleanupWarnings: string[] = [];

    async function removeOldFile(fileId: string, label: 'DOCX' | 'PDF') {
      try {
        await deleteFilePermanent(fileId);
        return;
      } catch (deleteErr) {
        console.warn(`[FILE_UPLOAD] Permanent delete failed for ${label} ${fileId}, fallback to trash`, deleteErr);
      }

      try {
        await trashFile(fileId);
      } catch (trashErr) {
        console.error(`[FILE_UPLOAD] Failed to remove old ${label} ${fileId}`, trashErr);
        cleanupWarnings.push(`remove_old_${label.toLowerCase()}_failed`);
      }
    }

    const existingHistory = (task.file_history as Array<{
      fileName?: string;
      uploadedAt?: string;
      uploadedBy?: string;
      uploadedByName?: string;
      driveFileId?: string;
      isPdf?: boolean;
      uploadBatchId?: string;
      uploadBatchIndex?: number;
      uploadBatchTotal?: number;
    }> | null) ?? [];
    const latestOldDocxFromHistory = [...existingHistory].reverse().find(f => !f.isPdf && f.driveFileId)?.driveFileId;

    const newFileHistoryEntry = {
      fileName: driveFileName,
      uploadedAt: now,
      uploadedBy: user.email,
      uploadedByName: dbUser.display_name,
      driveFileId,
      isPdf,
      uploadBatchId: hasPdfBatchMeta ? uploadBatchId : undefined,
      uploadBatchIndex: hasPdfBatchMeta ? uploadBatchIndex ?? undefined : undefined,
      uploadBatchTotal: hasPdfBatchMeta ? uploadBatchTotal ?? undefined : undefined,
    };
    const fileHistory = [...existingHistory, newFileHistoryEntry];
    updates.file_history = fileHistory;

    if (isPdf) {
      if (hasPdfBatchMeta) {
        const summaryBaseName = (uploadBatchLabel || driveFileName).replace(/-part-\d+\.pdf$/i, '.pdf');
        const sameBatch = fileHistory
          .filter((entry) => (
            entry.isPdf
            && entry.uploadBatchId === uploadBatchId
            && typeof entry.driveFileId === 'string'
            && entry.driveFileId.length > 0
          ))
          .sort((a, b) => (a.uploadBatchIndex ?? 9999) - (b.uploadBatchIndex ?? 9999));

        const expectedTotal = uploadBatchTotal ?? 0;
        const indexSet = new Set(
          sameBatch
            .map((entry) => entry.uploadBatchIndex)
            .filter((value): value is number => typeof value === 'number' && value > 0),
        );
        const isBatchComplete = expectedTotal > 1
          && sameBatch.length >= expectedTotal
          && Array.from({ length: expectedTotal }, (_, idx) => idx + 1).every((value) => indexSet.has(value));

        if (isBatchComplete && sameBatch[0]?.driveFileId) {
          updates.ref_file_id = sameBatch[0].driveFileId;
          updates.ref_file_name = `${summaryBaseName} + ${expectedTotal - 1} files`;
        }
      } else {
        updates.ref_file_id = driveFileId;
        updates.ref_file_name = driveFileName;
      }
    } else {
      const oldDocxId = task.drive_file_id ?? latestOldDocxFromHistory;
      if (oldDocxId && oldDocxId !== driveFileId) {
        await removeOldFile(oldDocxId, 'DOCX');
      }
      updates.drive_file_id = driveFileId;
      updates.drive_file_name = driveFileName;
    }

    await admin.from('tasks').update(updates).eq('id', taskId);

    await admin.from('uploaded_files').insert({
      task_id: taskId,
      uploader_id: dbUser.id,
      drive_file_id: driveFileId,
      drive_file_name: driveFileName,
      file_type: ext?.toUpperCase(),
      file_size_bytes: file.size,
    });

    return NextResponse.json({
      ok: true,
      driveFileId,
      driveFileName,
      isPdf,
      viewUrl: `https://drive.google.com/file/d/${driveFileId}/view`,
      cleanupWarnings,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    console.error('[FILE_UPLOAD_ERROR]', err);
    const message = err instanceof Error ? err.message : 'Upload failed.';
    if (/unauthorized_client/i.test(message)) {
      return errorResponse(
        500,
        'unauthorized_client',
        'Google service-account impersonation is not authorized. Disable impersonation or enable domain-wide delegation.',
      );
    }
    return errorResponse(500, 'upload_failed', message);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return errorResponse(401, 'unauthorized', 'Please sign in first.');

    const { taskId } = await params;
    const uploadBatchId = request.nextUrl.searchParams.get('upload_batch_id')?.trim();
    if (!uploadBatchId) {
      return errorResponse(400, 'missing_upload_batch_id', 'Missing upload_batch_id.');
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

    const toRollback = fileHistory.filter((entry) => (
      entry.isPdf
      && entry.uploadBatchId === uploadBatchId
      && entry.uploadedBy === user.email
      && typeof entry.driveFileId === 'string'
      && entry.driveFileId.length > 0
    ));

    if (toRollback.length === 0) {
      return NextResponse.json({ ok: true, removed: 0 });
    }

    const rollbackIds = Array.from(new Set(toRollback.map((entry) => entry.driveFileId as string)));

    const filteredHistory = fileHistory.filter((entry) => !(
      entry.isPdf
      && entry.uploadBatchId === uploadBatchId
      && entry.uploadedBy === user.email
    ));

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


