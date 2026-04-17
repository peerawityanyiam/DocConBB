import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { generateRequestId } from '@/lib/ops/observability';

const PUBLIC_PATHS = ['/login', '/callback', '/api/cron', '/api/health'];
const DOCUMENT_CONTROL_GAS_URL =
  process.env.NEXT_PUBLIC_DOCUMENT_CONTROL_GAS_URL ||
  'https://accounts.google.com/AccountChooser?continue=https://script.google.com/a/macros/medicine.psu.ac.th/s/AKfycbx0oytFnXvNDaMfPkfLTUQKd8zr-uHpNhuaJNv2csLnM3pKADaWxpa0laQcVciTvRe-/exec';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = request.headers.get('x-request-id')?.trim() || generateRequestId();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);

  // Deprecated internal library module: force route to GAS
  if (pathname === '/library' || pathname.startsWith('/library/')) {
    const response = NextResponse.redirect(DOCUMENT_CONTROL_GAS_URL);
    response.headers.set('x-request-id', requestId);
    return response;
  }

  // Deprecated internal library APIs: disable to avoid accidentally running old flow
  if (pathname === '/api/library' || pathname.startsWith('/api/library/')) {
    const response = NextResponse.json(
      { error: 'Internal library API is deprecated. Please use Document Control (GAS).' },
      { status: 410 },
    );
    response.headers.set('x-request-id', requestId);
    return response;
  }

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.headers.set('x-request-id', requestId);
    return response;
  }

  const supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });
  supabaseResponse.headers.set('x-request-id', requestId);

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
    const response = NextResponse.redirect(url);
    response.headers.set('x-request-id', requestId);
    return response;
  }

  const allowedDomains = (process.env.ALLOWED_DOMAIN || 'medicine.psu.ac.th')
    .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
  const emailDomain = user.email ? user.email.toLowerCase().split('@')[1] : '';
  if (!emailDomain || !allowedDomains.includes(emailDomain)) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('error', 'domain');
    const response = NextResponse.redirect(url);
    response.headers.set('x-request-id', requestId);
    return response;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|.*\\.png$).*)',
  ],
};
