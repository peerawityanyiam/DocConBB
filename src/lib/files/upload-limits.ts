export const MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES = 8 * 1024 * 1024;
export const MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL = '8MB';
export const TARGET_COMPRESSED_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const TARGET_COMPRESSED_IMAGE_MAX_LABEL = '4MB';

// Keep generated PDF parts below direct upload ceiling with headroom for multipart overhead.
export const DEFAULT_IMAGE_TO_PDF_PART_SIZE_BYTES = Math.floor(7 * 1024 * 1024);
