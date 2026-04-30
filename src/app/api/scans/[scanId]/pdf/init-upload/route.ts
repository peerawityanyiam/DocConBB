import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { createResumableSession } from '@/lib/google-drive/files';
import { ensureScanFolders, getScanForUser } from '@/lib/scans/server';
import {
  MAX_RESUMABLE_UPLOAD_FILE_SIZE_BYTES,
  MAX_RESUMABLE_UPLOAD_FILE_SIZE_LABEL,
} from '@/lib/files/upload-limits';

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  try {
    const user = await getAuthUser('hub');
    if (!user) return errorResponse(401, 'unauthorized', 'Please sign in first.');

    const { scanId } = await params;
    const body = (await request.json()) as {
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
    };
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0;
    if (!fileName) return errorResponse(400, 'file_required', 'Missing fileName.');
    if (!fileName.toLowerCase().endsWith('.pdf')) return errorResponse(400, 'unsupported_file_type', 'Only PDF output is supported.');
    if (!Number.isFinite(fileSize) || fileSize <= 0) return errorResponse(400, 'invalid_size', 'Invalid file size.');
    if (fileSize > MAX_RESUMABLE_UPLOAD_FILE_SIZE_BYTES) {
      return errorResponse(400, 'file_too_large', `PDF exceeds ${MAX_RESUMABLE_UPLOAD_FILE_SIZE_LABEL}.`);
    }

    const admin = await createServiceRoleClient();
    const scan = await getScanForUser(admin, scanId, user);
    const folders = await ensureScanFolders(admin, scan);

    const headerOrigin = request.headers.get('origin');
    const origin = headerOrigin && headerOrigin !== 'null' ? headerOrigin : new URL(request.url).origin;
    const { uploadUrl } = await createResumableSession(
      folders.pdfFolderId,
      fileName,
      'application/pdf',
      fileSize,
      origin,
    );

    return NextResponse.json({
      ok: true,
      uploadUrl,
      mimeType: 'application/pdf',
      folderId: folders.pdfFolderId,
    });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.pdf.init' });
  }
}
