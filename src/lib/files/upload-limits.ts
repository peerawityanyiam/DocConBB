// Deployed on Vercel serverless: keep under request payload ceiling (~4.5MB) with headroom.
export const MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES = 4 * 1024 * 1024;
export const MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL = '4MB';
export const TARGET_COMPRESSED_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const TARGET_COMPRESSED_IMAGE_MAX_LABEL = '4MB';

// Keep generated PDF parts below direct upload ceiling with headroom for multipart overhead.
export const DEFAULT_IMAGE_TO_PDF_PART_SIZE_BYTES = Math.floor(3.5 * 1024 * 1024);

// UX-safe image selection limits per upload action.
export const MAX_IMAGE_BATCH_COUNT = 20;
export const MAX_IMAGE_BATCH_COUNT_LABEL = '20 images';
export const MAX_IMAGE_BATCH_TOTAL_BYTES = 80 * 1024 * 1024;
export const MAX_IMAGE_BATCH_TOTAL_LABEL = '80MB';
export const MAX_IMAGE_PDF_PARTS = 20;
export const MAX_IMAGE_PDF_PARTS_LABEL = '20 parts';
