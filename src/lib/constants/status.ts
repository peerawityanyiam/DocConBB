export type TaskStatus =
  | 'ASSIGNED'
  | 'SUBMITTED_TO_DOCCON'
  | 'DOCCON_REJECTED'
  | 'PENDING_REVIEW'
  | 'REVIEWER_REJECTED'
  | 'WAITING_BOSS_APPROVAL'
  | 'BOSS_REJECTED'
  | 'WAITING_SUPER_BOSS_APPROVAL'
  | 'SUPER_BOSS_REJECTED'
  | 'COMPLETED'
  | 'CANCELLED';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  ASSIGNED: 'รอดำเนินการ',
  SUBMITTED_TO_DOCCON: 'รอ DocCon ตรวจ',
  DOCCON_REJECTED: 'DocCon ส่งกลับ',
  PENDING_REVIEW: 'รอตรวจสอบเนื้อหา',
  REVIEWER_REJECTED: 'ผู้ตรวจสอบส่งกลับ',
  WAITING_BOSS_APPROVAL: 'รอผู้สั่งงานอนุมัติ',
  BOSS_REJECTED: 'ผู้สั่งงานส่งกลับ',
  WAITING_SUPER_BOSS_APPROVAL: 'รอหัวหน้างานอนุมัติ',
  SUPER_BOSS_REJECTED: 'หัวหน้างานส่งกลับ',
  COMPLETED: 'เสร็จสิ้น',
  CANCELLED: 'ยกเลิกแล้ว',
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  ASSIGNED: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  SUBMITTED_TO_DOCCON: 'bg-cyan-100 text-cyan-800 border-cyan-300',
  DOCCON_REJECTED: 'bg-red-100 text-red-800 border-red-300',
  PENDING_REVIEW: 'bg-blue-100 text-blue-800 border-blue-300',
  REVIEWER_REJECTED: 'bg-red-100 text-red-800 border-red-300',
  WAITING_BOSS_APPROVAL: 'bg-purple-100 text-purple-800 border-purple-300',
  BOSS_REJECTED: 'bg-red-100 text-red-800 border-red-300',
  WAITING_SUPER_BOSS_APPROVAL: 'bg-pink-100 text-pink-800 border-pink-300',
  SUPER_BOSS_REJECTED: 'bg-red-100 text-red-800 border-red-300',
  COMPLETED: 'bg-green-100 text-green-800 border-green-300',
  CANCELLED: 'bg-gray-100 text-gray-800 border-gray-300',
};

export type DocStatus = 'OPEN' | 'LOCKED' | 'NOT_YET' | 'EXPIRED' | 'NOT_SET';

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  OPEN: 'เปิดรับ',
  LOCKED: 'ล็อก',
  NOT_YET: 'ยังไม่เปิด',
  EXPIRED: 'หมดเวลา',
  NOT_SET: 'ไม่ระบุ',
};

export const DOC_STATUS_COLORS: Record<DocStatus, string> = {
  OPEN: 'bg-green-100 text-green-800 border-green-300',
  LOCKED: 'bg-red-100 text-red-800 border-red-300',
  NOT_YET: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  EXPIRED: 'bg-gray-100 text-gray-800 border-gray-300',
  NOT_SET: 'bg-slate-100 text-slate-600 border-slate-300',
};
