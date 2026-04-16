import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError, handleAuthError } from '@/lib/auth/guards';
import { getDriveAccessToken } from '@/lib/google-drive/client';
import { getOrCreateFolder, checkFolderExists } from '@/lib/google-drive/files';
import { MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES, MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL } from '@/lib/files/upload-limits';

export const maxDuration = 30;

const UPLOAD_FOLDER_ID = process.env.GOOGLE_UPLOAD_FOLDER_ID || process.env.GOOGLE_SHARED_FOLDER_ID!;

function toPositiveInt(v: unknown): number | null {
  if (typeof v !== 'number') return null;
  const n = Math.floor(v);
  return Number.isFinite(n) && n > 0 ? n : null;
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
    const body = await request.json() as {
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
      uploadBatchId?: string;
      uploadBatchLabel?: string;
      uploadBatchIndex?: number;
      uploadBatchTotal?: number;
    };

    const { fileName, mimeType, fileSize } = body;
    if (!fileName || !mimeType) {
      return errorResponse(400, 'missing_fields', 'fileName and mimeType are required.');
    }
    if (typeof fileSize !== 'number' || fileSize <= 0) {
      return errorResponse(400, 'invalid_file_size', 'fileSize must be a positive number.');
    }
    if (fileSize > MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES) {
      return errorResponse(400, 'file_too_large', `File exceeds ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}.`);
    }

    const ext = fileName.toLowerCase().split('.').pop();
    if (!['docx', 'pdf'].includes(ext ?? '')) {
      return errorResponse(400, 'unsupported_file_type', 'Only .docx and .pdf are supported.');
    }

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

    const admin = await createServiceRoleClient();

    const { data: dbUser } = await admin
      .from('users')
      .select('id, display_name')
      .eq('id', user.id)
      .single();
    if (!dbUser) throw new AuthError('User profile not found.', 404);

    const { data: task } = await admin.from('tasks').select('*').eq('id', taskId).single();
    if (!task) return errorResponse(404, 'task_not_found', 'Task not found.');

    const s = task.status;
    const isOfficer = task.officer_id === user.id;
    const isReviewer = task.reviewer_id === user.id;
    const isCreator = task.created_by === user.id;
    const officerStatuses = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];
    const projectRolesSet = new Set(user.roles.map((role) => role.toUpperCase()));

    let canUpload = false;
    if (isOfficer && officerStatuses.includes(s)) canUpload = true;
    if (isCreator && (s === 'ASSIGNED' || s === 'WAITING_BOSS_APPROVAL')) canUpload = true;
    if (projectRolesSet.has('DOCCON') && s === 'SUBMITTED_TO_DOCCON') canUpload = true;
    if (isReviewer && s === 'PENDING_REVIEW') canUpload = true;
    if (projectRolesSet.has('SUPER_BOSS') && s === 'WAITING_SUPER_BOSS_APPROVAL') canUpload = true;
    if (projectRolesSet.has('SUPER_ADMIN')) canUpload = true;

    if (!canUpload) {
      const rolesStr = Array.from(projectRolesSet).join(', ') || 'none';
      const isStaffLike = projectRolesSet.has('STAFF');
      const statusInOfficerFlow = officerStatuses.includes(s);
      const denyCode = isStaffLike && statusInOfficerFlow && !isOfficer
        ? 'not_task_officer'
        : 'forbidden_upload_state';
      const denyMessage = denyCode === 'not_task_officer'
        ? 'This task is not assigned to your account.'
        : 'You do not have permission to upload files in this status.';
      return errorResponse(403, denyCode, denyMessage, {
        debug: { roles: rolesStr, status: s, officer: isOfficer, reviewer: isReviewer, creator: isCreator },
      });
    }

    const isPdfFile = ext === 'pdf';
    if (isPdfFile) {
      const pdfAllowedStatuses = ['SUBMITTED_TO_DOCCON', 'PENDING_REVIEW', 'WAITING_BOSS_APPROVAL', 'WAITING_SUPER_BOSS_APPROVAL'];
      const isCreatorUploadingAtAssigned = isCreator && s === 'ASSIGNED';
      if (!pdfAllowedStatuses.includes(s) && !isCreatorUploadingAtAssigned) {
        return errorResponse(400, 'pdf_not_allowed_in_status', 'This status accepts only .docx files.');
      }
      if (s === 'SUBMITTED_TO_DOCCON' && projectRolesSet.has('DOCCON') && !isCreator) {
        const history = (task.status_history as Array<{ status?: string; note?: string }>) ?? [];
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          if (h.status === 'SUBMITTED_TO_DOCCON' && h.note?.startsWith('sentBackToDocconBy:')) {
            return errorResponse(400, 'doccon_word_only_after_boss_sendback', 'When sent back from Boss/Super Boss, only .docx upload is allowed.');
          }
          if (h.status === 'SUBMITTED_TO_DOCCON') break;
        }
      }
    }

    // Folder setup
    let taskFolderId = task.task_folder_id;
    let needNewFolder = !taskFolderId;
    if (taskFolderId) {
      const folderOk = await checkFolderExists(taskFolderId);
      if (!folderOk) {
        console.warn('[INITIATE] Existing task_folder_id invalid:', taskFolderId);
        needNewFolder = true;
      }
    }
    if (needNewFolder) {
      console.log('[INITIATE] Creating new folder. Parent:', UPLOAD_FOLDER_ID, 'Task:', task.task_code);
      taskFolderId = await getOrCreateFolder(UPLOAD_FOLDER_ID, task.task_code);
      await admin.from('tasks').update({ task_folder_id: taskFolderId }).eq('id', taskId);
    }

    // Create Google Drive resumable upload session
    const accessToken = await getDriveAccessToken();
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(fileSize),
        },
        body: JSON.stringify({ name: fileName, parents: [taskFolderId] }),
      },
    );

    if (!initRes.ok) {
      const errText = await initRes.text();
      console.error('[INITIATE] Drive session error:', initRes.status, errText);
      return errorResponse(502, 'drive_session_failed', 'Failed to create upload session with Google Drive.');
    }

    const uploadUri = initRes.headers.get('location');
    if (!uploadUri) {
      return errorResponse(502, 'missing_upload_uri', 'Google Drive did not return an upload URI.');
    }

    return NextResponse.json({
      ok: true,
      uploadUri,
      taskFolderId,
      hasPdfBatchMeta,
      uploadBatchId: hasPdfBatchMeta ? uploadBatchId : '',
      uploadBatchLabel: hasPdfBatchMeta ? uploadBatchLabel : '',
      uploadBatchIndex: hasPdfBatchMeta ? uploadBatchIndex : null,
      uploadBatchTotal: hasPdfBatchMeta ? uploadBatchTotal : null,
    });
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    console.error('[INITIATE_ERROR]', err);
    const message = err instanceof Error ? err.message : 'Initiate failed.';
    if (/unauthorized_client/i.test(message)) {
      return errorResponse(500, 'unauthorized_client', 'Google service-account impersonation is not authorized.');
    }
    return errorResponse(500, 'initiate_failed', message);
  }
}
