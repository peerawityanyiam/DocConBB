import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, AuthError, handleAuthError } from '@/lib/auth/guards';
import { canAccessTask } from '@/lib/auth/task-access';
import {
  uploadFile,
  getOrCreateFolder,
  checkFolderExists,
  deleteFilePermanent,
  trashFile,
} from '@/lib/google-drive/files';
import { MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES, MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL } from '@/lib/files/upload-limits';

export const maxDuration = 60;

const UPLOAD_FOLDER_ID = process.env.GOOGLE_UPLOAD_FOLDER_ID || process.env.GOOGLE_SHARED_FOLDER_ID!;
const CLOSED_STATUSES = new Set(['COMPLETED', 'CANCELLED']);
const ALLOWED_EXTENSIONS = new Set([
  'docx',
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'heic',
  'heif',
]);

type TaskLite = {
  id: string;
  task_code: string;
  status: string;
  officer_id: string;
  reviewer_id: string;
  created_by: string;
  task_folder_id: string | null;
};

type DraftFileRow = {
  id: string;
  task_id: string;
  uploader_id: string;
  drive_file_id: string;
  drive_file_name: string;
  original_file_name: string;
  normalized_name: string;
  file_type: string | null;
  file_size_bytes: number | null;
  is_deleted: boolean;
  created_at: string;
};

type DraftFileResponseItem = Pick<
  DraftFileRow,
  | 'id'
  | 'drive_file_id'
  | 'drive_file_name'
  | 'original_file_name'
  | 'file_type'
  | 'file_size_bytes'
  | 'created_at'
  | 'uploader_id'
>;

function errorResponse(status: number, error: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, message, ...(extra ?? {}) }, { status });
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function splitFileName(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) {
    return { base: fileName, ext: '' };
  }
  return {
    base: fileName.slice(0, dotIndex),
    ext: fileName.slice(dotIndex),
  };
}

function buildSuffixedName(fileName: string, existingNormalizedNames: Set<string>) {
  const { base, ext } = splitFileName(fileName);
  if (!existingNormalizedNames.has(normalizeName(fileName))) return fileName;

  let counter = 2;
  while (counter < 1000) {
    const candidate = `${base}(${counter})${ext}`;
    if (!existingNormalizedNames.has(normalizeName(candidate))) {
      return candidate;
    }
    counter += 1;
  }

  return `${base}(${Date.now()})${ext}`;
}

function inferMimeType(fileName: string, fallback: string) {
  const ext = getExtension(fileName);
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  return fallback || 'application/octet-stream';
}

function getExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
}

async function removeDriveFileBestEffort(fileId: string) {
  try {
    await deleteFilePermanent(fileId);
    return;
  } catch {
    // fallback
  }

  try {
    await trashFile(fileId);
  } catch {
    // ignore cleanup failures
  }
}

