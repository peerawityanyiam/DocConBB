import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/guards';
import { buildDocumentControlUrl } from '@/lib/google-apps-script/document-control';

export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  const user = await getAuthUser('hub');
  if (!user) redirect('/login');

  redirect(buildDocumentControlUrl(user.email));
}
