import { redirect } from 'next/navigation';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/auth/guards';
import TaskDetailPage from './TaskDetailPage';

export const dynamic = 'force-dynamic';

export default async function TrackingTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const user = await getAuthUser('tracking');
  if (!user) redirect('/login');

  const { taskId } = await params;
  const admin = await createServiceRoleClient();

  const { data: dbUser } = await admin
    .from('users')
    .select('id')
    .eq('email', user.email)
    .single();

  if (!dbUser) redirect('/login');

  return (
    <TaskDetailPage
      taskId={taskId}
      userRoles={user.roles}
      userId={dbUser.id}
    />
  );
}
