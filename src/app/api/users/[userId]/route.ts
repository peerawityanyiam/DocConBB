import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

// PATCH /api/users/[userId] — อัปเดต display_name หรือ is_active
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const user = await getAuthUser('tracking');
    requireRole(user, ['SUPER_ADMIN']);

    const { userId } = await params;
    const body = await request.json();

    // อนุญาตแค่ field ที่ระบุ
    const allowed: Record<string, unknown> = {};
    if (typeof body.display_name === 'string') allowed.display_name = body.display_name.trim();
    if (typeof body.is_active === 'boolean') allowed.is_active = body.is_active;

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะอัปเดต' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();
    const { data, error } = await admin
      .from('users')
      .update({ ...allowed, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    return handleAuthError(err);
  }
}
