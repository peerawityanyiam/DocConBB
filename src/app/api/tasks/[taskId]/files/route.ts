import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError, handleAuthError } from '@/lib/auth/guards';
import { uploadFile, getOrCreateFolder, deleteFilePermanent, checkFolderExists, trashFile } from '@/lib/google-drive/files';
import { setFilePublic } from '@/lib/google-drive/permissions';
import { MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES, MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL } from '@/lib/files/upload-limits';

const UPLOAD_FOLDER_ID = process.env.GOOGLE_UPLOAD_FOLDER_ID || process.env.GOOGLE_SHARED_FOLDER_ID!;

function toPositiveInt(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string') return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

// POST /api/tasks/[taskId]/files â€” à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸Ÿà¸¥à¹Œ (docx/pdf) à¹€à¸‚à¹‰à¸² task folder
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' }, { status: 401 });

    const { taskId } = await params;
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const uploadBatchIdRaw = formData.get('upload_batch_id');
    const uploadBatchLabelRaw = formData.get('upload_batch_label');
    const uploadBatchIndex = toPositiveInt(formData.get('upload_batch_index'));
    const uploadBatchTotal = toPositiveInt(formData.get('upload_batch_total'));

    if (!file) return NextResponse.json({ error: 'à¹„à¸¡à¹ˆà¸žà¸šà¹„à¸Ÿà¸¥à¹Œ' }, { status: 400 });
    const uploadBatchId = typeof uploadBatchIdRaw === 'string' ? uploadBatchIdRaw.trim() : '';
    const uploadBatchLabel = typeof uploadBatchLabelRaw === 'string' ? uploadBatchLabelRaw.trim() : '';
    const hasPdfBatchMeta = Boolean(
      uploadBatchId &&
      uploadBatchTotal &&
      uploadBatchTotal > 1 &&
      uploadBatchIndex &&
      uploadBatchIndex <= uploadBatchTotal,
    );

    // à¸•à¸£à¸§à¸ˆà¸™à¸²à¸¡à¸ªà¸à¸¸à¸¥
    const ext = file.name.toLowerCase().split('.').pop();
    if (!['docx', 'pdf'].includes(ext ?? '')) {
      return NextResponse.json({ error: 'à¸£à¸­à¸‡à¸£à¸±à¸šà¹€à¸‰à¸žà¸²à¸° .docx à¹à¸¥à¸° .pdf' }, { status: 400 });
    }

    // à¸•à¸£à¸§à¸ˆà¸‚à¸™à¸²à¸” (à¸•à¸£à¸‡à¸à¸±à¸šà¸‚à¸µà¸”à¸ˆà¸³à¸à¸±à¸” upload à¸ˆà¸£à¸´à¸‡à¸‚à¸­à¸‡à¸£à¸°à¸šà¸šà¸«à¸™à¹‰à¸²à¹€à¸§à¹‡à¸š)
    if (file.size > MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: `à¹„à¸Ÿà¸¥à¹Œà¹ƒà¸«à¸à¹ˆà¹€à¸à¸´à¸™ ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}` }, { status: 400 });
    }

    const admin = await createServiceRoleClient();

    const { data: dbUser } = await admin
      .from('users')
      .select('id, display_name')
      .eq('email', user.email)
      .single();
    if (!dbUser) throw new AuthError('à¹„à¸¡à¹ˆà¸žà¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸œà¸¹à¹‰à¹ƒà¸Šà¹‰', 404);

    // à¸”à¸¶à¸‡ task
    const { data: task } = await admin.from('tasks').select('*').eq('id', taskId).single();
    if (!task) return NextResponse.json({ error: 'à¹„à¸¡à¹ˆà¸žà¸šà¸‡à¸²à¸™' }, { status: 404 });

    // â”€â”€ à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¸ªà¸´à¸—à¸˜à¸´à¹Œà¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¸•à¸²à¸¡ relationship + role + status â”€â”€
    const { data: userRoleRows } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', dbUser.id);
    const userRolesSet = new Set((userRoleRows ?? []).map(r => r.role));

    const s = task.status;
    const isOfficer = task.officer_id === dbUser.id;
    const isReviewer = task.reviewer_id === dbUser.id;
    const isCreator = task.created_by === dbUser.id;

    // à¸ªà¸–à¸²à¸™à¸°à¸—à¸µà¹ˆà¹à¸•à¹ˆà¸¥à¸° role à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸”à¹‰
    const officerStatuses = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];

    let canUpload = false;
    // Also check roles from the auth token (user_project_roles), not just user_roles table
    const authRolesSet = new Set(user.roles);

    // à¹€à¸ˆà¹‰à¸²à¸«à¸™à¹‰à¸²à¸—à¸µà¹ˆ (officer) â€” à¹€à¸Šà¹‡à¸„à¸ˆà¸²à¸ relationship à¹„à¸¡à¹ˆà¸•à¹‰à¸­à¸‡à¸¡à¸µ role à¸à¹‡à¹„à¸”à¹‰
    if (isOfficer && officerStatuses.includes(s)) canUpload = true;
    // Boss (à¸œà¸¹à¹‰à¸ªà¸±à¹ˆà¸‡à¸‡à¸²à¸™) â€” à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸”à¹‰à¸—à¸±à¹‰à¸‡ ASSIGNED (à¸•à¸­à¸™à¸ªà¸£à¹‰à¸²à¸‡à¸‡à¸²à¸™) à¹à¸¥à¸° WAITING_BOSS_APPROVAL
    if (isCreator && (s === 'ASSIGNED' || s === 'WAITING_BOSS_APPROVAL')) canUpload = true;
    // DocCon â€” check both tables
    if ((userRolesSet.has('DOCCON') || authRolesSet.has('DOCCON')) && s === 'SUBMITTED_TO_DOCCON') canUpload = true;
    // Reviewer â€” à¹€à¸Šà¹‡à¸„à¸ˆà¸²à¸ relationship
    if (isReviewer && s === 'PENDING_REVIEW') canUpload = true;
    // SuperBoss â€” check both tables
    if ((userRolesSet.has('SUPER_BOSS') || authRolesSet.has('SUPER_BOSS')) && s === 'WAITING_SUPER_BOSS_APPROVAL') canUpload = true;
    // SuperAdmin
    if (userRolesSet.has('SUPER_ADMIN') || authRolesSet.has('SUPER_ADMIN')) canUpload = true;

    if (!canUpload) {
      const rolesStr = Array.from(userRolesSet).join(', ') || 'none';
      return NextResponse.json({
        error: `à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¸¡à¸µà¸ªà¸´à¸—à¸˜à¸´à¹Œà¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸Ÿà¸¥à¹Œà¹ƒà¸™à¸ªà¸–à¸²à¸™à¸°à¸™à¸µà¹‰ (roles: ${rolesStr}, status: ${s}, officer: ${isOfficer}, reviewer: ${isReviewer}, creator: ${isCreator})`,
      }, { status: 403 });
    }

    // PDF logic: PDF à¹ƒà¸Šà¹‰à¸›à¸£à¸°à¸à¸­à¸šà¸à¸²à¸£à¸•à¸µà¸à¸¥à¸±à¸šà¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™
    // - à¹€à¸‰à¸žà¸²à¸° DocCon/Reviewer/Boss/SuperBoss à¸—à¸µà¹ˆà¸à¸³à¸¥à¸±à¸‡à¸ˆà¸°à¸•à¸µà¸à¸¥à¸±à¸š à¸ªà¹ˆà¸‡ PDF à¹„à¸”à¹‰
    // - Boss (creator) à¸ªà¸£à¹‰à¸²à¸‡à¸‡à¸²à¸™à¹ƒà¸«à¸¡à¹ˆà¸ªà¸–à¸²à¸™à¸° ASSIGNED à¸ªà¸²à¸¡à¸²à¸£à¸–à¹à¸™à¸š PDF à¹„à¸”à¹‰
    // - à¹€à¸ˆà¹‰à¸²à¸«à¸™à¹‰à¸²à¸—à¸µà¹ˆà¸—à¸µà¹ˆà¸–à¸¹à¸à¸•à¸µà¸à¸¥à¸±à¸š à¸ªà¹ˆà¸‡ PDF à¹„à¸¡à¹ˆà¹„à¸”à¹‰ (à¸•à¹‰à¸­à¸‡à¹à¸à¹‰à¸•à¸²à¸¡à¸ªà¸±à¹ˆà¸‡ à¸ªà¹ˆà¸‡ word à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™)
    const isPdfFile = ext === 'pdf';
    if (isPdfFile) {
      const pdfAllowedStatuses = ['SUBMITTED_TO_DOCCON', 'PENDING_REVIEW', 'WAITING_BOSS_APPROVAL', 'WAITING_SUPER_BOSS_APPROVAL'];
      // Allow PDF at ASSIGNED if the uploader is the task creator (Boss creating a task)
      const isCreatorUploadingAtAssigned = isCreator && s === 'ASSIGNED';
      if (!pdfAllowedStatuses.includes(s) && !isCreatorUploadingAtAssigned) {
        return NextResponse.json({ error: 'à¸ªà¸–à¸²à¸™à¸°à¸™à¸µà¹‰à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸”à¹‰à¹€à¸‰à¸žà¸²à¸°à¹„à¸Ÿà¸¥à¹Œ .docx à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™ (PDF à¹ƒà¸Šà¹‰à¸›à¸£à¸°à¸à¸­à¸šà¸à¸²à¸£à¸•à¸µà¸à¸¥à¸±à¸š)' }, { status: 400 });
      }
      // Bug 5: DocCon cannot upload PDF when task was sent back from Boss/SuperBoss
      if (s === 'SUBMITTED_TO_DOCCON' && (userRolesSet.has('DOCCON') || authRolesSet.has('DOCCON')) && !isCreator) {
        const history = (task.status_history as Array<{status?: string; note?: string}>) ?? [];
        // Find last SUBMITTED_TO_DOCCON entry with sentBackToDocconBy note
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          if (h.status === 'SUBMITTED_TO_DOCCON' && h.note?.startsWith('sentBackToDocconBy:')) {
            return NextResponse.json({ error: 'à¹€à¸¡à¸·à¹ˆà¸­à¸‡à¸²à¸™à¸–à¸¹à¸à¸ªà¹ˆà¸‡à¸à¸¥à¸±à¸šà¸ˆà¸²à¸ Boss/Super Boss à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸”à¹‰à¹€à¸‰à¸žà¸²à¸°à¹„à¸Ÿà¸¥à¹Œ .docx à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™' }, { status: 400 });
          }
          // Stop searching once we hit a non-sentBack entry at SUBMITTED_TO_DOCCON
          if (h.status === 'SUBMITTED_TO_DOCCON') break;
        }
      }
    }

    // à¸ªà¸£à¹‰à¸²à¸‡/à¸«à¸² task folder à¹ƒà¸™ Shared Drive
    // à¸–à¹‰à¸² task à¸¡à¸µ folder à¹€à¸à¹ˆà¸² à¸•à¸£à¸§à¸ˆà¸§à¹ˆà¸²à¸¢à¸±à¸‡à¸­à¸¢à¸¹à¹ˆà¹ƒà¸™ Shared Drive à¹„à¸«à¸¡ à¸–à¹‰à¸²à¹„à¸¡à¹ˆ à¸ªà¸£à¹‰à¸²à¸‡à¹ƒà¸«à¸¡à¹ˆ
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

    // à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”
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
      // If quota error â†’ folder somehow still in My Drive, force create in Shared Drive
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

    // à¸•à¸±à¹‰à¸‡ public
    await setFilePublic(driveFileId);

    const isPdf = ext === 'pdf';
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };
    const cleanupWarnings: string[] = [];

    async function removeOldFile(fileId: string, label: 'DOCX' | 'PDF') {
      try {
        await deleteFilePermanent(fileId);
        return;
      } catch (deleteErr) {
        console.warn(`[FILE_UPLOAD] Permanent delete failed for ${label} ${fileId}, fallback to trash`, deleteErr);
      }

      try {
        await trashFile(fileId);
      } catch (trashErr) {
        console.error(`[FILE_UPLOAD] Failed to remove old ${label} ${fileId}`, trashErr);
        cleanupWarnings.push(`remove_old_${label.toLowerCase()}_failed`);
      }
    }

    const existingHistory = (task.file_history as Array<{
      fileName?: string;
      uploadedAt?: string;
      uploadedBy?: string;
      uploadedByName?: string;
      driveFileId?: string;
      isPdf?: boolean;
      uploadBatchId?: string;
      uploadBatchIndex?: number;
      uploadBatchTotal?: number;
    }> | null) ?? [];
    const latestOldDocxFromHistory = [...existingHistory].reverse().find(f => !f.isPdf && f.driveFileId)?.driveFileId;

    const newFileHistoryEntry = {
      fileName: driveFileName,
      uploadedAt: now,
      uploadedBy: user.email,
      uploadedByName: dbUser.display_name,
      driveFileId,
      isPdf,
      uploadBatchId: hasPdfBatchMeta ? uploadBatchId : undefined,
      uploadBatchIndex: hasPdfBatchMeta ? uploadBatchIndex ?? undefined : undefined,
      uploadBatchTotal: hasPdfBatchMeta ? uploadBatchTotal ?? undefined : undefined,
    };
    const fileHistory = [...existingHistory, newFileHistoryEntry];
    updates.file_history = fileHistory;

    if (isPdf) {
      // PDF is a reference file. For multi-part image batches, set ref only when all parts are uploaded.
      if (hasPdfBatchMeta) {
        const summaryBaseName = (uploadBatchLabel || driveFileName).replace(/-part-\d+\.pdf$/i, '.pdf');
        const sameBatch = fileHistory
          .filter((entry) => (
            entry.isPdf
            && entry.uploadBatchId === uploadBatchId
            && typeof entry.driveFileId === 'string'
            && entry.driveFileId.length > 0
          ))
          .sort((a, b) => (a.uploadBatchIndex ?? 9999) - (b.uploadBatchIndex ?? 9999));

        const expectedTotal = uploadBatchTotal ?? 0;
        const indexSet = new Set(
          sameBatch
            .map((entry) => entry.uploadBatchIndex)
            .filter((value): value is number => typeof value === 'number' && value > 0),
        );
        const isBatchComplete = expectedTotal > 1
          && sameBatch.length >= expectedTotal
          && Array.from({ length: expectedTotal }, (_, idx) => idx + 1).every((value) => indexSet.has(value));

        if (isBatchComplete && sameBatch[0]?.driveFileId) {
          updates.ref_file_id = sameBatch[0].driveFileId;
          updates.ref_file_name = `${summaryBaseName} + à¸­à¸µà¸ ${expectedTotal - 1} à¹„à¸Ÿà¸¥à¹Œ`;
        }
      } else {
        updates.ref_file_id = driveFileId;
        updates.ref_file_name = driveFileName;
      }
    } else {
      // DOCX â†’ à¹„à¸Ÿà¸¥à¹Œà¸«à¸¥à¸±à¸ â€” replace old DOCX only, keep ref PDF intact
      const oldDocxId = task.drive_file_id ?? latestOldDocxFromHistory;
      if (oldDocxId && oldDocxId !== driveFileId) {
        await removeOldFile(oldDocxId, 'DOCX');
      }
      updates.drive_file_id = driveFileId;
      updates.drive_file_name = driveFileName;
    }

    await admin.from('tasks').update(updates).eq('id', taskId);

    // à¸šà¸±à¸™à¸—à¸¶à¸à¹ƒà¸™ uploaded_files table
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
      cleanupWarnings,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    console.error('[FILE_UPLOAD_ERROR]', err);
    const message = err instanceof Error ? err.message : 'à¹€à¸à¸´à¸”à¸‚à¹‰à¸­à¸œà¸´à¸”à¸žà¸¥à¸²à¸”à¹ƒà¸™à¸à¸²à¸£à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸Ÿà¸¥à¹Œ';
    if (/unauthorized_client/i.test(message)) {
      return NextResponse.json({
        error: 'à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸² Google Service Account à¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¹‰à¸­à¸‡à¸ªà¸³à¸«à¸£à¸±à¸šà¸à¸²à¸£ impersonate à¸à¸£à¸¸à¸“à¸²à¹ƒà¸Šà¹‰à¹‚à¸«à¸¡à¸” service account à¸›à¸à¸•à¸´ (à¸›à¸´à¸” GOOGLE_ENABLE_IMPERSONATION) à¸«à¸£à¸·à¸­à¹ƒà¸«à¹‰à¸œà¸¹à¹‰à¸”à¸¹à¹à¸¥à¸£à¸°à¸šà¸šà¹€à¸›à¸´à¸” Domain-wide Delegation à¸à¹ˆà¸­à¸™',
      }, { status: 500 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/tasks/[taskId]/files?upload_batch_id=... â€” rollback partial image batch uploads
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { taskId } = await params;
    const uploadBatchId = request.nextUrl.searchParams.get('upload_batch_id')?.trim();
    if (!uploadBatchId) {
      return NextResponse.json({ error: 'à¹„à¸¡à¹ˆà¸£à¸°à¸šà¸¸ upload_batch_id' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();
    const { data: task } = await admin.from('tasks').select('ref_file_id, file_history').eq('id', taskId).single();
    if (!task) return NextResponse.json({ error: 'à¹„à¸¡à¹ˆà¸žà¸šà¸‡à¸²à¸™' }, { status: 404 });

    type FileHistoryEntry = {
      driveFileId?: string;
      isPdf?: boolean;
      uploadBatchId?: string;
      uploadedBy?: string;
    };
    const fileHistory = (task.file_history as FileHistoryEntry[] | null) ?? [];

    const toRollback = fileHistory.filter((entry) => (
      entry.isPdf
      && entry.uploadBatchId === uploadBatchId
      && entry.uploadedBy === user.email
      && typeof entry.driveFileId === 'string'
      && entry.driveFileId.length > 0
    ));

    if (toRollback.length === 0) {
      return NextResponse.json({ ok: true, removed: 0 });
    }

    const rollbackIds = Array.from(new Set(toRollback.map((entry) => entry.driveFileId as string)));

    const filteredHistory = fileHistory.filter((entry) => !(
      entry.isPdf
      && entry.uploadBatchId === uploadBatchId
      && entry.uploadedBy === user.email
    ));

    const updates: Record<string, unknown> = {
      file_history: filteredHistory,
      updated_at: new Date().toISOString(),
    };
    if (typeof task.ref_file_id === 'string' && rollbackIds.includes(task.ref_file_id)) {
      updates.ref_file_id = null;
      updates.ref_file_name = null;
    }

    await admin.from('tasks').update(updates).eq('id', taskId);
    await admin
      .from('uploaded_files')
      .delete()
      .eq('task_id', taskId)
      .in('drive_file_id', rollbackIds);

    const cleanupWarnings: string[] = [];
    for (const fileId of rollbackIds) {
      try {
        await deleteFilePermanent(fileId);
      } catch {
        try {
          await trashFile(fileId);
        } catch {
          cleanupWarnings.push(fileId);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      removed: rollbackIds.length,
      cleanupWarnings,
    });
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    console.error('[FILE_UPLOAD_ROLLBACK_ERROR]', err);
    return NextResponse.json({ error: 'ไม่สามารถล้างไฟล์ที่อัปโหลดค้างได้' }, { status: 500 });
  }
}

