import { convertExcelToSpreadsheet, trashFile } from '@/lib/google-drive/files';
import { getSheetsClient } from './client';

function buildUniqueSheetTitle(base: string, used: Set<string>): string {
  const maxLen = 100;
  const raw = (base || 'Sheet').trim() || 'Sheet';
  let candidate = raw.slice(0, maxLen);
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }

  let i = 2;
  while (i < 9999) {
    const suffix = ` (${i})`;
    candidate = raw.slice(0, Math.max(1, maxLen - suffix.length)) + suffix;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    i++;
  }

  const fallback = `${Date.now()}`.slice(-6);
  candidate = `Sheet_${fallback}`.slice(0, maxLen);
  used.add(candidate);
  return candidate;
}

export async function importExcelSheetsIntoSpreadsheet(params: {
  targetSpreadsheetId: string;
  tempFolderId: string;
  fileName: string;
  mimeType: string;
  body: Buffer;
  removeOriginalSheets?: boolean;
}) {
  const sheets = getSheetsClient();
  const removeOriginalSheets = params.removeOriginalSheets ?? true;

  const temp = await convertExcelToSpreadsheet(
    params.tempFolderId,
    `${params.fileName}_temp_${Date.now()}`,
    params.mimeType,
    params.body
  );

  try {
    const [sourceMeta, targetMeta] = await Promise.all([
      sheets.spreadsheets.get({
        spreadsheetId: temp.id,
        fields: 'sheets(properties(sheetId,title))',
      }),
      sheets.spreadsheets.get({
        spreadsheetId: params.targetSpreadsheetId,
        fields: 'sheets(properties(sheetId,title))',
      }),
    ]);

    const sourceSheets = sourceMeta.data.sheets ?? [];
    if (!sourceSheets.length) {
      throw new Error('ไม่พบชีตในไฟล์ Excel ที่นำเข้า');
    }

    const originalTargetSheets = targetMeta.data.sheets ?? [];
    const originalTargetSheetIds = originalTargetSheets
      .map(s => s.properties?.sheetId)
      .filter((id): id is number => typeof id === 'number');
    const usedTitles = new Set(
      originalTargetSheets
        .map(s => s.properties?.title)
        .filter((title): title is string => typeof title === 'string')
    );

    for (const source of sourceSheets) {
      const sourceSheetId = source.properties?.sheetId;
      if (typeof sourceSheetId !== 'number') continue;

      const copied = await sheets.spreadsheets.sheets.copyTo({
        spreadsheetId: temp.id,
        sheetId: sourceSheetId,
        requestBody: {
          destinationSpreadsheetId: params.targetSpreadsheetId,
        },
      });

      const newSheetId = copied.data.sheetId;
      if (typeof newSheetId !== 'number') continue;

      const sourceTitle = source.properties?.title ?? 'Sheet';
      const targetTitle = buildUniqueSheetTitle(sourceTitle, usedTitles);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: params.targetSpreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: newSheetId,
                  title: targetTitle,
                },
                fields: 'title',
              },
            },
          ],
        },
      });
    }

    if (removeOriginalSheets && originalTargetSheetIds.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: params.targetSpreadsheetId,
        requestBody: {
          requests: originalTargetSheetIds.map(sheetId => ({
            deleteSheet: { sheetId },
          })),
        },
      });
    }
  } finally {
    try {
      await trashFile(temp.id);
    } catch {
      console.warn('[google-sheets/workbook] failed to trash temp spreadsheet:', temp.id);
    }
  }
}

