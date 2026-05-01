import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { trashFile, verifyUploadedFile } from '@/lib/google-drive/files';
import {
  ensureScanFolders,
  getScanForUser,
  type ScanPageRow,
} from '@/lib/scans/server';

type UploadKind = 'original' | 'processed';

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

function isSupportedUploadedImage(mimeType: string, name: string) {
  const ext = name.toLowerCase().split('.').pop() ?? '';
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
      driveFileId?: string;
      kind?: UploadKind;
      pageId?: string;
      adjustments?: Record<string, unknown>;
    };

    const driveFileId = typeof body.driveFileId === 'string' ? body.driveFileId.trim() : '';
    const kind: UploadKind = body.kind === 'processed' ? 'processed' : 'original';
    if (!driveFileId) return errorResponse(400, 'missing_drive_file_id', 'driveFileId is required.');

    const admin = await createServiceRoleClient();
    const scan = await getScanForUser(admin, scanId, user);
    const folders = await ensureScanFolders(admin, scan);
    const expectedFolder = kind === 'processed' ? folders.processedFolderId : folders.originalsFolderId;
    const meta = await verifyUploadedFile(driveFileId, expectedFolder);
    if (!isSupportedUploadedImage(meta.mimeType, meta.name)) {
      return errorResponse(400, 'unsupported_file_type', 'Only JPEG, PNG, and WebP images are supported. HEIC/HEIF is not supported.');
    }

    if (kind === 'processed') {
      const pageId = typeof body.pageId === 'string' ? body.pageId.trim() : '';
      if (!pageId) return errorResponse(400, 'page_required', 'pageId is required.');

      const { data: currentPage, error: currentPageError } = await admin
        .from('scan_pages')
        .select('processed_drive_file_id')
        .eq('id', pageId)
        .eq('scan_id', scanId)
        .single<{ processed_drive_file_id: string | null }>();
      if (currentPageError || !currentPage) {
        return errorResponse(404, 'page_not_found', 'Page not found.');
      }
      const oldProcessedFileId = currentPage.processed_drive_file_id;

      const { data: page, error } = await admin
        .from('scan_pages')
        .update({
          processed_drive_file_id: driveFileId,
          processed_drive_file_name: meta.name,
          processed_mime_type: meta.mimeType,
          processed_size_bytes: meta.size,
          adjustments: body.adjustments ?? {},
          updated_at: new Date().toISOString(),
        })
        .eq('id', pageId)
        .eq('scan_id', scanId)
        .select('*')
        .single<ScanPageRow>();

      if (error || !page) throw error ?? new Error('processed_page_update_failed');
      if (oldProcessedFileId && oldProcessedFileId !== driveFileId) {
        try {
          await trashFile(oldProcessedFileId);
        } catch {
          // best-effort cleanup only
        }
      }
      return NextResponse.json({ ok: true, page });
    }

    const { data: page, error } = await admin
      .rpc('append_scan_page', {
        p_scan_id: scanId,
        p_owner_id: scan.owner_id,
        p_original_drive_file_id: driveFileId,
        p_original_drive_file_name: meta.name,
        p_original_mime_type: meta.mimeType,
        p_original_size_bytes: meta.size,
      })
      .single<ScanPageRow>();

    if (error || !page) throw error ?? new Error('scan_page_insert_failed');

    return NextResponse.json({ ok: true, page }, { status: 201 });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.images.finalize' });
  }
}
