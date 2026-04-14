export const MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES = 8 * 1024 * 1024;
export const MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL = '8MB';

// Keep generated PDF parts below direct upload ceiling with headroom for multipart overhead.
export const DEFAULT_IMAGE_TO_PDF_PART_SIZE_BYTES = Math.floor(2.8 * 1024 * 1024);
