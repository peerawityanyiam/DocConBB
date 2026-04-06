import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const { name, url } = await request.json();
    if (!name?.trim()) return NextResponse.json({ error: 'กรุณาระบุชื่อลิงก์' }, { status: 400 });
    if (!url?.trim()) return NextResponse.json({ error: 'กรุณาระบุ URL' }, { status: 400 });
    if (!/^https?:\/\//i.test(url.trim())) {
      return NextResponse.json({ error: 'URL ต้องขึ้นต้นด้วย http:// หรือ https://' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();

    // ตรวจชื่อซ้ำ
    const { data: dup } = await admin
      .from('standards')
      .select('id')
      .ilike('name', name.trim())
      .limit(1);

    if (dup && dup.length > 0) {
      return NextResponse.json({ error: `ชื่อ '${name.trim()}' มีอยู่ในระบบแล้ว` }, { status: 409 });
    }

    // หา user id
    const { data: dbUser } = await admin
      .from('users')
      .select('id')
      .eq('email', user!.email)
      .single();

    const { data, error } = await admin
      .from('standards')
      .insert({
        name: name.trim(),
        url: url.trim(),
        is_link: true,
        created_by: dbUser?.id,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return handleAuthError(err);
  }
}
