import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError, hasRole } from '@/lib/auth/guards';
import { deleteFilePermanent, trashFile } from '@/lib/google-drive/files';

// GET /api/tasks/[taskId] — ดู task พร้อม history และชื่อผู้ใช้
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { taskId } = await params;
    const admin = await createServiceRoleClient();

    const { data: task, error } = await admin
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (error || !task) return NextResponse.json({ error: 'ไม่พบงาน' }, { status: 404 });

    // ดึงชื่อผู้ใช้
    const userIds = [task.officer_id, task.reviewer_id, task.created_by].filter(Boolean);
    const { data: usersData } = await admin
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds);

    const usersMap = Object.fromEntries((usersData ?? []).map(u => [u.id, u]));

    return NextResponse.json({
      ...task,
      officer: usersMap[task.officer_id] ?? null,
      reviewer: usersMap[task.reviewer_id] ?? null,
      creator: usersMap[task.created_by] ?? null,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

// DELETE /api/tasks/[taskId] - hard delete only for rollback on newly created task
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { taskId } = await params;
    const admin = await createServiceRoleClient();

    const { data: task, error } = await admin
      .from('tasks')
      .select('id, status, is_archived, created_by, drive_file_id, ref_file_id, file_history, status_history')
      .eq('id', taskId)
      .single();

    if (error || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const isSuperAdmin = hasRole(user, ['SUPER_ADMIN']);
    const isCreator = task.created_by === user.id;
    if (!isSuperAdmin && !isCreator) {
      return NextResponse.json({ error: 'No permission to delete this task' }, { status: 403 });
    }

    // Safe guard: allow hard delete only while task is still fresh/new
    if (task.status !== 'ASSIGNED' || task.is_archived) {
      return NextResponse.json(
        { error: 'Only newly created unsubmitted tasks can be deleted' },
        { status: 400 },
      );
    }

    const statusHistory = Array.isArray(task.status_history) ? task.status_history : [];
    if (statusHistory.length > 1) {
      return NextResponse.json(
        { error: 'Cannot delete task after workflow has progressed' },
        { status: 400 },
      );
    }

    const driveFileIds = new Set<string>();
    if (typeof task.drive_file_id === 'string' && task.drive_file_id) driveFileIds.add(task.drive_file_id);
    if (typeof task.ref_file_id === 'string' && task.ref_file_id) driveFileIds.add(task.ref_file_id);

    if (Array.isArray(task.file_history)) {
      for (const item of task.file_history as Array<{ driveFileId?: string }>) {
        if (typeof item?.driveFileId === 'string' && item.driveFileId) {
          driveFileIds.add(item.driveFileId);
        }
      }
    }

    const { error: uploadedFilesDeleteError } = await admin
      .from('uploaded_files')
      .delete()
      .eq('task_id', taskId);
    if (uploadedFilesDeleteError) throw uploadedFilesDeleteError;

    const { error: taskDeleteError } = await admin.from('tasks').delete().eq('id', taskId);
    if (taskDeleteError) throw taskDeleteError;

    const cleanupWarnings: string[] = [];
    for (const fileId of driveFileIds) {
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
      cleanupWarnings,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
