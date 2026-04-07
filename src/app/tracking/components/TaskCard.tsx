'use client';

import StatusBadge from './StatusBadge';
import type { TaskStatus } from '@/lib/constants/status';

/* ── Pipeline stages (happy-path order) ── */
const PIPELINE_STAGES: { key: string; label: string; icon: string }[] = [
  { key: 'ASSIGNED', label: 'มอบหมาย', icon: '①' },
  { key: 'SUBMITTED_TO_DOCCON', label: 'DocCon', icon: '②' },
  { key: 'PENDING_REVIEW', label: 'ตรวจเนื้อหา', icon: '③' },
  { key: 'WAITING_BOSS_APPROVAL', label: 'หัวหน้า', icon: '④' },
  { key: 'WAITING_SUPER_BOSS_APPROVAL', label: 'ผู้บริหาร', icon: '⑤' },
  { key: 'COMPLETED', label: 'เสร็จ', icon: '✓' },
];

/** Map every status to its corresponding pipeline stage index */
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

/* ── Left-border color per status (matches ref exactly) ── */
const BORDER_LEFT_STYLE: Record<TaskStatus, string> = {
  ASSIGNED: '#f59e0b',           // yellow
  SUBMITTED_TO_DOCCON: '#06b6d4', // cyan
  DOCCON_REJECTED: '#ef4444',    // red
  PENDING_REVIEW: '#3b82f6',     // blue
  REVIEWER_REJECTED: '#f97316',  // orange
  WAITING_BOSS_APPROVAL: '#8b5cf6', // purple
  BOSS_REJECTED: '#ef4444',      // red
  WAITING_SUPER_BOSS_APPROVAL: '#ec4899', // pink
  SUPER_BOSS_REJECTED: '#ef4444', // red
  COMPLETED: '#10b981',          // green
  CANCELLED: '#9ca3af',          // gray
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
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  });
}

/** Compute age in days from an ISO date string */
function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/** Age chip style (matches ref .age-chip / .age-chip.urgent) */
function ageStyle(days: number): string {
  if (days > 14) return 'bg-[#fee2e2] text-[#991b1b]'; // urgent red
  if (days >= 7) return 'bg-[#fef3c7] text-[#92400e]';  // warning yellow
  return 'bg-[#f3f4f6] text-[#374151]';                  // neutral
}

/* ── Pipeline visualization (matches ref .tracking-pipeline) ── */
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

        // Step state class
        let dotBg = 'bg-[#f8fafc] border-[#e2e8f0] text-[#6b7f96]'; // default/upcoming
        let labelColor = 'text-[#6b7f96]';
        let dotOpacity = isUpcoming ? 'opacity-40' : '';

        if (isDone) {
          dotBg = 'bg-[#d1fae5] border-[#10b981] text-[#10b981]';
          labelColor = 'text-[#10b981]';
        }
        if (isCurrent && isRejected) {
          dotBg = 'bg-[#fee2e2] border-[#ef4444] text-[#ef4444]';
          labelColor = 'text-[#ef4444] font-bold';
        } else if (isCurrent) {
          dotBg = 'bg-[#00c2a8] border-[#00c2a8] text-white shadow-[0_0_0_3px_rgba(0,194,168,0.2)]';
          labelColor = 'text-[#00c2a8] font-bold';
        }

        // Line color
        const lineColor = isDone ? 'bg-[#10b981]' : 'bg-[#e2e8f0]';

        return (
          <div key={stage.key} className="flex items-center" style={{ flex: 1, minWidth: '48px' }}>
            {/* connector line (skip before first dot) */}
            {i > 0 && <div className={`h-0.5 ${lineColor}`} style={{ flex: 1, minWidth: '8px', marginBottom: '16px' }} />}
            {/* step: dot + label */}
            <div className={`flex flex-col items-center shrink-0 gap-1 ${dotOpacity}`}>
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[0.65rem] border-2 ${dotBg} transition-all`}
              >
                {isDone ? '✓' : stage.icon.charAt(0) === '✓' ? '✓' : (i + 1)}
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

export default function TaskCard({ task, onClick }: TaskCardProps) {
  const age = daysAgo(task.created_at);
  const isRejected = REJECTED_STATUSES.has(task.status);

  return (
    <button
      onClick={() => onClick(task)}
      className="w-full text-left bg-white rounded-xl shadow-[0_1px_3px_rgba(13,27,46,0.06),0_1px_2px_rgba(13,27,46,0.04)] hover:shadow-[0_4px_16px_rgba(13,27,46,0.09)] hover:-translate-y-px transition-all group"
      style={{
        border: '1px solid #e2e8f0',
        borderLeft: `4px solid ${BORDER_LEFT_STYLE[task.status]}`,
        borderRadius: '12px',
      }}
    >
      {/* Card Body */}
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex-1 min-w-0">
            <p className="text-[0.68rem] text-[#6b7f96] font-mono mb-0.5">{task.task_code}</p>
            <h3 className="font-bold text-[#0d1b2e] text-sm leading-snug line-clamp-2">
              {task.title}
            </h3>
          </div>
          <StatusBadge status={task.status} size="sm" />
        </div>

        {/* Pipeline visualization */}
        <PipelineBar status={task.status} />

        {task.doc_ref && (
          <p className="text-xs text-[#6b7f96] mt-1">
            เลขที่: <span className="font-semibold text-[#374f6b]">{task.doc_ref}</span>
          </p>
        )}

        {/* Meta row (matches ref .task-meta) */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.72rem] text-[#6b7f96] mt-2">
          <span>👤 {task.officer?.display_name ?? '—'}</span>
          <span>📋 {task.reviewer?.display_name ?? '—'}</span>
        </div>

        {/* Latest comment (matches ref .comment-box) */}
        {task.latest_comment && (
          <div
            className="mt-2 px-3 py-2 rounded-md text-[0.78rem] leading-snug"
            style={{
              background: isRejected ? '#fee2e2' : '#fef3c7',
              borderLeft: `3px solid ${isRejected ? '#ef4444' : '#f59e0b'}`,
              color: isRejected ? '#991b1b' : '#92400e',
            }}
          >
            💬 {task.latest_comment}
          </div>
        )}
      </div>

      {/* Card Footer (matches ref .card-action) */}
      <div
        className="flex items-center justify-between px-3.5 py-2.5 border-t"
        style={{ background: '#f8fafc', borderColor: '#e2e8f0', borderRadius: '0 0 12px 12px' }}
      >
        <span className="text-[0.7rem] text-[#6b7f96]">
          อัปเดต {formatDate(task.updated_at)}
        </span>
        {/* Age chip (matches ref .age-chip) */}
        <span className={`text-[0.65rem] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${ageStyle(age)}`}>
          ⏱ {age} วัน
        </span>
      </div>
    </button>
  );
}
