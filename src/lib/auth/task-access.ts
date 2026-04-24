import { AuthError } from '@/lib/auth/guards';

export type TaskAccessRole = string;

export interface TaskAccessTarget {
  created_by: string | null;
  officer_id: string | null;
  reviewer_id: string | null;
}

export function canAccessTask(
  task: TaskAccessTarget,
  userId: string,
  roles: readonly TaskAccessRole[],
): boolean {
  const roleSet = new Set(roles.map((role) => role.toUpperCase()));
  if (roleSet.has('SUPER_ADMIN')) return true;
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
