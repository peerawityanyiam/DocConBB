import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser('tracking');
    requireRole(user, ['DOCCON']);

    const ref = request.nextUrl.searchParams.get('ref')?.trim();
    if (!ref) return NextResponse.json({ docRef: '', found: false, matches: [] });

    const admin = await createServiceRoleClient();
    const { data: tasks } = await admin
      .from('tasks')
      .select('id, title, status, completed_at')
      .eq('doc_ref', ref);

    const matches = (tasks ?? []).map(t => ({
      taskId: t.id,
      title: t.title,
      status: t.status,
      completedAt: t.completed_at ?? '',
    }));

    return NextResponse.json({ docRef: ref, found: matches.length > 0, matches });
  } catch (err) {
    return handleAuthError(err);
  }
}
