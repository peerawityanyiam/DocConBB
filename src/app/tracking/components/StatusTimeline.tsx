'use client';

import { STATUS_LABELS } from '@/lib/constants/status';
import type { TaskStatus } from '@/lib/constants/status';

interface HistoryEntry {
  status: TaskStatus;
  changedAt: string;
  changedBy: string;
  changedByName: string;
  note?: string;
}

interface StatusTimelineProps {
  history: HistoryEntry[];
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}

const NOTE_DISPLAY: Record<string, string> = {
  'sentBackBy:BOSS': 'ส่งกลับตรวจรูปแบบโดยหัวหน้า',
  'sentBackBy:SUPER_BOSS': 'ส่งกลับตรวจรูปแบบโดยผู้บริหาร',
  'สร้างงานใหม่': 'สร้างงานใหม่',
};

const STATUS_ICON: Partial<Record<TaskStatus, string>> = {
  ASSIGNED: '📋',
  SUBMITTED_TO_DOCCON: '📤',
  DOCCON_REJECTED: '❌',
  PENDING_REVIEW: '🔍',
  REVIEWER_REJECTED: '❌',
  WAITING_BOSS_APPROVAL: '⏳',
  BOSS_REJECTED: '❌',
  WAITING_SUPER_BOSS_APPROVAL: '⏳',
  SUPER_BOSS_REJECTED: '❌',
  COMPLETED: '✅',
  CANCELLED: '🚫',
};

export default function StatusTimeline({ history }: StatusTimelineProps) {
  if (!history?.length) {
    return <p className="text-sm text-slate-400 italic">ยังไม่มีประวัติสถานะ</p>;
  }

  const reversed = [...history].reverse();

  return (
    <ol className="relative border-l border-slate-200 ml-2 space-y-4">
      {reversed.map((entry, idx) => (
        <li key={idx} className="ml-4">
          <div className="absolute -left-2 mt-1 w-4 h-4 rounded-full bg-white border-2 border-slate-300 flex items-center justify-center text-[10px]">
            {idx === 0 ? (
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 block" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-slate-300 block" />
            )}
          </div>
          <div className="bg-white border border-slate-100 rounded-lg px-3 py-2 shadow-xs">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm">{STATUS_ICON[entry.status] ?? '•'}</span>
              <span className="text-sm font-medium text-slate-800">
                {STATUS_LABELS[entry.status] ?? entry.status}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {entry.changedByName} &bull; {formatDateTime(entry.changedAt)}
            </p>
            {entry.note && !entry.note.startsWith('sentBackBy:') && entry.note !== 'สร้างงานใหม่' && (
              <p className="text-xs text-slate-600 mt-1 italic">&ldquo;{entry.note}&rdquo;</p>
            )}
            {entry.note && (entry.note.startsWith('sentBackBy:') || entry.note === 'สร้างงานใหม่') && (
              <p className="text-xs text-slate-500 mt-1">{NOTE_DISPLAY[entry.note] ?? entry.note}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
