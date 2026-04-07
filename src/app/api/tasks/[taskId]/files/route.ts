import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError, handleAuthError } from '@/lib/auth/guards';
import { uploadFile, getOrCreateFolder, trashFile, checkFolderExists } from '@/lib/google-drive/files';
import { setFilePublic } from '@/lib/google-drive/permissions';

const UPLOAD_FOLDER_ID = process.env.GOOGLE_UPLOAD_FOLDER_ID || process.env.GOOGLE_SHARED_FOLDER_ID!;

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

    // ── ตรวจสอบสิทธิ์อัปโหลดตาม role + status (ตาม reference GAS) ──
    const { data: userRoleRows } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', dbUser.id);
    const userRolesSet = new Set((userRoleRows ?? []).map(r => r.role));

    // All roles can upload both .docx and .pdf at their actionable statuses
    const officerStatuses = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];
    const docconStatuses = ['SUBMITTED_TO_DOCCON'];
    const reviewerStatuses = ['PENDING_REVIEW'];
    const bossStatuses = ['WAITING_BOSS_APPROVAL'];
    const superBossStatuses = ['WAITING_SUPER_BOSS_APPROVAL'];

    let canUpload = false;

    if (userRolesSet.has('STAFF') && task.officer_id === dbUser.id && officerStatuses.includes(task.status)) {
      canUpload = true;
    }
    if (userRolesSet.has('DOCCON') && docconStatuses.includes(task.status)) {
      canUpload = true;
    }
    if (userRolesSet.has('REVIEWER') && reviewerStatuses.includes(task.status) && task.reviewer_id === dbUser.id) {
      canUpload = true;
    }
    if (userRolesSet.has('BOSS') && bossStatuses.includes(task.status)) {
      canUpload = true;
    }
    if (userRolesSet.has('SUPER_BOSS') && superBossStatuses.includes(task.status)) {
      canUpload = true;
    }
    if (userRolesSet.has('SUPER_ADMIN')) {
      canUpload = true;
    }

    if (!canUpload) {
      const rolesStr = Array.from(userRolesSet).join(', ') || 'none';
      return NextResponse.json({
        error: `คุณไม่มีสิทธิ์อัปโหลดไฟล์ในสถานะนี้ (roles: ${rolesStr}, status: ${task.status}, officer_id: ${task.officer_id}, user_id: ${dbUser.id})`,
      }, { status: 403 });
    }

    // สร้าง/หา task folder ใน Shared Drive
    // ถ้า task มี folder เก่า ตรวจว่ายังอยู่ใน Shared Drive ไหม ถ้าไม่ สร้างใหม่
    let taskFolderId = task.task_folder_id;
    let needNewFolder = !taskFolderId;

    if (taskFolderId) {
      // Validate existing folder is accessible (might be in old My Drive)
      const folderOk = await checkFolderExists(taskFolderId);
      if (!folderOk) {
        console.warn('[FILE_UPLOAD] Existing task_folder_id is invalid/inaccessible:', taskFolderId);
        needNewFolder = true;
      }
    }

    if (needNewFolder) {
      console.log('[FILE_UPLOAD] Creating new folder in Shared Drive. Parent:', UPLOAD_FOLDER_ID, 'Task:', task.task_code);
      taskFolderId = await getOrCreateFolder(UPLOAD_FOLDER_ID, task.task_code);
      await admin.from('tasks').update({ task_folder_id: taskFolderId }).eq('id', taskId);
    }

    // อัปโหลด
    const buffer = Buffer.from(await file.arrayBuffer());
    let driveFileId: string;
    let driveFileName: string;
    try {
      const result = await uploadFile(
        taskFolderId,
        file.name,
        file.type || 'application/octet-stream',
        buffer
      );
      driveFileId = result.id;
      driveFileName = result.name;
    } catch (uploadErr: unknown) {
      const errMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
      // If quota error → folder somehow still in My Drive, force create in Shared Drive
      if (errMsg.includes('storage quota') || errMsg.includes('storageQuotaExceeded')) {
        console.warn('[FILE_UPLOAD] Quota error! Force recreating folder in Shared Drive. Old:', taskFolderId);
        taskFolderId = await getOrCreateFolder(UPLOAD_FOLDER_ID, task.task_code);
        await admin.from('tasks').update({ task_folder_id: taskFolderId }).eq('id', taskId);
        const result = await uploadFile(
          taskFolderId,
          file.name,
          file.type || 'application/octet-stream',
          buffer
        );
        driveFileId = result.id;
        driveFileName = result.name;
      } else {
        throw uploadErr;
      }
    }

    // ตั้ง public
    await setFilePublic(driveFileId);

    const isPdf = ext === 'pdf';
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };

    if (isPdf) {
      // PDF → ไฟล์อ้างอิง (ref) — replace old PDF only
      if (task.ref_file_id && task.ref_file_id !== driveFileId) {
        try { await trashFile(task.ref_file_id); } catch { /* ignore */ }
      }
      updates.ref_file_id = driveFileId;
      updates.ref_file_name = driveFileName;
    } else {
      // DOCX → ไฟล์หลัก — replace old DOCX only, keep ref PDF intact
      if (task.drive_file_id && task.drive_file_id !== driveFileId) {
        try { await trashFile(task.drive_file_id); } catch { /* ignore */ }
      }
      updates.drive_file_id = driveFileId;
      updates.drive_file_name = driveFileName;
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
    if (err instanceof AuthError) return handleAuthError(err);
    console.error('[FILE_UPLOAD_ERROR]', err);
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
