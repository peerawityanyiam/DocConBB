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
  activeRole?: string;  // Which role tab is viewing this card
  userId?: string;      // Current user id for action-required detection
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

/** Role-specific action hint — tells the viewer what they need to do */
function getActionHint(task: Task, activeRole?: string, userId?: string): { text: string; color: string; icon: string } | null {
  const s = task.status;

  if (activeRole === 'STAFF') {
    if (s === 'ASSIGNED') return { text: 'รอส่งงาน', icon: '📤', color: '#f59e0b' };
    if (s === 'DOCCON_REJECTED') return { text: 'ถูกตีกลับ (DocCon) — แก้ไขแล้วส่งใหม่', icon: '🔄', color: '#ef4444' };
    if (s === 'REVIEWER_REJECTED') return { text: 'ถูกตีกลับ (ผู้ตรวจสอบ) — แก้ไขแล้วส่งใหม่', icon: '🔄', color: '#ef4444' };
    if (s === 'BOSS_REJECTED') return { text: 'ถูกตีกลับ (หัวหน้า) — แก้ไขแล้วส่งใหม่', icon: '🔄', color: '#ef4444' };
    if (s === 'SUPER_BOSS_REJECTED') return { text: 'ถูกตีกลับ (ผู้บริหาร) — แก้ไขแล้วส่งใหม่', icon: '🔄', color: '#ef4444' };
    if (s === 'SUBMITTED_TO_DOCCON') return { text: 'อยู่ระหว่าง DocCon ตรวจสอบ', icon: '⏳', color: '#06b6d4' };
    if (s === 'PENDING_REVIEW') return { text: 'อยู่ระหว่างตรวจเนื้อหา', icon: '⏳', color: '#3b82f6' };
    if (s === 'WAITING_BOSS_APPROVAL') return { text: 'อยู่ระหว่างรออนุมัติหัวหน้า', icon: '⏳', color: '#8b5cf6' };
    if (s === 'WAITING_SUPER_BOSS_APPROVAL') return { text: 'อยู่ระหว่างรออนุมัติผู้บริหาร', icon: '⏳', color: '#ec4899' };
    if (s === 'COMPLETED') return { text: 'เสร็จสมบูรณ์', icon: '✅', color: '#10b981' };
    if (s === 'CANCELLED') return { text: 'ยกเลิกแล้ว', icon: '🚫', color: '#9ca3af' };
  }

  if (activeRole === 'DOCCON') {
    if (s === 'SUBMITTED_TO_DOCCON') return { text: 'รอตรวจรูปแบบ', icon: '🔍', color: '#00c2a8' };
  }

  if (activeRole === 'REVIEWER') {
    if (s === 'PENDING_REVIEW') return { text: 'รอตรวจสอบเนื้อหา', icon: '📝', color: '#00c2a8' };
  }

  if (activeRole === 'BOSS') {
    if (s === 'WAITING_BOSS_APPROVAL') return { text: 'รออนุมัติ', icon: '✍️', color: '#00c2a8' };
    if (s === 'ASSIGNED') return { text: 'เจ้าหน้าที่กำลังดำเนินการ', icon: '⏳', color: '#f59e0b' };
    if (['DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'].includes(s)) return { text: 'ถูกตีกลับ — รอแก้ไข', icon: '🔄', color: '#ef4444' };
  }

  if (activeRole === 'SUPER_BOSS') {
    if (s === 'WAITING_SUPER_BOSS_APPROVAL') return { text: 'รออนุมัติขั้นสุดท้าย', icon: '👑', color: '#00c2a8' };
  }

  return null;
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

export default function TaskCard({ task, onClick, activeRole, userId }: TaskCardProps) {
  const age = daysAgo(task.created_at);
  const isRejected = REJECTED_STATUSES.has(task.status);
  const actionHint = getActionHint(task, activeRole, userId);

  // Determine if this card needs action from the current viewer
  const needsAction = actionHint?.color === '#00c2a8' || actionHint?.color === '#ef4444';

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
            <h3 className="font-bold text-[#0d1b2e] text-sm leading-snug line-clamp-2">
              {task.title}
            </h3>
          </div>
          <StatusBadge status={task.status} size="sm" />
        </div>

        {/* Action hint (role-specific) */}
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

        {/* Pipeline visualization */}
        <PipelineBar status={task.status} />

        {task.doc_ref && (
          <p className="text-xs text-[#6b7f96] mt-1">
            เลขที่: <span className="font-semibold text-[#374f6b]">{task.doc_ref}</span>
          </p>
        )}

        {/* Meta row (matches ref .task-meta) — role-specific info */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.72rem] text-[#6b7f96] mt-2">
          {activeRole === 'BOSS' ? (
            <>
              <span>👤 ผู้รับผิดชอบ: {task.officer?.display_name ?? '—'}</span>
              <span>📋 ผู้ตรวจสอบ: {task.reviewer?.display_name ?? '—'}</span>
            </>
          ) : activeRole === 'STAFF' ? (
            <>
              <span>💼 ผู้สั่งงาน: {task.creator?.display_name ?? '—'}</span>
              <span>📋 ผู้ตรวจสอบ: {task.reviewer?.display_name ?? '—'}</span>
            </>
          ) : activeRole === 'DOCCON' ? (
            <>
              <span>👤 {task.officer?.display_name ?? '—'}</span>
              <span>💼 {task.creator?.display_name ?? '—'}</span>
              {task.doccon_checked && <span className="text-green-600 font-medium">✅ ตรวจแล้ว</span>}
            </>
          ) : (
            <>
              <span>👤 {task.officer?.display_name ?? '—'}</span>
              <span>📋 {task.reviewer?.display_name ?? '—'}</span>
            </>
          )}
        </div>

        {/* Drive checklist for DocCon role on completed tasks */}
        {activeRole === 'DOCCON' && task.status === 'COMPLETED' && (
          <div className="flex gap-3 text-[0.68rem] mt-1.5">
            <span className={task.drive_uploaded ? 'text-green-600' : 'text-slate-400'}>
              {task.drive_uploaded ? '✅' : '⬜'} อัปโหลด Drive
            </span>
            <span className={task.sent_to_branch ? 'text-green-600' : 'text-slate-400'}>
              {task.sent_to_branch ? '✅' : '⬜'} ส่งหน่วยงาน
            </span>
          </div>
        )}

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
