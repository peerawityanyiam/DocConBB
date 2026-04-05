import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';
import { trashFile } from '@/lib/google-drive/files';

// POST /api/library/delete — ลบ standard + trash drive file (DOCCON only)
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'ไม่ระบุ id' }, { status: 400 });

    const admin = await createServiceRoleClient();

    // ดึง standard เพื่อ trash drive file
    const { data: standard } = await admin
      .from('standards')
      .select('drive_file_id, name')
      .eq('id', id)
      .single();

    if (!standard) return NextResponse.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });

    // Trash drive file ถ้ามี
    if (standard.drive_file_id) {
      try {
        await trashFile(standard.drive_file_id);
      } catch {
        // ไม่หยุดถ้า drive error
        console.error('Failed to trash drive file:', standard.drive_file_id);
      }
    }

    // บันทึก deletion log
    const { data: dbUser } = await admin
      .from('users')
      .select('id')
      .eq('email', user.email)
      .single();

    if (dbUser) {
      await admin.from('deletion_log').insert({
        deleted_by: dbUser.id,
        doc_name: standard.name,
        drive_file_id: standard.drive_file_id ?? null,
        reason: 'ลบจาก Admin Panel',
      });
    }

    const { error } = await admin.from('standards').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err);
  }
}
