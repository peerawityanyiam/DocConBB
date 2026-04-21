import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { AuthError, getAuthUser, handleAuthError, hasGlobalRole } from '@/lib/auth/guards';
import { SHORTCUT_ICONS } from '@/lib/shortcuts/icons';

const MAX_LABEL_LEN = 60;
const MAX_URL_LEN = 2048;
const VALID_ICON_KEYS = new Set(SHORTCUT_ICONS.map((i) => i.key));

function validUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function badRequest(message: string) {
  return NextResponse.json({ error: 'bad_request', message }, { status: 400 });
}

// PATCH /api/shortcuts/[id] — update label/url/icon/sort_order/is_active.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (!(await hasGlobalRole(user.id, ['SUPER_ADMIN']))) {
      throw new AuthError('ไม่มีสิทธิ์ดำเนินการ', 403);
    }

    const { id } = await params;
    if (!id) return badRequest('missing id');

    const body = (await request.json()) as {
      label?: string;
      url?: string;
      icon_key?: string | null;
      sort_order?: number;
      is_active?: boolean;
    };

    const updates: Record<string, unknown> = {};

    if (typeof body.label === 'string') {
      const label = body.label.trim();
      if (!label || label.length > MAX_LABEL_LEN) {
        return badRequest(`label is required (<= ${MAX_LABEL_LEN} chars)`);
      }
      updates.label = label;
    }
    if (typeof body.url === 'string') {
      const cleanUrl = validUrl(body.url.trim());
      if (!cleanUrl || cleanUrl.length > MAX_URL_LEN) {
        return badRequest('url must be a valid http(s) URL');
      }
      updates.url = cleanUrl;
    }
    if (body.icon_key === null) {
      updates.icon_key = null;
    } else if (typeof body.icon_key === 'string') {
      const key = body.icon_key.trim();
      if (key && !VALID_ICON_KEYS.has(key)) {
        return badRequest('icon_key is not recognized');
      }
      updates.icon_key = key || null;
    }
    if (typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)) {
      updates.sort_order = Math.trunc(body.sort_order);
    }
    if (typeof body.is_active === 'boolean') {
      updates.is_active = body.is_active;
    }

    if (Object.keys(updates).length === 0) {
      return badRequest('no fields to update');
    }

    const admin = await createServiceRoleClient();
    const { data, error } = await admin
      .from('external_shortcuts')
      .update(updates)
      .eq('id', id)
      .select('id, label, url, icon_key, sort_order, is_active, created_at, updated_at')
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, shortcut: data });
  } catch (err) {
    return handleAuthError(err, { scope: 'shortcuts.update' });
  }
}

// DELETE /api/shortcuts/[id] — hard delete (we only ever have a handful).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (!(await hasGlobalRole(user.id, ['SUPER_ADMIN']))) {
      throw new AuthError('ไม่มีสิทธิ์ดำเนินการ', 403);
    }

    const { id } = await params;
    if (!id) return badRequest('missing id');

    const admin = await createServiceRoleClient();
    const { error } = await admin.from('external_shortcuts').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err, { scope: 'shortcuts.delete' });
  }
}
