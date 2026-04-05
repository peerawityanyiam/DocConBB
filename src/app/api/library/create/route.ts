import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

// POST /api/library/create — สร้าง standard ใหม่ (DOCCON only)
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const { name, url, is_link, start_date, end_date, always_open } = await request.json();

    if (!name?.trim()) {
      return NextResponse.json({ error: 'กรุณากรอกชื่อเอกสาร' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();

    // หา created_by
    const { data: dbUser } = await admin
      .from('users')
      .select('id')
      .eq('email', user.email)
      .single();

    if (!dbUser) return NextResponse.json({ error: 'ไม่พบข้อมูลผู้ใช้' }, { status: 404 });

    const { data, error } = await admin
      .from('standards')
      .insert({
        name: name.trim(),
        url: url?.trim() ?? '',
        is_link: is_link ?? false,
        start_date: start_date ?? null,
        end_date: end_date ?? null,
        always_open: always_open ?? false,
        created_by: dbUser.id,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return handleAuthError(err);
  }
}
