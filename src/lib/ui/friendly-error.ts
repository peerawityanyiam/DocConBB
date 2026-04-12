const THAI_PATTERN = /[\u0E00-\u0E7F]/;

function extractRawMessage(error: unknown): string {
  if (typeof error === 'string') return error.trim();
  if (error instanceof Error) return error.message.trim();
  return '';
}

export function toFriendlyErrorMessage(
  error: unknown,
  fallback = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
): string {
  const raw = extractRawMessage(error);
  if (!raw) return fallback;
  if (THAI_PATTERN.test(raw)) return raw;

  const normalized = raw.toLowerCase();

  if (
    normalized.includes('unauthorized_client') ||
    normalized.includes('client is unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('permission denied') ||
    normalized.includes('access token') ||
    normalized.includes('scope')
  ) {
    return 'สิทธิ์การเข้าถึงไม่เพียงพอ กรุณาออกจากระบบแล้วเข้าใหม่อีกครั้ง';
  }

  if (normalized === 'unauthorized' || normalized.includes('401')) {
    return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('network request failed') ||
    normalized.includes('load failed') ||
    normalized.includes('econn')
  ) {
    return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  }

  if (normalized.includes('timeout')) {
    return 'การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง';
  }

  if (normalized.includes('50mb') || normalized.includes('too large')) {
    return 'ไฟล์มีขนาดใหญ่เกิน 50MB กรุณาเลือกไฟล์ขนาดเล็กลง';
  }

  if (normalized.includes('.docx') && normalized.includes('.pdf')) {
    return 'รองรับเฉพาะไฟล์ .docx หรือ .pdf เท่านั้น';
  }

  if (normalized.includes('.docx')) {
    return 'รองรับเฉพาะไฟล์ Word (.docx) เท่านั้น';
  }

  if (normalized.includes('.pdf')) {
    return 'รองรับเฉพาะไฟล์ PDF (.pdf) เท่านั้น';
  }

  if (normalized.includes('internal') || normalized.includes('500')) {
    return 'ระบบมีปัญหาชั่วคราว กรุณาลองใหม่อีกครั้ง';
  }

  return fallback;
}
