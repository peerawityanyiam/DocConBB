import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/guards';
import { buildDocumentControlUrl } from '@/lib/google-apps-script/document-control';

export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  // Guests are allowed: the GAS enforces its own Google Workspace login.
  const user = await getAuthUser('hub');
  redirect(buildDocumentControlUrl(user?.email));
}
