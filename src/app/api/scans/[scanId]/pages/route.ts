import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getScanForUser } from '@/lib/scans/server';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { scanId } = await params;
    const body = (await request.json()) as { orderedPageIds?: string[] };
    const orderedPageIds = Array.isArray(body.orderedPageIds) ? body.orderedPageIds : [];
    if (orderedPageIds.length === 0) {
      return NextResponse.json({ error: 'orderedPageIds_required' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();
    await getScanForUser(admin, scanId, user);

    const { data: existing, error: existingError } = await admin
      .from('scan_pages')
      .select('id')
      .eq('scan_id', scanId);
    if (existingError) throw existingError;

    const existingIds = new Set((existing ?? []).map((row) => row.id));
    if (orderedPageIds.length !== existingIds.size || orderedPageIds.some((id) => !existingIds.has(id))) {
      return NextResponse.json({ error: 'invalid_page_order' }, { status: 400 });
    }

    await Promise.all(
      orderedPageIds.map((id, pageIndex) => (
        admin.from('scan_pages').update({ page_index: pageIndex }).eq('id', id).eq('scan_id', scanId)
      )),
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.pages.reorder' });
  }
}
