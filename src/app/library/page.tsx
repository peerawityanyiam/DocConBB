import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/guards';
import LibraryDashboard from './components/LibraryDashboard';

export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  const user = await getAuthUser('library');
  if (!user) redirect('/login');

  return (
    <LibraryDashboard
      userRoles={user.roles}
      userEmail={user.email}
    />
  );
}
