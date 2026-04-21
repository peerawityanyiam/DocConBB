import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { AuthError, getAuthUser, handleAuthError, hasGlobalRole } from '@/lib/auth/guards';
import { SHORTCUT_ICONS } from '@/lib/shortcuts/icons';

const MAX_LABEL_LEN = 60;
const MAX_URL_LEN = 2048;
const MAX_SHORTCUTS = 30;
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

// GET /api/shortcuts — everyone signed in; returns active shortcuts ordered.
export async function GET() {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const admin = await createServiceRoleClient();
    const { data, error } = await admin
      .from('external_shortcuts')
      .select('id, label, url, icon_key, sort_order, is_active, created_at, updated_at')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    return NextResponse.json({ shortcuts: data ?? [] });
  } catch (err) {
    return handleAuthError(err, { scope: 'shortcuts.list' });
  }
}

// POST /api/shortcuts — SUPER_ADMIN only.
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('hub');
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (!(await hasGlobalRole(user.id, ['SUPER_ADMIN']))) {
      throw new AuthError('ไม่มีสิทธิ์ดำเนินการ', 403);
    }

    const body = (await request.json()) as {
      label?: string;
      url?: string;
      icon_key?: string | null;
    };

    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
    const iconKey =
      typeof body.icon_key === 'string' && body.icon_key.trim()
        ? body.icon_key.trim()
        : null;

    if (!label || label.length > MAX_LABEL_LEN) {
      return badRequest(`label is required (<= ${MAX_LABEL_LEN} chars)`);
    }
    if (!rawUrl || rawUrl.length > MAX_URL_LEN) {
      return badRequest(`url is required (<= ${MAX_URL_LEN} chars)`);
    }
    const cleanUrl = validUrl(rawUrl);
    if (!cleanUrl) return badRequest('url must be a valid http(s) URL');
    if (iconKey !== null && !VALID_ICON_KEYS.has(iconKey)) {
      return badRequest('icon_key is not recognized');
    }

    const admin = await createServiceRoleClient();

    const { count } = await admin
      .from('external_shortcuts')
      .select('*', { count: 'exact', head: true });
    if ((count ?? 0) >= MAX_SHORTCUTS) {
      return badRequest(`จำนวนลิงก์ครบจำนวนที่รองรับแล้ว (สูงสุด ${MAX_SHORTCUTS})`);
    }

    // Default sort_order = max + 1 so new items land at the end.
    const { data: maxRow } = await admin
      .from('external_shortcuts')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (maxRow?.sort_order ?? -1) + 1;

    const { data, error } = await admin
      .from('external_shortcuts')
      .insert({
        label,
        url: cleanUrl,
        icon_key: iconKey,
        sort_order: nextSort,
        is_active: true,
        created_by: user.id,
      })
      .select('id, label, url, icon_key, sort_order, is_active, created_at, updated_at')
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, shortcut: data }, { status: 201 });
  } catch (err) {
    return handleAuthError(err, { scope: 'shortcuts.create' });
  }
}
