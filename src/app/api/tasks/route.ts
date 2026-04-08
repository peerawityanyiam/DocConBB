import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

const TASK_SELECT = 'id, task_code, title, detail, status, doc_ref, doccon_checked, drive_file_id, drive_file_name, ref_file_id, ref_file_name, status_history, created_at, updated_at, completed_at, is_archived, latest_comment, officer_id, reviewer_id, created_by, superseded_by';

// GET /api/tasks?role=BOSS
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const role = request.nextUrl.searchParams.get('role');
    const admin = await createServiceRoleClient();

    const { data: dbUser } = await admin
      .from('users')
      .select('id')
      .eq('email', user.email)
      .single();

    if (!dbUser) return NextResponse.json([]);

    let query = admin
      .from('tasks')
      .select(TASK_SELECT)
      .order('updated_at', { ascending: false });

    switch (role) {
      case 'STAFF':
        query = query.eq('officer_id', dbUser.id);
        break;
      case 'REVIEWER':
        query = query.eq('reviewer_id', dbUser.id);
        break;
      case 'BOSS':
        query = query.eq('created_by', dbUser.id).eq('is_archived', false);
        break;
      case 'DOCCON':
        // DOCCON sees all active tasks
        query = query.eq('is_archived', false);
        break;
      case 'SUPER_BOSS':
        // SUPER_BOSS tracking should see all active tasks (same as DOCCON)
        query = query.eq('is_archived', false);
        break;
      case 'completed': {
        const userRolesSet = new Set(user.roles);

        let completedQuery = admin
          .from('tasks')
          .select(TASK_SELECT)
          .eq('status', 'COMPLETED')
          .order('updated_at', { ascending: false })
          .limit(100);

        if (!userRolesSet.has('DOCCON') && !userRolesSet.has('SUPER_ADMIN')) {
          completedQuery = completedQuery.or(
            `officer_id.eq.${dbUser.id},reviewer_id.eq.${dbUser.id},created_by.eq.${dbUser.id}`
          );
        }

        query = completedQuery;
        break;
      }
      default:
        query = query
          .or(`officer_id.eq.${dbUser.id},reviewer_id.eq.${dbUser.id},created_by.eq.${dbUser.id}`)
          .eq('is_archived', false);
    }

    const { data: tasks, error } = await query;
    if (error) throw error;

    const taskRows = tasks ?? [];
    const userIds = [...new Set([
      ...taskRows.map(t => t.officer_id),
      ...taskRows.map(t => t.reviewer_id),
      ...taskRows.map(t => t.created_by),
    ].filter(Boolean))];

    const { data: usersData } = await admin
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds);

    const usersMap = Object.fromEntries((usersData ?? []).map(u => [u.id, u]));

    const result = taskRows.map(t => ({
      ...t,
      officer: usersMap[t.officer_id] ?? null,
      reviewer: usersMap[t.reviewer_id] ?? null,
      creator: usersMap[t.created_by] ?? null,
    }));

    return NextResponse.json(result);
  } catch (err) {
    return handleAuthError(err);
  }
}

// POST /api/tasks - create task (BOSS only)
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['BOSS']);

    const { title, detail, officer_id, reviewer_id } = await request.json();

    if (!title || !officer_id || !reviewer_id) {
      return NextResponse.json({ error: 'กรุณากรอกข้อมูลให้ครบ' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();

    const { data: creator } = await admin
      .from('users')
      .select('id, display_name')
      .eq('email', user.email)
      .single();

    if (!creator) return NextResponse.json({ error: 'ไม่พบข้อมูลผู้ใช้' }, { status: 404 });

    const taskCode = `T_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const initialHistory = [{
      status: 'ASSIGNED',
      changedAt: now,
      changedBy: user.email,
      changedByName: creator.display_name,
      note: 'สร้างงานใหม่',
    }];

    const { data, error } = await admin
      .from('tasks')
      .insert({
        task_code: taskCode,
        title: title.trim(),
        detail: (detail ?? '').trim(),
        officer_id,
        reviewer_id,
        created_by: creator.id,
        status: 'ASSIGNED',
        status_history: initialHistory,
        comment_history: [],
        file_history: [],
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return handleAuthError(err);
  }
}
