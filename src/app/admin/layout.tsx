import { redirect } from 'next/navigation';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import Navbar from '@/components/Navbar';

export const metadata = { title: 'จัดการผู้ใช้ - ระบบติดตามเอกสาร' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) redirect('/login');

  // ใช้ service role เพื่อ bypass RLS
  const admin = await createServiceRoleClient();

  const { data: dbUser } = await admin
    .from('users')
    .select('id')
    .eq('email', user.email)
    .single();

  if (!dbUser) redirect('/tracking');

  // ตรวจสอบ SUPER_ADMIN ใน project ใดก็ได้
  const { data: adminRole } = await admin
    .from('user_project_roles')
    .select('id, projects!inner(slug)')
    .eq('user_id', dbUser.id)
    .eq('projects.slug', 'tracking')
    .in('role', ['DOCCON', 'SUPER_ADMIN'])
    .limit(1);

  if (!adminRole?.length) redirect('/tracking');

  return (
    <>
      <Navbar />
      <main className="flex-1 bg-slate-50 min-h-screen">{children}</main>
    </>
  );
}

