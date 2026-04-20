/**
 * Client-side resumable upload helper.
 *
 * The backend exposes two upload paths:
 *   1. Direct multipart POST to /api/tasks/[taskId]/files — simple but subject
 *      to Vercel's ~4.5MB request body limit.
 *   2. Resumable flow (this helper): POST /files/init-upload → PUT directly to
 *      Drive → POST /files/finalize. Bypasses Vercel's body limit entirely;
 *      supports files up to MAX_RESUMABLE_UPLOAD_FILE_SIZE_BYTES.
 *
 * Use the resumable path for files larger than MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES.
 * Small files should keep using the direct path (one fewer round-trip).
 */

export interface ResumableUploadBatchMeta {
  id: string;
  index: number;
  total: number;
  label: string;
}

export interface ResumableUploadResult {
  driveFileId: string;
  driveFileName: string;
  isPdf: boolean;
}

export interface ResumableUploadOptions {
  taskId: string;
  file: File;
  batchMeta?: ResumableUploadBatchMeta;
  onProgress?: (percent: number) => void;
}

async function parseJson<T = Record<string, unknown>>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function describeErrorFromPayload(
  payload: Record<string, unknown> | null,
  fallbackStatus: number,
): string {
  if (!payload) return `HTTP_${fallbackStatus}`;
  const error = typeof payload.error === 'string' ? payload.error : '';
  const message = typeof payload.message === 'string' ? payload.message : '';
  const combined = [error, message].filter(Boolean).join(' ').trim();
  return combined || `HTTP_${fallbackStatus}`;
}

function putToDrive(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void,
): Promise<{ driveFileId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.addEventListener('progress', (e) => {
      if (!onProgress || !e.lengthComputable) return;
      onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`drive_put_failed_${xhr.status}`));
        return;
      }
      // On successful completion of a resumable upload, Drive returns the file
      // metadata JSON in the response body. We need at least the `id`.
      try {
        const parsed = JSON.parse(xhr.responseText) as { id?: string };
        if (!parsed.id) {
          reject(new Error('drive_put_missing_file_id'));
          return;
        }
        resolve({ driveFileId: parsed.id });
      } catch {
        reject(new Error('drive_put_invalid_response'));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('drive_put_network_error')));
    xhr.addEventListener('abort', () => reject(new Error('UPLOAD_ABORTED')));
    xhr.send(file);
  });
}

export async function uploadFileResumable(
  options: ResumableUploadOptions,
): Promise<ResumableUploadResult> {
  const { taskId, file, batchMeta, onProgress } = options;

  // 1. Ask our server to create a Drive resumable session.
  const initRes = await fetch(`/api/tasks/${taskId}/files/init-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
    }),
  });
  const initPayload = await parseJson<{ uploadUrl?: string; mimeType?: string }>(initRes);
  if (!initRes.ok || !initPayload?.uploadUrl) {
    throw new Error(
      describeErrorFromPayload(initPayload as Record<string, unknown> | null, initRes.status),
    );
  }
  const uploadUrl = initPayload.uploadUrl;
  const contentType = initPayload.mimeType || file.type || 'application/octet-stream';

  // 2. PUT the file bytes directly to Drive and collect the resulting file id.
  const { driveFileId } = await putToDrive(uploadUrl, file, contentType, onProgress);

  // 3. Finalize server-side: verify the file, update DB bookkeeping, return
  //    the same response shape as the direct-upload path.
  const finalizeRes = await fetch(`/api/tasks/${taskId}/files/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      driveFileId,
      upload_batch_id: batchMeta?.id,
      upload_batch_index: batchMeta?.index,
      upload_batch_total: batchMeta?.total,
      upload_batch_label: batchMeta?.label,
    }),
  });
  const finalizePayload = await parseJson<{
    driveFileId?: string;
    driveFileName?: string;
    isPdf?: boolean;
  }>(finalizeRes);
  if (!finalizeRes.ok || !finalizePayload?.driveFileId) {
    throw new Error(
      describeErrorFromPayload(finalizePayload as Record<string, unknown> | null, finalizeRes.status),
    );
  }

  return {
    driveFileId: finalizePayload.driveFileId,
    driveFileName: finalizePayload.driveFileName ?? file.name,
    isPdf: Boolean(finalizePayload.isPdf),
  };
}
