import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError, handleAuthError } from '@/lib/auth/guards';
import { getDriveClient } from '@/lib/google-drive/client';
import { setFilePublic } from '@/lib/google-drive/permissions';
import { deleteFilePermanent, trashFile } from '@/lib/google-drive/files';

export const maxDuration = 30;

function toPositiveInt(v: unknown): number | null {
  if (typeof v !== 'number') return null;
  const n = Math.floor(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return errorResponse(401, 'unauthorized', 'Please sign in first.');
    const normalizedUserEmail = user.email.trim().toLowerCase();

    const { taskId } = await params;
    const body = await request.json() as {
      driveFileId?: string;
      driveFileName?: string;
      mimeType?: string;
      fileSizeBytes?: number;
      isPdf?: boolean;
      uploadBatchId?: string;
      uploadBatchLabel?: string;
      uploadBatchIndex?: number;
      uploadBatchTotal?: number;
    };

    const { driveFileId, driveFileName, fileSizeBytes, isPdf = false } = body;
    if (!driveFileId || !driveFileName) {
      return errorResponse(400, 'missing_fields', 'driveFileId and driveFileName are required.');
    }

    // Verify file exists on Drive (prevents spoofed fileIds)
    try {
      await getDriveClient().files.get({
        fileId: driveFileId,
        fields: 'id',
        supportsAllDrives: true,
      });
    } catch {
      return errorResponse(400, 'drive_file_not_found', 'Uploaded file not found on Google Drive.');
    }

    const admin = await createServiceRoleClient();

    const { data: dbUser } = await admin
      .from('users')
      .select('id, display_name')
      .eq('id', user.id)
      .single();
    if (!dbUser) throw new AuthError('User profile not found.', 404);

    const { data: task } = await admin.from('tasks').select('*').eq('id', taskId).single();
    if (!task) return errorResponse(404, 'task_not_found', 'Task not found.');

    // Re-verify permission (task status may have changed between initiate and confirm)
    const s = task.status;
    const isOfficer = task.officer_id === user.id;
    const isReviewer = task.reviewer_id === user.id;
    const isCreator = task.created_by === user.id;
    const officerStatuses = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];
    const projectRolesSet = new Set(user.roles.map((r) => r.toUpperCase()));

    let canUpload = false;
    if (isOfficer && officerStatuses.includes(s)) canUpload = true;
    if (isCreator && (s === 'ASSIGNED' || s === 'WAITING_BOSS_APPROVAL')) canUpload = true;
    if (projectRolesSet.has('DOCCON') && s === 'SUBMITTED_TO_DOCCON') canUpload = true;
    if (isReviewer && s === 'PENDING_REVIEW') canUpload = true;
    if (projectRolesSet.has('SUPER_BOSS') && s === 'WAITING_SUPER_BOSS_APPROVAL') canUpload = true;
    if (projectRolesSet.has('SUPER_ADMIN')) canUpload = true;

    if (!canUpload) {
      return errorResponse(403, 'forbidden_upload_state', 'You do not have permission to upload files in this status.');
    }

    await setFilePublic(driveFileId);

    const uploadBatchId = typeof body.uploadBatchId === 'string' ? body.uploadBatchId.trim() : '';
    const uploadBatchLabel = typeof body.uploadBatchLabel === 'string' ? body.uploadBatchLabel.trim() : '';
    const uploadBatchIndex = toPositiveInt(body.uploadBatchIndex ?? null);
    const uploadBatchTotal = toPositiveInt(body.uploadBatchTotal ?? null);
    const hasPdfBatchMeta = Boolean(
      uploadBatchId &&
      uploadBatchTotal &&
      uploadBatchTotal > 1 &&
      uploadBatchIndex &&
      uploadBatchIndex <= uploadBatchTotal,
    );

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };
    const cleanupWarnings: string[] = [];

    async function removeOldFile(fileId: string, label: 'DOCX' | 'PDF') {
      try {
        await deleteFilePermanent(fileId);
        return;
      } catch (deleteErr) {
        console.warn(`[CONFIRM] Permanent delete failed for ${label} ${fileId}, fallback to trash`, deleteErr);
      }
      try {
        await trashFile(fileId);
      } catch (trashErr) {
        console.error(`[CONFIRM] Failed to remove old ${label} ${fileId}`, trashErr);
        cleanupWarnings.push(`remove_old_${label.toLowerCase()}_failed`);
      }
    }

    type FileHistoryEntry = {
      fileName?: string;
      uploadedAt?: string;
      uploadedBy?: string;
      uploadedByName?: string;
      driveFileId?: string;
      isPdf?: boolean;
      uploadBatchId?: string;
      uploadBatchIndex?: number;
      uploadBatchTotal?: number;
    };

    const existingHistory = (task.file_history as FileHistoryEntry[] | null) ?? [];
    const latestOldDocxFromHistory = [...existingHistory].reverse().find(f => !f.isPdf && f.driveFileId)?.driveFileId;

    const newEntry: FileHistoryEntry = {
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
    const fileHistory = [...existingHistory, newEntry];
    updates.file_history = fileHistory;

    if (isPdf) {
      if (hasPdfBatchMeta) {
        const summaryBaseName = (uploadBatchLabel || driveFileName).replace(/-part-\d+\.pdf$/i, '.pdf');
        const sameBatch = fileHistory
          .filter((entry) => (
            entry.isPdf &&
            entry.uploadBatchId === uploadBatchId &&
            typeof entry.driveFileId === 'string' &&
            entry.driveFileId.length > 0
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

    const ext = driveFileName.toLowerCase().split('.').pop();
    await admin.from('uploaded_files').insert({
      task_id: taskId,
      uploader_id: user.id,
      drive_file_id: driveFileId,
      drive_file_name: driveFileName,
      file_type: ext?.toUpperCase(),
      file_size_bytes: fileSizeBytes ?? null,
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
    console.error('[CONFIRM_ERROR]', err);
    const message = err instanceof Error ? err.message : 'Confirm failed.';
    return NextResponse.json({ error: 'confirm_failed', message }, { status: 500 });
  }
}
