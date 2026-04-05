import { createServiceRoleClient, createServerSupabaseClient } from '@/lib/supabase/server';
import UserManagement from './components/UserManagement';
import type { UserRole, UserRow, Project } from './components/UserManagement';

export default async function AdminPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  const admin = await createServiceRoleClient();

  // หา current user id
  const { data: currentUser } = await admin
    .from('users')
    .select('id')
    .eq('email', user!.email!)
    .single();

  // ดึงข้อมูลทั้งหมดพร้อมกัน
  const [{ data: users }, { data: roles }, { data: projects }] = await Promise.all([
    admin.from('users').select('*').order('display_name'),
    admin.from('user_project_roles').select('user_id, role, project_id, projects(slug, name)'),
    admin.from('projects').select('id, name, slug').eq('is_active', true).order('name'),
  ]);

  // รวม roles เข้ากับ users
  const usersWithRoles: UserRow[] = (users ?? []).map(u => ({
    ...u,
    roles: (roles ?? [])
      .filter(r => r.user_id === u.id)
      .map(r => ({
        role: r.role,
        project_id: r.project_id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        project_slug: (r.projects as any)?.slug ?? '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        project_name: (r.projects as any)?.name ?? '',
      })) as UserRole[],
  }));

  return (
    <UserManagement
      initialUsers={usersWithRoles}
      projects={(projects ?? []) as Project[]}
      currentUserId={currentUser?.id ?? ''}
    />
  );
}
