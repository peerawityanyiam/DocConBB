const THAI_PATTERN = /[\u0E00-\u0E7F]/;

function extractRawMessage(error: unknown): string {
  if (typeof error === 'string') return error.trim();
  if (error instanceof Error) return error.message.trim();
  return '';
}

function getNormalizedText(error: unknown, friendly: string): string {
  return `${extractRawMessage(error)} ${friendly}`.toLowerCase();
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
    return 'สิทธิ์การเข้าถึงไม่เพียงพอ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่อีกครั้ง';
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

  if (
    normalized.includes('50mb') ||
    normalized.includes('too large') ||
    normalized.includes('payload too large')
  ) {
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

export function toUploadFailureMessage(
  error: unknown,
  fallback = 'อัปโหลดไฟล์ไม่สำเร็จ'
): string {
  const friendly = toFriendlyErrorMessage(error, fallback);
  const normalized = getNormalizedText(error, friendly);

  if (
    normalized.includes('50mb') ||
    normalized.includes('too large') ||
    normalized.includes('payload too large') ||
    normalized.includes('ใหญ่เกิน')
  ) {
    return `${friendly}\nคำแนะนำ: ลดจำนวนรูปต่อครั้ง, บีบอัดรูปก่อนอัปโหลด, หรือแยกอัปโหลดเป็นหลายชุด`;
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('network request failed') ||
    normalized.includes('load failed') ||
    normalized.includes('econn') ||
    normalized.includes('timeout') ||
    normalized.includes('เชื่อมต่อ')
  ) {
    return `${friendly}\nคำแนะนำ: ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ หรืออัปโหลดทีละชุดเพื่อลดโอกาส timeout`;
  }

  if (
    normalized.includes('.docx') ||
    normalized.includes('.pdf') ||
    normalized.includes('mime') ||
    normalized.includes('file type')
  ) {
    return `${friendly}\nคำแนะนำ: ใช้ไฟล์ .docx / .pdf หรือแนบรูปเพื่อรวมเป็น PDF`;
  }

  if (
    normalized.includes('unauthorized') ||
    normalized.includes('permission') ||
    normalized.includes('forbidden') ||
    normalized.includes('scope')
  ) {
    return `${friendly}\nคำแนะนำ: ออกจากระบบแล้วเข้าสู่ระบบใหม่ก่อนลองอัปโหลดอีกครั้ง`;
  }

  return `${friendly}\nคำแนะนำ: ลองลดจำนวนรูปหรือขนาดไฟล์ แล้วอัปโหลดใหม่อีกครั้ง`;
}
