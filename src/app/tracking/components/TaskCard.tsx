'use client';

import StatusBadge from './StatusBadge';
import type { TaskStatus } from '@/lib/constants/status';

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
  file_history?: Array<{
    fileName: string;
    fileId: string;
    uploadedAt: string;
    uploadedBy: string;
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

export default function TaskCard({ task, onClick }: TaskCardProps) {
  return (
    <button
      onClick={() => onClick(task)}
      className="w-full text-left bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all p-4 group"
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
        <span className="text-xs text-slate-400">อัปเดต {formatDate(task.updated_at)}</span>
        {task.latest_comment && (
          <span className="text-xs text-slate-400 italic truncate max-w-[160px]">
            &ldquo;{task.latest_comment}&rdquo;
          </span>
        )}
      </div>
    </button>
  );
}
