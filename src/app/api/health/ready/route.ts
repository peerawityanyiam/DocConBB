import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getRequestIdFromHeaders, logEvent } from '@/lib/ops/observability';

const REQUIRED_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_UPLOAD_FOLDER_ID',
] as const;

export async function GET(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const missingEnv = REQUIRED_ENV_KEYS.filter((key) => !process.env[key]);

  if (missingEnv.length > 0) {
    const response = NextResponse.json(
      {
        ok: false,
        status: 'not_ready',
        reason: 'missing_env',
        missingEnv,
        requestId,
      },
      { status: 503 },
    );
    response.headers.set('x-request-id', requestId);
    return response;
  }

  try {
    const admin = await createServiceRoleClient();
    const { error } = await admin.from('projects').select('id').limit(1);
    if (error) throw error;

    const response = NextResponse.json(
      {
        ok: true,
        status: 'ready',
        checks: {
          env: 'ok',
          database: 'ok',
        },
        now: new Date().toISOString(),
        requestId,
      },
      { status: 200 },
    );
    response.headers.set('x-request-id', requestId);
    return response;
  } catch (err) {
    logEvent('error', 'health_ready', requestId, 'Readiness database check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    const response = NextResponse.json(
      {
        ok: false,
        status: 'not_ready',
        reason: 'database_unavailable',
        requestId,
      },
      { status: 503 },
    );
    response.headers.set('x-request-id', requestId);
    return response;
  }
}
