import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError, requireRole } from '@/lib/auth/guards';
import { convertExcelToSpreadsheet, uploadFile } from '@/lib/google-drive/files';
import { setFilePublic } from '@/lib/google-drive/permissions';

// Fixed library upload folder (requested behavior to mirror GAS flow)
const LIBRARY_UPLOAD_FOLDER_ID = '10Ithv7g75Sd0he6IuVP6Nwk0IIVCFw1i';

// POST /api/library/files/upload — อัปโหลดไฟล์ผ่าน Service Account
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const standardId = formData.get('standardId') as string | null;

    if (!file) return NextResponse.json({ error: 'ไม่พบไฟล์' }, { status: 400 });
    if (!standardId) return NextResponse.json({ error: 'ไม่ระบุ standardId' }, { status: 400 });

    const admin = await createServiceRoleClient();

    // ตรวจสอบ file size (max 50MB)
    const MAX_BYTES = 50 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'ไฟล์ใหญ่เกิน 50MB' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload all library files into the fixed shared folder
    const folderId = LIBRARY_UPLOAD_FOLDER_ID;
    const lowerName = file.name.toLowerCase();
    const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');

    let driveFileId: string;
    let driveFileName: string;
    let viewUrl: string;
    if (isExcel) {
      const excelMimeType = file.type
        || (lowerName.endsWith('.xls')
          ? 'application/vnd.ms-excel'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const converted = await convertExcelToSpreadsheet(
        folderId,
        file.name,
        excelMimeType,
        buffer
      );
      driveFileId = converted.id;
      driveFileName = converted.name;
      viewUrl = converted.webViewLink ?? `https://docs.google.com/spreadsheets/d/${driveFileId}/edit`;
    } else {
      const uploaded = await uploadFile(
        folderId,
        file.name,
        file.type || 'application/octet-stream',
        buffer
      );
      driveFileId = uploaded.id;
      driveFileName = uploaded.name;
      viewUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
    }

    // ตั้งสิทธิ์ public (anyoneWithLink)
    await setFilePublic(driveFileId);

    // หา standard เพื่ออัปเดต drive_file_id
    const { data: standard } = await admin
      .from('standards')
      .select('drive_file_id')
      .eq('id', standardId)
      .single();

    if (!standard) {
      return NextResponse.json({ error: 'ไม่พบเอกสารในระบบ' }, { status: 404 });
    }

    // Soft-delete ไฟล์เก่าใน DB + trash ใน Drive ถ้ามี
    if (standard?.drive_file_id) {
      try {
        const { trashFile } = await import('@/lib/google-drive/files');
        await trashFile(standard.drive_file_id);
      } catch {
        console.error('Could not trash old file:', standard.drive_file_id);
      }
    }

    // อัปเดต standards table
    const { error: updateError } = await admin
      .from('standards')
      .update({
        drive_file_id: driveFileId,
        url: viewUrl,
        is_link: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', standardId);

    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      driveFileId,
      driveFileName,
      viewUrl,
    }, { status: 201 });
  } catch (err) {
    console.error('[library/files/upload] failed:', err);
    const message =
      typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : 'เกิดข้อผิดพลาดภายใน';
    const driveApiMessage =
      typeof err === 'object' &&
      err !== null &&
      'response' in err &&
      typeof (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message === 'string'
        ? (err as { response: { data: { error: { message: string } } } }).response.data.error.message
        : null;

    if (driveApiMessage) {
      return NextResponse.json({ error: `อัปโหลดไฟล์ไม่สำเร็จ: ${driveApiMessage}` }, { status: 500 });
    }

    if (message && message !== 'เกิดข้อผิดพลาดภายใน') {
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return handleAuthError(err);
  }
}
