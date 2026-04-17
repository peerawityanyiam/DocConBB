import { NextRequest, NextResponse } from 'next/server';
import { getRequestIdFromHeaders } from '@/lib/ops/observability';

export async function GET(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const response = NextResponse.json(
    {
      ok: true,
      service: 'hospital-docs',
      status: 'alive',
      now: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      requestId,
    },
    { status: 200 },
  );
  response.headers.set('x-request-id', requestId);
  return response;
}
