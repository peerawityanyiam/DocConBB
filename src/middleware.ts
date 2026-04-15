import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/callback', '/api/cron'];
const DOCUMENT_CONTROL_GAS_URL =
  process.env.NEXT_PUBLIC_DOCUMENT_CONTROL_GAS_URL ||
  'https://accounts.google.com/AccountChooser?continue=https://script.google.com/a/macros/medicine.psu.ac.th/s/AKfycbx0oytFnXvNDaMfPkfLTUQKd8zr-uHpNhuaJNv2csLnM3pKADaWxpa0laQcVciTvRe-/exec';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Deprecated internal library module: force route to GAS
  if (pathname === '/library' || pathname.startsWith('/library/')) {
    return NextResponse.redirect(DOCUMENT_CONTROL_GAS_URL);
  }

  // Deprecated internal library APIs: disable to avoid accidentally running old flow
  if (pathname === '/api/library' || pathname.startsWith('/api/library/')) {
    return NextResponse.json(
      { error: 'Internal library API is deprecated. Please use Document Control (GAS).' },
      { status: 410 },
    );
  }

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  const allowedDomain = process.env.ALLOWED_DOMAIN || 'medicine.psu.ac.th';
  if (user.email && !user.email.endsWith(`@${allowedDomain}`)) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('error', 'domain');
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|.*\\.png$).*)',
  ],
};
