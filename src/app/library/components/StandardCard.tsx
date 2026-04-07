'use client';

import { calculateDocStatus } from '@/lib/utils/status';
import type { AppRole } from '@/lib/auth/guards';
import type { DocStatus } from '@/lib/constants/status';

export interface Standard {
  id: string;
  name: string;
  url: string;
  drive_file_id?: string;
  drive_file_name?: string;
  is_link: boolean;
  start_date?: string | null;
  end_date?: string | null;
  always_open: boolean;
  hidden: boolean;
  locked: boolean;
  pinned: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface StandardCardProps {
  standard: Standard;
  userRoles: AppRole[];
  onUpload: (standard: Standard) => void;
  onRename: (standard: Standard) => void;
  onSettings: (standard: Standard) => void;
  onDelete: (standard: Standard) => void;
  onTogglePin: (standard: Standard) => void;
}

function formatDisplayDate(d: string | null | undefined) {
  if (!d) return '';
  const parts = d.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
}

/* ── Stripe color per status (matches ref .s-open etc) ── */
function stripeGradient(status: DocStatus, isLink: boolean): string {
  if (isLink) return 'linear-gradient(90deg, #a855f7, #7c3aed)'; // purple
  switch (status) {
    case 'OPEN': return 'linear-gradient(90deg, #22c55e, #16a34a)';
    case 'NOT_YET': return 'linear-gradient(90deg, #f59e0b, #d97706)';
    case 'EXPIRED': return 'linear-gradient(90deg, #94a3b8, #64748b)';
    case 'LOCKED': return '#e5e7eb';
    default: return '#e5e7eb';
  }
}

/* ── Status pill (matches ref .s-pill .p-*) ── */
function statusPill(status: DocStatus, isLink: boolean, alwaysOpen: boolean) {
  if (isLink) {
    return { bg: '#faf5ff', color: '#7c3aed', border: '#e9d5ff', label: '🔗 ลิงก์ภายนอก' };
  }
  if (status === 'OPEN') {
    return {
      bg: '#f0fdf4', color: '#15803d', border: 'transparent',
      label: alwaysOpen ? '● เปิดรับเอกสาร' : '● เปิดรับเอกสาร',
    };
  }
  if (status === 'NOT_YET') {
    return { bg: '#fffbeb', color: '#b45309', border: 'transparent', label: '● ยังไม่ถึงช่วงรับเอกสาร' };
  }
  if (status === 'EXPIRED') {
    return { bg: '#f1f5f9', color: '#475569', border: 'transparent', label: '● ปิดรับเอกสาร' };
  }
  // LOCKED
  return { bg: '#f8fafc', color: '#9ca3af', border: '#e5e7eb', label: '● ปิดรับเอกสาร' };
}

/* ── Info message (matches ref .info-msg) ── */
function infoMsg(status: DocStatus, openDate: string | null | undefined) {
  if (status === 'LOCKED') {
    return { bg: '#f8fafc', border: '#e5e7eb', color: '#64748b', icon: '🔒', text: 'ไม่อยู่ในช่วงรับเอกสาร' };
  }
  if (status === 'NOT_YET' && openDate) {
    return { bg: '#fffbeb', border: '#fde68a', color: '#b45309', icon: '⏰', text: `เปิดรับ ${formatDisplayDate(openDate)}` };
  }
  if (status === 'EXPIRED') {
    return { bg: '#f1f5f9', border: '#e5e7eb', color: '#475569', icon: '🔒', text: 'หมดช่วงรับเอกสาร' };
  }
  return null;
}

export default function StandardCard({ standard, userRoles, onUpload, onRename, onSettings, onDelete, onTogglePin }: StandardCardProps) {
  const docStatus = calculateDocStatus(
    standard.start_date ?? null,
    standard.end_date ?? null,
    standard.always_open,
    standard.locked
  );

  const isDoccon = userRoles.includes('DOCCON') || userRoles.includes('SUPER_ADMIN');
  const driveUrl = standard.drive_file_id
    ? `https://drive.google.com/file/d/${standard.drive_file_id}/view`
    : null;
  const openUrl = driveUrl ?? (standard.url || null);

  const pill = statusPill(docStatus, standard.is_link, standard.always_open);
  const info = !standard.is_link ? infoMsg(docStatus, standard.start_date) : null;
  const isWindow = !standard.is_link && !standard.always_open && !standard.locked;

  return (
    <div
      className={`bg-white border rounded-xl overflow-hidden flex flex-col transition-all hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:-translate-y-[3px] ${standard.hidden ? 'opacity-65 border-dashed' : ''}`}
      style={{ border: '1px solid #e5e7eb' }}
    >
      {/* Top stripe (matches ref .card-stripe) */}
      <div style={{ height: '4px', flexShrink: 0, background: stripeGradient(docStatus, standard.is_link) }} />

      {/* Card body (matches ref .card-body) */}
      <div className="flex-1" style={{ padding: '18px 18px 14px' }}>
        {/* Pin badge */}
        {standard.pinned && (
          <div className="flex items-center gap-1 text-[11px] text-[#ca8a04] mb-1.5 font-medium">
            📌 ปักหมุดไว้
          </div>
        )}

        {/* Name */}
        <div className="flex items-start gap-2 text-[15px] font-bold text-[#111827] leading-snug mb-3">
          <span>{standard.name}</span>
          {standard.hidden && (
            <span className="bg-[#f1f5f9] text-[#475569] text-[10px] px-2 py-0.5 rounded-full font-semibold border border-[#e5e7eb] shrink-0 mt-0.5">ซ่อนอยู่</span>
          )}
        </div>

        {/* Status pill */}
        <div
          className="inline-flex items-center gap-1.5 rounded-full text-[11.5px] font-semibold mb-3"
          style={{ padding: '5px 12px', background: pill.bg, color: pill.color, border: pill.border !== 'transparent' ? `1px solid ${pill.border}` : 'none' }}
        >
          {pill.label}
        </div>

        {/* Info message */}
        {info && (
          <div
            className="flex items-center gap-2 rounded-lg text-xs leading-snug mb-3"
            style={{ padding: '9px 12px', background: info.bg, color: info.color, border: `1px solid ${info.border}` }}
          >
            {info.icon} {info.text}
          </div>
        )}

        {/* Dates (matches ref .card-dates) */}
        {isWindow && (standard.start_date || standard.end_date) && (
          <div className="flex gap-3.5 flex-wrap text-[11.5px] text-[#6b7280] mb-1">
            {standard.start_date && (
              <span className="flex items-center gap-1">📅 เปิด {formatDisplayDate(standard.start_date)}</span>
            )}
            {standard.end_date && (
              <span className="flex items-center gap-1">📅 ปิด {formatDisplayDate(standard.end_date)}</span>
            )}
          </div>
        )}
      </div>

      {/* Card footer (matches ref .card-foot) */}
      <div
        className="flex gap-2 items-center flex-wrap"
        style={{ borderTop: '1px solid #e5e7eb', padding: '12px 18px', background: '#fafbfc' }}
      >
        {/* Main action button */}
        {standard.is_link && openUrl ? (
          <a href={openUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-white no-underline"
            style={{ background: '#7c3aed', padding: '6px 14px' }}>
            ↗ เปิดลิงก์
          </a>
        ) : openUrl ? (
          <a href={openUrl} target="_blank" rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 rounded-md text-xs font-semibold no-underline ${
              docStatus === 'OPEN'
                ? 'text-white shadow-[0_2px_8px_rgba(37,99,235,0.25)]'
                : 'bg-white text-[#374151] border border-[#e5e7eb] shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
            }`}
            style={{ padding: '6px 14px', ...(docStatus === 'OPEN' ? { background: '#2563eb' } : {}) }}>
            {docStatus === 'OPEN' ? '✏️ เข้าสู่เอกสาร' : '📥 เข้าสู่เอกสาร'}
          </a>
        ) : null}

        {/* DocCon action buttons (matches ref card foot admin buttons) */}
        {isDoccon && (
          <div className="ml-auto flex gap-1.5">
            <button onClick={() => onTogglePin(standard)}
              className={`rounded-md text-xs border transition-colors ${
                standard.pinned
                  ? 'bg-[#fef9c3] text-[#ca8a04] border-[#fde047]'
                  : 'bg-[#f1f5f9] text-[#94a3b8] border-[#e5e7eb] hover:bg-[#fef9c3] hover:text-[#ca8a04] hover:border-[#fde047]'
              }`}
              style={{ padding: '6px 10px' }}
              title={standard.pinned ? 'ถอดหมุด' : 'ปักหมุด'}>
              📌
            </button>
            <button onClick={() => onRename(standard)}
              className="bg-[#f1f5f9] text-[#475569] border border-[#e5e7eb] rounded-md text-xs hover:bg-[#e2e8f0] hover:text-[#111827] transition-colors"
              style={{ padding: '6px 10px' }}
              title="เปลี่ยนชื่อ">
              ✏️
            </button>
            {!standard.is_link && (
              <button onClick={() => onSettings(standard)}
                className="bg-[#f1f5f9] text-[#475569] border border-[#e5e7eb] rounded-md text-xs hover:bg-[#e2e8f0] hover:text-[#111827] transition-colors"
                style={{ padding: '6px 10px' }}
                title="ตั้งค่า">
                ⚙️
              </button>
            )}
            <button onClick={() => onDelete(standard)}
              className="bg-[#fff1f2] text-[#dc2626] border border-[#fecaca] rounded-md text-xs hover:bg-[#fee2e2] hover:text-[#b91c1c] transition-colors"
              style={{ padding: '6px 10px' }}
              title="ลบ">
              🗑️
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
