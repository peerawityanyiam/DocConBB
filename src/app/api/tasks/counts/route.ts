import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

const STAFF_ACTIONABLE = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];

type CountResult = { count: number | null; error: unknown };

async function countExact(query: PromiseLike<CountResult>) {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

// GET /api/tasks/counts
export async function GET() {
  try {
    const user = await getAuthUser('tracking');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = await createServiceRoleClient();
    const userId = user.id;
    const roleSet = new Set(user.roles);

    const counts: Record<string, number> = {};

    if (roleSet.has('STAFF')) {
      counts.STAFF = await countExact(
        admin
          .from('tasks')
          .select('id', { head: true, count: 'exact' })
          .eq('officer_id', userId)
          .in('status', STAFF_ACTIONABLE)
          .eq('is_archived', false)
      );
    }

    if (roleSet.has('DOCCON')) {
      counts.DOCCON = await countExact(
        admin
          .from('tasks')
          .select('id', { head: true, count: 'exact' })
          .eq('status', 'SUBMITTED_TO_DOCCON')
          .eq('is_archived', false)
      );
    }

    if (roleSet.has('REVIEWER')) {
      counts.REVIEWER = await countExact(
        admin
          .from('tasks')
          .select('id', { head: true, count: 'exact' })
          .eq('reviewer_id', userId)
          .eq('status', 'PENDING_REVIEW')
          .eq('is_archived', false)
      );
    }

    if (roleSet.has('BOSS')) {
      counts.BOSS = await countExact(
        admin
          .from('tasks')
          .select('id', { head: true, count: 'exact' })
          .eq('created_by', userId)
          .eq('status', 'WAITING_BOSS_APPROVAL')
          .eq('is_archived', false)
      );
    }

    if (roleSet.has('SUPER_BOSS')) {
      counts.SUPER_BOSS = await countExact(
        admin
          .from('tasks')
          .select('id', { head: true, count: 'exact' })
          .eq('status', 'WAITING_SUPER_BOSS_APPROVAL')
          .eq('is_archived', false)
      );
    }

    if (roleSet.has('DOCCON') || roleSet.has('SUPER_BOSS') || roleSet.has('SUPER_ADMIN')) {
      counts.completed = await countExact(
        admin
          .from('tasks')
          .select('id', { head: true, count: 'exact' })
          .eq('status', 'COMPLETED')
      );
    } else {
      counts.completed = await countExact(
        admin
          .from('tasks')
          .select('id', { head: true, count: 'exact' })
          .eq('status', 'COMPLETED')
          .or(`officer_id.eq.${userId},reviewer_id.eq.${userId},created_by.eq.${userId}`)
      );
    }

    return NextResponse.json({ counts });
  } catch (err) {
    return handleAuthError(err);
  }
}
