import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { createResumableSession } from '@/lib/google-drive/files';
import { ensureScanFolders, getScanForUser } from '@/lib/scans/server';
import {
  SCAN_MAX_IMAGE_FILE_SIZE_BYTES,
  SCAN_MAX_IMAGE_FILE_SIZE_LABEL,
  SCAN_MAX_PAGE_COUNT,
} from '@/lib/files/upload-limits';

type UploadKind = 'original' | 'processed';

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

function isSupportedImage(mimeType: string, fileName: string) {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (['heic', 'heif'].includes(ext) || /hei[cf]$/i.test(mimeType)) return false;
  return ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) || ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
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
      kind?: UploadKind;
      pageId?: string;
    };

    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const mimeType = typeof body.mimeType === 'string' && body.mimeType.trim()
      ? body.mimeType.trim()
      : 'image/jpeg';
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0;
    const kind: UploadKind = body.kind === 'processed' ? 'processed' : 'original';

    if (!fileName) return errorResponse(400, 'file_required', 'Missing fileName.');
    if (!Number.isFinite(fileSize) || fileSize <= 0) return errorResponse(400, 'invalid_size', 'Invalid file size.');
    if (fileSize > SCAN_MAX_IMAGE_FILE_SIZE_BYTES) {
      return errorResponse(400, 'file_too_large', `Each image must be ${SCAN_MAX_IMAGE_FILE_SIZE_LABEL} or smaller.`);
    }
    if (!isSupportedImage(mimeType, fileName)) {
      return errorResponse(400, 'unsupported_file_type', 'Only JPEG, PNG, and WebP images are supported. HEIC/HEIF is not supported.');
    }
    if (kind === 'processed' && !body.pageId) {
      return errorResponse(400, 'page_required', 'pageId is required for processed uploads.');
    }

    const admin = await createServiceRoleClient();
    const scan = await getScanForUser(admin, scanId, user);
    const folders = await ensureScanFolders(admin, scan);

    if (kind === 'original') {
      const { count, error: countError } = await admin
        .from('scan_pages')
        .select('id', { count: 'exact', head: true })
        .eq('scan_id', scanId);
      if (countError) throw countError;
      if ((count ?? 0) >= SCAN_MAX_PAGE_COUNT) {
        return errorResponse(400, 'page_limit_reached', `A scan can contain up to ${SCAN_MAX_PAGE_COUNT} pages.`);
      }
    } else {
      const { data: page, error } = await admin
        .from('scan_pages')
        .select('id')
        .eq('id', body.pageId)
        .eq('scan_id', scanId)
        .single();
      if (error || !page) return errorResponse(404, 'page_not_found', 'Page not found.');
    }

    const headerOrigin = request.headers.get('origin');
    const origin = headerOrigin && headerOrigin !== 'null' ? headerOrigin : new URL(request.url).origin;
    const folderId = kind === 'processed' ? folders.processedFolderId : folders.originalsFolderId;
    const { uploadUrl } = await createResumableSession(folderId, fileName, mimeType, fileSize, origin);

    return NextResponse.json({
      ok: true,
      uploadUrl,
      mimeType,
      folderId,
      kind,
    });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.images.init' });
  }
}
