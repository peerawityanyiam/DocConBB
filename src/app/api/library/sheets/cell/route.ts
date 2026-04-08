import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, requireRole, handleAuthError } from '@/lib/auth/guards';
import { clearCell, setFileHyperlinkInCell } from '@/lib/google-sheets/cells';

type Body =
  | {
      action: 'add';
      spreadsheetId: string;
      cellA1: string;
      driveFileId: string;
      sheetName?: string;
      label?: string;
    }
  | {
      action: 'remove';
      spreadsheetId: string;
      cellA1: string;
      sheetName?: string;
    };

// POST /api/library/sheets/cell
// action=add: set HYPERLINK to Drive file in a target cell
// action=remove: clear target cell
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const body = (await request.json()) as Body;
    if (!body?.action) return NextResponse.json({ error: 'missing action' }, { status: 400 });

    if (!body.spreadsheetId?.trim()) {
      return NextResponse.json({ error: 'missing spreadsheetId' }, { status: 400 });
    }
    if (!body.cellA1?.trim()) {
      return NextResponse.json({ error: 'missing cellA1' }, { status: 400 });
    }

    if (body.action === 'add') {
      if (!body.driveFileId?.trim()) {
        return NextResponse.json({ error: 'missing driveFileId' }, { status: 400 });
      }
      await setFileHyperlinkInCell({
        spreadsheetId: body.spreadsheetId.trim(),
        sheetName: body.sheetName?.trim(),
        cellA1: body.cellA1.trim(),
        driveFileId: body.driveFileId.trim(),
        label: body.label?.trim(),
      });
      return NextResponse.json({ ok: true, action: 'add' });
    }

    await clearCell({
      spreadsheetId: body.spreadsheetId.trim(),
      sheetName: body.sheetName?.trim(),
      cellA1: body.cellA1.trim(),
    });
    return NextResponse.json({ ok: true, action: 'remove' });
  } catch (err) {
    return handleAuthError(err);
  }
}

