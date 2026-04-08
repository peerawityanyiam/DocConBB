'use client';

import StatusBadge from './StatusBadge';
import type { TaskStatus } from '@/lib/constants/status';

const PIPELINE_STAGES: { key: string; label: string; icon: string }[] = [
  { key: 'ASSIGNED', label: 'เจ้าหน้าที่', icon: '1' },
  { key: 'SUBMITTED_TO_DOCCON', label: 'DocCon', icon: '2' },
  { key: 'PENDING_REVIEW', label: 'ผู้ตรวจสอบ', icon: '3' },
  { key: 'WAITING_BOSS_APPROVAL', label: 'Boss', icon: '4' },
  { key: 'WAITING_SUPER_BOSS_APPROVAL', label: 'หัวหน้างาน', icon: '5' },
  { key: 'COMPLETED', label: 'เสร็จสิ้น', icon: '6' },
];

const STATUS_STAGE_INDEX: Record<TaskStatus, number> = {
  ASSIGNED: 0,
  SUBMITTED_TO_DOCCON: 1,
  DOCCON_REJECTED: 1,
  PENDING_REVIEW: 2,
  REVIEWER_REJECTED: 2,
  WAITING_BOSS_APPROVAL: 3,
  BOSS_REJECTED: 3,
  WAITING_SUPER_BOSS_APPROVAL: 4,
  SUPER_BOSS_REJECTED: 4,
  COMPLETED: 5,
  CANCELLED: -1,
};

const REJECTED_STATUSES = new Set<TaskStatus>([
  'DOCCON_REJECTED',
  'REVIEWER_REJECTED',
  'BOSS_REJECTED',
  'SUPER_BOSS_REJECTED',
]);

const BORDER_LEFT_STYLE: Record<TaskStatus, string> = {
  ASSIGNED: '#f59e0b',
  SUBMITTED_TO_DOCCON: '#06b6d4',
  DOCCON_REJECTED: '#ef4444',
  PENDING_REVIEW: '#3b82f6',
  REVIEWER_REJECTED: '#f97316',
  WAITING_BOSS_APPROVAL: '#8b5cf6',
  BOSS_REJECTED: '#ef4444',
  WAITING_SUPER_BOSS_APPROVAL: '#ec4899',
  SUPER_BOSS_REJECTED: '#ef4444',
  COMPLETED: '#10b981',
  CANCELLED: '#9ca3af',
};

export interface TaskUser {
  id: string;
  display_name: string;
  email: string;
}

export interface Task {
  id: string;
  task_code: string;
  title: string;
  detail?: string;
  status: TaskStatus;
  doc_ref?: string;
  doccon_checked: boolean;
  drive_file_id?: string;
  drive_file_name?: string;
  latest_comment?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  is_archived: boolean;
  officer_id: string;
  reviewer_id: string;
  created_by: string;
  officer?: TaskUser | null;
  reviewer?: TaskUser | null;
  creator?: TaskUser | null;
  status_history?: Array<{
    status: TaskStatus;
    changedAt: string;
    changedBy: string;
    changedByName: string;
    note?: string;
  }>;
  comment_history?: Array<{
    text: string;
    by: string;
    byName: string;
    at: string;
  }>;
  ref_file_id?: string;
  ref_file_name?: string;
  superseded_by?: string | null;
  task_folder_id?: string;
  drive_uploaded?: boolean;
  sent_to_branch?: boolean;
  file_history?: Array<{
    fileName: string;
    driveFileId: string;
    uploadedAt: string;
    uploadedBy: string;
    uploadedByName: string;
    isPdf: boolean;
  }>;
}

interface TaskCardProps {
  task: Task;
  onClick: (task: Task) => void;
  activeRole?: string;
  userId?: string;
  isCompletedView?: boolean;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  });
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function durationText(createdAt: string, endAt?: string): string {
  const start = new Date(createdAt).getTime();
  const end = new Date(endAt ?? Date.now()).getTime();
  const days = Math.max(0, Math.floor((end - start) / 86400000));
  return `${days} วัน`;
}

