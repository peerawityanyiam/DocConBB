import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';
import { checkFolderExists, copyTemplate } from '@/lib/google-drive/files';

const LIBRARY_FOLDER_ID = '10Ithv7g75Sd0he6IuVP6Nwk0IIVCFw1i';
const LIBRARY_TEMPLATE_ID = process.env.GOOGLE_LIBRARY_TEMPLATE_ID || '1HKO-Nfg3bV0QbP2WTK4V2R_eoywruNrolxOjVJS8mjo';

// POST /api/library/create - สร้างมาตรฐานใหม่ (DOCCON only)
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const { name, url, is_link, start_date, end_date, always_open } = await request.json();
    const normalizedName = typeof name === 'string' ? name.trim() : '';

    if (!normalizedName) {
      return NextResponse.json({ error: 'กรุณากรอกชื่อเอกสาร' }, { status: 400 });
    }

    const admin = await createServiceRoleClient();

    const { data: dbUser } = await admin
      .from('users')
      .select('id')
      .eq('email', user.email)
      .single();

    if (!dbUser) {
      return NextResponse.json({ error: 'ไม่พบข้อมูลผู้ใช้' }, { status: 404 });
    }

    // กันชื่อซ้ำ (case-insensitive) เพื่อไม่ให้หลุดไปเป็น 500
    const { data: dup, error: dupError } = await admin
      .from('standards')
      .select('id')
      .ilike('name', normalizedName)
      .maybeSingle();

    if (dupError) throw dupError;

    if (dup) {
      return NextResponse.json(
        { error: `ชื่อเอกสาร "${normalizedName}" มีอยู่แล้ว กรุณาเปลี่ยนชื่อใหม่` },
        { status: 409 }
      );
    }

    const linkMode = Boolean(is_link);
    let finalUrl = typeof url === 'string' ? url.trim() : '';
    let driveFileId: string | null = null;

    // เอกสารปกติ: สร้างไฟล์จาก Template เพื่อให้ได้ GAS menu เพิ่ม/ลบเอกสารเหมือนระบบเดิม
    if (!linkMode) {
      const folderOk = await checkFolderExists(LIBRARY_FOLDER_ID);
      if (!folderOk) {
        return NextResponse.json({ error: 'ไม่พบโฟลเดอร์ปลายทางของคลังเอกสาร' }, { status: 500 });
      }

      try {
        const copied = await copyTemplate(LIBRARY_TEMPLATE_ID, normalizedName, LIBRARY_FOLDER_ID);
        driveFileId = copied.id;
        finalUrl = copied.url || `https://docs.google.com/spreadsheets/d/${copied.id}/edit`;
      } catch (copyErr) {
        const copyMsg = copyErr instanceof Error ? copyErr.message : 'ไม่สามารถคัดลอก Template ได้';
        return NextResponse.json({ error: `สร้างไฟล์เอกสารไม่สำเร็จ: ${copyMsg}` }, { status: 500 });
      }
    }

    const { data, error } = await admin
      .from('standards')
      .insert({
        name: normalizedName,
        url: finalUrl,
        drive_file_id: driveFileId,
        is_link: linkMode,
        start_date: start_date ?? null,
        end_date: end_date ?? null,
        always_open: always_open ?? false,
        created_by: dbUser.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `ชื่อเอกสาร "${normalizedName}" มีอยู่แล้ว กรุณาเปลี่ยนชื่อใหม่` },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('[library/create] failed:', err);
    const message =
      typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : null;

    if (message) {
      return NextResponse.json({ error: `สร้างรายการเอกสารไม่สำเร็จ: ${message}` }, { status: 500 });
    }

    return handleAuthError(err);
  }
}
