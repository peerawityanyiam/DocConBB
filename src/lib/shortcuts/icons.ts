/**
 * Fixed icon set for home page external shortcuts.
 *
 * SUPER_ADMIN picks an `icon_key` when creating a shortcut; the client
 * looks up the emoji from this list. Using emoji keeps the bundle small
 * (no icon lib) and matches the existing homepage card style.
 *
 * Picking an icon is optional — when `icon_key` is null or not in this
 * map, the button renders with just its label.
 */

export interface ShortcutIcon {
  key: string;
  emoji: string;
  label: string;
}

export const SHORTCUT_ICONS: ShortcutIcon[] = [
  { key: 'link', emoji: '🔗', label: 'ลิงก์' },
  { key: 'globe', emoji: '🌐', label: 'เว็บไซต์' },
  { key: 'book', emoji: '📖', label: 'คู่มือ' },
  { key: 'file', emoji: '📄', label: 'เอกสาร' },
  { key: 'clipboard', emoji: '📋', label: 'แบบฟอร์ม' },
  { key: 'calendar', emoji: '📅', label: 'ปฏิทิน' },
  { key: 'mail', emoji: '✉️', label: 'อีเมล' },
  { key: 'phone', emoji: '📞', label: 'โทรศัพท์' },
  { key: 'hospital', emoji: '🏥', label: 'โรงพยาบาล' },
  { key: 'users', emoji: '👥', label: 'บุคลากร' },
  { key: 'education', emoji: '🎓', label: 'การศึกษา' },
  { key: 'chart', emoji: '📊', label: 'สถิติ' },
  { key: 'bookmark', emoji: '🔖', label: 'บุ๊กมาร์ก' },
  { key: 'shield', emoji: '🛡️', label: 'ความปลอดภัย' },
  { key: 'download', emoji: '⬇️', label: 'ดาวน์โหลด' },
  { key: 'video', emoji: '🎥', label: 'วิดีโอ' },
  { key: 'wrench', emoji: '🔧', label: 'เครื่องมือ' },
  { key: 'help', emoji: '❓', label: 'ช่วยเหลือ' },
  { key: 'blood', emoji: '🩸', label: 'เลือด' },
  { key: 'syringe', emoji: '💉', label: 'เจาะเลือด' },
  { key: 'test-tube', emoji: '🧪', label: 'สิ่งส่งตรวจ' },
  { key: 'microscope', emoji: '🔬', label: 'ห้องปฏิบัติการ' },
  { key: 'dna', emoji: '🧬', label: 'พันธุกรรม' },
  { key: 'pill', emoji: '💊', label: 'ยา' },
  { key: 'stethoscope', emoji: '🩺', label: 'คลินิก' },
  { key: 'ambulance', emoji: '🚑', label: 'ฉุกเฉิน' },
  { key: 'folder', emoji: '📁', label: 'โฟลเดอร์' },
  { key: 'memo', emoji: '📝', label: 'บันทึก' },
  { key: 'check', emoji: '✅', label: 'ตรวจสอบ' },
  { key: 'warning', emoji: '⚠️', label: 'คำเตือน' },
  { key: 'bell', emoji: '🔔', label: 'แจ้งเตือน' },
  { key: 'megaphone', emoji: '📢', label: 'ประกาศ' },
  { key: 'package', emoji: '📦', label: 'พัสดุ/คลัง' },
  { key: 'chat', emoji: '💬', label: 'แชท' },
  { key: 'star', emoji: '⭐', label: 'สำคัญ' },
  { key: 'home', emoji: '🏠', label: 'หน้าหลัก' },
];

const ICON_MAP: Record<string, string> = Object.fromEntries(
  SHORTCUT_ICONS.map((i) => [i.key, i.emoji]),
);

export function getShortcutEmoji(iconKey: string | null | undefined): string | null {
  if (!iconKey) return null;
  return ICON_MAP[iconKey] ?? null;
}
