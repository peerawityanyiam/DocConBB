const THAI_PATTERN = /[\u0E00-\u0E7F]/;

function extractRawMessage(error: unknown): string {
  if (typeof error === 'string') return error.trim();
  if (error instanceof Error) return error.message.trim();
  return '';
}

function getNormalizedText(error: unknown, friendly: string): string {
  return (extractRawMessage(error) + ' ' + friendly).toLowerCase();
}

function parseSingleImageTooLargeFileName(raw: string): string | null {
  const match = raw.match(/image_too_large_after_compress:([^:]+)/i);
  return match?.[1]?.trim() || null;
}

export function toFriendlyErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
): string {
  const raw = extractRawMessage(error);
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();

  if (normalized.includes('too_many_images')) {
    return 'You can select up to 20 images per upload.';
  }

  if (normalized.includes('image_total_too_large')) {
    return 'Total image size exceeds 80MB per upload. Please split into smaller batches.';
  }

  if (normalized.includes('too_many_pdf_parts')) {
    return 'Selected images produce more than 20 PDF parts. Please reduce image count or split upload.';
  }

  if (normalized.includes('file_too_large')) {
    return 'File size exceeds 4MB per file.';
  }

  if (normalized.includes('forbidden_upload_state')) {
    return 'You do not have permission to upload files for this task/status.';
  }

  if (normalized.includes('not_task_officer')) {
    return 'This task is not assigned to your account.';
  }

  if (normalized.includes('unsupported_file_type') || normalized.includes('unsupported_image_file')) {
    return 'Only Word (.docx), PDF (.pdf), and image files are supported.';
  }

  if (normalized.includes('image_too_large_after_compress')) {
    const fileName = parseSingleImageTooLargeFileName(raw);
    if (fileName) {
      return 'Image ' + fileName + ' is still too large after conversion. Please reduce size and try again.';
    }
    return 'At least one image is still too large after conversion. Please reduce image size and try again.';
  }

  if (normalized.includes('no_images_selected')) {
    return 'Please select at least one image.';
  }

  if (normalized.includes('image_processing_failed') || normalized.includes('image_conversion_failed') || normalized.includes('prepare_image_failed')) {
    return 'Unable to prepare images. Please try again.';
  }

  if (
    normalized.includes('unauthorized_client') ||
    normalized.includes('client is unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('permission denied') ||
    normalized.includes('access token') ||
    normalized.includes('scope')
  ) {
    return 'Insufficient permissions. Please sign out and sign in again.';
  }

  if (normalized === 'unauthorized' || normalized.includes('401')) {
    return 'Session expired. Please sign in again.';
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('network request failed') ||
    normalized.includes('load failed') ||
    normalized.includes('econn')
  ) {
    return 'Cannot connect to server. Please check your internet connection and try again.';
  }

  if (normalized.includes('timeout')) {
    return 'Request timed out. Please try again.';
  }

  if (
    normalized.includes('413') ||
    normalized.includes('payload too large')
  ) {
    return 'File size is too large for this system. Please reduce size or split upload.';
  }

  if (normalized.includes('.docx') && normalized.includes('.pdf')) {
    return 'Only .docx or .pdf files are supported.';
  }

  if (normalized.includes('.docx')) {
    return 'Only Word (.docx) files are supported.';
  }

  if (normalized.includes('.pdf')) {
    return 'Only PDF (.pdf) files are supported.';
  }

  if (THAI_PATTERN.test(raw)) return raw;

  if (normalized.includes('internal') || normalized.includes('500')) {
    return 'Temporary server error. Please try again.';
  }

  return fallback;
}

export function toUploadFailureMessage(
  error: unknown,
  fallback = 'Upload failed.'
): string {
  const friendly = toFriendlyErrorMessage(error, fallback);
  const normalized = getNormalizedText(error, friendly);

  if (
    normalized.includes('too_many_images') ||
    normalized.includes('image_total_too_large') ||
    normalized.includes('too_many_pdf_parts') ||
    normalized.includes('413') ||
    normalized.includes('payload too large') ||
    normalized.includes('file_too_large')
  ) {
    return friendly + '\nSystem limits: max 4MB per file, max 20 images / 80MB per upload, max 20 PDF parts.';
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('network request failed') ||
    normalized.includes('load failed') ||
    normalized.includes('econn') ||
    normalized.includes('timeout')
  ) {
    return friendly + '\nSuggestion: check internet connection and try again, or split into smaller batches.';
  }

  if (
    normalized.includes('.docx') ||
    normalized.includes('.pdf') ||
    normalized.includes('mime') ||
    normalized.includes('file type') ||
    normalized.includes('unsupported_file_type') ||
    normalized.includes('unsupported_image_file')
  ) {
    return friendly + '\nSuggestion: use .docx / .pdf files, or attach images for auto-PDF conversion.';
  }

  if (
    normalized.includes('unauthorized') ||
    normalized.includes('permission') ||
    normalized.includes('forbidden') ||
    normalized.includes('scope')
  ) {
    return friendly + '\nSuggestion: sign out and sign in again before retrying.';
  }

  return friendly + '\nSuggestion: try again, and if the issue persists contact admin.';
}
