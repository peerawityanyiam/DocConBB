import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { trashFile, verifyUploadedFile } from '@/lib/google-drive/files';
import { ensureScanFolders, getScanForUser } from '@/lib/scans/server';

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
    const body = (await request.json()) as { driveFileId?: string };
    const driveFileId = typeof body.driveFileId === 'string' ? body.driveFileId.trim() : '';
    if (!driveFileId) return errorResponse(400, 'missing_drive_file_id', 'driveFileId is required.');

    const admin = await createServiceRoleClient();
    const scan = await getScanForUser(admin, scanId, user);
    const folders = await ensureScanFolders(admin, scan);
    const meta = await verifyUploadedFile(driveFileId, folders.pdfFolderId);
    if (meta.mimeType !== 'application/pdf' && !meta.name.toLowerCase().endsWith('.pdf')) {
      return errorResponse(400, 'unsupported_file_type', 'Uploaded file is not a PDF.');
    }

    const viewUrl = `/api/scans/${scanId}/files/${driveFileId}`;
    const oldPdfId = scan.latest_pdf_file_id;

    const { data, error } = await admin
      .from('scan_documents')
      .update({
        status: 'PDF_READY',
        latest_pdf_file_id: driveFileId,
        latest_pdf_file_name: meta.name,
        latest_pdf_view_url: viewUrl,
        latest_pdf_size_bytes: meta.size,
        latest_pdf_uploaded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', scanId)
      .select('*')
      .single();
    if (error) throw error;

    if (oldPdfId && oldPdfId !== driveFileId) {
      try {
        await trashFile(oldPdfId);
      } catch {
        // best-effort cleanup
      }
    }

    return NextResponse.json({
      ok: true,
      scan: data,
      driveFileId,
      driveFileName: meta.name,
      viewUrl,
    });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.pdf.finalize' });
  }
}
