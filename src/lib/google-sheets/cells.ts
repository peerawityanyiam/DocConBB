import { getSheetsClient } from './client';

function buildRange(cellA1: string, sheetName?: string): string {
  if (!sheetName?.trim()) return cellA1;
  const escapedName = sheetName.replace(/'/g, "''");
  return `'${escapedName}'!${cellA1}`;
}

function escapeFormulaText(text: string): string {
  return text.replace(/"/g, '""');
}

export async function setFileHyperlinkInCell(params: {
  spreadsheetId: string;
  cellA1: string;
  driveFileId: string;
  sheetName?: string;
  label?: string;
}) {
  const sheets = getSheetsClient();
  const range = buildRange(params.cellA1, params.sheetName);
  const url = `https://drive.google.com/file/d/${params.driveFileId}/view`;
  const label = params.label?.trim() || params.driveFileId;
  const formula = `=HYPERLINK("${escapeFormulaText(url)}","${escapeFormulaText(label)}")`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: params.spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[formula]],
    },
  });
}

export async function clearCell(params: {
  spreadsheetId: string;
  cellA1: string;
  sheetName?: string;
}) {
  const sheets = getSheetsClient();
  const range = buildRange(params.cellA1, params.sheetName);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: params.spreadsheetId,
    range,
  });
}

