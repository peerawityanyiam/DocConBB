import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError, handleAuthError } from '@/lib/auth/guards';
import { uploadFile, getOrCreateFolder, trashFile } from '@/lib/google-drive/files';
import { setFilePublic } from '@/lib/google-drive/permissions';

const UPLOAD_FOLDER_ID = process.env.GOOGLE_SHARED_FOLDER_ID!;

// POST /api/tasks/[taskId]/files — อัปโหลดไฟล์ (docx/pdf) เข้า task folder
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { taskId } = await params;
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'ไม่พบไฟล์' }, { status: 400 });

    // ตรวจนามสกุล
    const ext = file.name.toLowerCase().split('.').pop();
    if (!['docx', 'pdf'].includes(ext ?? '')) {
      return NextResponse.json({ error: 'รองรับเฉพาะ .docx และ .pdf' }, { status: 400 });
    }

    // ตรวจขนาด (50MB)
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'ไฟล์ใหญ่เกิน 50MB' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();

    const { data: dbUser } = await admin
      .from('users')
      .select('id, display_name')
      .eq('email', user.email)
      .single();
    if (!dbUser) throw new AuthError('ไม่พบข้อมูลผู้ใช้', 404);

    // ดึง task
    const { data: task } = await admin.from('tasks').select('*').eq('id', taskId).single();
    if (!task) return NextResponse.json({ error: 'ไม่พบงาน' }, { status: 404 });

    // ตรวจสอบสถานะ — อนุญาตอัปโหลดเฉพาะสถานะที่ถูกต้อง
    const uploadableStatuses = [
      'ASSIGNED', 'SUBMITTED_TO_DOCCON',
      'DOCCON_REJECTED', 'REVIEWER_REJECTED',
      'BOSS_REJECTED', 'SUPER_BOSS_REJECTED',
      'PENDING_REVIEW', 'WAITING_BOSS_APPROVAL', 'WAITING_SUPER_BOSS_APPROVAL',
    ];
    if (!uploadableStatuses.includes(task.status)) {
      return NextResponse.json(
        { error: 'ไม่สามารถอัปโหลดไฟล์ในสถานะนี้ได้' },
        { status: 400 }
      );
    }

    // สร้าง/หา task folder ใน Drive
    let taskFolderId = task.task_folder_id;
    if (!taskFolderId) {
      taskFolderId = await getOrCreateFolder(UPLOAD_FOLDER_ID, task.task_code);
      await admin.from('tasks').update({ task_folder_id: taskFolderId }).eq('id', taskId);
    }

    // อัปโหลด
    const buffer = Buffer.from(await file.arrayBuffer());
    const { id: driveFileId, name: driveFileName } = await uploadFile(
      taskFolderId,
      file.name,
      file.type || 'application/octet-stream',
      buffer
    );

    // ตั้ง public
    await setFilePublic(driveFileId);

    const isPdf = ext === 'pdf';
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };

    if (isPdf) {
      // PDF → ไฟล์อ้างอิง (ref)
      if (task.ref_file_id && task.ref_file_id !== driveFileId) {
        try { await trashFile(task.ref_file_id); } catch { /* ignore */ }
      }
      updates.ref_file_id = driveFileId;
      updates.ref_file_name = driveFileName;
    } else {
      // DOCX → ไฟล์หลัก + ล้าง ref PDF + trash ไฟล์เก่า
      if (task.drive_file_id && task.drive_file_id !== driveFileId) {
        try { await trashFile(task.drive_file_id); } catch { /* ignore */ }
      }
      if (task.ref_file_id) {
        try { await trashFile(task.ref_file_id); } catch { /* ignore */ }
      }
      updates.drive_file_id = driveFileId;
      updates.drive_file_name = driveFileName;
      updates.ref_file_id = null;
      updates.ref_file_name = null;
    }

    // อัปเดต file_history
    const fileHistory = [...(task.file_history ?? []), {
      fileName: driveFileName,
      uploadedAt: now,
      uploadedBy: user.email,
      uploadedByName: dbUser.display_name,
      driveFileId,
      isPdf,
    }];
    updates.file_history = fileHistory;

    await admin.from('tasks').update(updates).eq('id', taskId);

    // บันทึกใน uploaded_files table
    await admin.from('uploaded_files').insert({
      task_id: taskId,
      uploader_id: dbUser.id,
      drive_file_id: driveFileId,
      drive_file_name: driveFileName,
      file_type: ext?.toUpperCase(),
      file_size_bytes: file.size,
    });

    return NextResponse.json({
      ok: true,
      driveFileId,
      driveFileName,
      isPdf,
      viewUrl: `https://drive.google.com/file/d/${driveFileId}/view`,
    }, { status: 201 });
  } catch (err) {
    return handleAuthError(err);
  }
}