function ageStyle(days: number): string {
  if (days > 14) return 'bg-[#fee2e2] text-[#991b1b]';
  if (days >= 7) return 'bg-[#fef3c7] text-[#92400e]';
  return 'bg-[#f3f4f6] text-[#374151]';
}

function getActionHint(task: Task, activeRole?: string): { text: string; color: string; icon: string } | null {
  const s = task.status;
  if (activeRole === 'DOCCON' && s === 'SUBMITTED_TO_DOCCON') return { text: 'รอตรวจรูปแบบ', icon: '🔍', color: '#00c2a8' };
  if (activeRole === 'REVIEWER' && s === 'PENDING_REVIEW') return { text: 'รอตรวจเนื้อหา', icon: '📝', color: '#00c2a8' };
  if (activeRole === 'BOSS' && s === 'WAITING_BOSS_APPROVAL') return { text: 'รอผู้สั่งงานอนุมัติ', icon: '✍️', color: '#00c2a8' };
  if (activeRole === 'SUPER_BOSS' && s === 'WAITING_SUPER_BOSS_APPROVAL') return { text: 'รอหัวหน้างานอนุมัติ', icon: '👑', color: '#00c2a8' };
  if (activeRole === 'STAFF' && REJECTED_STATUSES.has(s)) return { text: 'ตีกลับแล้ว รอแก้ไขและส่งใหม่', icon: '🔁', color: '#ef4444' };
  return null;
}

