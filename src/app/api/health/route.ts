import { NextRequest, NextResponse } from 'next/server';
import { getRequestIdFromHeaders, logEvent } from '@/lib/ops/observability';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { checkFolderExists } from '@/lib/google-drive/files';

type CheckStatus = 'ok' | 'fail' | 'skipped';
type CheckResult = { status: CheckStatus; latencyMs: number; error?: string };

const CHECK_TIMEOUT_MS = 3000;

async function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function checkSupabase(): Promise<CheckResult> {
  const started = Date.now();
  try {
    const admin = await createServiceRoleClient();
    const result = await withTimeout(
      admin.from('projects').select('id', { count: 'exact', head: true }).limit(1),
      CHECK_TIMEOUT_MS,
      'supabase',
    );
    if (result.error) throw result.error;
    return { status: 'ok', latencyMs: Date.now() - started };
  } catch (err) {
    return {
      status: 'fail',
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkDrive(): Promise<CheckResult> {
  const started = Date.now();
  const folderId = process.env.GOOGLE_UPLOAD_FOLDER_ID?.trim();
  if (!folderId) {
    return { status: 'skipped', latencyMs: 0, error: 'GOOGLE_UPLOAD_FOLDER_ID not set' };
  }
  try {
    const exists = await withTimeout(checkFolderExists(folderId), CHECK_TIMEOUT_MS, 'drive');
    if (!exists) {
      return {
        status: 'fail',
        latencyMs: Date.now() - started,
        error: 'upload folder not accessible',
      };
    }
    return { status: 'ok', latencyMs: Date.now() - started };
  } catch (err) {
    return {
      status: 'fail',
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const deep = request.nextUrl.searchParams.get('deep') !== '0';

  const [supabase, drive]: CheckResult[] = deep
    ? await Promise.all([checkSupabase(), checkDrive()])
    : [
        { status: 'skipped', latencyMs: 0 },
        { status: 'skipped', latencyMs: 0 },
      ];

  const anyFail = supabase.status === 'fail' || drive.status === 'fail';
  const httpStatus = anyFail ? 503 : 200;

  if (anyFail) {
    logEvent('error', 'health', requestId, 'dependency check failed', {
      supabase,
      drive,
    });
  }

  const response = NextResponse.json(
    {
      ok: !anyFail,
      service: 'hospital-docs',
      status: anyFail ? 'degraded' : 'alive',
      now: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      checks: { supabase, drive },
      requestId,
    },
    { status: httpStatus },
  );
  response.headers.set('x-request-id', requestId);
  response.headers.set('cache-control', 'no-store');
  return response;
}
