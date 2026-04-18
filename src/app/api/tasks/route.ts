import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

const TASK_SELECT = 'id, task_code, title, detail, status, doc_ref, doccon_checked, drive_file_id, drive_file_name, ref_file_id, ref_file_name, drive_uploaded, sent_to_branch, status_history, file_history, created_at, updated_at, completed_at, is_archived, latest_comment, officer_id, reviewer_id, created_by, superseded_by';
const ALLOWED_QUERY_ROLES = new Set(['STAFF', 'REVIEWER', 'BOSS', 'DOCCON', 'SUPER_BOSS', 'completed']);
const MAX_TITLE_LEN = 300;
const MAX_DETAIL_LEN = 5000;

// GET /api/tasks?role=BOSS
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const role = request.nextUrl.searchParams.get('role');
    const scope = request.nextUrl.searchParams.get('scope') === 'completed' ? 'completed' : 'active';
    if (role && !ALLOWED_QUERY_ROLES.has(role)) {
      return NextResponse.json({ error: 'Invalid role filter.' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();
    const dbUserId = user.id;

    let query = admin
      .from('tasks')
      .select(TASK_SELECT)
      .order('updated_at', { ascending: false });

    switch (role) {
      case 'STAFF':
        if (scope === 'completed') {
          query = query.eq('officer_id', dbUserId).eq('status', 'COMPLETED');
        } else {
          query = query
            .eq('officer_id', dbUserId)
            .eq('is_archived', false)
            .neq('status', 'COMPLETED')
            .neq('status', 'CANCELLED');
        }
        break;
      case 'REVIEWER':
        if (scope === 'completed') {
          query = query.eq('reviewer_id', dbUserId).eq('status', 'COMPLETED');
        } else {
          query = query
            .eq('reviewer_id', dbUserId)
            .eq('is_archived', false)
            .neq('status', 'COMPLETED')
            .neq('status', 'CANCELLED');
        }
        break;
      case 'BOSS':
        if (scope === 'completed') {
          query = query.eq('created_by', dbUserId).eq('status', 'COMPLETED');
        } else {
          query = query
            .eq('created_by', dbUserId)
            .eq('is_archived', false)
            .neq('status', 'COMPLETED')
            .neq('status', 'CANCELLED');
        }
        break;
      case 'DOCCON':
        query = query.eq('is_archived', false);
        break;
      case 'SUPER_BOSS':
        query = query.eq('is_archived', false);
        break;
      case 'completed': {
        const userRolesSet = new Set(user.roles);

        let completedQuery = admin
          .from('tasks')
          .select(TASK_SELECT)
          .eq('status', 'COMPLETED')
          .order('updated_at', { ascending: false });

        if (!userRolesSet.has('DOCCON') && !userRolesSet.has('SUPER_ADMIN')) {
          completedQuery = completedQuery.or(
            `officer_id.eq.${dbUserId},reviewer_id.eq.${dbUserId},created_by.eq.${dbUserId}`,
          );
        }

        query = completedQuery;
        break;
      }
      default:
        query = query
          .or(`officer_id.eq.${dbUserId},reviewer_id.eq.${dbUserId},created_by.eq.${dbUserId}`)
          .eq('is_archived', false);
    }

    const { data: tasks, error } = await query;
    if (error) throw error;

    const taskRows = tasks ?? [];
    const userIds = [
      ...new Set(
        [
          ...taskRows.map((t) => t.officer_id),
          ...taskRows.map((t) => t.reviewer_id),
          ...taskRows.map((t) => t.created_by),
        ].filter(Boolean),
      ),
    ];

    const { data: usersData } = await admin
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds);

    const usersMap = Object.fromEntries((usersData ?? []).map((u) => [u.id, u]));

    const result = taskRows.map((t) => ({
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

    const normalizedTitle = typeof title === 'string' ? title.trim() : '';
    const normalizedDetail = typeof detail === 'string' ? detail.trim() : '';
    const normalizedOfficerId = typeof officer_id === 'string' ? officer_id.trim() : '';
    const normalizedReviewerId = typeof reviewer_id === 'string' ? reviewer_id.trim() : '';

    if (!normalizedTitle || !normalizedOfficerId || !normalizedReviewerId) {
      return NextResponse.json({ error: 'กรุณากรอกข้อมูลให้ครบ' }, { status: 400 });
    }
    if (normalizedTitle.length > MAX_TITLE_LEN) {
      return NextResponse.json({ error: `ชื่องานยาวเกินไป (ไม่เกิน ${MAX_TITLE_LEN} ตัวอักษร)` }, { status: 400 });
    }
    if (normalizedDetail.length > MAX_DETAIL_LEN) {
      return NextResponse.json({ error: `รายละเอียดงานยาวเกินไป (ไม่เกิน ${MAX_DETAIL_LEN} ตัวอักษร)` }, { status: 400 });
    }
    const admin = await createServiceRoleClient();

    const { data: creator } = await admin
      .from('users')
      .select('id, display_name')
      .eq('id', user.id)
      .single();

    if (!creator) return NextResponse.json({ error: 'ไม่พบข้อมูลผู้ใช้' }, { status: 404 });

    const { data: targetUsers } = await admin
      .from('users')
      .select('id, is_active')
      .in('id', [normalizedOfficerId, normalizedReviewerId]);

    const targetUserMap = new Map((targetUsers ?? []).map((u) => [u.id, u]));
    const officerUser = targetUserMap.get(normalizedOfficerId);
    const reviewerUser = targetUserMap.get(normalizedReviewerId);
    if (!officerUser || officerUser.is_active === false) {
      return NextResponse.json({ error: 'ผู้รับผิดชอบไม่พร้อมใช้งาน' }, { status: 400 });
    }
    if (!reviewerUser || reviewerUser.is_active === false) {
      return NextResponse.json({ error: 'ผู้ตรวจสอบไม่พร้อมใช้งาน' }, { status: 400 });
    }

    const { data: roleRows } = await admin
      .from('user_project_roles')
      .select('user_id, role, projects!inner(slug)')
      .in('user_id', [normalizedOfficerId, normalizedReviewerId])
      .eq('projects.slug', 'tracking');

    const roleMap = new Map<string, Set<string>>();
    for (const row of roleRows ?? []) {
      const existing = roleMap.get(row.user_id) ?? new Set<string>();
      existing.add(row.role);
      roleMap.set(row.user_id, existing);
    }

    if (!roleMap.get(normalizedOfficerId)?.has('STAFF')) {
      return NextResponse.json({ error: 'ผู้รับผิดชอบต้องมีสิทธิ์เจ้าหน้าที่ (STAFF)' }, { status: 400 });
    }
    if (!roleMap.get(normalizedReviewerId)?.has('REVIEWER')) {
      return NextResponse.json({ error: 'ผู้ตรวจสอบต้องมีสิทธิ์ผู้ตรวจสอบ (REVIEWER)' }, { status: 400 });
    }

    const taskCode = `T_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const initialHistory = [
      {
        status: 'ASSIGNED',
        changedAt: now,
        changedBy: user.email,
        changedByName: creator.display_name,
        note: 'สร้างงานใหม่',
      },
    ];

    const { data, error } = await admin
      .from('tasks')
      .insert({
        task_code: taskCode,
        title: normalizedTitle,
        detail: normalizedDetail,
        officer_id: normalizedOfficerId,
        reviewer_id: normalizedReviewerId,
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