async function getTask(admin: Awaited<ReturnType<typeof createServiceRoleClient>>, taskId: string) {
  const { data, error } = await admin
    .from('tasks')
    .select('id,task_code,status,officer_id,reviewer_id,created_by,task_folder_id')
    .eq('id', taskId)
    .single<TaskLite>();

  if (error || !data) return null;
  return data;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return errorResponse(401, 'unauthorized', 'Please sign in first.');

    const { taskId } = await params;
    const admin = await createServiceRoleClient();
    const task = await getTask(admin, taskId);
    if (!task) return errorResponse(404, 'task_not_found', 'Task not found.');
    if (!canAccessTask(task, user.id, user.roles)) return errorResponse(403, 'forbidden', 'No access to this task.');

    const { data, error } = await admin
      .from('task_private_files')
      .select('id, task_id, uploader_id, drive_file_id, drive_file_name, original_file_name, normalized_name, file_type, file_size_bytes, is_deleted, created_at')
      .eq('task_id', taskId)
      .eq('uploader_id', user.id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const files = ((data ?? []) as DraftFileRow[])
      .filter((row) => row.uploader_id === user.id)
      .map<DraftFileResponseItem>((row) => ({
        id: row.id,
        drive_file_id: row.drive_file_id,
        drive_file_name: row.drive_file_name,
        original_file_name: row.original_file_name,
        file_type: row.file_type,
        file_size_bytes: row.file_size_bytes,
        created_at: row.created_at,
        uploader_id: row.uploader_id,
      }));

    return NextResponse.json({ files });
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    return errorResponse(500, 'draft_list_failed', err instanceof Error ? err.message : 'Failed to list draft files.');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return errorResponse(401, 'unauthorized', 'Please sign in first.');

    const { taskId } = await params;
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const replaceExisting = formData.get('replace_existing') === '1';
    if (!file) return errorResponse(400, 'file_required', 'No file was provided.');

    if (file.size > MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES) {
      return errorResponse(400, 'file_too_large', `File exceeds ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}.`);
    }

    const ext = getExtension(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return errorResponse(400, 'unsupported_file_type', 'Only Word, PDF, and image files are supported.');
    }

    const admin = await createServiceRoleClient();
    const task = await getTask(admin, taskId);
    if (!task) return errorResponse(404, 'task_not_found', 'Task not found.');
    if (!canAccessTask(task, user.id, user.roles)) return errorResponse(403, 'forbidden', 'No access to this task.');
    if (CLOSED_STATUSES.has(task.status)) {
      return errorResponse(400, 'task_closed_private_upload', 'Cannot upload private files for completed/cancelled task.');
    }

    let taskFolderId = task.task_folder_id;
    if (!taskFolderId || !(await checkFolderExists(taskFolderId))) {
      taskFolderId = await getOrCreateFolder(UPLOAD_FOLDER_ID, task.task_code);
      await admin.from('tasks').update({ task_folder_id: taskFolderId }).eq('id', taskId);
    }

    const normalizedOriginalName = normalizeName(file.name);
    const { data: existingRows, error: existingError } = await admin
      .from('task_private_files')
      .select('id, drive_file_id, drive_file_name, normalized_name')
      .eq('task_id', taskId)
      .eq('uploader_id', user.id)
      .eq('is_deleted', false);
    if (existingError) throw existingError;

    const existing = (existingRows ?? []) as Array<{
      id: string;
      drive_file_id: string;
      drive_file_name: string;
      normalized_name: string;
    }>;
    const existingNameSet = new Set(existing.map((item) => normalizeName(item.drive_file_name)));
    const matchedByOriginal = existing.filter((item) => item.normalized_name === normalizedOriginalName);

    let finalFileName = file.name;
    if (matchedByOriginal.length > 0 && !replaceExisting) {
      finalFileName = buildSuffixedName(file.name, existingNameSet);
    }

    const normalizedFinalName = normalizeName(finalFileName);
    const contentBuffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadFile(
      taskFolderId,
      finalFileName,
      inferMimeType(finalFileName, file.type),
      contentBuffer,
      {
        appProperties: {
          fileCategory: 'task_private_draft',
          taskId,
          uploaderId: user.id,
        },
      }
    );

    if (replaceExisting && matchedByOriginal.length > 0) {
      const deleteIds = matchedByOriginal.map((row) => row.id);
      const driveDeleteIds = matchedByOriginal.map((row) => row.drive_file_id);
      await admin
        .from('task_private_files')
        .update({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
        })
        .in('id', deleteIds);
      for (const driveFileId of driveDeleteIds) {
        await removeDriveFileBestEffort(driveFileId);
      }
    }

    const insertPayload = {
      task_id: taskId,
      uploader_id: user.id,
      drive_file_id: uploaded.id,
      drive_file_name: uploaded.name,
      original_file_name: file.name,
      normalized_name: normalizedFinalName,
      file_type: ext.toUpperCase(),
      file_size_bytes: file.size,
    };

    const { data: inserted, error: insertError } = await admin
      .from('task_private_files')
      .insert(insertPayload)
      .select('id, task_id, uploader_id, drive_file_id, drive_file_name, original_file_name, normalized_name, file_type, file_size_bytes, is_deleted, created_at')
      .single<DraftFileRow>();
    if (insertError) throw insertError;

    return NextResponse.json({
      ok: true,
      file: inserted,
      replaced: replaceExisting && matchedByOriginal.length > 0,
      viewUrl: `https://drive.google.com/file/d/${uploaded.id}/view`,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    return errorResponse(500, 'draft_upload_failed', err instanceof Error ? err.message : 'Failed to upload draft file.');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return errorResponse(401, 'unauthorized', 'Please sign in first.');

    const draftId = request.nextUrl.searchParams.get('draft_id')?.trim();
    if (!draftId) return errorResponse(400, 'draft_id_required', 'Missing draft_id.');

    const { taskId } = await params;
    const admin = await createServiceRoleClient();
    const task = await getTask(admin, taskId);
    if (!task) return errorResponse(404, 'task_not_found', 'Task not found.');
    if (!canAccessTask(task, user.id, user.roles)) return errorResponse(403, 'forbidden', 'No access to this task.');

    const { data: row, error: rowError } = await admin
      .from('task_private_files')
      .select('id, drive_file_id')
      .eq('id', draftId)
      .eq('task_id', taskId)
      .eq('uploader_id', user.id)
      .eq('is_deleted', false)
      .single<{ id: string; drive_file_id: string }>();
    if (rowError || !row) return errorResponse(404, 'draft_not_found', 'Draft file not found.');

    await admin
      .from('task_private_files')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
      })
      .eq('id', row.id);
    await removeDriveFileBestEffort(row.drive_file_id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    return errorResponse(500, 'draft_delete_failed', err instanceof Error ? err.message : 'Failed to delete draft file.');
  }
}
