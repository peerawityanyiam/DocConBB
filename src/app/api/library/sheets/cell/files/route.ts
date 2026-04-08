import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';
import { getFileMetadata, trashFile, uploadFile } from '@/lib/google-drive/files';
import { setFilePublic } from '@/lib/google-drive/permissions';
import {
  appendCellFileLink,
  getCellFileLinks,
  removeCellFileLinkByDriveId,
} from '@/lib/google-sheets/cells';

const LIBRARY_UPLOAD_FOLDER_ID = '10Ithv7g75Sd0he6IuVP6Nwk0IIVCFw1i';

function isDocconRole(roles: string[]) {
  return roles.includes('DOCCON') || roles.includes('SUPER_ADMIN');
}

// GET /api/library/sheets/cell/files?spreadsheetId=...&cellA1=...&sheetName=...
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.roles.length === 0) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ใช้งานคลังเอกสาร' }, { status: 403 });
    }

    const spreadsheetId = request.nextUrl.searchParams.get('spreadsheetId')?.trim();
    const cellA1 = request.nextUrl.searchParams.get('cellA1')?.trim();
    const sheetName = request.nextUrl.searchParams.get('sheetName')?.trim() || undefined;
    if (!spreadsheetId || !cellA1) {
      return NextResponse.json({ error: 'ต้องระบุ spreadsheetId และ cellA1' }, { status: 400 });
    }

    const files = await getCellFileLinks({ spreadsheetId, cellA1, sheetName });
    const isDoccon = isDocconRole(user.roles);

    const enriched = await Promise.all(
      files.map(async (f) => {
        let uploaderUserId = '';
        let uploaderEmail = '';
        if (f.driveFileId) {
          try {
            const meta = await getFileMetadata(f.driveFileId);
            uploaderUserId = meta.appProperties.uploadedByUserId ?? '';
            uploaderEmail = meta.appProperties.uploadedByEmail ?? '';
          } catch {
            // keep fallback empty (still can render list)
          }
        }

        const canDelete =
          isDoccon
          || Boolean(uploaderUserId && uploaderUserId === user.id)
          || Boolean(uploaderEmail && uploaderEmail === user.email);

        return {
          ...f,
          uploaderUserId,
          uploaderEmail,
          canDelete,
        };
      })
    );

    return NextResponse.json({ ok: true, files: enriched });
  } catch (err) {
    return handleAuthError(err);
  }
}

// POST /api/library/sheets/cell/files
// multipart form-data: spreadsheetId, cellA1, sheetName(optional), file
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.roles.length === 0) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ใช้งานคลังเอกสาร' }, { status: 403 });
    }

    const formData = await request.formData();
    const spreadsheetId = String(formData.get('spreadsheetId') ?? '').trim();
    const cellA1 = String(formData.get('cellA1') ?? '').trim();
    const sheetNameRaw = String(formData.get('sheetName') ?? '').trim();
    const sheetName = sheetNameRaw || undefined;
    const file = formData.get('file') as File | null;

    if (!spreadsheetId || !cellA1) {
      return NextResponse.json({ error: 'ต้องระบุ spreadsheetId และ cellA1' }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ error: 'ไม่พบไฟล์ที่ต้องการอัปโหลด' }, { status: 400 });
    }

    const MAX_BYTES = 50 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'ไฟล์ใหญ่เกิน 50MB' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadFile(
      LIBRARY_UPLOAD_FOLDER_ID,
      file.name,
      file.type || 'application/octet-stream',
      buffer,
      {
        appProperties: {
          source: 'library_sheet_cell',
          spreadsheetId,
          sheetName: sheetName ?? '',
          cellA1,
          uploadedByUserId: user.id,
          uploadedByEmail: user.email,
        },
      }
    );

    let warning: string | null = null;
    try {
      await setFilePublic(uploaded.id);
    } catch (permissionErr) {
      warning = permissionErr instanceof Error ? permissionErr.message : 'ไม่สามารถตั้งสิทธิ์ public ได้';
    }

    const url = `https://drive.google.com/file/d/${uploaded.id}/view`;
    await appendCellFileLink({
      spreadsheetId,
      cellA1,
      sheetName,
      text: uploaded.name || file.name,
      url,
    });

    return NextResponse.json({
      ok: true,
      file: {
        id: uploaded.id,
        name: uploaded.name || file.name,
        url,
        uploaderUserId: user.id,
        uploaderEmail: user.email,
      },
      warning,
    }, { status: 201 });
  } catch (err) {
    return handleAuthError(err);
  }
}

// DELETE /api/library/sheets/cell/files
// body: { spreadsheetId, cellA1, sheetName?, driveFileId, deleteFromDrive? }
export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.roles.length === 0) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ใช้งานคลังเอกสาร' }, { status: 403 });
    }

    const body = await request.json();
    const spreadsheetId = String(body?.spreadsheetId ?? '').trim();
    const cellA1 = String(body?.cellA1 ?? '').trim();
    const sheetName = String(body?.sheetName ?? '').trim() || undefined;
    const driveFileId = String(body?.driveFileId ?? '').trim();
    const deleteFromDrive = body?.deleteFromDrive !== false;

    if (!spreadsheetId || !cellA1 || !driveFileId) {
      return NextResponse.json({ error: 'ต้องระบุ spreadsheetId, cellA1, driveFileId' }, { status: 400 });
    }

    const isDoccon = isDocconRole(user.roles);
    let uploaderUserId = '';
    let uploaderEmail = '';
    try {
      const meta = await getFileMetadata(driveFileId);
      uploaderUserId = meta.appProperties.uploadedByUserId ?? '';
      uploaderEmail = meta.appProperties.uploadedByEmail ?? '';
    } catch {
      // if cannot read metadata, non-doccon should not delete
    }

    const ownerMatched =
      Boolean(uploaderUserId && uploaderUserId === user.id)
      || Boolean(uploaderEmail && uploaderEmail === user.email);
    if (!isDoccon && !ownerMatched) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ลบไฟล์นี้ (ลบได้เฉพาะไฟล์ที่ตนเองอัปโหลด)' }, { status: 403 });
    }

    await removeCellFileLinkByDriveId({
      spreadsheetId,
      cellA1,
      sheetName,
      driveFileId,
    });

    if (deleteFromDrive) {
      try {
        await trashFile(driveFileId);
      } catch {
        // Even if Drive delete fails, link already removed from sheet.
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err);
  }
}

