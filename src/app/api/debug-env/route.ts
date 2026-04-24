import { NextResponse } from 'next/server';
import { getAuthUser, handleAuthError, hasGlobalRole } from '@/lib/auth/guards';

// Temporary debug endpoint; disabled in production and restricted in development.
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isSuperAdmin = await hasGlobalRole(user.id, ['SUPER_ADMIN']);
    if (!isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const uploadId = process.env.GOOGLE_UPLOAD_FOLDER_ID ?? '(not set)';
    const sharedId = process.env.GOOGLE_SHARED_FOLDER_ID ?? '(not set)';

    function mask(val: string) {
      if (val === '(not set)') return val;
      if (val.length <= 6) return val;
      return val.slice(0, 4) + '...' + val.slice(-4);
    }

    return NextResponse.json({
      GOOGLE_UPLOAD_FOLDER_ID: mask(uploadId),
      GOOGLE_SHARED_FOLDER_ID: mask(sharedId),
      effective_upload_folder: mask(uploadId !== '(not set)' ? uploadId : sharedId),
      expected_upload: '1fww...tsy',
      expected_shared: '10It...w1i',
      match_upload: uploadId === '1fww8pK-uOH-uuup0Jjv70TUbjG-QUtsy',
      match_shared: sharedId === '10Ithv7g75Sd0he6IuVP6Nwk0IIVCFw1i',
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
