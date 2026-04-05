import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { uploadFile } from '@/lib/google-drive/files';
import { setFilePublic } from '@/lib/google-drive/permissions';

const SHARED_FOLDER_ID = process.env.GOOGLE_SHARED_FOLDER_ID!;

// POST /api/library/files/upload — อัปโหลดไฟล์ผ่าน Service Account
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const standardId = formData.get('standardId') as string | null;

    if (!file) return NextResponse.json({ error: 'ไม่พบไฟล์' }, { status: 400 });
    if (!standardId) return NextResponse.json({ error: 'ไม่ระบุ standardId' }, { status: 400 });

    const admin = await createServiceRoleClient();

    // หา uploader id
    const { data: dbUser } = await admin
      .from('users')
      .select('id')
      .eq('email', user.email)
      .single();

    if (!dbUser) return NextResponse.json({ error: 'ไม่พบข้อมูลผู้ใช้' }, { status: 404 });

    // ตรวจสอบ file size (max 50MB)
    const MAX_BYTES = 50 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'ไฟล์ใหญ่เกิน 50MB' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // อัปโหลดไปยัง Google Drive
    const folderId = SHARED_FOLDER_ID || 'root';
    const { id: driveFileId, name: driveFileName } = await uploadFile(
      folderId,
      file.name,
      file.type || 'application/octet-stream',
      buffer
    );

    // ตั้งสิทธิ์ public (anyoneWithLink)
    await setFilePublic(driveFileId);

    // หา standard เพื่ออัปเดต drive_file_id
    const { data: standard } = await admin
      .from('standards')
      .select('drive_file_id')
      .eq('id', standardId)
      .single();

    // Soft-delete ไฟล์เก่าใน DB + trash ใน Drive ถ้ามี
    if (standard?.drive_file_id) {
      try {
        const { trashFile } = await import('@/lib/google-drive/files');
        await trashFile(standard.drive_file_id);
      } catch {
        console.error('Could not trash old file:', standard.drive_file_id);
      }
      await admin
        .from('uploaded_files')
        .update({ is_current: false })
        .eq('task_id', standardId)
        .eq('is_deleted', false);
    }

    // อัปเดต standards table
    await admin
      .from('standards')
      .update({
        drive_file_id: driveFileId,
        drive_file_name: driveFileName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', standardId);

    // บันทึกใน uploaded_files
    const ext = file.name.split('.').pop()?.toUpperCase() ?? 'FILE';
    const { data: fileRecord, error: insertErr } = await admin
      .from('uploaded_files')
      .insert({
        task_id: standardId,   // ใช้ task_id เก็บ standard reference
        uploader_id: dbUser.id,
        drive_file_id: driveFileId,
        drive_file_name: driveFileName,
        file_type: ext,
        file_size_bytes: file.size,
        is_current: true,
        is_deleted: false,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    return NextResponse.json({
      ok: true,
      file: fileRecord,
      driveFileId,
      driveFileName,
      viewUrl: `https://drive.google.com/file/d/${driveFileId}/view`,
    }, { status: 201 });
  } catch (err) {
    return handleAuthError(err);
  }
}
