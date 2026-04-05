import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

// GET /api/users/[userId]/roles — ดู roles ของผู้ใช้
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    requireRole(user, ['SUPER_ADMIN']);

    const { userId } = await params;
    const admin = await createServiceRoleClient();

    const { data, error } = await admin
      .from('user_project_roles')
      .select('id, role, project_id, projects(slug, name)')
      .eq('user_id', userId);

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    return handleAuthError(err);
  }
}

// POST /api/users/[userId]/roles — เพิ่ม role
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const currentUser = await getAuthUser('tracking');
    requireRole(currentUser, ['SUPER_ADMIN']);

    const { userId } = await params;
    const { project_id, role } = await request.json() as { project_id: string; role: string };

    if (!project_id || !role) {
      return NextResponse.json({ error: 'กรุณาระบุ project_id และ role' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();

    // หา id ของ assigner
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { data: assigner } = await admin
      .from('users')
      .select('id')
      .eq('email', user!.email!)
      .single();

    const { data, error } = await admin
      .from('user_project_roles')
      .insert({
        user_id: userId,
        project_id,
        role,
        assigned_by: assigner?.id ?? null,
      })
      .select('id, role, project_id, projects(slug, name)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'มีสิทธิ์นี้อยู่แล้ว' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return handleAuthError(err);
  }
}

// DELETE /api/users/[userId]/roles — ลบ role
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const currentUser = await getAuthUser('tracking');
    requireRole(currentUser, ['SUPER_ADMIN']);

    const { userId } = await params;
    const { project_id, role } = await request.json() as { project_id: string; role: string };

    const admin = await createServiceRoleClient();
    const { error } = await admin
      .from('user_project_roles')
      .delete()
      .eq('user_id', userId)
      .eq('project_id', project_id)
      .eq('role', role);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err);
  }
}
