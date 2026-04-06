import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const { id, new_name } = await request.json();
    if (!id || !new_name?.trim()) {
      return NextResponse.json({ error: 'กรุณาระบุชื่อใหม่' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();

    // ตรวจชื่อซ้ำ
    const { data: dup } = await admin
      .from('standards')
      .select('id')
      .ilike('name', new_name.trim())
      .neq('id', id)
      .limit(1);

    if (dup && dup.length > 0) {
      return NextResponse.json({ error: `ชื่อ '${new_name.trim()}' มีอยู่ในระบบแล้ว` }, { status: 409 });
    }

    // Rename in Drive if has file
    const { data: standard } = await admin
      .from('standards')
      .select('drive_file_id, name')
      .eq('id', id)
      .single();

    if (standard?.drive_file_id) {
      try {
        const { getDriveClient } = await import('@/lib/google-drive/client');
        const drive = getDriveClient();
        await drive.files.update({
          fileId: standard.drive_file_id,
          requestBody: { name: new_name.trim() },
        });
      } catch (e) {
        console.error('Drive rename failed:', e);
      }
    }

    const { error } = await admin
      .from('standards')
      .update({ name: new_name.trim() })
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err);
  }
}
