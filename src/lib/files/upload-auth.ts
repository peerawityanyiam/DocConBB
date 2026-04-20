import type { AppRole, AuthUser } from '@/lib/auth/guards';

/**
 * Shared upload-authorization logic used by both the direct multipart route
 * and the resumable init-upload route. Keeps permission rules in a single
 * place so the two routes cannot drift apart.
 */

export type UploadDecision =
  | { allow: true }
  | { allow: false; status: number; code: string; message: string };

export interface UploadAuthInput {
  user: Pick<AuthUser, 'id' | 'roles'>;
  task: {
    status: string;
    officer_id: string | null;
    reviewer_id: string | null;
    created_by: string | null;
    status_history: Array<{ status?: string; note?: string }> | null;
  };
  ext: 'docx' | 'pdf';
}

const OFFICER_STATUSES = new Set([
  'ASSIGNED',
  'DOCCON_REJECTED',
  'REVIEWER_REJECTED',
  'BOSS_REJECTED',
  'SUPER_BOSS_REJECTED',
]);

const PDF_ALLOWED_STATUSES = new Set([
  'SUBMITTED_TO_DOCCON',
  'PENDING_REVIEW',
  'WAITING_BOSS_APPROVAL',
  'WAITING_SUPER_BOSS_APPROVAL',
]);

export function authorizeUpload(input: UploadAuthInput): UploadDecision {
  const { user, task, ext } = input;
  const s = task.status;
  const isOfficer = task.officer_id === user.id;
  const isReviewer = task.reviewer_id === user.id;
  const isCreator = task.created_by === user.id;
  const roles = new Set<AppRole>(user.roles.map((r) => r.toUpperCase() as AppRole));

  let canUpload = false;
  if (isOfficer && OFFICER_STATUSES.has(s)) canUpload = true;
  if (isCreator && (s === 'ASSIGNED' || s === 'WAITING_BOSS_APPROVAL')) canUpload = true;
  if (roles.has('DOCCON') && s === 'SUBMITTED_TO_DOCCON') canUpload = true;
  if (isReviewer && s === 'PENDING_REVIEW') canUpload = true;
  if (roles.has('SUPER_BOSS') && s === 'WAITING_SUPER_BOSS_APPROVAL') canUpload = true;
  if (roles.has('SUPER_ADMIN')) canUpload = true;

  if (!canUpload) {
    const isStaffLike = roles.has('STAFF');
    const statusInOfficerFlow = OFFICER_STATUSES.has(s);
    const denyCode =
      isStaffLike && statusInOfficerFlow && !isOfficer
        ? 'not_task_officer'
        : 'forbidden_upload_state';
    const message =
      denyCode === 'not_task_officer'
        ? 'This task is not assigned to your account.'
        : 'You do not have permission to upload files in this status.';
    return { allow: false, status: 403, code: denyCode, message };
  }

  if (ext === 'pdf') {
    const isCreatorUploadingAtAssigned = isCreator && s === 'ASSIGNED';
    if (!PDF_ALLOWED_STATUSES.has(s) && !isCreatorUploadingAtAssigned) {
      return {
        allow: false,
        status: 400,
        code: 'pdf_not_allowed_in_status',
        message: 'This status accepts only .docx files (PDF is for rejection reference).',
      };
    }
    if (s === 'SUBMITTED_TO_DOCCON' && roles.has('DOCCON') && !isCreator) {
      const history = task.status_history ?? [];
      for (let i = history.length - 1; i >= 0; i -= 1) {
        const h = history[i];
        if (h.status === 'SUBMITTED_TO_DOCCON' && h.note?.startsWith('sentBackToDocconBy:')) {
          return {
            allow: false,
            status: 400,
            code: 'doccon_word_only_after_boss_sendback',
            message: 'When sent back from Boss/Super Boss, only .docx upload is allowed.',
          };
        }
        if (h.status === 'SUBMITTED_TO_DOCCON') break;
      }
    }
  }

  return { allow: true };
}

export function normalizeMimeByExt(ext: 'docx' | 'pdf', fallback: string): string {
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'pdf') return 'application/pdf';
  return fallback || 'application/octet-stream';
}
