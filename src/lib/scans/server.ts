import { AuthError, type AuthUser, hasGlobalRole } from '@/lib/auth/guards';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getOrCreateFolder } from '@/lib/google-drive/files';

export type AdminClient = Awaited<ReturnType<typeof createServiceRoleClient>>;

export interface ScanDocumentRow {
  id: string;
  owner_id: string;
  title: string;
  status: 'DRAFT' | 'PDF_READY' | 'ERROR';
  scan_folder_id: string | null;
  originals_folder_id: string | null;
  processed_folder_id: string | null;
  pdf_folder_id: string | null;
  latest_pdf_file_id: string | null;
  latest_pdf_file_name: string | null;
  latest_pdf_view_url: string | null;
  latest_pdf_size_bytes: number | null;
  latest_pdf_uploaded_at: string | null;
  page_count: number;
  created_at: string;
  updated_at: string;
}

export interface ScanPageRow {
  id: string;
  scan_id: string;
  owner_id: string;
  page_index: number;
  original_drive_file_id: string;
  original_drive_file_name: string;
  original_mime_type: string | null;
  original_size_bytes: number | null;
  processed_drive_file_id: string | null;
  processed_drive_file_name: string | null;
  processed_mime_type: string | null;
  processed_size_bytes: number | null;
  adjustments: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function getScanRootFolderId(): string {
  const folderId = process.env.GOOGLE_SCAN_FOLDER_ID?.trim();
  if (!folderId) throw new Error('GOOGLE_SCAN_FOLDER_ID is not configured.');
  return folderId;
}

function formatDriveTimestamp(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().replace(/[:.]/g, '-');
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:.]/g, '-');
}

function scanFolderName(scan: Pick<ScanDocumentRow, 'id' | 'created_at'>) {
  return `${formatDriveTimestamp(scan.created_at)}_${scan.id}`;
}

export async function canAccessScan(scan: Pick<ScanDocumentRow, 'owner_id'>, user: AuthUser): Promise<boolean> {
  if (scan.owner_id === user.id) return true;
  return hasGlobalRole(user.id, ['SUPER_ADMIN']);
}

export async function assertCanAccessScan(
  scan: Pick<ScanDocumentRow, 'owner_id'>,
  user: AuthUser,
): Promise<void> {
  if (!(await canAccessScan(scan, user))) {
    throw new AuthError('No access to this scan.', 403);
  }
}

export async function getScanForUser(
  admin: AdminClient,
  scanId: string,
  user: AuthUser,
): Promise<ScanDocumentRow> {
  const { data, error } = await admin
    .from('scan_documents')
    .select('*')
    .eq('id', scanId)
    .single<ScanDocumentRow>();

  if (error || !data) throw new AuthError('Scan not found.', 404);
  await assertCanAccessScan(data, user);
  return data;
}

export async function ensureScanFolders(
  admin: AdminClient,
  scan: ScanDocumentRow,
): Promise<{
  scanFolderId: string;
  originalsFolderId: string;
  processedFolderId: string;
  pdfFolderId: string;
}> {
  const rootFolderId = getScanRootFolderId();
  const userFolderId = await getOrCreateFolder(rootFolderId, scan.owner_id);
  const scanFolderId = scan.scan_folder_id || await getOrCreateFolder(userFolderId, scanFolderName(scan));
  const originalsFolderId = scan.originals_folder_id || await getOrCreateFolder(scanFolderId, 'originals');
  const processedFolderId = scan.processed_folder_id || await getOrCreateFolder(scanFolderId, 'processed');
  const pdfFolderId = scan.pdf_folder_id || await getOrCreateFolder(scanFolderId, 'pdf');

  if (
    scan.scan_folder_id !== scanFolderId ||
    scan.originals_folder_id !== originalsFolderId ||
    scan.processed_folder_id !== processedFolderId ||
    scan.pdf_folder_id !== pdfFolderId
  ) {
    await admin
      .from('scan_documents')
      .update({
        scan_folder_id: scanFolderId,
        originals_folder_id: originalsFolderId,
        processed_folder_id: processedFolderId,
        pdf_folder_id: pdfFolderId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', scan.id);
  }

  return { scanFolderId, originalsFolderId, processedFolderId, pdfFolderId };
}

export function toScanDocumentPayload(scan: ScanDocumentRow, pages: ScanPageRow[] = []) {
  return {
    ...scan,
    pages,
  };
}
