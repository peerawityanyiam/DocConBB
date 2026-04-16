import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export type AppRole = 'STAFF' | 'DOCCON' | 'REVIEWER' | 'BOSS' | 'SUPER_BOSS' | 'SUPER_ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  roles: AppRole[];
}

export async function getAuthUser(projectSlug: string): Promise<AuthUser | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) return null;
  const normalizedEmail = user.email.trim().toLowerCase();
  const admin = await createServiceRoleClient();

  const { data: dbUser } = await admin
    .from('users')
    .select('id')
    .ilike('email', normalizedEmail)
    .single();

  if (!dbUser) return null;

  const { data: projectRoles } = await admin
    .from('user_project_roles')
    .select('role, projects!inner(slug)')
    .eq('user_id', dbUser.id)
    .eq('projects.slug', projectSlug);

  // Backward compatibility: some older users may still have roles in legacy user_roles only.
  const { data: legacyRoles } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', dbUser.id);

  const mergedRoles = new Set<AppRole>();
  for (const row of projectRoles ?? []) mergedRoles.add(row.role as AppRole);
  for (const row of legacyRoles ?? []) mergedRoles.add(row.role as AppRole);

  return {
    id: dbUser.id,
    email: normalizedEmail,
    roles: Array.from(mergedRoles),
  };
}

export function hasRole(user: AuthUser, allowedRoles: AppRole[]): boolean {
  return user.roles.some(r => allowedRoles.includes(r));
}

export function requireRole(user: AuthUser | null, allowedRoles: AppRole[]): AuthUser {
  if (!user) {
    throw new AuthError('ไม่พบข้อมูลผู้ใช้', 401);
  }
  if (!hasRole(user, allowedRoles)) {
    throw new AuthError('ไม่มีสิทธิ์ดำเนินการ', 403);
  }
  return user;
}

export class AuthError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'AuthError';
  }
}

export function handleAuthError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    );
  }
  console.error('Unexpected error:', error);
  return NextResponse.json(
    { error: 'เกิดข้อผิดพลาดภายใน' },
    { status: 500 }
  );
}
