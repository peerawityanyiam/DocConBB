import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError, handleAuthError } from '@/lib/auth/guards';
import { uploadFile, getOrCreateFolder, deleteFilePermanent, checkFolderExists } from '@/lib/google-drive/files';
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

    // ── ตรวจสอบสิทธิ์อัปโหลดตาม relationship + role + status ──
    const { data: userRoleRows } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', dbUser.id);
    const userRolesSet = new Set((userRoleRows ?? []).map(r => r.role));

    const s = task.status;
    const isOfficer = task.officer_id === dbUser.id;
    const isReviewer = task.reviewer_id === dbUser.id;
    const isCreator = task.created_by === dbUser.id;

    // สถานะที่แต่ละ role อัปโหลดได้
    const officerStatuses = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];

    let canUpload = false;
    // Also check roles from the auth token (user_project_roles), not just user_roles table
    const authRolesSet = new Set(user.roles);

    // เจ้าหน้าที่ (officer) — เช็คจาก relationship ไม่ต้องมี role ก็ได้
    if (isOfficer && officerStatuses.includes(s)) canUpload = true;
    // Boss (ผู้สั่งงาน) — อัปโหลดได้ทั้ง ASSIGNED (ตอนสร้างงาน) และ WAITING_BOSS_APPROVAL
    if (isCreator && (s === 'ASSIGNED' || s === 'WAITING_BOSS_APPROVAL')) canUpload = true;
    // DocCon — check both tables
    if ((userRolesSet.has('DOCCON') || authRolesSet.has('DOCCON')) && s === 'SUBMITTED_TO_DOCCON') canUpload = true;
    // Reviewer — เช็คจาก relationship
    if (isReviewer && s === 'PENDING_REVIEW') canUpload = true;
    // SuperBoss — check both tables
    if ((userRolesSet.has('SUPER_BOSS') || authRolesSet.has('SUPER_BOSS')) && s === 'WAITING_SUPER_BOSS_APPROVAL') canUpload = true;
    // SuperAdmin
    if (userRolesSet.has('SUPER_ADMIN') || authRolesSet.has('SUPER_ADMIN')) canUpload = true;

    if (!canUpload) {
      const rolesStr = Array.from(userRolesSet).join(', ') || 'none';
      return NextResponse.json({
        error: `คุณไม่มีสิทธิ์อัปโหลดไฟล์ในสถานะนี้ (roles: ${rolesStr}, status: ${s}, officer: ${isOfficer}, reviewer: ${isReviewer}, creator: ${isCreator})`,
      }, { status: 403 });
    }

    // PDF logic: PDF ใช้ประกอบการตีกลับเท่านั้น
    // - เฉพาะ DocCon/Reviewer/Boss/SuperBoss ที่กำลังจะตีกลับ ส่ง PDF ได้
    // - Boss (creator) สร้างงานใหม่สถานะ ASSIGNED สามารถแนบ PDF ได้
    // - เจ้าหน้าที่ที่ถูกตีกลับ ส่ง PDF ไม่ได้ (ต้องแก้ตามสั่ง ส่ง word เท่านั้น)
    const isPdfFile = ext === 'pdf';
    if (isPdfFile) {
      const pdfAllowedStatuses = ['SUBMITTED_TO_DOCCON', 'PENDING_REVIEW', 'WAITING_BOSS_APPROVAL', 'WAITING_SUPER_BOSS_APPROVAL'];
      // Allow PDF at ASSIGNED if the uploader is the task creator (Boss creating a task)
      const isCreatorUploadingAtAssigned = isCreator && s === 'ASSIGNED';
      if (!pdfAllowedStatuses.includes(s) && !isCreatorUploadingAtAssigned) {
        return NextResponse.json({ error: 'สถานะนี้อัปโหลดได้เฉพาะไฟล์ .docx เท่านั้น (PDF ใช้ประกอบการตีกลับ)' }, { status: 400 });
      }
      // Bug 5: DocCon cannot upload PDF when task was sent back from Boss/SuperBoss
      if (s === 'SUBMITTED_TO_DOCCON' && (userRolesSet.has('DOCCON') || authRolesSet.has('DOCCON')) && !isCreator) {
        const history = (task.status_history as Array<{status?: string; note?: string}>) ?? [];
        // Find last SUBMITTED_TO_DOCCON entry with sentBackToDocconBy note
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          if (h.status === 'SUBMITTED_TO_DOCCON' && h.note?.startsWith('sentBackToDocconBy:')) {
            return NextResponse.json({ error: 'เมื่องานถูกส่งกลับจาก Boss/Super Boss อัปโหลดได้เฉพาะไฟล์ .docx เท่านั้น' }, { status: 400 });
          }
          // Stop searching once we hit a non-sentBack entry at SUBMITTED_TO_DOCCON
          if (h.status === 'SUBMITTED_TO_DOCCON') break;
        }
      }
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
        try { await deleteFilePermanent(task.ref_file_id); } catch { /* ignore */ }
      }
      updates.ref_file_id = driveFileId;
      updates.ref_file_name = driveFileName;
    } else {
      // DOCX → ไฟล์หลัก — replace old DOCX only, keep ref PDF intact
      if (task.drive_file_id && task.drive_file_id !== driveFileId) {
        try { await deleteFilePermanent(task.drive_file_id); } catch { /* ignore */ }
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
