import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/guards';
import ScanWorkspace from './ScanWorkspace';

export const dynamic = 'force-dynamic';

export default async function ScanPage() {
  const user = await getAuthUser('hub');
  if (!user) redirect('/login');
  return <ScanWorkspace userEmail={user.email} />;
}
