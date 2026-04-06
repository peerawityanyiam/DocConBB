'use client';

import StatusBadge from './StatusBadge';
import type { TaskStatus } from '@/lib/constants/status';

/* ── Pipeline stages (happy-path order) ── */
const PIPELINE_STAGES: { key: TaskStatus; label: string }[] = [
  { key: 'ASSIGNED', label: 'มอบหมาย' },
  { key: 'SUBMITTED_TO_DOCCON', label: 'ตรวจรูปแบบ' },
  { key: 'PENDING_REVIEW', label: 'ตรวจเนื้อหา' },
  { key: 'WAITING_BOSS_APPROVAL', label: 'อนุมัติหัวหน้า' },
  { key: 'WAITING_SUPER_BOSS_APPROVAL', label: 'อนุมัติผู้บริหาร' },
  { key: 'COMPLETED', label: 'เสร็จ' },
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

/* ── Left-border color per status ── */
const BORDER_LEFT_COLOR: Record<TaskStatus, string> = {
  ASSIGNED: 'border-l-yellow-400',
  SUBMITTED_TO_DOCCON: 'border-l-cyan-400',
  DOCCON_REJECTED: 'border-l-red-400',
  PENDING_REVIEW: 'border-l-blue-400',
  REVIEWER_REJECTED: 'border-l-red-400',
  WAITING_BOSS_APPROVAL: 'border-l-purple-400',
  BOSS_REJECTED: 'border-l-red-400',
  WAITING_SUPER_BOSS_APPROVAL: 'border-l-pink-400',
  SUPER_BOSS_REJECTED: 'border-l-red-400',
  COMPLETED: 'border-l-green-400',
  CANCELLED: 'border-l-gray-400',
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

/** Age chip background color */
function ageBg(days: number): string {
  if (days > 14) return 'bg-red-100 text-red-700';
  if (days >= 7) return 'bg-orange-100 text-orange-700';
  return 'bg-slate-100 text-slate-600';
}

/* ── Pipeline visualization ── */
function PipelineBar({ status }: { status: TaskStatus }) {
  const currentIdx = STATUS_STAGE_INDEX[status];
  const isRejected = REJECTED_STATUSES.has(status);
  const isCancelled = status === 'CANCELLED';

  return (
    <div className="flex items-center gap-0 mt-2 mb-1 px-0.5" aria-label="ขั้นตอนงาน">
      {PIPELINE_STAGES.map((stage, i) => {
        const isCompleted = !isCancelled && currentIdx > i;
        const isCurrent = currentIdx === i;
        const isFuture = isCancelled || currentIdx < i;

        // Dot color
        let dotClass = 'bg-slate-300'; // future / cancelled
        if (isCompleted) dotClass = 'bg-green-500';
        if (isCurrent && isRejected) dotClass = 'bg-red-500 ring-2 ring-red-200';
        else if (isCurrent) dotClass = 'bg-blue-500 ring-2 ring-blue-200 animate-pulse';

        // Line color (line before this dot)
        const lineClass = isCompleted ? 'bg-green-400' : 'bg-slate-200';

        return (
          <div key={stage.key} className="flex items-center flex-1 min-w-0">
            {/* connector line (skip before first dot) */}
            {i > 0 && <div className={`h-0.5 flex-1 ${lineClass} rounded-full`} />}
            {/* dot */}
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`}
              title={stage.label}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function TaskCard({ task, onClick }: TaskCardProps) {
  const age = daysAgo(task.created_at);

  return (
    <button
      onClick={() => onClick(task)}
      className={`w-full text-left bg-white rounded-xl border border-slate-200 border-l-4 ${BORDER_LEFT_COLOR[task.status]} shadow-sm hover:shadow-md hover:border-slate-300 transition-all p-4 group`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-400 font-mono mb-0.5">{task.task_code}</p>
          <h3 className="font-semibold text-slate-800 text-sm leading-snug group-hover:text-slate-900 line-clamp-2">
            {task.title}
          </h3>
        </div>
        <StatusBadge status={task.status} size="sm" />
      </div>

      {/* Pipeline visualization */}
      <PipelineBar status={task.status} />

      {task.doc_ref && (
        <p className="text-xs text-slate-500 mb-2">
          เลขที่เอกสาร: <span className="font-medium text-slate-700">{task.doc_ref}</span>
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mt-3">
        <span>
          ผู้รับผิดชอบ: <span className="text-slate-700">{task.officer?.display_name ?? '—'}</span>
        </span>
        <span>
          ผู้ตรวจสอบ: <span className="text-slate-700">{task.reviewer?.display_name ?? '—'}</span>
        </span>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">อัปเดต {formatDate(task.updated_at)}</span>
          {/* Age chip */}
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ageBg(age)}`}>
            {age} วัน
          </span>
        </div>
        {task.latest_comment && (
          <span className="text-xs text-slate-400 italic truncate max-w-[160px]">
            &ldquo;{task.latest_comment}&rdquo;
          </span>
        )}
      </div>
    </button>
  );
}
