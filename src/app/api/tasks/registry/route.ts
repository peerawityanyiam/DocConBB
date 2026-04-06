import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

// GET /api/tasks/registry — ทะเบียนเอกสาร (DOCCON only)
export async function GET() {
  try {
    const user = await getAuthUser('tracking');
    requireRole(user, ['DOCCON']);

    const admin = await createServiceRoleClient();

    // ดึง tasks ที่เสร็จแล้วและมี doc_ref
    const { data: tasks, error } = await admin
      .from('tasks')
      .select('id, task_code, title, doc_ref, completed_at')
      .eq('status', 'COMPLETED')
      .not('doc_ref', 'is', null)
      .order('doc_ref', { ascending: true })
      .order('completed_at', { ascending: false });

    if (error) throw error;

    // Group by doc_ref
    const grouped = new Map<string, {
      doc_ref: string;
      latestTitle: string;
      latestTaskCode: string;
      completedAt: string | null;
      versionCount: number;
      tasks: { id: string; task_code: string; title: string; completed_at: string | null }[];
    }>();

    for (const t of tasks ?? []) {
      const ref = t.doc_ref as string;
      if (!grouped.has(ref)) {
        grouped.set(ref, {
          doc_ref: ref,
          latestTitle: t.title,
          latestTaskCode: t.task_code,
          completedAt: t.completed_at,
          versionCount: 0,
          tasks: [],
        });
      }
      const entry = grouped.get(ref)!;
      entry.versionCount += 1;
      entry.tasks.push({
        id: t.id,
        task_code: t.task_code,
        title: t.title,
        completed_at: t.completed_at,
      });
    }

    // Sort by doc_ref ascending (already ordered from query)
    const result = Array.from(grouped.values());

    return NextResponse.json(result);
  } catch (err) {
    return handleAuthError(err);
  }
}
