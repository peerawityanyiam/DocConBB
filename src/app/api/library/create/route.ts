import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

// POST /api/library/create - สร้างมาตรฐานใหม่ (DOCCON only)
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const { name, url, is_link, start_date, end_date, always_open } = await request.json();
    const normalizedName = typeof name === 'string' ? name.trim() : '';

    if (!normalizedName) {
      return NextResponse.json({ error: 'กรุณากรอกชื่อเอกสาร' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();

    const { data: dbUser } = await admin
      .from('users')
      .select('id')
      .eq('email', user.email)
      .single();

    if (!dbUser) {
      return NextResponse.json({ error: 'ไม่พบข้อมูลผู้ใช้' }, { status: 404 });
    }

    // กันชื่อซ้ำ (case-insensitive) เพื่อไม่ให้หลุดไปเป็น 500
    const { data: dup, error: dupError } = await admin
      .from('standards')
      .select('id')
      .ilike('name', normalizedName)
      .maybeSingle();

    if (dupError) throw dupError;

    if (dup) {
      return NextResponse.json(
        { error: `ชื่อเอกสาร "${normalizedName}" มีอยู่แล้ว กรุณาเปลี่ยนชื่อใหม่` },
        { status: 409 }
      );
    }

    const { data, error } = await admin
      .from('standards')
      .insert({
        name: normalizedName,
        url: url?.trim() ?? '',
        is_link: is_link ?? false,
        start_date: start_date ?? null,
        end_date: end_date ?? null,
        always_open: always_open ?? false,
        created_by: dbUser.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `ชื่อเอกสาร "${normalizedName}" มีอยู่แล้ว กรุณาเปลี่ยนชื่อใหม่` },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('[library/create] failed:', err);
    const message =
      typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : null;

    if (message) {
      return NextResponse.json({ error: `สร้างรายการเอกสารไม่สำเร็จ: ${message}` }, { status: 500 });
    }

    return handleAuthError(err);
  }
}
