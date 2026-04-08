import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError, requireRole } from '@/lib/auth/guards';
import { trashFile } from '@/lib/google-drive/files';

// POST /api/library/files/clear
// ลบไฟล์หลักของ standard (ย้ายไฟล์เดิมไปถังขยะ และเคลียร์ drive_file_id/url)
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const { standardId } = await request.json();
    if (!standardId) {
      return NextResponse.json({ error: 'ไม่พบ standardId' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();
    const { data: standard, error: stdErr } = await admin
      .from('standards')
      .select('id, drive_file_id')
      .eq('id', standardId)
      .single();

    if (stdErr) throw stdErr;
    if (!standard) {
      return NextResponse.json({ error: 'ไม่พบเอกสารในระบบ' }, { status: 404 });
    }

    if (standard.drive_file_id) {
      try {
        await trashFile(standard.drive_file_id);
      } catch {
        console.warn('[library/files/clear] could not trash file:', standard.drive_file_id);
      }
    }

    const { error: updateErr } = await admin
      .from('standards')
      .update({
        drive_file_id: null,
        url: '',
        is_link: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', standardId);

    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err);
  }
}

