'use client';

import { STATUS_LABELS } from '@/lib/constants/status';
import type { TaskStatus } from '@/lib/constants/status';
import { getStageDurationDaysByHistoryIndex } from '@/lib/tasks/pipeline';

interface HistoryEntry {
  status: TaskStatus | string;
  changedAt: string;
  changedBy: string;
  changedByName: string;
  note?: string;
}

interface StatusTimelineProps {
  history: HistoryEntry[];
  currentStatus?: TaskStatus | string;
  updatedAt?: string;
  completedAt?: string;
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

function formatDaysValue(days: number): string {
  return days.toFixed(1);
}

const NOTE_DISPLAY: Record<string, string> = {
  'sentBackBy:BOSS': 'ส่งกลับตรวจรูปแบบโดยผู้สั่งงาน',
  'sentBackBy:SUPER_BOSS': 'ส่งกลับตรวจรูปแบบโดยหัวหน้างาน',
  'sentBackToDocconBy:BOSS': 'ส่งกลับให้ DocCon ตรวจใหม่โดยผู้สั่งงาน',
  'sentBackToDocconBy:SUPER_BOSS': 'ส่งกลับให้ DocCon ตรวจใหม่โดยหัวหน้างาน',
  'reopenFromCompletedBy:DOCCON': 'DocCon ดึงงานที่เสร็จแล้วกลับมาแก้ไข',
  'reopenFromCompletedBy:BOSS': 'ผู้สั่งงานดึงงานที่เสร็จแล้วกลับมาแก้ไข',
  'reopenFromCompletedBy:SUPER_BOSS': 'หัวหน้างานดึงงานที่เสร็จแล้วกลับมาแก้ไข',
  'สร้างงานใหม่': 'สร้างงานใหม่',
};

function resolveSystemNote(note: string): { text: string; reason?: string } | null {
  const marker = Object.keys(NOTE_DISPLAY).find((key) => note.startsWith(key));
  if (!marker) return null;
  const reasonPrefix = '|reason:';
  const reasonIndex = note.indexOf(reasonPrefix);
  const reason = reasonIndex >= 0 ? note.slice(reasonIndex + reasonPrefix.length).trim() : '';
  return {
    text: NOTE_DISPLAY[marker],
    reason: reason || undefined,
  };
}

const STATUS_ICON: Record<string, string> = {
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
  REASSIGNED: '🔁',
};

const STATUS_ACTION_LABEL: Record<string, string> = {
  ASSIGNED: 'สร้างงานใหม่',
  SUBMITTED_TO_DOCCON: 'ส่งให้ DocCon ตรวจ',
  DOCCON_REJECTED: 'ส่งกลับให้เจ้าหน้าที่แก้ไข',
  PENDING_REVIEW: 'ส่งให้ผู้ตรวจสอบเนื้อหา',
  REVIEWER_REJECTED: 'ส่งกลับให้เจ้าหน้าที่แก้ไข',
  WAITING_BOSS_APPROVAL: 'ส่งให้ผู้สั่งงานอนุมัติ',
  BOSS_REJECTED: 'ส่งกลับให้เจ้าหน้าที่แก้ไขแล้วส่งใหม่',
  WAITING_SUPER_BOSS_APPROVAL: 'ส่งให้หัวหน้างานอนุมัติ',
  SUPER_BOSS_REJECTED: 'ส่งกลับให้เจ้าหน้าที่แก้ไขแล้วส่งใหม่',
  COMPLETED: 'อนุมัติให้เสร็จสิ้น',
  CANCELLED: 'ยกเลิกงาน',
  REASSIGNED: 'โอนงาน',
};

function getActionLabel(entry: HistoryEntry, statusLabel: string): string {
  const note = entry.note ?? '';

  if (note.startsWith('sentBackToDocconBy:')) return 'ส่งกลับให้ DocCon ตรวจใหม่';
  if (note.startsWith('reopenFromCompletedBy:')) return 'ดึงงานที่เสร็จแล้วกลับมาแก้ไข';

  return STATUS_ACTION_LABEL[entry.status] ?? `เปลี่ยนสถานะเป็น ${statusLabel}`;
}

export default function StatusTimeline({
  history,
  currentStatus,
  updatedAt,
  completedAt,
}: StatusTimelineProps) {
  if (!history?.length) {
    return <p className="text-sm text-slate-400 italic">ยังไม่มีประวัติสถานะ</p>;
  }

  const durationByIndex = getStageDurationDaysByHistoryIndex(history, {
    currentStatus,
    updatedAt,
    completedAt,
  });

  const reversed = history
    .map((entry, index) => ({ entry, index }))
    .reverse();

  return (
    <ol className="relative border-l border-slate-200 ml-2 space-y-4">
      {reversed.map(({ entry, index }, idx) => {
        const statusLabel = STATUS_LABELS[entry.status as TaskStatus] ?? entry.status;
        const stuckDays = durationByIndex[index];
        const systemNote = entry.note ? resolveSystemNote(entry.note) : null;
        const actorName = entry.changedByName || entry.changedBy || 'ไม่ระบุ';
        const actionLabel = getActionLabel(entry, statusLabel);

        return (
          <li key={`${entry.changedAt}-${index}`} className="ml-4">
            <div className="absolute -left-2 mt-1 w-4 h-4 rounded-full bg-white border-2 border-slate-300 flex items-center justify-center text-[10px]">
              {idx === 0 ? (
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 block" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-slate-300 block" />
              )}
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 shadow-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-sm">{STATUS_ICON[entry.status] ?? '•'}</span>
                  <span className="text-sm font-semibold text-slate-900">{statusLabel}</span>
                </div>
                {(typeof stuckDays === 'number' && Number.isFinite(stuckDays)) || idx === 0 ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {typeof stuckDays === 'number' && Number.isFinite(stuckDays) && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                        ใช้เวลา {formatDaysValue(stuckDays)} วัน
                      </span>
                    )}
                    {idx === 0 && (
                      <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-[11px] font-semibold text-yellow-700">
                        ล่าสุด
                      </span>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2 shadow-xs">
                <p className="text-xs leading-relaxed text-slate-600">
                  <span className="font-semibold text-slate-700">{actorName}</span>{' '}
                  {actionLabel}
                  <span className="text-slate-400"> &bull; {formatDateTime(entry.changedAt)}</span>
                </p>

                {entry.note && !systemNote && (
                  <p className="mt-1 text-xs italic text-slate-600">&ldquo;{entry.note}&rdquo;</p>
                )}

                {systemNote?.reason && (
                  <p className="mt-1 text-xs italic text-slate-600">&ldquo;{systemNote.reason}&rdquo;</p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
