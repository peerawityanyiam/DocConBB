import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { downloadFileBytes } from '@/lib/google-drive/files';
import { getScanForUser } from '@/lib/scans/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ scanId: string; fileId: string }> },
) {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { scanId, fileId } = await params;
    const admin = await createServiceRoleClient();
    const scan = await getScanForUser(admin, scanId, user);

    let allowed = scan.latest_pdf_file_id === fileId;
    if (!allowed) {
      const { data: page } = await admin
        .from('scan_pages')
        .select('id')
        .eq('scan_id', scanId)
        .or(`original_drive_file_id.eq.${fileId},processed_drive_file_id.eq.${fileId}`)
        .maybeSingle();
      allowed = Boolean(page);
    }
    if (!allowed) return NextResponse.json({ error: 'file_not_found' }, { status: 404 });

    const file = await downloadFileBytes(fileId);
    const body = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer;

    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': file.mimeType,
        'content-disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
        'cache-control': 'private, max-age=300',
      },
    });
  } catch (err) {
    return handleAuthError(err, { scope: 'scans.files.get' });
  }
}
