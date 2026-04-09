import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

// GET /api/users — รายชื่อผู้ใช้ทั้งหมด พร้อม roles
export async function GET() {
  try {
    const user = await getAuthUser('tracking');
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const admin = await createServiceRoleClient();

    const [{ data: users, error: usersErr }, { data: roles, error: rolesErr }] =
      await Promise.all([
        admin.from('users').select('*').order('display_name'),
        admin
          .from('user_project_roles')
          .select('user_id, role, project_id, projects!inner(slug, name)')
          .eq('projects.slug', 'tracking'),
      ]);

    if (usersErr) throw usersErr;
    if (rolesErr) throw rolesErr;

    const merged = (users ?? []).map((u) => ({
      ...u,
      roles: (roles ?? [])
        .filter((r) => r.user_id === u.id)
        .map((r) => ({
          role: r.role,
          project_id: r.project_id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          project_slug: (r.projects as any)?.slug ?? '',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          project_name: (r.projects as any)?.name ?? '',
        })),
    }));

    return NextResponse.json(merged);
  } catch (err) {
    return handleAuthError(err);
  }
}

// POST /api/users — เพิ่มผู้ใช้ใหม่
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('tracking');
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const body = await request.json();
    const { email, display_name } = body as { email: string; display_name: string };

    if (!email || !display_name) {
      return NextResponse.json({ error: 'กรุณากรอกข้อมูลให้ครบ' }, { status: 400 });
    }

    const domain = process.env.ALLOWED_DOMAIN ?? 'medicine.psu.ac.th';
    if (!email.endsWith(`@${domain}`)) {
      return NextResponse.json(
        { error: `อีเมลต้องเป็น @${domain} เท่านั้น` },
        { status: 400 }
      );
    }

    const admin = await createServiceRoleClient();

    const { data, error } = await admin
      .from('users')
      .insert({ email: email.toLowerCase().trim(), display_name: display_name.trim() })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'อีเมลนี้มีในระบบแล้ว' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ ...data, roles: [] }, { status: 201 });
  } catch (err) {
    return handleAuthError(err);
  }
}
