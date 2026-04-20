import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError, handleAuthError } from '@/lib/auth/guards';
import {
  checkFolderExists,
  createResumableSession,
  getOrCreateFolder,
} from '@/lib/google-drive/files';
import { authorizeUpload, normalizeMimeByExt } from '@/lib/files/upload-auth';
import {
  MAX_RESUMABLE_UPLOAD_FILE_SIZE_BYTES,
  MAX_RESUMABLE_UPLOAD_FILE_SIZE_LABEL,
} from '@/lib/files/upload-limits';
import { getRequestIdFromHeaders, logEvent } from '@/lib/ops/observability';

const UPLOAD_FOLDER_ID = process.env.GOOGLE_UPLOAD_FOLDER_ID || process.env.GOOGLE_SHARED_FOLDER_ID!;

function errorResponse(
  status: number,
  error: string,
  message: string,
  requestId: string,
) {
  return NextResponse.json({ error, message, requestId }, { status });
}

// POST /api/tasks/[taskId]/files/init-upload
// Body: { fileName, mimeType, fileSize }
// Response: { uploadUrl, taskFolderId, driveFileNameHint }
//
// The browser should PUT the file bytes to the returned uploadUrl directly,
// then call POST /api/tasks/[taskId]/files/finalize with the resulting Drive
// file id.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  try {
    const user = await getAuthUser('tracking');
    if (!user) return errorResponse(401, 'unauthorized', 'Please sign in first.', requestId);

    const { taskId } = await params;
    const body = (await request.json()) as {
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
    };

    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0;
    if (!fileName) return errorResponse(400, 'file_required', 'Missing fileName.', requestId);
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return errorResponse(400, 'invalid_size', 'Missing or invalid fileSize.', requestId);
    }
    if (fileSize > MAX_RESUMABLE_UPLOAD_FILE_SIZE_BYTES) {
      return errorResponse(
        400,
        'file_too_large',
        `File exceeds ${MAX_RESUMABLE_UPLOAD_FILE_SIZE_LABEL}.`,
        requestId,
      );
    }

    const extRaw = fileName.toLowerCase().split('.').pop();
    if (extRaw !== 'docx' && extRaw !== 'pdf') {
      return errorResponse(400, 'unsupported_file_type', 'Only .docx and .pdf are supported.', requestId);
    }
    const ext: 'docx' | 'pdf' = extRaw;
    const mimeType = normalizeMimeByExt(ext, typeof body.mimeType === 'string' ? body.mimeType : '');

    const admin = await createServiceRoleClient();
    const { data: task } = await admin.from('tasks').select('*').eq('id', taskId).single();
    if (!task) return errorResponse(404, 'task_not_found', 'Task not found.', requestId);

    const decision = authorizeUpload({ user, task, ext });
    if (!decision.allow) {
      return errorResponse(decision.status, decision.code, decision.message, requestId);
    }

    let taskFolderId: string = task.task_folder_id;
    let needNewFolder = !taskFolderId;
    if (taskFolderId) {
      const ok = await checkFolderExists(taskFolderId);
      if (!ok) {
        logEvent('warn', 'file_upload_init', requestId, 'Existing task_folder_id invalid', {
          taskFolderId,
        });
        needNewFolder = true;
      }
    }
    if (needNewFolder) {
      taskFolderId = await getOrCreateFolder(UPLOAD_FOLDER_ID, task.task_code);
      await admin.from('tasks').update({ task_folder_id: taskFolderId }).eq('id', taskId);
    }

    // Prefer the Origin header sent by the browser (same-origin fetch does
     // include it on POST). Fall back to constructing origin from the request
     // URL so server-initiated calls still work.
    const headerOrigin = request.headers.get('origin');
    const origin = headerOrigin && headerOrigin !== 'null' ? headerOrigin : new URL(request.url).origin;
    const { uploadUrl } = await createResumableSession(taskFolderId, fileName, mimeType, fileSize, origin);

    logEvent('info', 'file_upload_init', requestId, 'Resumable session created', {
      taskId,
      fileName,
      fileSize,
      ext,
    });

    return NextResponse.json({
      ok: true,
      requestId,
      uploadUrl,
      taskFolderId,
      mimeType,
    });
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    logEvent('error', 'file_upload_init', requestId, 'Failed to create resumable session', {
      error: err instanceof Error ? err.message : String(err),
    });
    return handleAuthError(err, { scope: 'files.init-upload', requestId });
  }
}
