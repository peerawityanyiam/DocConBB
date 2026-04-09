import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/guards';
import TrackingDashboard from './components/TrackingDashboard';

export const dynamic = 'force-dynamic';

export default async function TrackingPage() {
  const user = await getAuthUser('tracking');
  if (!user) redirect('/login');

  return (
    <TrackingDashboard
      userRoles={user.roles}
      userId={user.id}
      userEmail={user.email}
    />
  );
}
