import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError, requireRole } from '@/lib/auth/guards';
import { convertExcelToSpreadsheet, trashFile, uploadFile } from '@/lib/google-drive/files';
import { grantAccess, setFilePublic } from '@/lib/google-drive/permissions';
import { importExcelSheetsIntoSpreadsheet } from '@/lib/google-sheets/workbook';

// Fixed library upload folder (requested behavior to mirror GAS flow)
const LIBRARY_UPLOAD_FOLDER_ID = '10Ithv7g75Sd0he6IuVP6Nwk0IIVCFw1i';

// POST /api/library/files/upload - อัปโหลดไฟล์ผ่าน Service Account
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

    const { data: standard, error: stdError } = await admin
      .from('standards')
      .select('id, name, drive_file_id, is_link')
      .eq('id', standardId)
      .single();

    if (stdError) throw stdError;
    if (!standard) return NextResponse.json({ error: 'ไม่พบเอกสารในระบบ' }, { status: 404 });
    if (standard.is_link) {
      return NextResponse.json({ error: 'เอกสารนี้เป็นลิงก์ภายนอก ไม่สามารถอัปโหลดไฟล์ทับได้' }, { status: 400 });
    }

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
    let replacedInPlace = false;

    if (isExcel) {
      const excelMimeType = file.type
        || (lowerName.endsWith('.xls')
          ? 'application/vnd.ms-excel'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      // GAS behavior: ถ้ามีไฟล์ template อยู่แล้ว ให้ดูดชีตจาก Excel มาแทนชีตเดิมในไฟล์นั้น
      // เพื่อคงเมนู GAS เพิ่ม/ลบเอกสารไว้
      if (standard.drive_file_id) {
        // Ensure current DocCon can edit this sheet before importing
        try {
          await grantAccess(standard.drive_file_id, user.email, 'writer');
        } catch {
          // ignore duplicate permission / policy conflict
        }

        await importExcelSheetsIntoSpreadsheet({
          targetSpreadsheetId: standard.drive_file_id,
          tempFolderId: folderId,
          fileName: file.name,
          mimeType: excelMimeType,
          body: buffer,
          removeOriginalSheets: true,
        });

        driveFileId = standard.drive_file_id;
        driveFileName = standard.name || file.name.replace(/\.(xlsx|xls)$/i, '');
        viewUrl = `https://docs.google.com/spreadsheets/d/${driveFileId}/edit`;
        replacedInPlace = true;
      } else {
        // fallback กรณีเอกสารเก่ายังไม่มีไฟล์ผูกอยู่
        const converted = await convertExcelToSpreadsheet(
          folderId,
          file.name,
          excelMimeType,
          buffer
        );
        driveFileId = converted.id;
        driveFileName = converted.name;
        viewUrl = converted.webViewLink ?? `https://docs.google.com/spreadsheets/d/${driveFileId}/edit`;
      }
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

    // พยายามตั้งสิทธิ์ public (บางองค์กร block "anyone" ใน Shared Drive)
    // ถ้าตั้งไม่ได้ให้ทำงานต่อ เพื่อไม่ให้ผู้ใช้เห็นว่าอัปโหลดล้มทั้งที่ไฟล์ขึ้น Drive แล้ว
    let permissionWarning: string | null = null;
    try {
      await setFilePublic(driveFileId);
    } catch (permissionError) {
      const msg =
        typeof permissionError === 'object' &&
        permissionError !== null &&
        'message' in permissionError &&
        typeof (permissionError as { message?: unknown }).message === 'string'
          ? (permissionError as { message: string }).message
          : 'ไม่สามารถปรับสิทธิ์เป็นสาธารณะได้';
      permissionWarning = msg;
      console.warn('[library/files/upload] setFilePublic failed:', msg);
    }

    // non-Excel หรือ fallback Excel ใหม่: ถ้ามีไฟล์เก่าให้ย้ายถังขยะ
    if (!replacedInPlace && standard.drive_file_id && standard.drive_file_id !== driveFileId) {
      try {
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
      warning: permissionWarning,
      replacedInPlace,
    }, { status: 201 });
  } catch (err) {
    console.error('[library/files/upload] failed:', err);
    const rawMessage =
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

    const combinedMessage = [driveApiMessage, rawMessage].filter(Boolean).join(' ');
    if (/Google Sheets API has not been used|sheets\.googleapis\.com|is disabled/i.test(combinedMessage)) {
      const projectMatch = combinedMessage.match(/project\s+(\d+)/i);
      const projectNo = projectMatch?.[1];
      const enableLink = projectNo
        ? `https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=${projectNo}`
        : 'https://console.developers.google.com/apis/api/sheets.googleapis.com/overview';
      return NextResponse.json(
        {
          error: `ยังไม่ได้เปิด Google Sheets API สำหรับ Service Account ที่ใช้งานอยู่ กรุณาเปิดที่ ${enableLink} แล้วรอ 5-10 นาที ก่อนลองใหม่`,
        },
        { status: 503 }
      );
    }

    if (driveApiMessage) {
      return NextResponse.json({ error: `อัปโหลดไฟล์ไม่สำเร็จ: ${driveApiMessage}` }, { status: 500 });
    }

    if (rawMessage && rawMessage !== 'เกิดข้อผิดพลาดภายใน') {
      return NextResponse.json({ error: rawMessage }, { status: 500 });
    }

    return handleAuthError(err);
  }
}

