import { putFileToDriveResumable } from '@/lib/files/client-upload';

async function parseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function payloadError(payload: Record<string, unknown> | null, status: number) {
  const error = typeof payload?.error === 'string' ? payload.error : '';
  const message = typeof payload?.message === 'string' ? payload.message : '';
  return [error, message].filter(Boolean).join(' ') || `HTTP_${status}`;
}

export async function uploadScanImageResumable(options: {
  scanId: string;
  file: File;
  kind: 'original' | 'processed';
  pageId?: string;
  adjustments?: Record<string, unknown>;
  onProgress?: (percent: number) => void;
}) {
  const { scanId, file, kind, pageId, adjustments, onProgress } = options;
  const initRes = await fetch(`/api/scans/${scanId}/images/init-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
      kind,
      pageId,
    }),
  });
  const initPayload = await parseJson<{ uploadUrl?: string; mimeType?: string }>(initRes);
  if (!initRes.ok || !initPayload?.uploadUrl) {
    throw new Error(payloadError(initPayload as Record<string, unknown> | null, initRes.status));
  }

  const { driveFileId } = await putFileToDriveResumable(
    initPayload.uploadUrl,
    file,
    initPayload.mimeType || file.type || 'application/octet-stream',
    onProgress,
  );

  const finalizeRes = await fetch(`/api/scans/${scanId}/images/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      driveFileId,
      kind,
      pageId,
      adjustments,
    }),
  });
  const finalizePayload = await parseJson<{ page?: unknown }>(finalizeRes);
  if (!finalizeRes.ok || !finalizePayload?.page) {
    throw new Error(payloadError(finalizePayload as Record<string, unknown> | null, finalizeRes.status));
  }
  return finalizePayload.page;
}

export async function uploadScanPdfResumable(options: {
  scanId: string;
  file: File;
  onProgress?: (percent: number) => void;
}) {
  const { scanId, file, onProgress } = options;
  const initRes = await fetch(`/api/scans/${scanId}/pdf/init-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: 'application/pdf',
      fileSize: file.size,
    }),
  });
  const initPayload = await parseJson<{ uploadUrl?: string; mimeType?: string }>(initRes);
  if (!initRes.ok || !initPayload?.uploadUrl) {
    throw new Error(payloadError(initPayload as Record<string, unknown> | null, initRes.status));
  }

  const { driveFileId } = await putFileToDriveResumable(
    initPayload.uploadUrl,
    file,
    'application/pdf',
    onProgress,
  );

  const finalizeRes = await fetch(`/api/scans/${scanId}/pdf/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driveFileId }),
  });
  const finalizePayload = await parseJson<{
    scan?: unknown;
    driveFileId?: string;
    viewUrl?: string;
  }>(finalizeRes);
  if (!finalizeRes.ok || !finalizePayload?.driveFileId) {
    throw new Error(payloadError(finalizePayload as Record<string, unknown> | null, finalizeRes.status));
  }
  return finalizePayload;
}
