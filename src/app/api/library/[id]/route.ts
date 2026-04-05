import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';

// PATCH /api/library/[id] — แก้ไขการตั้งค่า standard (DOCCON only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const { id } = await params;
    const body = await request.json();

    // Allowed fields to update
    const allowed = ['name', 'url', 'is_link', 'start_date', 'end_date', 'always_open', 'hidden', 'locked', 'sort_order'];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะอัปเดต' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();
    const { data, error } = await admin
      .from('standards')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return handleAuthError(err);
  }
}
