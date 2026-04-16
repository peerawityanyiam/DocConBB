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
  fallback = 'เกิดข้อผิดพลาด กรุณาลองใหม่'
): string {
  const raw = extractRawMessage(error);
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();

  if (normalized.includes('too_many_images')) {
    return 'เลือกรูปได้สูงสุด 20 รูปต่อครั้ง';
  }

  if (normalized.includes('image_total_too_large')) {
    return 'ขนาดรวมรูปเกิน 80MB ต่อครั้ง กรุณาแบ่งอัปโหลด';
  }

  if (normalized.includes('too_many_pdf_parts')) {
    return 'รูปที่เลือกแปลงเป็น PDF ได้เกิน 20 ส่วน กรุณาลดจำนวนรูปหรือแบ่งอัปโหลด';
  }

  if (normalized.includes('file_too_large')) {
    return 'ขนาดไฟล์เกิน 100MB ต่อไฟล์';
  }

  if (normalized.includes('storage_quota_exceeded') || normalized.includes('storagequotaexceeded')) {
    return 'Google Drive เต็มหรือเกิน quota กรุณาติดต่อผู้ดูแลระบบ';
  }

  if (normalized.includes('drive_session_failed') || normalized.includes('missing_upload_uri')) {
    return 'ไม่สามารถสร้าง session อัปโหลดได้ กรุณาลองใหม่';
  }

  if (normalized.includes('drive_file_not_found') || normalized.includes('invalid_drive_response')) {
    return 'ตรวจสอบไฟล์ที่อัปโหลดไม่ได้ กรุณาลองใหม่';
  }

  if (normalized.includes('initiate_failed') || normalized.includes('confirm_failed')) {
    return 'กระบวนการอัปโหลดไม่สมบูรณ์ กรุณาลองใหม่';
  }

  if (normalized.includes('drive_upload_http')) {
    return 'อัปโหลดไปยัง Google Drive ไม่สำเร็จ กรุณาลองใหม่';
  }

  if (normalized.includes('network_upload_failed')) {
    return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  }

  if (normalized.includes('forbidden_upload_state')) {
    return 'ไม่มีสิทธิ์อัปโหลดไฟล์ในสถานะงานนี้';
  }

  if (normalized.includes('not_task_officer')) {
    return 'งานนี้ไม่ได้มอบหมายให้บัญชีของคุณ';
  }

  if (normalized.includes('missing_drive_file_id') || normalized.includes('invalid_upload_response')) {
    return 'ระบบอัปโหลดตอบกลับไม่ครบถ้วน กรุณาลองใหม่';
  }

  if (normalized.includes('upload_failed')) {
    return 'อัปโหลดไฟล์ไม่สำเร็จ';
  }

  if (normalized.includes('unsupported_file_type') || normalized.includes('unsupported_image_file')) {
    return 'รองรับเฉพาะไฟล์ Word (.docx), PDF (.pdf) และรูปภาพ';
  }

  if (normalized.includes('image_too_large_after_compress')) {
    const fileName = parseSingleImageTooLargeFileName(raw);
    if (fileName) {
      return 'รูป ' + fileName + ' ยังมีขนาดใหญ่เกินหลังแปลง กรุณาลดขนาดและลองใหม่';
    }
    return 'มีรูปอย่างน้อย 1 รูปที่ยังใหญ่เกินหลังแปลง กรุณาลดขนาดรูปและลองใหม่';
  }

  if (normalized.includes('no_images_selected')) {
    return 'กรุณาเลือกรูปอย่างน้อย 1 รูป';
  }

  if (normalized.includes('image_processing_failed') || normalized.includes('image_conversion_failed') || normalized.includes('prepare_image_failed')) {
    return 'ไม่สามารถเตรียมรูปสำหรับอัปโหลดได้ กรุณาลองใหม่';
  }

  if (
    normalized.includes('unauthorized_client') ||
    normalized.includes('client is unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('permission denied') ||
    normalized.includes('access token') ||
    normalized.includes('scope')
  ) {
    return 'สิทธิ์การเข้าถึงไม่เพียงพอ กรุณาออกจากระบบและเข้าสู่ระบบใหม่';
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
    return 'การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่';
  }

  if (
    normalized.includes('413') ||
    normalized.includes('payload too large')
  ) {
    return 'ไฟล์มีขนาดใหญ่เกินกว่าที่ระบบรองรับ กรุณาลดขนาดหรือแบ่งอัปโหลด';
  }

  if (normalized.includes('.docx') && normalized.includes('.pdf')) {
    return 'รองรับเฉพาะ .docx หรือ .pdf';
  }

  if (normalized.includes('.docx')) {
    return 'รองรับเฉพาะไฟล์ Word (.docx)';
  }

  if (normalized.includes('.pdf')) {
    return 'รองรับเฉพาะไฟล์ PDF (.pdf)';
  }

  if (THAI_PATTERN.test(raw)) return raw;

  if (normalized.includes('internal') || normalized.includes('500')) {
    return 'เซิร์ฟเวอร์ขัดข้องชั่วคราว กรุณาลองใหม่';
  }

  return fallback;
}

export function toUploadFailureMessage(
  error: unknown,
  fallback = 'อัปโหลดไฟล์ไม่สำเร็จ'
): string {
  const raw = extractRawMessage(error);
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
    return friendly + '\nข้อจำกัดระบบ: ต่อไฟล์ไม่เกิน 100MB, ต่อครั้งไม่เกิน 20 รูป/80MB, และแตก PDF ได้สูงสุด 20 ส่วน';
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('network request failed') ||
    normalized.includes('load failed') ||
    normalized.includes('econn') ||
    normalized.includes('timeout')
  ) {
    return friendly + '\nคำแนะนำ: ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ หรือแบ่งอัปโหลดเป็นชุดเล็กลง';
  }

  if (
    normalized.includes('.docx') ||
    normalized.includes('.pdf') ||
    normalized.includes('mime') ||
    normalized.includes('file type') ||
    normalized.includes('unsupported_file_type') ||
    normalized.includes('unsupported_image_file')
  ) {
    return friendly + '\nคำแนะนำ: ใช้ไฟล์ .docx / .pdf หรือแนบรูปเพื่อให้ระบบรวมเป็น PDF อัตโนมัติ';
  }

  if (
    normalized.includes('unauthorized') ||
    normalized.includes('permission') ||
    normalized.includes('forbidden') ||
    normalized.includes('scope')
  ) {
    return friendly + '\nคำแนะนำ: ออกจากระบบแล้วเข้าสู่ระบบใหม่ก่อนลองอีกครั้ง';
  }

  if (raw) {
    return friendly + '\nรายละเอียด: ' + raw;
  }

  return friendly;
}
