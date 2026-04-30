// Deployed on Vercel serverless: keep under request payload ceiling (~4.5MB) with headroom.
// Files under this size go through the direct multipart POST to /api/tasks/[id]/files.
// Larger files use the resumable upload flow (init-upload → PUT to Drive → finalize)
// which bypasses Vercel's body limit entirely by uploading browser-to-Drive directly.
export const MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES = 4 * 1024 * 1024;
export const MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL = '4MB';

// Ceiling for the resumable client-direct upload path. Google Drive itself allows
// up to 5TB; we cap here for sanity and to align with hospital document expectations.
export const MAX_RESUMABLE_UPLOAD_FILE_SIZE_BYTES = 200 * 1024 * 1024;
export const MAX_RESUMABLE_UPLOAD_FILE_SIZE_LABEL = '200MB';
export const TARGET_COMPRESSED_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const TARGET_COMPRESSED_IMAGE_MAX_LABEL = '4MB';

// With resumable upload, the 4.5MB Vercel body limit no longer forces part
// splitting. Raise the cap so typical batches consolidate into ONE PDF file.
// Splitting only kicks in for genuinely huge outputs.
export const DEFAULT_IMAGE_TO_PDF_PART_SIZE_BYTES = 150 * 1024 * 1024;

// UX-safe image selection limits per upload action.
export const MAX_IMAGE_BATCH_COUNT = 30;
export const MAX_IMAGE_BATCH_COUNT_LABEL = '30 images';
export const MAX_IMAGE_BATCH_TOTAL_BYTES = 120 * 1024 * 1024;
export const MAX_IMAGE_BATCH_TOTAL_LABEL = '120MB';
export const MAX_IMAGE_PDF_PARTS = 30;
export const MAX_IMAGE_PDF_PARTS_LABEL = '30 parts';

// Scanner module limits. Each source photo is uploaded browser-to-Drive
// through resumable upload; keep per-photo size modest for mobile reliability.
export const SCAN_MAX_IMAGE_FILE_SIZE_BYTES = 4 * 1024 * 1024;
export const SCAN_MAX_IMAGE_FILE_SIZE_LABEL = '4MB';
export const SCAN_MAX_PAGE_COUNT = 30;
export const SCAN_MAX_PAGE_COUNT_LABEL = '30 pages';
