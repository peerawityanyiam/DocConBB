'use client';

import DocStatusBadge from './DocStatusBadge';
import { calculateDocStatus } from '@/lib/utils/status';
import type { AppRole } from '@/lib/auth/guards';

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
  onSettings: (standard: Standard) => void;
  onDelete: (standard: Standard) => void;
  onTogglePin: (standard: Standard) => void;
}

function formatDate(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function StandardCard({ standard, userRoles, onUpload, onSettings, onDelete, onTogglePin }: StandardCardProps) {
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

  return (
    <div className={`bg-white rounded-xl border shadow-sm transition-all hover:shadow-md ${standard.hidden ? 'opacity-60 border-dashed border-slate-300' : 'border-slate-200'}`}>
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            {standard.pinned && <span className="text-yellow-500 mt-0.5 shrink-0" title="ปักหมุด">📌</span>}
            {standard.hidden && <span className="text-slate-400 mt-0.5 shrink-0" title="ซ่อน">👁️‍🗨️</span>}
            <h3 className="font-semibold text-slate-800 text-sm leading-snug">{standard.name}</h3>
          </div>
          <DocStatusBadge status={docStatus} />
        </div>

        {/* Date range */}
        {(standard.start_date || standard.end_date) && !standard.always_open && (
          <p className="text-xs text-slate-500 mb-3">
            {formatDate(standard.start_date)} — {formatDate(standard.end_date)}
          </p>
        )}
        {standard.always_open && (
          <p className="text-xs text-slate-500 mb-3">เปิดตลอด</p>
        )}

        {/* File info */}
        {standard.drive_file_name && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-3 bg-slate-50 rounded-lg px-2.5 py-1.5">
            <span>📄</span>
            <span className="truncate">{standard.drive_file_name}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
          {openUrl && (
            <a href={openUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg transition-colors">
              <span>🔗</span>
              {standard.is_link ? 'เปิดลิงก์' : 'ดูไฟล์'}
            </a>
          )}

          {/* Upload (STAFF & DOCCON) */}
          <button onClick={() => onUpload(standard)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 rounded-lg transition-colors">
            <span>⬆️</span>
            อัปโหลด
          </button>

          {/* DOCCON-only actions */}
          {isDoccon && (
            <>
              <button onClick={() => onTogglePin(standard)}
                className="px-3 py-1.5 text-xs font-medium bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded-lg transition-colors"
                title={standard.pinned ? 'เลิกปักหมุด' : 'ปักหมุด'}>
                {standard.pinned ? '📌 เลิกปักหมุด' : '📌 ปักหมุด'}
              </button>
              <button onClick={() => onSettings(standard)}
                className="px-3 py-1.5 text-xs font-medium bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                ⚙️ ตั้งค่า
              </button>
              <button onClick={() => onDelete(standard)}
                className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors">
                🗑️ ลบ
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
