import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';

// GET /api/library — ดึง standards (hidden เฉพาะ DOCCON/SUPER_ADMIN เห็น)
export async function GET(_req: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isDoccon = user.roles.includes('DOCCON') || user.roles.includes('SUPER_ADMIN');
    const admin = await createServiceRoleClient();

    let query = admin
      .from('standards')
      .select('*')
      .order('pinned', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (!isDoccon) {
      query = query.eq('hidden', false);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    return handleAuthError(err);
  }
}
