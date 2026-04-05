'use client';

import { STATUS_LABELS, STATUS_COLORS } from '@/lib/constants/status';
import type { TaskStatus } from '@/lib/constants/status';

interface StatusBadgeProps {
  status: TaskStatus;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const label = STATUS_LABELS[status] ?? status;
  const colors = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-800 border-gray-300';
  const sizeClass = size === 'sm'
    ? 'px-2 py-0.5 text-xs'
    : 'px-2.5 py-1 text-xs font-medium';

  return (
    <span className={`inline-flex items-center rounded-full border ${colors} ${sizeClass} whitespace-nowrap`}>
      {label}
    </span>
  );
}
