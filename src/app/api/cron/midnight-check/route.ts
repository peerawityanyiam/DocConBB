import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { setFilePublic, setFilePrivate } from '@/lib/google-drive/permissions';
import { calculateDocStatus } from '@/lib/utils/status';

// GET /api/cron/midnight-check — Vercel cron (0 17 * * * UTC = เที่ยงคืน Bangkok)
// ตรวจสอบ standards ทั้งหมด แล้วปรับ Drive permissions ตามสถานะ
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization');
  if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = await createServiceRoleClient();
  const { data: standards, error } = await admin
    .from('standards')
    .select('id, drive_file_id, start_date, end_date, always_open, locked, hidden')
    .not('drive_file_id', 'is', null);

  if (error) {
    console.error('Cron: failed to fetch standards', error);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  let publicized = 0;
  let privatized = 0;
  const errors: string[] = [];

  for (const std of standards ?? []) {
    if (!std.drive_file_id) continue;

    const status = calculateDocStatus(
      std.start_date ?? null,
      std.end_date ?? null,
      std.always_open,
      std.locked
    );

    try {
      if (status === 'OPEN') {
        await setFilePublic(std.drive_file_id);
        publicized++;
      } else {
        // LOCKED, EXPIRED, NOT_YET, NOT_SET → ปิด public access
        await setFilePrivate(std.drive_file_id);
        privatized++;
      }
    } catch (err) {
      const msg = `standard ${std.id}: ${err instanceof Error ? err.message : 'unknown'}`;
      errors.push(msg);
      console.error('Cron error:', msg);
    }
  }

  console.log(`Cron midnight-check done: ${publicized} public, ${privatized} private, ${errors.length} errors`);

  return NextResponse.json({
    ok: true,
    processed: (standards ?? []).length,
    publicized,
    privatized,
    errors,
    timestamp: new Date().toISOString(),
  });
}
