import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { trashFile } from '@/lib/google-drive/files';
import { getScanForUser, type ScanPageRow } from '@/lib/scans/server';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string; pageId: string }> },
) {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { scanId, pageId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      adjustments?: Record<string, unknown>;
    };
    const admin = await createServiceRoleClient();
    await getScanForUser(admin, scanId, user);

    const { data, error } = await admin
      .from('scan_pages')
      .update({
        adjustments: body.adjustments ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', pageId)
      .eq('scan_id', scanId)
      .select('*')
      .single<ScanPageRow>();
    if (error || !data) throw error ?? new Error('page_update_failed');
    return NextResponse.json({ page: data });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.pages.update' });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ scanId: string; pageId: string }> },
) {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { scanId, pageId } = await params;
    const admin = await createServiceRoleClient();
    await getScanForUser(admin, scanId, user);

    const { data: page, error: pageError } = await admin
      .from('scan_pages')
      .select('*')
      .eq('id', pageId)
      .eq('scan_id', scanId)
      .single<ScanPageRow>();
    if (pageError || !page) return NextResponse.json({ error: 'page_not_found' }, { status: 404 });

    const { error } = await admin.from('scan_pages').delete().eq('id', pageId).eq('scan_id', scanId);
    if (error) throw error;

    const { data: remaining } = await admin
      .from('scan_pages')
      .select('id')
      .eq('scan_id', scanId)
      .order('page_index', { ascending: true });
    await Promise.all(
      (remaining ?? []).map((row, pageIndex) => (
        admin.from('scan_pages').update({ page_index: pageIndex }).eq('id', row.id)
      )),
    );
    await admin
      .from('scan_documents')
      .update({
        page_count: remaining?.length ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', scanId);

    for (const fileId of [page.original_drive_file_id, page.processed_drive_file_id]) {
      if (!fileId) continue;
      try {
        await trashFile(fileId);
      } catch {
        // best effort
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.pages.delete' });
  }
}
