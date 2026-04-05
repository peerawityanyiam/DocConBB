import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError, handleAuthError } from '@/lib/auth/guards';
import { trashFile } from '@/lib/google-drive/files';

// POST /api/library/files/delete — soft-delete ไฟล์
// STAFF ลบได้เฉพาะไฟล์ตัวเอง, DOCCON ลบได้ทุกไฟล์
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { fileId, reason } = await request.json();
    if (!fileId) return NextResponse.json({ error: 'ไม่ระบุ fileId' }, { status: 400 });

    const admin = await createServiceRoleClient();

    // หา uploader id
    const { data: dbUser } = await admin
      .from('users')
      .select('id')
      .eq('email', user.email)
      .single();

    if (!dbUser) return NextResponse.json({ error: 'ไม่พบข้อมูลผู้ใช้' }, { status: 404 });

    // ดึงข้อมูลไฟล์
    const { data: fileRecord } = await admin
      .from('uploaded_files')
      .select('id, uploader_id, drive_file_id, drive_file_name, is_deleted')
      .eq('id', fileId)
      .single();

    if (!fileRecord) return NextResponse.json({ error: 'ไม่พบไฟล์' }, { status: 404 });
    if (fileRecord.is_deleted) return NextResponse.json({ error: 'ไฟล์ถูกลบไปแล้ว' }, { status: 400 });

    const isDoccon = user.roles.includes('DOCCON') || user.roles.includes('SUPER_ADMIN');
    const isOwner = fileRecord.uploader_id === dbUser.id;

    if (!isDoccon && !isOwner) {
      throw new AuthError('ไม่มีสิทธิ์ลบไฟล์นี้', 403);
    }

    // Trash ใน Google Drive
    if (fileRecord.drive_file_id) {
      try {
        await trashFile(fileRecord.drive_file_id);
      } catch {
        console.error('Failed to trash drive file:', fileRecord.drive_file_id);
      }
    }

    const now = new Date().toISOString();

    // Soft-delete ใน DB
    await admin
      .from('uploaded_files')
      .update({
        is_deleted: true,
        is_current: false,
        deleted_by: dbUser.id,
        deleted_at: now,
      })
      .eq('id', fileId);

    // บันทึก deletion log
    await admin.from('deletion_log').insert({
      deleted_by: dbUser.id,
      doc_name: fileRecord.drive_file_name,
      drive_file_id: fileRecord.drive_file_id ?? null,
      reason: reason ?? 'ลบไฟล์',
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err);
  }
}