function PipelineBar({ status }: { status: TaskStatus }) {
  const currentIdx = STATUS_STAGE_INDEX[status];
  const isRejected = REJECTED_STATUSES.has(status);
  const isCancelled = status === 'CANCELLED';

  return (
    <div className="flex items-center gap-0 mt-2 mb-1 overflow-x-auto" style={{ padding: '4px 0 2px' }}>
      {PIPELINE_STAGES.map((stage, i) => {
        const isDone = !isCancelled && currentIdx > i;
        const isCurrent = currentIdx === i;
        const isUpcoming = isCancelled || currentIdx < i;

        let dotBg = 'bg-[#f8fafc] border-[#e2e8f0] text-[#6b7f96]';
        let labelColor = 'text-[#6b7f96]';
        const dotOpacity = isUpcoming ? 'opacity-40' : '';

        if (isDone) {
          dotBg = 'bg-[#d1fae5] border-[#10b981] text-[#10b981]';
          labelColor = 'text-[#10b981]';
        }
        if (isCurrent && isRejected) {
          dotBg = 'bg-[#fee2e2] border-[#ef4444] text-[#ef4444]';
          labelColor = 'text-[#ef4444] font-bold';
        } else if (isCurrent) {
          dotBg = 'bg-[#00c2a8] border-[#00c2a8] text-white';
          labelColor = 'text-[#00c2a8] font-bold';
        }

        const lineColor = isDone ? 'bg-[#10b981]' : 'bg-[#e2e8f0]';

        return (
          <div key={stage.key} className="flex items-center" style={{ flex: 1, minWidth: '48px' }}>
            {i > 0 && <div className={`h-0.5 ${lineColor}`} style={{ flex: 1, minWidth: '8px', marginBottom: '16px' }} />}
            <div className={`flex flex-col items-center shrink-0 gap-1 ${dotOpacity}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[0.65rem] border-2 ${dotBg}`}>
                {isDone ? '✓' : stage.icon}
              </div>
              <span className={`text-[0.6rem] ${labelColor} text-center whitespace-nowrap`} style={{ fontWeight: 500 }}>
                {stage.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function TaskCard({ task, onClick, activeRole, isCompletedView = false }: TaskCardProps) {
  const age = daysAgo(task.created_at);
  const isRejected = REJECTED_STATUSES.has(task.status);
  const actionHint = getActionHint(task, activeRole);
  const needsAction = actionHint?.color === '#00c2a8' || actionHint?.color === '#ef4444';
  const headline = isCompletedView ? (task.drive_file_name ?? task.title) : task.title;

  return (
    <button
      onClick={() => onClick(task)}
      className="w-full text-left bg-white rounded-xl shadow-[0_1px_3px_rgba(13,27,46,0.06),0_1px_2px_rgba(13,27,46,0.04)] hover:shadow-[0_4px_16px_rgba(13,27,46,0.09)] hover:-translate-y-px transition-all group"
      style={{ border: '1px solid #e2e8f0', borderLeft: `4px solid ${BORDER_LEFT_STYLE[task.status]}`, borderRadius: '12px' }}
    >
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-[#0d1b2e] text-sm leading-snug line-clamp-2">{headline}</h3>
          </div>
          <StatusBadge status={task.status} size="sm" />
        </div>

        {isCompletedView ? (
          <div className="space-y-2 mt-1 text-[0.72rem]">
            <p className="text-[#6b7f96]">คำสั่ง: <span className="text-[#0d1b2e] font-semibold">{task.title}</span></p>
            <p className="text-[#6b7f96]">ชื่อไฟล์สุดท้าย: <span className="text-[#0d1b2e] font-semibold">{task.drive_file_name ?? '-'}</span></p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[#6b7f96]">
              <p>รหัสเอกสาร: <span className="font-semibold text-[#374f6b]">{task.doc_ref ?? '-'}</span></p>
              <p>ผู้ดำเนินการ: <span className="font-semibold text-[#374f6b]">{task.officer?.display_name ?? '-'}</span></p>
              <p>ผู้ตรวจสอบ: <span className="font-semibold text-[#374f6b]">{task.reviewer?.display_name ?? '-'}</span></p>
              <p>วันที่เสร็จ: <span className="font-semibold text-[#374f6b]">{formatDate(task.completed_at ?? task.updated_at)}</span></p>
              <p>ระยะเวลา: <span className="font-semibold text-[#374f6b]">{durationText(task.created_at, task.completed_at ?? task.updated_at)}</span></p>
            </div>
            {task.superseded_by && task.status === 'COMPLETED' && (
              <div className="mt-2 px-3 py-2 rounded-md text-[0.72rem] bg-amber-50 border border-amber-200 text-amber-700">
                มีเอกสารใหม่ของรหัสนี้แล้ว จึงไม่สามารถดาวน์โหลดไฟล์จากการ์ดเก่าได้
              </div>
            )}
          </div>
        ) : (
          <>
            {actionHint && (
              <div
                className="flex items-center gap-1.5 mt-1.5 mb-1 px-2.5 py-1 rounded-md text-[0.72rem] font-semibold"
                style={{
                  background: needsAction ? `${actionHint.color}12` : `${actionHint.color}10`,
                  color: actionHint.color,
                  border: needsAction ? `1px solid ${actionHint.color}30` : 'none',
                }}
              >
                <span>{actionHint.icon}</span>
                <span>{actionHint.text}</span>
              </div>
            )}

            <PipelineBar status={task.status} />

            {task.doc_ref && (
              <p className="text-xs text-[#6b7f96] mt-1">รหัสเอกสาร: <span className="font-semibold text-[#374f6b]">{task.doc_ref}</span></p>
            )}

            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.72rem] text-[#6b7f96] mt-2">
              <span>ผู้ดำเนินการ: {task.officer?.display_name ?? '-'}</span>
              <span>ผู้ตรวจสอบ: {task.reviewer?.display_name ?? '-'}</span>
            </div>

            {task.latest_comment && (
              <div
                className="mt-2 px-3 py-2 rounded-md text-[0.78rem] leading-snug"
                style={{
                  background: isRejected ? '#fee2e2' : '#fef3c7',
                  borderLeft: `3px solid ${isRejected ? '#ef4444' : '#f59e0b'}`,
                  color: isRejected ? '#991b1b' : '#92400e',
                }}
              >
                หมายเหตุ: {task.latest_comment}
              </div>
            )}
          </>
        )}
      </div>

      {!isCompletedView && (
        <div className="flex items-center justify-between px-3.5 py-2.5 border-t" style={{ background: '#f8fafc', borderColor: '#e2e8f0', borderRadius: '0 0 12px 12px' }}>
          <span className="text-[0.7rem] text-[#6b7f96]">อัปเดต {formatDate(task.updated_at)}</span>
          <span className={`text-[0.65rem] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${ageStyle(age)}`}>⏱ {age} วัน</span>
        </div>
      )}
    </button>
  );
}
