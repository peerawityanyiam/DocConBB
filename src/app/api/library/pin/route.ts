import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

// POST /api/library/pin — toggle pin (DOCCON only)
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const { id, pinned } = await request.json();
    if (!id) return NextResponse.json({ error: 'ไม่ระบุ id' }, { status: 400 });

    const admin = await createServiceRoleClient();
    const { data, error } = await admin
      .from('standards')
      .update({ pinned: !!pinned, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, pinned')
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    return handleAuthError(err);
  }
}
