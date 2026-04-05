import type { DocStatus } from '@/lib/constants/status';

export function calculateDocStatus(
  startDate: string | null,
  endDate: string | null,
  alwaysOpen: boolean,
  locked: boolean
): DocStatus {
  if (locked) return 'LOCKED';
  if (alwaysOpen) return 'OPEN';
  if (!startDate || !endDate) return 'NOT_SET';

  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  if (now < start) return 'NOT_YET';
  if (now > end) return 'EXPIRED';
  return 'OPEN';
}

export function calcNextStatus(
  currentStatus: string,
  docconChecked: boolean
): string {
  const resubmitStatuses = [
    'ASSIGNED',
    'DOCCON_REJECTED',
    'REVIEWER_REJECTED',
    'BOSS_REJECTED',
    'SUPER_BOSS_REJECTED',
  ];

  if (resubmitStatuses.includes(currentStatus)) {
    return docconChecked ? 'PENDING_REVIEW' : 'SUBMITTED_TO_DOCCON';
  }
  return currentStatus;
}
