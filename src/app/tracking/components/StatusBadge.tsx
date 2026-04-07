'use client';

import { STATUS_LABELS } from '@/lib/constants/status';
import type { TaskStatus } from '@/lib/constants/status';

/* ── Badge colors matching reference .sbadge-* exactly ── */
const SBADGE_COLORS: Record<TaskStatus, { bg: string; color: string }> = {
  ASSIGNED:                     { bg: '#fef3c7', color: '#92400e' },
  SUBMITTED_TO_DOCCON:          { bg: '#cffafe', color: '#164e63' },
  DOCCON_REJECTED:              { bg: '#fee2e2', color: '#991b1b' },
  PENDING_REVIEW:               { bg: '#dbeafe', color: '#1e40af' },
  REVIEWER_REJECTED:            { bg: '#ffedd5', color: '#9a3412' },
  WAITING_BOSS_APPROVAL:        { bg: '#ede9fe', color: '#4c1d95' },
  BOSS_REJECTED:                { bg: '#fee2e2', color: '#991b1b' },
  WAITING_SUPER_BOSS_APPROVAL:  { bg: '#fce7f3', color: '#9d174d' },
  SUPER_BOSS_REJECTED:          { bg: '#fee2e2', color: '#991b1b' },
  COMPLETED:                    { bg: '#d1fae5', color: '#065f46' },
  CANCELLED:                    { bg: '#f3f4f6', color: '#6b7280' },
};

/* ── Status icons matching reference STATUS_ICON ── */
const STATUS_ICON: Record<TaskStatus, string> = {
  ASSIGNED: '⏳',
  SUBMITTED_TO_DOCCON: '🔍',
  DOCCON_REJECTED: '❌',
  PENDING_REVIEW: '👁',
  REVIEWER_REJECTED: '❌',
  WAITING_BOSS_APPROVAL: '👔',
  BOSS_REJECTED: '✖',
  WAITING_SUPER_BOSS_APPROVAL: '👑',
  SUPER_BOSS_REJECTED: '✖',
  COMPLETED: '✅',
  CANCELLED: '🚫',
};

interface StatusBadgeProps {
  status: TaskStatus;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const label = STATUS_LABELS[status] ?? status;
  const { bg, color } = SBADGE_COLORS[status] ?? { bg: '#f3f4f6', color: '#6b7280' };
  const icon = STATUS_ICON[status] ?? '';
  const fontSize = size === 'sm' ? '0.62rem' : '0.68rem';
  const padding = size === 'sm' ? '2px 8px' : '3px 10px';

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap"
      style={{
        background: bg,
        color: color,
        fontSize,
        padding,
        letterSpacing: '0.3px',
      }}
    >
      <span style={{ fontSize: '0.7em' }}>{icon}</span>
      {label}
    </span>
  );
}
