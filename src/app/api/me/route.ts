import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = await createServiceRoleClient();

  const { data: dbUser } = await admin
    .from('users')
    .select('id, display_name, email')
    .eq('email', user.email)
    .single();

  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data: roleRows } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', dbUser.id);

  return NextResponse.json({
    id: dbUser.id,
    display_name: dbUser.display_name,
    email: dbUser.email,
    roles: (roleRows ?? []).map(r => r.role),
  });
}
