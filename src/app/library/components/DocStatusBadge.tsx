'use client';

import { DOC_STATUS_LABELS, DOC_STATUS_COLORS } from '@/lib/constants/status';
import type { DocStatus } from '@/lib/constants/status';

const DOC_STATUS_ICON: Record<DocStatus, string> = {
  OPEN: '🟢',
  LOCKED: '🔒',
  NOT_YET: '⏳',
  EXPIRED: '⛔',
  NOT_SET: '—',
};

export default function DocStatusBadge({ status }: { status: DocStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${DOC_STATUS_COLORS[status]}`}>
      <span>{DOC_STATUS_ICON[status]}</span>
      {DOC_STATUS_LABELS[status]}
    </span>
  );
}
