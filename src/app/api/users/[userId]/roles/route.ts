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
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const { userId } = await params;
    const admin = await createServiceRoleClient();

    const { data, error } = await admin
      .from('user_project_roles')
      .select('id, role, project_id, projects!inner(slug, name)')
      .eq('user_id', userId)
      .eq('projects.slug', 'tracking');

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
    requireRole(currentUser, ['DOCCON', 'SUPER_ADMIN']);

    const { userId } = await params;
    const { project_id, role } = await request.json() as { project_id: string; role: string };

    if (!project_id || !role) {
      return NextResponse.json({ error: 'กรุณาระบุ project_id และ role' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();

    const { data: trackingProject } = await admin
      .from('projects')
      .select('id')
      .eq('slug', 'tracking')
      .single();

    if (!trackingProject || project_id !== trackingProject.id) {
      return NextResponse.json({ error: 'กำหนดสิทธิ์ได้เฉพาะระบบติดตามเอกสาร' }, { status: 400 });
    }

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
    const currentUser = requireRole(await getAuthUser('tracking'), ['DOCCON', 'SUPER_ADMIN']);

    const { userId } = await params;
    const { project_id, role } = await request.json() as { project_id: string; role: string };

    const admin = await createServiceRoleClient();

    const { data: trackingProject } = await admin
      .from('projects')
      .select('id')
      .eq('slug', 'tracking')
      .single();

    if (!trackingProject || project_id !== trackingProject.id) {
      return NextResponse.json({ error: 'จัดการสิทธิ์ได้เฉพาะระบบติดตามเอกสาร' }, { status: 400 });
    }

    if (role === 'SUPER_ADMIN') {
      if (userId === currentUser.id) {
        return NextResponse.json(
          { error: 'ไม่สามารถถอดสิทธิ์ผู้ดูแลระบบของบัญชีตัวเองได้' },
          { status: 400 },
        );
      }

      const { count, error: countError } = await admin
        .from('user_project_roles')
        .select('id', { head: true, count: 'exact' })
        .eq('project_id', trackingProject.id)
        .eq('role', 'SUPER_ADMIN');

      if (countError) throw countError;
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน' },
          { status: 400 },
        );
      }
    }

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
