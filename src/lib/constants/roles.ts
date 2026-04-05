import type { AppRole } from '@/lib/auth/guards';

export const ROLE_LABELS: Record<AppRole, string> = {
  STAFF: 'เจ้าหน้าที่',
  DOCCON: 'ผู้ควบคุมเอกสาร',
  REVIEWER: 'ผู้ตรวจสอบ',
  BOSS: 'หัวหน้างาน',
  SUPER_BOSS: 'ผู้บริหาร',
  SUPER_ADMIN: 'ผู้ดูแลระบบ',
};

export const ROLE_COLORS: Record<AppRole, string> = {
  STAFF: 'bg-blue-500 text-white',
  DOCCON: 'bg-purple-500 text-white',
  REVIEWER: 'bg-green-500 text-white',
  BOSS: 'bg-yellow-400 text-black',
  SUPER_BOSS: 'bg-pink-500 text-white',
  SUPER_ADMIN: 'bg-red-600 text-white',
};
