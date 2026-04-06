import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

// GET /api/tasks/staff-list — รายชื่อ users สำหรับสร้างงาน (BOSS only)
export async function GET() {
  try {
    const user = await getAuthUser('tracking');
    requireRole(user, ['BOSS', 'SUPER_BOSS', 'SUPER_ADMIN']);

    const admin = await createServiceRoleClient();

    const { data: users, error } = await admin
      .from('users')
      .select('id, email, display_name, is_active')
      .eq('is_active', true)
      .order('display_name');

    if (error) throw error;

    // ดึง roles ใน project tracking
    const { data: roles } = await admin
      .from('user_project_roles')
      .select('user_id, role, projects!inner(slug)')
      .eq('projects.slug', 'tracking');

    const roleMap = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const existing = roleMap.get(r.user_id) ?? [];
      existing.push(r.role);
      roleMap.set(r.user_id, existing);
    }

    const result = (users ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      roles: roleMap.get(u.id) ?? [],
    }));

    return NextResponse.json(result);
  } catch (err) {
    return handleAuthError(err);
  }
}
