import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedEmail, AUTH_CONFIG } from '@/lib/auth/config';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? AUTH_CONFIG.defaultRedirect;

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  // Upsert user into public.users table
  const { createClient } = await import('@supabase/supabase-js');
  const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Check if user already exists by email (pre-created by admin)
  const { data: existingUser } = await serviceClient
    .from('users')
    .select('id')
    .ilike('email', user.email)
    .single();

  if (existingUser) {
    // User pre-exists — update metadata only, never overwrite id
    await serviceClient.from('users').update({
      avatar_url: user.user_metadata?.avatar_url || null,
    }).eq('id', existingUser.id);
  } else {
    // New user — insert with Supabase Auth id
    await serviceClient.from('users').insert({
      id: user.id,
      email: user.email,
      display_name: user.user_metadata?.full_name || user.email.split('@')[0],
      avatar_url: user.user_metadata?.avatar_url || null,
    });
  }

  return NextResponse.redirect(`${origin}${next}`);
}
