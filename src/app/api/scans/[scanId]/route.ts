import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  getScanForUser,
  toScanDocumentPayload,
  type ScanPageRow,
} from '@/lib/scans/server';
import { trashFile } from '@/lib/google-drive/files';

export const dynamic = 'force-dynamic';

const MAX_TITLE_LEN = 120;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { scanId } = await params;
    const admin = await createServiceRoleClient();
    const scan = await getScanForUser(admin, scanId, user);
    const { data: pages, error } = await admin
      .from('scan_pages')
      .select('*')
      .eq('scan_id', scanId)
      .order('page_index', { ascending: true })
      .returns<ScanPageRow[]>();
    if (error) throw error;

    return NextResponse.json({ scan: toScanDocumentPayload(scan, pages ?? []) });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.get' });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { scanId } = await params;
    const admin = await createServiceRoleClient();
    await getScanForUser(admin, scanId, user);

    const body = (await request.json().catch(() => ({}))) as { title?: string };
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE_LEN) : '';
    if (!title) return NextResponse.json({ error: 'title_required' }, { status: 400 });

    const { data, error } = await admin
      .from('scan_documents')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', scanId)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ scan: data });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.update' });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { scanId } = await params;
    const admin = await createServiceRoleClient();
    const scan = await getScanForUser(admin, scanId, user);

    const { data: pages } = await admin
      .from('scan_pages')
      .select('original_drive_file_id, processed_drive_file_id')
      .eq('scan_id', scanId);

    const { error } = await admin.from('scan_documents').delete().eq('id', scanId);
    if (error) throw error;

    const driveIds = new Set<string>();
    for (const page of pages ?? []) {
      if (page.original_drive_file_id) driveIds.add(page.original_drive_file_id);
      if (page.processed_drive_file_id) driveIds.add(page.processed_drive_file_id);
    }
    if (scan.latest_pdf_file_id) driveIds.add(scan.latest_pdf_file_id);
    if (scan.scan_folder_id) driveIds.add(scan.scan_folder_id);

    for (const fileId of driveIds) {
      try {
        await trashFile(fileId);
      } catch {
        // best-effort cleanup only
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.delete' });
  }
}
