import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError, handleAuthError } from '@/lib/auth/guards';
import {
  deleteFilePermanent,
  trashFile,
  verifyUploadedFile,
} from '@/lib/google-drive/files';
import { setFilePublic } from '@/lib/google-drive/permissions';
import { authorizeUpload } from '@/lib/files/upload-auth';
import { MAX_RESUMABLE_UPLOAD_FILE_SIZE_BYTES } from '@/lib/files/upload-limits';
import { getRequestIdFromHeaders, logEvent } from '@/lib/ops/observability';

function errorResponse(
  status: number,
  error: string,
  message: string,
  requestId: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ error, message, requestId, ...(extra ?? {}) }, { status });
}

// POST /api/tasks/[taskId]/files/finalize
// Body: { driveFileId, upload_batch_id?, upload_batch_label?, upload_batch_index?, upload_batch_total? }
//
// Called after the browser PUTs a file directly to Drive via the resumable
// uploadUrl returned by /init-upload. Verifies the file landed in the task
// folder, then performs the same DB bookkeeping as the direct multipart route.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  try {
    const user = await getAuthUser('tracking');
    if (!user) return errorResponse(401, 'unauthorized', 'Please sign in first.', requestId);
    const normalizedUserEmail = user.email.trim().toLowerCase();

    const { taskId } = await params;
    const body = (await request.json()) as {
      driveFileId?: string;
      upload_batch_id?: string;
      upload_batch_label?: string;
      upload_batch_index?: number;
      upload_batch_total?: number;
    };

    const driveFileId = typeof body.driveFileId === 'string' ? body.driveFileId.trim() : '';
    if (!driveFileId) {
      return errorResponse(400, 'missing_drive_file_id', 'driveFileId is required.', requestId);
    }

    const uploadBatchId = typeof body.upload_batch_id === 'string' ? body.upload_batch_id.trim() : '';
    const uploadBatchLabel = typeof body.upload_batch_label === 'string' ? body.upload_batch_label.trim() : '';
    const uploadBatchIndex =
      typeof body.upload_batch_index === 'number' && body.upload_batch_index > 0
        ? body.upload_batch_index
        : null;
    const uploadBatchTotal =
      typeof body.upload_batch_total === 'number' && body.upload_batch_total > 0
        ? body.upload_batch_total
        : null;
    const hasPdfBatchMeta = Boolean(
      uploadBatchId && uploadBatchTotal && uploadBatchTotal > 1 && uploadBatchIndex && uploadBatchIndex <= uploadBatchTotal,
    );

    const admin = await createServiceRoleClient();

    const { data: dbUser } = await admin
      .from('users')
      .select('id, display_name')
      .eq('id', user.id)
      .single();
    if (!dbUser) throw new AuthError('User profile not found.', 404);

    const { data: task } = await admin.from('tasks').select('*').eq('id', taskId).single();
    if (!task) return errorResponse(404, 'task_not_found', 'Task not found.', requestId);

    // Derive ext from the batch label (client hints) or we'll read it from Drive below.
    // We re-run the full authorization check below using the actual Drive-reported filename.
    if (!task.task_folder_id) {
      return errorResponse(
        400,
        'task_folder_missing',
        'Task folder is missing; please retry the upload.',
        requestId,
      );
    }

    let meta;
    try {
      meta = await verifyUploadedFile(driveFileId, task.task_folder_id);
    } catch (err) {
      logEvent('warn', 'file_upload_finalize', requestId, 'Uploaded file verification failed', {
        driveFileId,
        error: err instanceof Error ? err.message : String(err),
      });
      return errorResponse(
        400,
        'uploaded_file_not_verified',
        'Uploaded file could not be verified. Please retry.',
        requestId,
      );
    }

    if (meta.size > MAX_RESUMABLE_UPLOAD_FILE_SIZE_BYTES) {
      // Best-effort cleanup and reject
      try {
        await deleteFilePermanent(driveFileId);
      } catch {
        // ignore
      }
      return errorResponse(
        400,
        'file_too_large',
        'Uploaded file exceeds the allowed size.',
        requestId,
      );
    }

    const extRaw = (meta.name.toLowerCase().split('.').pop() ?? '') as string;
    if (extRaw !== 'docx' && extRaw !== 'pdf') {
      try {
        await deleteFilePermanent(driveFileId);
      } catch {
        // ignore
      }
      return errorResponse(
        400,
        'unsupported_file_type',
        'Only .docx and .pdf are supported.',
        requestId,
      );
    }
    const ext: 'docx' | 'pdf' = extRaw;

    // Re-run upload authorization against the ACTUAL status at finalize time,
    // since state could have changed during the upload.
    const decision = authorizeUpload({ user, task, ext });
    if (!decision.allow) {
      // Don't delete the file yet — let the user retry a different action
      return errorResponse(decision.status, decision.code, decision.message, requestId);
    }

    const isPdf = ext === 'pdf';
    const driveFileName = meta.name;

    await setFilePublic(driveFileId);

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };
    const cleanupWarnings: string[] = [];

    async function removeOldFile(fileId: string, label: 'DOCX' | 'PDF') {
      try {
        await deleteFilePermanent(fileId);
        return;
      } catch (deleteErr) {
        console.warn(`[FILE_FINALIZE] Permanent delete failed for ${label} ${fileId}`, deleteErr);
      }
      try {
        await trashFile(fileId);
      } catch (trashErr) {
        console.error(`[FILE_FINALIZE] Failed to remove old ${label} ${fileId}`, trashErr);
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
    const latestOldDocxFromHistory = [...existingHistory].reverse().find((f) => !f.isPdf && f.driveFileId)?.driveFileId;

    const newFileHistoryEntry = {
      fileName: driveFileName,
      uploadedAt: now,
      uploadedBy: normalizedUserEmail,
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
          .filter(
            (entry) =>
              entry.isPdf &&
              entry.uploadBatchId === uploadBatchId &&
              typeof entry.driveFileId === 'string' &&
              entry.driveFileId.length > 0,
          )
          .sort((a, b) => (a.uploadBatchIndex ?? 9999) - (b.uploadBatchIndex ?? 9999));

        const expectedTotal = uploadBatchTotal ?? 0;
        const indexSet = new Set(
          sameBatch
            .map((entry) => entry.uploadBatchIndex)
            .filter((value): value is number => typeof value === 'number' && value > 0),
        );
        const isBatchComplete =
          expectedTotal > 1 &&
          sameBatch.length >= expectedTotal &&
          Array.from({ length: expectedTotal }, (_, idx) => idx + 1).every((value) => indexSet.has(value));

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
      uploader_id: user.id,
      drive_file_id: driveFileId,
      drive_file_name: driveFileName,
      file_type: ext.toUpperCase(),
      file_size_bytes: meta.size,
    });

    return NextResponse.json(
      {
        ok: true,
        requestId,
        driveFileId,
        driveFileName,
        isPdf,
        viewUrl: `https://drive.google.com/file/d/${driveFileId}/view`,
        cleanupWarnings,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    logEvent('error', 'file_upload_finalize', requestId, 'Finalize failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return handleAuthError(err, { scope: 'files.finalize', requestId });
  }
}
