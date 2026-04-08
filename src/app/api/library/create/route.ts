import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';
import { assertFolderAccessible, copyTemplate } from '@/lib/google-drive/files';
import { grantAccess } from '@/lib/google-drive/permissions';

const LIBRARY_FOLDER_ID = '10Ithv7g75Sd0he6IuVP6Nwk0IIVCFw1i';
const LIBRARY_TEMPLATE_ID = process.env.GOOGLE_LIBRARY_TEMPLATE_ID || '1HKO-Nfg3bV0QbP2WTK4V2R_eoywruNrolxOjVJS8mjo';
const IMPERSONATE_EMAIL = process.env.GOOGLE_IMPERSONATE_EMAIL?.trim();

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
      if (!IMPERSONATE_EMAIL) {
        return NextResponse.json(
          {
            error:
              'ยังไม่ได้ตั้งค่า GOOGLE_IMPERSONATE_EMAIL ทำให้ไฟล์ถูกสร้างโดย service account และ Apps Script จะรันไม่ได้ กรุณาตั้งเป็นอีเมลผู้ใช้จริงก่อนสร้างเอกสาร',
          },
          { status: 500 }
        );
      }

      try {
        await assertFolderAccessible(LIBRARY_FOLDER_ID);
      } catch (folderErr) {
        const msg = folderErr instanceof Error ? folderErr.message : 'ไม่สามารถเข้าถึงโฟลเดอร์ปลายทางของคลังเอกสารได้';
        return NextResponse.json(
          { error: `เข้าถึงโฟลเดอร์คลังเอกสารไม่ได้: ${msg}` },
          { status: 500 }
        );
      }

      try {
        const copied = await copyTemplate(LIBRARY_TEMPLATE_ID, normalizedName, LIBRARY_FOLDER_ID);
        driveFileId = copied.id;
        finalUrl = `https://docs.google.com/spreadsheets/d/${copied.id}/edit`;

        // ให้ผู้สร้างแก้ไขได้แน่นอน
        try {
          await grantAccess(copied.id, user.email, 'writer');
        } catch {
          // skip: may already have permission from shared drive
        }

        // ensure impersonated owner has explicit writer access too
        try {
          await grantAccess(copied.id, IMPERSONATE_EMAIL, 'writer');
        } catch {
          // skip duplicate permission
        }

        // ให้ DocCon/SuperAdmin ของ project library มีสิทธิ์ writer ด้วย
        try {
          const { data: libraryProject } = await admin
            .from('projects')
            .select('id')
            .eq('slug', 'library')
            .single();

          if (libraryProject?.id) {
            const { data: roleRows } = await admin
              .from('user_project_roles')
              .select('users!inner(email)')
              .eq('project_id', libraryProject.id)
              .in('role', ['DOCCON', 'SUPER_ADMIN']);

            const emails = Array.from(
              new Set(
                (roleRows ?? [])
                  .map((r: { users?: { email?: string } | Array<{ email?: string }> }) => {
                    if (Array.isArray(r.users)) return r.users[0]?.email?.trim().toLowerCase();
                    return r.users?.email?.trim().toLowerCase();
                  })
                  .filter((email): email is string => Boolean(email))
              )
            );

            for (const email of emails) {
              try {
                await grantAccess(copied.id, email, 'writer');
              } catch {
                // ignore duplicate permission / policy conflict per user
              }
            }
          }
        } catch {
          // non-blocking: file is already created and linked
        }
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
