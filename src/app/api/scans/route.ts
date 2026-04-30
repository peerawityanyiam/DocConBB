import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleAuthError, hasGlobalRole } from '@/lib/auth/guards';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { ensureScanFolders, type ScanDocumentRow } from '@/lib/scans/server';

export const dynamic = 'force-dynamic';

const MAX_TITLE_LEN = 120;

export async function GET() {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = await createServiceRoleClient();
    const isSuperAdmin = await hasGlobalRole(user.id, ['SUPER_ADMIN']);
    let query = admin
      .from('scan_documents')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(50);
    if (!isSuperAdmin) query = query.eq('owner_id', user.id);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ scans: data ?? [] });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.list' });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { title?: string };
    const titleRaw = typeof body.title === 'string' ? body.title.trim() : '';
    const title = titleRaw.slice(0, MAX_TITLE_LEN) || `เอกสารสแกน ${new Date().toLocaleDateString('th-TH')}`;

    const admin = await createServiceRoleClient();
    const { data: created, error } = await admin
      .from('scan_documents')
      .insert({
        owner_id: user.id,
        title,
        status: 'DRAFT',
      })
      .select('*')
      .single<ScanDocumentRow>();

    if (error || !created) throw error ?? new Error('scan_create_failed');
    await ensureScanFolders(admin, created);

    const { data: scan, error: reloadError } = await admin
      .from('scan_documents')
      .select('*')
      .eq('id', created.id)
      .single<ScanDocumentRow>();
    if (reloadError || !scan) throw reloadError ?? new Error('scan_reload_failed');

    return NextResponse.json({ scan }, { status: 201 });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.create' });
  }
}
