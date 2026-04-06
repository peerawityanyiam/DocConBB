import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';

// GET /api/library — ดึง standards (hidden เฉพาะ DOCCON/SUPER_ADMIN เห็น)
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isDoccon = user.roles.includes('DOCCON') || user.roles.includes('SUPER_ADMIN');
    const admin = await createServiceRoleClient();
    const sort = req.nextUrl.searchParams.get('sort') || 'default';

    let query = admin.from('standards').select('*');

    switch (sort) {
      case 'name_asc':
        query = query.order('name', { ascending: true });
        break;
      case 'name_desc':
        query = query.order('name', { ascending: false });
        break;
      case 'status':
        // open first (always_open=true or end_date in future), then closed
        query = query
          .order('always_open', { ascending: false })
          .order('end_date', { ascending: false, nullsFirst: true })
          .order('name', { ascending: true });
        break;
      case 'close_date':
        query = query
          .order('end_date', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true });
        break;
      default:
        // default: pinned first, then sort_order, then name
        query = query
          .order('pinned', { ascending: false })
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        break;
    }

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
