import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { verifyUploadedFile } from '@/lib/google-drive/files';
import {
  ensureScanFolders,
  getScanForUser,
  type ScanPageRow,
} from '@/lib/scans/server';
import { SCAN_MAX_PAGE_COUNT } from '@/lib/files/upload-limits';

type UploadKind = 'original' | 'processed';

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
    if (!meta.mimeType.startsWith('image/')) {
      return errorResponse(400, 'unsupported_file_type', 'Uploaded file is not an image.');
    }

    if (kind === 'processed') {
      const pageId = typeof body.pageId === 'string' ? body.pageId.trim() : '';
      if (!pageId) return errorResponse(400, 'page_required', 'pageId is required.');

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
      return NextResponse.json({ ok: true, page });
    }

    const { count } = await admin
      .from('scan_pages')
      .select('id', { count: 'exact', head: true })
      .eq('scan_id', scanId);
    if ((count ?? 0) >= SCAN_MAX_PAGE_COUNT) {
      return errorResponse(400, 'page_limit_reached', `A scan can contain up to ${SCAN_MAX_PAGE_COUNT} pages.`);
    }
    const pageIndex = count ?? 0;
    const { data: page, error } = await admin
      .from('scan_pages')
      .insert({
        scan_id: scanId,
        owner_id: scan.owner_id,
        page_index: pageIndex,
        original_drive_file_id: driveFileId,
        original_drive_file_name: meta.name,
        original_mime_type: meta.mimeType,
        original_size_bytes: meta.size,
        adjustments: {},
      })
      .select('*')
      .single<ScanPageRow>();

    if (error || !page) throw error ?? new Error('scan_page_insert_failed');
    await admin
      .from('scan_documents')
      .update({
        status: 'DRAFT',
        page_count: pageIndex + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', scanId);

    return NextResponse.json({ ok: true, page }, { status: 201 });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.images.finalize' });
  }
}
