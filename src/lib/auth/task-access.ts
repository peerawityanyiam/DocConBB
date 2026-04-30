import { AuthError } from '@/lib/auth/guards';

export type TaskAccessRole = string;

export interface TaskAccessTarget {
  created_by: string | null;
  officer_id: string | null;
  reviewer_id: string | null;
}

// Oversight roles that can view/comment on any task (matches the "tracking
// all tasks" sub-tab they already see in the dashboard).
const OVERSIGHT_ROLES = new Set(['SUPER_ADMIN', 'SUPER_BOSS', 'DOCCON']);

export function canAccessTask(
  task: TaskAccessTarget,
  userId: string,
  roles: readonly TaskAccessRole[],
): boolean {
  const roleSet = new Set(roles.map((role) => role.toUpperCase()));
  for (const r of roleSet) {
    if (OVERSIGHT_ROLES.has(r)) return true;
  }
  if (task.created_by === userId) return true;
  if (task.officer_id === userId) return true;
  if (task.reviewer_id === userId) return true;
  return false;
}

export function assertTaskAccess(
  task: TaskAccessTarget,
  userId: string,
  roles: readonly TaskAccessRole[],
): void {
  if (!canAccessTask(task, userId, roles)) {
    throw new AuthError('No access to this task.', 403);
  }
}
