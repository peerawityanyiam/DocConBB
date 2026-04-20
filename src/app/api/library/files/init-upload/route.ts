import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError, requireRole } from '@/lib/auth/guards';
import { createResumableSession } from '@/lib/google-drive/files';
import { getRequestIdFromHeaders, logEvent } from '@/lib/ops/observability';
import {
  MAX_RESUMABLE_UPLOAD_FILE_SIZE_BYTES,
  MAX_RESUMABLE_UPLOAD_FILE_SIZE_LABEL,
} from '@/lib/files/upload-limits';

const LIBRARY_UPLOAD_FOLDER_ID = '10Ithv7g75Sd0he6IuVP6Nwk0IIVCFw1i';

// Excel files still go through /api/library/files/upload so the server can
// import sheets in-place. Anything else can use resumable direct-to-Drive.
const RESUMABLE_ALLOWED_EXTS = new Set(['pdf', 'docx', 'doc', 'jpg', 'jpeg', 'png']);

function errorResponse(
  status: number,
  error: string,
  message: string,
  requestId: string,
) {
  return NextResponse.json({ error, message, requestId }, { status });
}

// POST /api/library/files/init-upload
// Body: { standardId, fileName, mimeType, fileSize }
// Response: { uploadUrl, mimeType }
export async function POST(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);
  try {
    const user = await getAuthUser('library');
    if (!user) return errorResponse(401, 'unauthorized', 'Please sign in first.', requestId);
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const body = (await request.json()) as {
      standardId?: string;
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
    };

    const standardId = typeof body.standardId === 'string' ? body.standardId.trim() : '';
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0;

    if (!standardId) return errorResponse(400, 'missing_standard', 'Missing standardId.', requestId);
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

    const ext = fileName.toLowerCase().split('.').pop() ?? '';
    if (!RESUMABLE_ALLOWED_EXTS.has(ext)) {
      return errorResponse(
        400,
        'unsupported_file_type',
        'Only PDF / DOCX / รูปภาพ รองรับการอัปโหลดขนาดใหญ่ (Excel ให้ใช้ช่องทางเดิม).',
        requestId,
      );
    }

    const admin = await createServiceRoleClient();
    const { data: standard, error: stdError } = await admin
      .from('standards')
      .select('id, is_link')
      .eq('id', standardId)
      .single();
    if (stdError) throw stdError;
    if (!standard) return errorResponse(404, 'standard_not_found', 'ไม่พบเอกสารในระบบ', requestId);
    if (standard.is_link) {
      return errorResponse(
        400,
        'standard_is_link',
        'เอกสารนี้เป็นลิงก์ภายนอก ไม่สามารถอัปโหลดไฟล์ทับได้',
        requestId,
      );
    }

    const mimeType = typeof body.mimeType === 'string' && body.mimeType
      ? body.mimeType
      : 'application/octet-stream';

    const headerOrigin = request.headers.get('origin');
    const origin = headerOrigin && headerOrigin !== 'null' ? headerOrigin : new URL(request.url).origin;

    const { uploadUrl } = await createResumableSession(
      LIBRARY_UPLOAD_FOLDER_ID,
      fileName,
      mimeType,
      fileSize,
      origin,
    );

    logEvent('info', 'library_upload_init', requestId, 'Resumable session created', {
      standardId,
      fileName,
      fileSize,
      ext,
    });

    return NextResponse.json({ ok: true, requestId, uploadUrl, mimeType });
  } catch (err) {
    logEvent('error', 'library_upload_init', requestId, 'Failed to create resumable session', {
      error: err instanceof Error ? err.message : String(err),
    });
    return handleAuthError(err, { scope: 'library.files.init-upload', requestId });
  }
}
