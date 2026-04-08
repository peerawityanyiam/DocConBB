import { getSheetsClient } from './client';

interface CellPos {
  sheetId: number;
  sheetName: string;
  rowIndex: number;
  colIndex: number;
}

interface CellLink {
  text: string;
  url: string;
  driveFileId?: string;
}

function buildRange(cellA1: string, sheetName?: string): string {
  if (!sheetName?.trim()) return cellA1;
  const escapedName = sheetName.replace(/'/g, "''");
  return `'${escapedName}'!${cellA1}`;
}

function escapeFormulaText(text: string): string {
  return text.replace(/"/g, '""');
}

function parseA1Cell(cellA1: string): { rowIndex: number; colIndex: number } {
  const m = /^([A-Za-z]+)(\d+)$/.exec(cellA1.trim());
  if (!m) {
    throw new Error('รูปแบบ cell ไม่ถูกต้อง (ต้องเป็นแบบ A1)');
  }

  const letters = m[1].toUpperCase();
  const row = Number(m[2]);
  if (!Number.isFinite(row) || row < 1) {
    throw new Error('เลขแถวใน cell ไม่ถูกต้อง');
  }

  let colIndex = 0;
  for (let i = 0; i < letters.length; i++) {
    colIndex = colIndex * 26 + (letters.charCodeAt(i) - 64);
  }

  return { rowIndex: row - 1, colIndex: colIndex - 1 };
}

async function resolveCellPos(spreadsheetId: string, cellA1: string, sheetName?: string): Promise<CellPos> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,index))',
  });

  const allSheets = (meta.data.sheets ?? [])
    .map(s => s.properties)
    .filter((p): p is { sheetId?: number | null; title?: string | null; index?: number | null } => Boolean(p));

  if (allSheets.length === 0) {
    throw new Error('ไม่พบชีตในไฟล์นี้');
  }

  let target = allSheets[0];
  if (sheetName?.trim()) {
    const found = allSheets.find(s => (s.title ?? '').trim() === sheetName.trim());
    if (!found) {
      throw new Error(`ไม่พบชีตชื่อ ${sheetName}`);
    }
    target = found;
  } else {
    const sorted = [...allSheets].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    target = sorted[0];
  }

  if (typeof target.sheetId !== 'number' || !target.title) {
    throw new Error('ไม่พบข้อมูลชีตปลายทาง');
  }

  const { rowIndex, colIndex } = parseA1Cell(cellA1);
  return {
    sheetId: target.sheetId,
    sheetName: target.title,
    rowIndex,
    colIndex,
  };
}

function extractDriveFileId(url: string): string | undefined {
  const m = /\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  return m?.[1];
}

export async function getCellFileLinks(params: {
  spreadsheetId: string;
  cellA1: string;
  sheetName?: string;
}): Promise<CellLink[]> {
  const sheets = getSheetsClient();
  const range = buildRange(params.cellA1, params.sheetName);

  const res = await sheets.spreadsheets.get({
    spreadsheetId: params.spreadsheetId,
    ranges: [range],
    includeGridData: true,
    fields: 'sheets(data(rowData(values(userEnteredValue,formattedValue,textFormatRuns,hyperlink))))',
  });

  const cell = res.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0];
  if (!cell) return [];

  const plainText =
    cell.userEnteredValue?.stringValue
    ?? cell.formattedValue
    ?? '';

  const runs = cell.textFormatRuns ?? [];
  if (runs.length > 0 && plainText) {
    const links: CellLink[] = [];
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const start = run.startIndex ?? 0;
      const end = i + 1 < runs.length ? (runs[i + 1].startIndex ?? plainText.length) : plainText.length;
      const text = plainText.slice(start, end).replace(/\n/g, '').trim();
      const url = run.format?.link?.uri ?? '';
      if (!text || !url) continue;
      links.push({ text, url, driveFileId: extractDriveFileId(url) });
    }
    if (links.length > 0) return links;
  }

  // fallback: single hyperlink cell
  if (cell.hyperlink && plainText) {
    const text = plainText.replace(/\n/g, '').trim();
    if (!text) return [];
    return [{ text, url: cell.hyperlink, driveFileId: extractDriveFileId(cell.hyperlink) }];
  }

  return [];
}

export async function setCellFileLinks(params: {
  spreadsheetId: string;
  cellA1: string;
  files: Array<{ text: string; url: string }>;
  sheetName?: string;
}) {
  const sheets = getSheetsClient();
  const cellPos = await resolveCellPos(params.spreadsheetId, params.cellA1, params.sheetName);

  const normalized = params.files
    .map(f => ({ text: f.text.trim(), url: f.url.trim() }))
    .filter(f => Boolean(f.text));

  if (normalized.length === 0) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: params.spreadsheetId,
      range: `'${cellPos.sheetName.replace(/'/g, "''")}'!${params.cellA1}`,
    });
    return;
  }

  const fullText = normalized.map(f => f.text).join('\n');
  let current = 0;
  const textFormatRuns = normalized.map(f => {
    const run = {
      startIndex: current,
      format: {
        link: { uri: f.url },
      },
    };
    current += f.text.length + 1;
    return run;
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: params.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            start: {
              sheetId: cellPos.sheetId,
              rowIndex: cellPos.rowIndex,
              columnIndex: cellPos.colIndex,
            },
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { stringValue: fullText },
                    textFormatRuns,
                  },
                ],
              },
            ],
            fields: 'userEnteredValue,textFormatRuns',
          },
        },
      ],
    },
  });
}

export async function appendCellFileLink(params: {
  spreadsheetId: string;
  cellA1: string;
  sheetName?: string;
  text: string;
  url: string;
}) {
  const existing = await getCellFileLinks(params);
  existing.push({ text: params.text, url: params.url });
  await setCellFileLinks({
    spreadsheetId: params.spreadsheetId,
    cellA1: params.cellA1,
    sheetName: params.sheetName,
    files: existing,
  });
}

export async function removeCellFileLinkByDriveId(params: {
  spreadsheetId: string;
  cellA1: string;
  sheetName?: string;
  driveFileId: string;
}) {
  const existing = await getCellFileLinks(params);
  const filtered = existing.filter(f => f.driveFileId !== params.driveFileId);
  await setCellFileLinks({
    spreadsheetId: params.spreadsheetId,
    cellA1: params.cellA1,
    sheetName: params.sheetName,
    files: filtered,
  });
}

// backward-compatible: replace cell with one hyperlink
export async function setFileHyperlinkInCell(params: {
  spreadsheetId: string;
  cellA1: string;
  driveFileId: string;
  sheetName?: string;
  label?: string;
}) {
  const url = `https://drive.google.com/file/d/${params.driveFileId}/view`;
  const label = params.label?.trim() || params.driveFileId;
  await setCellFileLinks({
    spreadsheetId: params.spreadsheetId,
    cellA1: params.cellA1,
    sheetName: params.sheetName,
    files: [{ text: label, url }],
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

// helper for old formula mode (if needed by callers)
export function buildHyperlinkFormula(url: string, label: string) {
  return `=HYPERLINK("${escapeFormulaText(url)}","${escapeFormulaText(label)}")`;
}
