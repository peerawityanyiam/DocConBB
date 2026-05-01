import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getScanForUser } from '@/lib/scans/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    if (orderedPageIds.length === 0 || !orderedPageIds.every((id) => typeof id === 'string' && UUID_RE.test(id))) {
      return NextResponse.json({ error: 'orderedPageIds_required' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();
    await getScanForUser(admin, scanId, user);

    const { error } = await admin.rpc('reorder_scan_pages', {
      p_scan_id: scanId,
      p_ordered_ids: orderedPageIds,
    });
    if (error?.message?.includes('invalid_page_order')) {
      return NextResponse.json({ error: 'invalid_page_order' }, { status: 400 });
    }
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.pages.reorder' });
  }
}
