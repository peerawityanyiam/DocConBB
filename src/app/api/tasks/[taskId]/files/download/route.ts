import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError } from '@/lib/auth/guards';
import { assertTaskAccess } from '@/lib/auth/task-access';
import { getDriveClient } from '@/lib/google-drive/client';
import { archiveFile } from '@/lib/google-drive/files';
import { setFilePublic } from '@/lib/google-drive/permissions';

// Plain HTML because this route is opened directly from a link, not fetched.
function messagePage(status: number, message: string) {
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ดาวน์โหลดไฟล์</title></head>
<body style="font-family:sans-serif;display:flex;min-height:90vh;align-items:center;justify-content:center;background:#f8fafc;color:#334155;margin:0;padding:16px">
<div style="max-width:420px;text-align:center;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
<p style="font-size:16px;margin:0 0 16px">${message}</p>
<button onclick="history.length>1?history.back():window.close()" style="padding:8px 16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;font-size:14px">กลับ</button>
</div></body></html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// GET /api/tasks/[taskId]/files/download?fileId=...
// Restores the file from trash if needed, ensures link access, then redirects to Drive's download URL.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return messagePage(401, 'กรุณาเข้าสู่ระบบก่อนดาวน์โหลดไฟล์');

    const { taskId } = await params;
    const fileId = request.nextUrl.searchParams.get('fileId')?.trim() ?? '';
    if (!fileId) return messagePage(400, 'ไม่พบรหัสไฟล์');

    const admin = await createServiceRoleClient();
    const { data: task } = await admin
      .from('tasks')
      .select('id, created_by, officer_id, reviewer_id, task_folder_id, drive_file_id, ref_file_id, file_history')
      .eq('id', taskId)
      .single();
    if (!task) return messagePage(404, 'ไม่พบงาน');

    assertTaskAccess(task, user.id, user.roles);

    const history = (task.file_history as Array<{ driveFileId?: string }> | null) ?? [];
    const belongsToTask =
      fileId === task.drive_file_id ||
      fileId === task.ref_file_id ||
      history.some((entry) => entry.driveFileId === fileId);
    if (!belongsToTask) return messagePage(404, 'ไฟล์นี้ไม่ได้อยู่ในงานนี้');

    const drive = getDriveClient();
    let trashed = false;
    try {
      const meta = await drive.files.get({ fileId, fields: 'id,trashed', supportsAllDrives: true });
      trashed = Boolean(meta.data.trashed);
    } catch {
      return messagePage(410, 'ไฟล์นี้ถูกลบออกจาก Google Drive แล้ว ไม่สามารถดาวน์โหลดได้');
    }

    if (trashed) {
      try {
        await drive.files.update({ fileId, requestBody: { trashed: false }, supportsAllDrives: true });
      } catch {
        return messagePage(410, 'ไฟล์นี้อยู่ในถังขยะและกู้คืนไม่ได้ ไม่สามารถดาวน์โหลดได้');
      }
      if (task.task_folder_id && fileId !== task.drive_file_id && fileId !== task.ref_file_id) {
        try {
          await archiveFile(fileId, task.task_folder_id);
        } catch {
          // restored in place; archiving is best-effort
        }
      }
    }

    try {
      await setFilePublic(fileId);
    } catch {
      // usually already public since upload
    }

    return NextResponse.redirect(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`);
  } catch (err) {
    if (err instanceof AuthError) return messagePage(err.statusCode,'คุณไม่มีสิทธิ์ดาวน์โหลดไฟล์ของงานนี้');
    console.error('[FILE_DOWNLOAD] failed', err);
    return messagePage(500, 'ดาวน์โหลดไฟล์ไม่สำเร็จ กรุณาลองใหม่');
  }
}
