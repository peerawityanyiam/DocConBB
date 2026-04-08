import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';

// GET /api/tasks/check-doc-ref?doc_ref=FIN-001&task_id=xxx
// Returns { exists: boolean, file_name?: string, date?: string }
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ exists: false }, { status: 401 });

    const docRef = request.nextUrl.searchParams.get('doc_ref')?.trim();
    const taskId = request.nextUrl.searchParams.get('task_id')?.trim();

    if (!docRef) return NextResponse.json({ exists: false });

    const admin = await createServiceRoleClient();

    let query = admin
      .from('tasks')
      .select('id, drive_file_name, title, updated_at, completed_at, status')
      .eq('doc_ref', docRef)
      .neq('status', 'CANCELLED')
      .limit(1);

    // Exclude the current task itself
    if (taskId) {
      query = query.neq('id', taskId);
    }

    const { data: tasks } = await query;
    const found = (tasks ?? []).length > 0;

    if (found) {
      const t = tasks![0];
      return NextResponse.json({
        exists: true,
        file_name: t.drive_file_name ?? t.title,
        date: t.completed_at ?? t.updated_at,
      });
    }

    return NextResponse.json({ exists: false });
  } catch (err) {
    return handleAuthError(err);
  }
}
