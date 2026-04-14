'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import StatusBadge from './StatusBadge';
import type { Task } from './TaskCard';
import type { AppRole } from '@/lib/auth/guards';
import { STATUS_LABELS, type TaskStatus } from '@/lib/constants/status';
import { buildPdfFilesFromImages, prepareImagesForPdf } from '@/lib/files/image-to-pdf';
import {
  MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES,
  MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL,
} from '@/lib/files/upload-limits';
import { getCurrentStageStuckInfo } from '@/lib/tasks/pipeline';
import { toFriendlyErrorMessage, toUploadFailureMessage } from '@/lib/ui/friendly-error';

/* â”€â”€ Border colors per role context â”€â”€ */
const ROLE_BORDER_COLOR: Record<string, string> = {
  STAFF: '#f59e0b',
  DOCCON: '#0d9488',
  REVIEWER: '#6366f1',
  BOSS: '#8b5cf6',
  SUPER_BOSS: '#ec4899',
};

interface ActionCardProps {
  task: Task;
  activeRole: string;
  activeSubTab: string;
  userId: string;
  userRoles: AppRole[];
  onUpdated: () => void;
  onOpenHistory: (taskId: string) => void;
}

/* â”€â”€ Helpers â”€â”€ */
function formatDateThai(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'Asia/Bangkok',
  });
}

function formatDaysValue(days: number) {
  return days.toFixed(1);
}

/* â”€â”€ Pipeline visualization (for DocCon tracking tab) â”€â”€ */
const PIPELINE_STAGES: { key: string; label: string }[] = [
  { key: 'ASSIGNED', label: 'à¹€à¸ˆà¹‰à¸²à¸«à¸™à¹‰à¸²à¸—à¸µà¹ˆ' },
  { key: 'SUBMITTED_TO_DOCCON', label: 'à¸•à¸£à¸§à¸ˆà¸£à¸¹à¸›à¹à¸šà¸š' },
  { key: 'PENDING_REVIEW', label: 'à¸•à¸£à¸§à¸ˆà¹€à¸™à¸·à¹‰à¸­à¸«à¸²' },
  { key: 'WAITING_BOSS_APPROVAL', label: 'Boss' },
  { key: 'WAITING_SUPER_BOSS_APPROVAL', label: 'à¸«à¸±à¸§à¸«à¸™à¹‰à¸²à¸‡à¸²à¸™' },
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
  'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED',
]);
const MAX_UPLOAD_FILE_SIZE = MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES;
const MAX_IMAGE_SOURCE_TOTAL_SIZE = 300 * 1024 * 1024;
const MAX_UPLOAD_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 900;

function getFileExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableUploadError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('http_5') ||
    message.includes('http_429') ||
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('connection') ||
    message.includes('econn')
  );
}

function PipelineViz({ status }: { status: TaskStatus }) {
  const currentIdx = STATUS_STAGE_INDEX[status];
  const isRejected = REJECTED_STATUSES.has(status);

  return (
    <div className="flex items-center gap-0 mt-3 mb-1 overflow-x-auto px-1">
      {PIPELINE_STAGES.map((stage, i) => {
        const isDone = currentIdx > i;
        const isCurrent = currentIdx === i;
        const isUpcoming = currentIdx < i;

        let dotClass = 'bg-gray-100 border-gray-300 text-gray-400';
        let labelClass = 'text-gray-400';
        if (isDone) {
          dotClass = 'bg-green-100 border-green-500 text-green-600';
          labelClass = 'text-green-600';
        } else if (isCurrent && isRejected) {
          dotClass = 'bg-red-100 border-red-500 text-red-600';
          labelClass = 'text-red-600 font-bold';
        } else if (isCurrent) {
          dotClass = 'bg-[#00c2a8] border-[#00c2a8] text-white';
          labelClass = 'text-[#00c2a8] font-bold';
        }

        const lineColor = isDone ? 'bg-green-400' : 'bg-gray-200';
        const opacity = isUpcoming ? 'opacity-40' : '';

        return (
          <div key={stage.key} className="flex items-center" style={{ flex: 1, minWidth: 50 }}>
            {i > 0 && <div className={`h-0.5 ${lineColor} flex-1`} style={{ minWidth: 8, marginBottom: 16 }} />}
            <div className={`flex flex-col items-center shrink-0 gap-1 ${opacity}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs border-2 ${dotClass}`}>
                {isDone ? 'âœ“' : i + 1}
              </div>
              <span className={`text-[0.6rem] ${labelClass} text-center whitespace-nowrap`}>
                {stage.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* â”€â”€ Rejection / Cancel Modal â”€â”€ */
function RejectModal({ title, onConfirm, onCancel, loading, confirmLabel = 'à¸•à¸µà¸à¸¥à¸±à¸š', confirmStyle = 'danger', requireComment = false }: {
  title: string;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
  loading: boolean;
  confirmLabel?: string;
  confirmStyle?: 'danger' | 'warning';
  requireComment?: boolean;
}) {
  const [comment, setComment] = useState('');
  const isCommentEmpty = requireComment && !comment.trim();
  const bgColor = confirmStyle === 'warning' ? 'bg-[#f59e0b] hover:bg-[#d97706]' : 'bg-[#dc3545] hover:bg-[#c82333]';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-800 mb-3">{title}</h3>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="à¸£à¸°à¸šà¸¸à¹€à¸«à¸•à¸¸à¸œà¸¥..."
          rows={3}
          className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 resize-none"
        />
        {requireComment && isCommentEmpty && (
          <p className="text-xs text-red-600 mt-1">à¸à¸£à¸¸à¸“à¸²à¸£à¸°à¸šà¸¸à¹€à¸«à¸•à¸¸à¸œà¸¥à¸à¹ˆà¸­à¸™à¸”à¸³à¹€à¸™à¸´à¸™à¸à¸²à¸£</p>
        )}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50"
          >
            à¸¢à¸à¹€à¸¥à¸´à¸
          </button>
          <button
            onClick={() => onConfirm(comment)}
            disabled={loading || isCommentEmpty}
            className={`flex-1 py-2.5 rounded-lg ${bgColor} text-white text-sm font-bold disabled:opacity-50`}
          >
            {loading ? 'à¸à¸³à¸¥à¸±à¸‡à¸”à¸³à¹€à¸™à¸´à¸™à¸à¸²à¸£...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* â”€â”€ DocRef Check Result â”€â”€ */
interface DocRefCheckResult {
  exists: boolean;
  file_name?: string;
  date?: string;
}

interface UploadBatchMeta {
  id: string;
  index: number;
  total: number;
  label: string;
}

interface ImageQueueItem {
  name: string;
  status: 'pending' | 'uploading' | 'done';
  outputBytes?: number;
}

export default function ActionCard({ task, activeRole, activeSubTab, userId, userRoles, onUpdated, onOpenHistory }: ActionCardProps) {
  const borderColor = ROLE_BORDER_COLOR[activeRole] ?? '#94a3b8';
  const currentStageStuck = getCurrentStageStuckInfo({
    status: task.status,
    statusHistory: task.status_history,
    updatedAt: task.updated_at,
    completedAt: task.completed_at,
  });
  const stageStuckDays = currentStageStuck?.days ?? 0;
  const stageStuckDaysLabel = formatDaysValue(stageStuckDays);
  const stageStuckLabel = currentStageStuck
    ? STATUS_LABELS[currentStageStuck.stage as TaskStatus]
    : '';
  const isOwnedStaffCard = activeRole === 'STAFF' && task.officer_id === userId;

  // File selection state â€” just tracks what user selected, NOT auto-uploaded
  const [selectedWordFile, setSelectedWordFile] = useState<File | null>(null);
  const [selectedImageFiles, setSelectedImageFiles] = useState<File[]>([]);
  const [imageQueue, setImageQueue] = useState<ImageQueueItem[]>([]);
  const [selectedImageCount, setSelectedImageCount] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isConvertingImages, setIsConvertingImages] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const wordInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Action state
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectActionKey, setRejectActionKey] = useState('');

  // DocRef state (DocCon)
  const [docRef, setDocRef] = useState(task.doc_ref ?? '');
  const [docRefCheck, setDocRefCheck] = useState<DocRefCheckResult | null>(null);
  const [docRefChecking, setDocRefChecking] = useState(false);
  const docRefTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDocRefEditing, setIsDocRefEditing] = useState(!(task.doc_ref ?? '').trim());

  // Debounced doc_ref check
  useEffect(() => {
    if (activeRole !== 'DOCCON' || !docRef.trim()) {
      setDocRefCheck(null);
      return;
    }
    if (docRefTimerRef.current) clearTimeout(docRefTimerRef.current);
    docRefTimerRef.current = setTimeout(async () => {
      setDocRefChecking(true);
      try {
        const res = await fetch(`/api/tasks/check-doc-ref?doc_ref=${encodeURIComponent(docRef.trim())}&task_id=${task.id}`);
        if (res.ok) setDocRefCheck(await res.json());
      } catch { /* ignore */ } finally {
        setDocRefChecking(false);
      }
    }, 500);
    return () => { if (docRefTimerRef.current) clearTimeout(docRefTimerRef.current); };
  }, [docRef, activeRole, task.id]);

  useEffect(() => {
    const initial = task.doc_ref ?? '';
    setDocRef(initial);
    setIsDocRefEditing(!initial.trim());
  }, [task.id, task.doc_ref]);

  function clearSelectedUploadFiles() {
    setSelectedWordFile(null);
    setSelectedImageFiles([]);
    setImageQueue([]);
    setSelectedImageCount(null);
    if (wordInputRef.current) wordInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  /* â”€â”€ uploadFileAsync: returns Promise (no callback) â”€â”€ */
  const uploadFileOnceAsync = useCallback((file: File, batchMeta?: UploadBatchMeta): Promise<void> => {
    return new Promise((resolve, reject) => {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!['.docx', '.pdf'].includes(ext)) {
        reject(new Error('à¸£à¸­à¸‡à¸£à¸±à¸šà¹€à¸‰à¸žà¸²à¸°à¹„à¸Ÿà¸¥à¹Œ .docx à¹à¸¥à¸° .pdf à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™'));
        return;
      }
      if (file.size > MAX_UPLOAD_FILE_SIZE) {
        reject(new Error(`à¹„à¸Ÿà¸¥à¹Œà¸¡à¸µà¸‚à¸™à¸²à¸”à¹€à¸à¸´à¸™ ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}`));
        return;
      }
      setUploadProgress(0);
      const formData = new FormData();
      formData.append('file', file);
      if (batchMeta) {
        formData.append('upload_batch_id', batchMeta.id);
        formData.append('upload_batch_index', String(batchMeta.index));
        formData.append('upload_batch_total', String(batchMeta.total));
        formData.append('upload_batch_label', batchMeta.label);
      }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/tasks/${task.id}/files`);
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener('load', () => {
        setUploadProgress(null);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          try {
            const d = JSON.parse(xhr.responseText) as { error?: string };
            reject(new Error(d.error ?? `HTTP_${xhr.status}`));
          } catch {
            reject(new Error(`HTTP_${xhr.status}`));
          }
        }
      });
      xhr.addEventListener('error', () => {
        setUploadProgress(null);
        reject(new Error('NETWORK_UPLOAD_FAILED'));
      });
      xhr.addEventListener('abort', () => {
        setUploadProgress(null);
        reject(new Error('UPLOAD_ABORTED'));
      });
      xhr.send(formData);
    });
  }, [task.id]);

  const uploadFileAsync = useCallback(async (file: File, batchMeta?: UploadBatchMeta): Promise<void> => {
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt <= MAX_UPLOAD_RETRIES) {
      try {
        setUploadProgress(0);
        await uploadFileOnceAsync(file, batchMeta);
        return;
      } catch (err) {
        lastError = err;
        if (!isRetryableUploadError(err) || attempt === MAX_UPLOAD_RETRIES) {
          throw err;
        }
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
      }
      attempt += 1;
    }
    throw lastError instanceof Error ? lastError : new Error('à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸Ÿà¸¥à¹Œà¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ');
  }, [uploadFileOnceAsync]);

  /* â”€â”€ callStatusApi: calls the status PATCH endpoint â”€â”€ */
  async function callStatusApi(actionKey: string, comment?: string): Promise<void> {
    const body: Record<string, string> = { action: actionKey };
    if (comment?.trim()) body.comment = comment.trim();
    if (docRef.trim() && activeRole === 'DOCCON') body.doc_ref = docRef.trim();
    const res = await fetch(`/api/tasks/${task.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data: { error?: string } = {};
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    if (!res.ok) throw new Error(toFriendlyErrorMessage(data.error ?? `HTTP_${res.status}`, 'à¸”à¸³à¹€à¸™à¸´à¸™à¸à¸²à¸£à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ à¸à¸£à¸¸à¸“à¸²à¸¥à¸­à¸‡à¹ƒà¸«à¸¡à¹ˆ'));
  }

  /* â”€â”€ uploadThenExecute: optionally upload selected file, then execute action â”€â”€ */
  async function rollbackUploadedPdfBatch(batchId: string): Promise<void> {
    try {
      await fetch(`/api/tasks/${task.id}/files?upload_batch_id=${encodeURIComponent(batchId)}`, {
        method: 'DELETE',
      });
    } catch {
      // best effort cleanup
    }
  }

  async function uploadThenExecute(actionKey: string, comment?: string) {
    setActionLoading(true);
    setActionError('');
    setUploadError('');
    const hasSelectedUpload = !!selectedWordFile || selectedImageFiles.length > 0;
    let uploadFinished = !hasSelectedUpload;
    let rollbackBatchId: string | null = null;
    try {
      if (selectedWordFile) {
        await uploadFileAsync(selectedWordFile);
        uploadFinished = true;
      }
      if (selectedImageFiles.length > 0) {
        setIsConvertingImages(true);
        const generatedPdfFiles = await buildPdfFilesFromImages(selectedImageFiles);
        const hasImageBatchMeta = generatedPdfFiles.length > 1;
        const pdfBatchId = hasImageBatchMeta ? `imgpdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : '';
        rollbackBatchId = hasImageBatchMeta ? pdfBatchId : null;
        const pdfBatchLabel = generatedPdfFiles[0].name.replace(/-part-\d+\.pdf$/i, '.pdf');
        for (let index = 0; index < generatedPdfFiles.length; index += 1) {
          const file = generatedPdfFiles[index];
          const batchMeta: UploadBatchMeta | undefined = hasImageBatchMeta
            ? {
                id: pdfBatchId,
                index: index + 1,
                total: generatedPdfFiles.length,
                label: pdfBatchLabel,
              }
            : undefined;
          await uploadFileAsync(file, batchMeta);
        }
        uploadFinished = true;
      }
      clearSelectedUploadFiles();
      await callStatusApi(actionKey, comment);
      onUpdated();
    } catch (err) {
      const uploadMsg = toUploadFailureMessage(err, 'à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸Ÿà¸¥à¹Œà¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ');
      const actionMsg = toFriendlyErrorMessage(err, 'à¹€à¸à¸´à¸”à¸‚à¹‰à¸­à¸œà¸´à¸”à¸žà¸¥à¸²à¸” à¸à¸£à¸¸à¸“à¸²à¸¥à¸­à¸‡à¹ƒà¸«à¸¡à¹ˆ');
      if (!uploadFinished && hasSelectedUpload) {
        if (rollbackBatchId) {
          await rollbackUploadedPdfBatch(rollbackBatchId);
        }
        // upload failed — clear selection so user can pick again
        clearSelectedUploadFiles();
        setUploadError(uploadMsg);
      } else {
        setActionError(actionMsg);
      }
    } finally {
      setIsConvertingImages(false);
      setActionLoading(false);
      setUploadProgress(null);
    }
  }

  /* â”€â”€ STAFF: always requires a new file â”€â”€ */
  async function handleStaffSubmit() {
    if (!selectedWordFile) {
      setActionError('à¸à¸£à¸¸à¸“à¸²à¹€à¸¥à¸·à¸­à¸à¹„à¸Ÿà¸¥à¹Œ Word (.docx) à¸à¹ˆà¸­à¸™à¸ªà¹ˆà¸‡à¸‡à¸²à¸™');
      return;
    }
    await uploadThenExecute('submit');
  }

  /* â”€â”€ DocCon approve â€” require doc_ref (unless sent back from Boss where it's already set) â”€â”€ */
  async function handleDocConApprove() {
    if (!docRef.trim() && !task.doc_ref) {
      setActionError('à¸à¸£à¸¸à¸“à¸²à¸£à¸°à¸šà¸¸à¸£à¸«à¸±à¸ªà¹€à¸­à¸à¸ªà¸²à¸£à¸à¹ˆà¸­à¸™');
      return;
    }
    if (docconSentBackFromBoss && !hasDocxSelected) {
      setActionError('à¸à¸£à¸¸à¸“à¸²à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸Ÿà¸¥à¹Œ Word (.docx) à¸à¹ˆà¸­à¸™à¸ªà¹ˆà¸‡à¸à¸¥à¸±à¸šà¹„à¸›à¸«à¸±à¸§à¸«à¸™à¹‰à¸²à¸‡à¸²à¸™à¸«à¸£à¸·à¸­à¸œà¸¹à¹‰à¸ªà¸±à¹ˆà¸‡à¸‡à¸²à¸™');
      return;
    }
    await uploadThenExecute('doccon_approve');
  }

  /* â”€â”€ Reject/cancel modal triggers â”€â”€ */
  function handleDocConRejectClick() { setRejectActionKey('doccon_reject'); setShowRejectModal(true); }
  function handleReviewerRejectClick() { setRejectActionKey('reviewer_reject'); setShowRejectModal(true); }
  function handleBossRejectClick() { setRejectActionKey('boss_reject'); setShowRejectModal(true); }
  function handleBossSendToDocCon() { setRejectActionKey('boss_send_to_doccon'); setShowRejectModal(true); }
  function handleSuperBossRejectClick() { setRejectActionKey('super_boss_reject'); setShowRejectModal(true); }
  function handleSuperBossSendToDocCon() { setRejectActionKey('super_boss_send_to_doccon'); setShowRejectModal(true); }

  /* â”€â”€ Rejection/cancel confirm â€” uploads file (if any) then executes action â”€â”€ */
  function handleRejectConfirm(comment: string) {
    setShowRejectModal(false);
    uploadThenExecute(rejectActionKey, comment);
  }

  /* â”€â”€ File input change: ONLY updates state, never auto-uploads â”€â”€ */
  function onWordFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      clearSelectedUploadFiles();
      setUploadError('');
      setActionError('');
      return;
    }

    const fileExt = getFileExtension(file.name);
    const allowedExtensions = docconSentBackFromBoss ? ['docx'] : ['docx', 'pdf'];
    if (!allowedExtensions.includes(fileExt)) {
      e.target.value = '';
      clearSelectedUploadFiles();
      setUploadError(docconSentBackFromBoss
        ? 'à¸‡à¸²à¸™à¸—à¸µà¹ˆà¸ªà¹ˆà¸‡à¸à¸¥à¸±à¸šà¸ˆà¸²à¸à¸«à¸±à¸§à¸«à¸™à¹‰à¸²à¸‡à¸²à¸™ à¸•à¹‰à¸­à¸‡à¹à¸™à¸šà¹„à¸Ÿà¸¥à¹Œ Word (.docx) à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™'
        : 'à¸£à¸­à¸‡à¸£à¸±à¸šà¹€à¸‰à¸žà¸²à¸°à¹„à¸Ÿà¸¥à¹Œ Word (.docx) à¸«à¸£à¸·à¸­ PDF (.pdf)');
      return;
    }

    if (file.size > MAX_UPLOAD_FILE_SIZE) {
      e.target.value = '';
      clearSelectedUploadFiles();
      setUploadError(`à¹„à¸Ÿà¸¥à¹Œà¸¡à¸µà¸‚à¸™à¸²à¸”à¹ƒà¸«à¸à¹ˆà¹€à¸à¸´à¸™ ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL} à¸à¸£à¸¸à¸“à¸²à¹€à¸¥à¸·à¸­à¸à¹„à¸Ÿà¸¥à¹Œà¹ƒà¸«à¸¡à¹ˆ`);
      return;
    }

    setSelectedWordFile(file);
    setSelectedImageFiles([]);
    setImageQueue([]);
    setSelectedImageCount(null);
    setUploadError('');
    setActionError('');
  }

  async function onImageFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const images = Array.from(e.target.files ?? []);
    if (!images.length) return;
    const sourceTotalBytes = images.reduce((sum, file) => sum + file.size, 0);

    setUploadError('');
    setActionError('');
    setSelectedWordFile(null);
    if (wordInputRef.current) wordInputRef.current.value = '';
    setImageQueue(images.map((image) => ({ name: image.name, status: 'pending' })));
    setIsConvertingImages(true);
    try {
      const nonImageFile = images.find((file) => !file.type.startsWith('image/'));
      if (nonImageFile) {
        throw new Error(`à¹„à¸Ÿà¸¥à¹Œ ${nonImageFile.name} à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸£à¸¹à¸›à¸ à¸²à¸ž`);
      }
      if (sourceTotalBytes > MAX_IMAGE_SOURCE_TOTAL_SIZE) {
        throw new Error('à¸£à¸¹à¸›à¸—à¸µà¹ˆà¹€à¸¥à¸·à¸­à¸à¸¡à¸µà¸‚à¸™à¸²à¸”à¸£à¸§à¸¡à¸ªà¸¹à¸‡à¹€à¸à¸´à¸™ 300MB à¸à¸£à¸¸à¸“à¸²à¹à¸šà¹ˆà¸‡à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹€à¸›à¹‡à¸™à¸«à¸¥à¸²à¸¢à¸£à¸­à¸š');
      }

      const preparedImages = await prepareImagesForPdf(images, (progress) => {
        setImageQueue((prev) => prev.map((item, index) => {
          if (index !== progress.index) return item;
          if (progress.status === 'processing') {
            return { ...item, status: 'uploading' };
          }
          return {
            ...item,
            status: 'done',
            outputBytes: progress.outputBytes,
          };
        }));
      });
      setSelectedImageFiles(preparedImages);
      setSelectedImageCount(images.length);
    } catch (err) {
      setSelectedImageFiles([]);
      setSelectedImageCount(null);
      setImageQueue([]);
      setUploadError(toUploadFailureMessage(err, 'à¹„à¸¡à¹ˆà¸ªà¸²à¸¡à¸²à¸£à¸–à¹€à¸•à¸£à¸µà¸¢à¸¡à¸£à¸¹à¸›à¹€à¸žà¸·à¹ˆà¸­à¸ªà¹ˆà¸‡à¹„à¸”à¹‰'));
    } finally {
      setIsConvertingImages(false);
      e.target.value = '';
    }
  }

  function openImagePicker() {
    imageInputRef.current?.click();
  }

  const hasDocxSelected = !!selectedWordFile && selectedWordFile.name.toLowerCase().endsWith('.docx');
  const selectedFileDisplayName = selectedWordFile
    ? selectedWordFile.name
    : (selectedImageCount ? `à¸ à¸²à¸ž ${selectedImageCount} à¸£à¸¹à¸›` : '');
  const imagePickerStatusText = isConvertingImages
    ? 'à¸à¸³à¸¥à¸±à¸‡à¹€à¸•à¸£à¸µà¸¢à¸¡à¸£à¸¹à¸›...'
    : (selectedImageCount
      ? `à¹€à¸¥à¸·à¸­à¸à¸£à¸¹à¸›à¹à¸¥à¹‰à¸§ ${selectedImageCount} à¸£à¸¹à¸›`
      : 'à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸¥à¸·à¸­à¸à¹„à¸Ÿà¸¥à¹Œ...');
  const requiresRejectReason = [
    'doccon_reject',
    'reviewer_reject',
    'boss_reject',
    'super_boss_reject',
    'boss_send_to_doccon',
    'super_boss_send_to_doccon',
  ].includes(rejectActionKey);

  /* â”€â”€ Is this a pipeline-only card (DocCon tracking sub-tab)? â”€â”€ */
  const isPipelineView = activeRole === 'DOCCON' && activeSubTab === 'tracking';

  /* â”€â”€ Compute file links â”€â”€ */
  const hasWordFile = !!task.drive_file_id;
  const wordFileUrl = hasWordFile ? `https://drive.google.com/file/d/${task.drive_file_id}/view` : null;
  const currentRefFiles = (() => {
    // IMPORTANT:
    // Show ref PDFs on card only when the task currently has ref_file_id.
    // Old PDFs remain in file_history for audit/history tab, but must not appear as "current".
    if (!task.ref_file_id) {
      return [] as Array<{ driveFileId: string; fileName: string; uploadBatchIndex?: number }>;
    }

    const history = (task.file_history ?? []).filter((entry) => (
      entry.isPdf &&
      typeof entry.driveFileId === 'string' &&
      entry.driveFileId.length > 0
    ));

    const refEntry = history.find((entry) => entry.driveFileId === task.ref_file_id);
    if (refEntry?.uploadBatchId) {
      const sameBatch = history
        .filter((entry) => entry.uploadBatchId === refEntry.uploadBatchId)
        .sort((a, b) => (a.uploadBatchIndex ?? 9999) - (b.uploadBatchIndex ?? 9999));
      if (sameBatch.length > 0) return sameBatch;
    }

    if (refEntry) return [refEntry];

    // Fallback for legacy data: keep card renderable even if history missed this id.
    return [{
      driveFileId: task.ref_file_id,
      fileName: task.ref_file_name || 'document.pdf',
      uploadBatchIndex: 1,
    }];
  })();
  const hasRefFile = currentRefFiles.length > 0;

  /* â”€â”€ Derived state for staff submit button (Bug 3: always require new file) â”€â”€ */
  const isRejectedStatus = REJECTED_STATUSES.has(task.status as TaskStatus);
  const staffCanSubmit = selectedWordFile !== null;

  /* â”€â”€ Bug 4: Derive who sent back for rejected statuses â”€â”€ */
  const lastHistoryEntry = task.status_history?.slice().reverse().find(h => h.status === task.status);
  const sentBackByName = lastHistoryEntry?.changedByName;

  /* â”€â”€ Bug 5: DocCon context â€” is this a "sent back from Boss/SuperBoss"? â”€â”€ */
  const docconSentBackFromBoss = task.status === 'SUBMITTED_TO_DOCCON' && (() => {
    const history = task.status_history ?? [];
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h.status === 'SUBMITTED_TO_DOCCON' && h.note?.startsWith('sentBackToDocconBy:')) return true;
      if (h.status === 'SUBMITTED_TO_DOCCON') return false;
    }
    return false;
  })();

  const isBlocked = actionLoading || uploadProgress !== null || isConvertingImages;
  const busyReason = isConvertingImages
    ? 'กำลังเตรียมรูป กรุณารอให้ครบก่อน'
    : (actionLoading || uploadProgress !== null ? 'ระบบกำลังอัปโหลดหรือบันทึกข้อมูล กรุณารอสักครู่' : '');
  const staffSubmitDisabledReason = isBlocked
    ? busyReason
    : (!staffCanSubmit ? 'à¸•à¹‰à¸­à¸‡à¹à¸™à¸šà¹„à¸Ÿà¸¥à¹Œ Word (.docx) à¸à¹ˆà¸­à¸™à¸ªà¹ˆà¸‡à¸‡à¸²à¸™' : '');
  const docConApproveDisabledReason = docconSentBackFromBoss
    ? (isBlocked
      ? busyReason
      : (!hasDocxSelected ? 'à¸‡à¸²à¸™à¸—à¸µà¹ˆà¸ªà¹ˆà¸‡à¸à¸¥à¸±à¸šà¸ˆà¸²à¸à¸«à¸±à¸§à¸«à¸™à¹‰à¸²à¸‡à¸²à¸™ à¸•à¹‰à¸­à¸‡à¹à¸™à¸šà¹„à¸Ÿà¸¥à¹Œ Word (.docx) à¸à¹ˆà¸­à¸™à¸ªà¹ˆà¸‡à¸•à¹ˆà¸­à¸à¸¥à¸±à¸š' : ''))
    : (isBlocked
      ? busyReason
      : ((!docRef.trim() && !task.doc_ref) ? 'à¸•à¹‰à¸­à¸‡à¸£à¸°à¸šà¸¸à¸£à¸«à¸±à¸ªà¹€à¸­à¸à¸ªà¸²à¸£à¸à¹ˆà¸­à¸™à¸à¸”à¸œà¹ˆà¸²à¸™à¸£à¸¹à¸›à¹à¸šà¸š' : ''));
  const genericApproveDisabledReason = isBlocked ? busyReason : '';
  const attachmentSummaryLabel = selectedWordFile || selectedImageFiles.length > 0
    ? `à¹„à¸Ÿà¸¥à¹Œà¸—à¸µà¹ˆà¸žà¸£à¹‰à¸­à¸¡à¸ªà¹ˆà¸‡: ${selectedFileDisplayName}`
    : 'à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸¥à¸·à¸­à¸à¹„à¸Ÿà¸¥à¹Œà¹à¸™à¸š';
  const attachmentSummaryHint = selectedWordFile || selectedImageFiles.length > 0
    ? (selectedImageCount
      ? 'ระบบจะรวมรูปที่เตรียมครบเป็น PDF ตอนกดปุ่มดำเนินการ'
      : 'ระบบจะส่งไฟล์นี้เมื่อกดปุ่มดำเนินการ')
    : `à¹€à¸¥à¸·à¸­à¸à¹„à¸Ÿà¸¥à¹Œà¸ˆà¸²à¸ Choose File à¸«à¸£à¸·à¸­à¸à¸”à¸›à¸¸à¹ˆà¸¡ "à¹à¸™à¸šà¸ à¸²à¸ž" (à¹„à¸¡à¹ˆà¹€à¸à¸´à¸™ ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL} à¸•à¹ˆà¸­à¹„à¸Ÿà¸¥à¹Œ)`;
  const attachmentHintWithLimit = `à¸£à¸­à¸‡à¸£à¸±à¸š Word/PDF à¸«à¸£à¸·à¸­à¹à¸™à¸šà¸ à¸²à¸žà¹€à¸žà¸·à¹ˆà¸­à¸£à¸§à¸¡à¹€à¸›à¹‡à¸™ PDF (à¹„à¸¡à¹ˆà¹€à¸à¸´à¸™ ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL} à¸•à¹ˆà¸­à¹„à¸Ÿà¸¥à¹Œ)`;
  const renderAttachmentSummary = (hint: string) => (
    <div className={`mt-2 rounded-md border px-2.5 py-2 text-[0.7rem] ${(selectedWordFile || selectedImageFiles.length > 0) ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
      <p className="font-semibold break-all">{attachmentSummaryLabel}</p>
      <p className="mt-0.5 text-[0.65rem] opacity-90">{(selectedWordFile || selectedImageFiles.length > 0) ? attachmentSummaryHint : hint}</p>
    </div>
  );
  const renderImageQueue = () => (
    imageQueue.length > 0 ? (
      <div className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 max-h-32 overflow-y-auto">
        {imageQueue.map((item, index) => (
          <p key={`${item.name}-${index}`} className="text-[0.68rem] text-amber-800 break-all">
            {`à¸£à¸¹à¸› ${index + 1} ${item.status === 'uploading' ? 'à¸à¸³à¸¥à¸±à¸‡à¹€à¸•à¸£à¸µà¸¢à¸¡' : item.status === 'done' ? 'à¹€à¸•à¸£à¸µà¸¢à¸¡à¹à¸¥à¹‰à¸§' : 'à¸£à¸­à¹€à¸•à¸£à¸µà¸¢à¸¡'}: ${item.name}`}
          </p>
        ))}
      </div>
    ) : null
  );

  return (
    <>
      <div
        className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
        style={{ borderLeft: `4px solid ${borderColor}` }}
      >
        {/* Card Body */}
        <div className="p-4">
          {/* Top row: Title + Status + History icon */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 text-sm leading-snug break-words">{task.title}</h3>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end max-w-[55%]">
              <StatusBadge status={task.status} size="sm" />
              {task.doc_ref && (
                <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded"># {task.doc_ref}</span>
              )}
              <button
                onClick={() => onOpenHistory(task.id)}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                title="à¸›à¸£à¸°à¸§à¸±à¸•à¸´à¹à¸¥à¸°à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Detail gray box */}
          {task.detail && (
            <div className="bg-gray-50 border-l-[3px] border-gray-300 px-3 py-2 rounded-r-md mb-3 flex items-start gap-2">
              <span className="text-gray-400 text-sm mt-0.5">â„¹ï¸</span>
              <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{task.detail}</p>
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 mb-3">
            {activeRole === 'STAFF' && (
              <>
                <span>ðŸ“… à¸ªà¸±à¹ˆà¸‡à¸‡à¸²à¸™à¸§à¸±à¸™à¸—à¸µà¹ˆ {formatDateThai(task.created_at)}</span>
              </>
            )}
            {activeRole === 'DOCCON' && (
              <>
                <span>ðŸ‘¤ à¸œà¸¹à¹‰à¸ªà¹ˆà¸‡: {task.officer?.display_name ?? 'â€”'}</span>
                <span>ðŸ“… à¸ªà¹ˆà¸‡ {formatDateThai(task.updated_at)}</span>
                {isPipelineView && currentStageStuck && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${stageStuckDays > 7 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                    à¸„à¹‰à¸²à¸‡ {stageStuckDaysLabel} à¸§à¸±à¸™
                  </span>
                )}
              </>
            )}
            {activeRole === 'REVIEWER' && (
              <>
                <span>ðŸ‘¤ à¸œà¸¹à¹‰à¸ªà¹ˆà¸‡: {task.officer?.display_name ?? 'â€”'}</span>
                <span>ðŸ“… à¸ªà¹ˆà¸‡ {formatDateThai(task.updated_at)}</span>
              </>
            )}
            {activeRole === 'BOSS' && (
              <>
                <span>ðŸ‘¤ à¹€à¸ˆà¹‰à¸²à¸«à¸™à¹‰à¸²à¸—à¸µà¹ˆ: {task.officer?.display_name ?? 'â€”'}</span>
                <span>ðŸ“‹ à¸œà¸¹à¹‰à¸•à¸£à¸§à¸ˆ: {task.reviewer?.display_name ?? 'â€”'}</span>
                <span>ðŸ“… {formatDateThai(task.updated_at)}</span>
              </>
            )}
            {activeRole === 'SUPER_BOSS' && (
              <>
                <span>ðŸ‘¤ à¸œà¸¹à¹‰à¸ªà¸£à¹‰à¸²à¸‡: {task.creator?.display_name ?? 'â€”'}</span>
                <span>ðŸ“… {formatDateThai(task.updated_at)}</span>
              </>
            )}
          </div>

          {currentStageStuck && (
            <div className="mb-3 text-xs text-gray-500">
              â± {isOwnedStaffCard ? 'à¸„à¹‰à¸²à¸‡à¸—à¸µà¹ˆà¸„à¸¸à¸“à¹ƒà¸™à¸‚à¸±à¹‰à¸™' : 'à¸„à¹‰à¸²à¸‡à¸—à¸µà¹ˆà¸‚à¸±à¹‰à¸™'} <span className="font-semibold text-gray-700">{stageStuckLabel}</span> à¸¡à¸²{' '}
              <span className="font-semibold text-gray-700">{stageStuckDaysLabel}</span> à¸§à¸±à¸™
            </div>
          )}

          {/* Latest comment (rejection reason) + who sent back */}
          {/* Rejected: show who sent back + comment */}
          {REJECTED_STATUSES.has(task.status) && (
            <div className="mb-3 px-3 py-2 rounded-md text-xs leading-relaxed bg-red-50 border-l-[3px] border-red-400 text-red-800 space-y-0.5">
              {sentBackByName && (
                <p className="font-semibold">â†© à¸ªà¹ˆà¸‡à¸à¸¥à¸±à¸šà¹‚à¸”à¸¢: {sentBackByName}</p>
              )}
              {task.latest_comment && (
                <p>ðŸ’¬ {task.latest_comment}</p>
              )}
            </div>
          )}

          {/* SUBMITTED_TO_DOCCON: show who sent it back (Boss/SuperBoss context) */}
          {docconSentBackFromBoss && (() => {
            const sentBackEntry = task.status_history?.slice().reverse().find(
              h => h.status === 'SUBMITTED_TO_DOCCON' && h.note?.startsWith('sentBackToDocconBy:')
            );
            return sentBackEntry ? (
              <div className="mb-3 px-3 py-2 rounded-md text-xs leading-relaxed bg-amber-50 border-l-[3px] border-amber-400 text-amber-800">
                â†© à¸ªà¹ˆà¸‡à¸à¸¥à¸±à¸šà¸•à¸£à¸§à¸ˆà¸£à¸¹à¸›à¹à¸šà¸šà¹‚à¸”à¸¢: <span className="font-semibold">{sentBackEntry.changedByName}</span>
                {task.latest_comment && <p className="mt-0.5">ðŸ’¬ {task.latest_comment}</p>}
              </div>
            ) : null;
          })()}

          {/* Pipeline visualization (DocCon tracking tab) */}
          {isPipelineView && <PipelineViz status={task.status} />}

          {/* File links â€” word (blue) + pdf (orange) */}
          {!isPipelineView && (hasWordFile || hasRefFile) && (
            <div className="flex flex-col gap-2 mb-3">
              {hasWordFile && (
                <a
                  href={wordFileUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 hover:bg-blue-100 transition-colors text-sm text-blue-800 min-w-0"
                >
                  <span>ðŸ“„</span>
                  <span className="min-w-0 break-all">Word: <span className="font-medium">{task.drive_file_name ?? 'document.docx'}</span></span>
                </a>
              )}
              {hasRefFile && (
                <div className="space-y-1.5">
                  {currentRefFiles.map((file, index) => (
                    <a
                      key={`${file.driveFileId}-${index}`}
                      href={`https://drive.google.com/file/d/${file.driveFileId}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors text-sm text-amber-800 min-w-0"
                    >
                      <span>ðŸ“‹</span>
                      <span className="min-w-0 break-all">
                        PDF{currentRefFiles.length > 1 ? ` ${index + 1}` : ''}: <span className="font-medium">{file.fileName || 'document.pdf'}</span>
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
          {/* â”€â”€  ROLE-SPECIFIC INLINE ACTIONS  â”€â”€  */}
          {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}

          {/* â”€â”€ STAFF: word upload + submit â”€â”€ */}
          {activeRole === 'STAFF' && isStaffActionable(task, userId) && (
            <div className="mt-2 space-y-3">
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                  ðŸ“„ {isRejectedStatus ? 'à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸Ÿà¸¥à¹Œ Word à¸—à¸µà¹ˆà¹à¸à¹‰à¹„à¸‚à¹à¸¥à¹‰à¸§' : 'à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸Ÿà¸¥à¹Œ Word (.docx)'}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  ref={wordInputRef}
                  type="file"
                  accept=".docx"
                  onChange={onWordFileChange}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                />
                {selectedWordFile && (
                  <div className="mt-1.5 space-y-0.5">
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      âœ… à¹€à¸¥à¸·à¸­à¸à¹à¸¥à¹‰à¸§: <span className="font-medium">{selectedFileDisplayName}</span>
                    </p>
                  </div>
                )}
                {renderAttachmentSummary('à¸‚à¸±à¹‰à¸™à¸•à¸­à¸™à¸™à¸µà¹‰à¸•à¹‰à¸­à¸‡à¹à¸™à¸šà¹„à¸Ÿà¸¥à¹Œ Word (.docx)')}
              </div>

              {/* Upload progress */}
              {uploadProgress !== null && (
                <div className="px-1">
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                    <span>à¸à¸³à¸¥à¸±à¸‡à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”...</span><span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-[#00c2a8] transition-all rounded-full" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}

              {uploadError && <p className="text-xs text-red-600 px-1 whitespace-pre-line">âš ï¸ {uploadError}</p>}
              {actionError && <p className="text-xs text-red-600 px-1 whitespace-pre-line">âš ï¸ {actionError}</p>}

              <button
                onClick={handleStaffSubmit}
                disabled={isBlocked || !staffCanSubmit}
                title={staffSubmitDisabledReason || undefined}
                className="w-full py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                {actionLoading ? (uploadProgress !== null ? `à¸à¸³à¸¥à¸±à¸‡à¸­à¸±à¸›à¹‚à¸«à¸¥à¸” ${uploadProgress}%...` : 'à¸à¸³à¸¥à¸±à¸‡à¸ªà¹ˆà¸‡...') : 'âœˆ à¸ªà¹ˆà¸‡à¸‡à¸²à¸™'}
              </button>
              {(isBlocked || !staffCanSubmit) && staffSubmitDisabledReason && (
                <p className="text-[0.68rem] text-amber-700 px-1">â„¹ {staffSubmitDisabledReason}</p>
              )}
            </div>
          )}

          {/* â”€â”€ DOCCON: à¸£à¸­à¸•à¸£à¸§à¸ˆ sub-tab â”€â”€ */}
          {activeRole === 'DOCCON' && activeSubTab === 'pending' && task.status === 'SUBMITTED_TO_DOCCON' && (
            <div className="mt-2 space-y-3">
              {/* Doc ref input â€” required before approve (hidden when sent back from Boss) */}
              {!docconSentBackFromBoss && <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block"># à¸£à¸«à¸±à¸ªà¹€à¸­à¸à¸ªà¸²à¸£: <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={docRef}
                    onChange={e => setDocRef(e.target.value)}
                    placeholder="à¸à¸£à¸­à¸à¸£à¸«à¸±à¸ªà¹€à¸­à¸à¸ªà¸²à¸£ à¹€à¸Šà¹ˆà¸™ TM-001"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-teal-400 bg-white"
                  />
                </div>
                {docRefChecking && <p className="text-xs text-gray-400 mt-1">à¸à¸³à¸¥à¸±à¸‡à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸š...</p>}
                {docRefCheck?.exists && (
                  <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded-md">
                    <p className="text-xs text-amber-700 font-medium">âš ï¸ à¸£à¸«à¸±à¸ªà¸‹à¹‰à¸³ â€” à¸¡à¸µà¹€à¸­à¸à¸ªà¸²à¸£: {docRefCheck.file_name ?? '-' } {docRefCheck.date ? `(${formatDateThai(docRefCheck.date)})` : ''}</p>
                    <p className="text-[0.65rem] text-amber-600 mt-0.5">à¹‚à¸›à¸£à¸”à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¹ƒà¸«à¹‰à¸¡à¸±à¹ˆà¸™à¹ƒà¸ˆà¸§à¹ˆà¸²à¹€à¸›à¹‡à¸™à¸à¸²à¸£à¹à¸à¹‰à¹„à¸‚à¹€à¸­à¸à¸ªà¸²à¸£à¸‰à¸šà¸±à¸šà¹€à¸”à¸´à¸¡à¸«à¸£à¸·à¸­à¹„à¸¡à¹ˆ (à¸à¸”à¸œà¹ˆà¸²à¸™à¹„à¸”à¹‰à¸«à¸²à¸à¹ƒà¸Šà¹ˆ)</p>
                  </div>
                )}
                {docRefCheck && !docRefCheck.exists && docRef.trim() && (
                  <p className="text-xs text-green-600 mt-1">âœ… à¸£à¸«à¸±à¸ªà¹„à¸¡à¹ˆà¸‹à¹‰à¸³</p>
                )}
                {!docRef.trim() && !task.doc_ref && (
                  <p className="text-xs text-red-500 mt-1">à¸à¸£à¸¸à¸“à¸²à¸à¸£à¸­à¸à¸£à¸«à¸±à¸ªà¹€à¸­à¸à¸ªà¸²à¸£à¸à¹ˆà¸­à¸™à¸à¸”à¸œà¹ˆà¸²à¸™à¸£à¸¹à¸›à¹à¸šà¸š</p>
                )}
              </div>}

              {docconSentBackFromBoss && (
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block"># à¸£à¸«à¸±à¸ªà¹€à¸­à¸à¸ªà¸²à¸£à¹€à¸”à¸´à¸¡</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={docRef}
                      readOnly={!isDocRefEditing}
                      onChange={e => setDocRef(e.target.value)}
                      placeholder="à¸à¸£à¸­à¸à¸£à¸«à¸±à¸ªà¹€à¸­à¸à¸ªà¸²à¸£ à¹€à¸Šà¹ˆà¸™ TM-001"
                      className={`flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-teal-400 ${isDocRefEditing ? 'bg-white' : 'bg-gray-100 text-gray-600'}`}
                    />
                    <button
                      type="button"
                      onClick={() => setIsDocRefEditing(v => !v)}
                      className="px-3 py-2 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    >
                      {isDocRefEditing ? 'à¸›à¸´à¸”à¹à¸à¹‰à¹„à¸‚' : 'à¹à¸à¹‰à¹„à¸‚à¸£à¸«à¸±à¸ª'}
                    </button>
                  </div>
                  <p className="text-[0.65rem] text-gray-500 mt-1">à¸„à¹ˆà¸²à¹€à¸”à¸´à¸¡à¸–à¸¹à¸à¸¥à¹‡à¸­à¸à¹„à¸§à¹‰ à¸«à¸²à¸à¸•à¹‰à¸­à¸‡à¸à¸²à¸£à¹à¸à¹‰à¹ƒà¸«à¹‰à¸à¸”à¸›à¸¸à¹ˆà¸¡à¹à¸à¹‰à¹„à¸‚</p>
                  {docRefChecking && <p className="text-xs text-gray-400 mt-1">à¸à¸³à¸¥à¸±à¸‡à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸š...</p>}
                  {docRefCheck?.exists && (
                    <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded-md">
                      <p className="text-xs text-amber-700 font-medium">âš ï¸ à¸£à¸«à¸±à¸ªà¸‹à¹‰à¸³ â€” à¸¡à¸µà¹€à¸­à¸à¸ªà¸²à¸£: {docRefCheck.file_name ?? '-'} {docRefCheck.date ? `(${formatDateThai(docRefCheck.date)})` : ''}</p>
                      <p className="text-[0.65rem] text-amber-600 mt-0.5">à¹‚à¸›à¸£à¸”à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¹ƒà¸«à¹‰à¸¡à¸±à¹ˆà¸™à¹ƒà¸ˆà¸§à¹ˆà¸²à¹€à¸›à¹‡à¸™à¸à¸²à¸£à¹à¸à¹‰à¹„à¸‚à¹€à¸­à¸à¸ªà¸²à¸£à¸‰à¸šà¸±à¸šà¹€à¸”à¸´à¸¡à¸«à¸£à¸·à¸­à¹„à¸¡à¹ˆ (à¸à¸”à¸ªà¹ˆà¸‡à¸•à¹ˆà¸­à¸à¸¥à¸±à¸šà¹„à¸”à¹‰à¸«à¸²à¸à¹ƒà¸Šà¹ˆ)</p>
                    </div>
                  )}
                  {docRefCheck && !docRefCheck.exists && docRef.trim() && (
                    <p className="text-xs text-green-600 mt-1">âœ… à¸£à¸«à¸±à¸ªà¹„à¸¡à¹ˆà¸‹à¹‰à¸³</p>
                  )}
                </div>
              )}

              {/* Optional file attachment */}
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">
                  {docconSentBackFromBoss ? 'ðŸ“Ž à¹à¸™à¸šà¹„à¸Ÿà¸¥à¹Œ Word à¸—à¸µà¹ˆà¹à¸à¹‰à¹„à¸‚ (à¸šà¸±à¸‡à¸„à¸±à¸š):' : 'ðŸ“Ž à¹à¸™à¸šà¹„à¸Ÿà¸¥à¹Œà¸—à¸µà¹ˆà¸¡à¸µà¸£à¸­à¸¢à¹à¸à¹‰ (à¹„à¸¡à¹ˆà¸šà¸±à¸‡à¸„à¸±à¸š):'}
                </label>
                <input
                  ref={wordInputRef}
                  type="file"
                  accept={docconSentBackFromBoss ? '.docx' : '.docx,.pdf'}
                  onChange={onWordFileChange}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 cursor-pointer"
                />
                {!docconSentBackFromBoss && (
                  <>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={onImageFilesChange}
                      className="hidden"
                    />
                    <div className="mt-2 flex items-center gap-3 min-w-0 text-sm text-gray-600">
                      <button
                        type="button"
                        onClick={openImagePicker}
                        disabled={isBlocked}
                        className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-50 text-teal-700 text-sm font-semibold hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        ðŸ–¼ï¸ à¹à¸™à¸šà¸ à¸²à¸ž
                      </button>
                      <span className="flex-1 min-w-0 truncate">{imagePickerStatusText}</span>
                    </div>
                  </>
                )}
                {(selectedWordFile || selectedImageFiles.length > 0) && (
                  <p className="text-xs text-green-700 mt-1.5">âœ… à¹€à¸¥à¸·à¸­à¸à¹à¸¥à¹‰à¸§: <span className="font-medium">{selectedFileDisplayName}</span></p>
                )}
                {renderImageQueue()}
                {renderAttachmentSummary(
                  docconSentBackFromBoss
                    ? 'à¸à¸£à¸“à¸µà¸ªà¹ˆà¸‡à¸à¸¥à¸±à¸šà¸ˆà¸²à¸à¸«à¸±à¸§à¸«à¸™à¹‰à¸²à¸‡à¸²à¸™ à¸•à¹‰à¸­à¸‡à¹à¸™à¸š Word (.docx)'
                    : attachmentHintWithLimit
                )}
                {uploadProgress !== null && (
                  <div className="mt-2"><div className="h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-teal-500 transition-all rounded-full" style={{ width: `${uploadProgress}%` }} /></div></div>
                )}
              </div>

              {(uploadError || actionError) && (
                <p className="text-xs text-red-600 whitespace-pre-line">âš ï¸ {uploadError || actionError}</p>
              )}

              {/* Action buttons: sent-back from Boss â†’ only forward, no reject */}
              {docconSentBackFromBoss ? (
                <button
                  onClick={handleDocConApprove}
                  disabled={isBlocked || !hasDocxSelected}
                  title={docConApproveDisabledReason || undefined}
                  className="w-full py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  {actionLoading ? (uploadProgress !== null ? `${uploadProgress}%...` : '...') : 'âœˆ à¸ªà¹ˆà¸‡à¸•à¹ˆà¸­à¸à¸¥à¸±à¸š'}
                </button>
              ) : (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleDocConApprove}
                  disabled={isBlocked || (!docRef.trim() && !task.doc_ref)}
                  title={docConApproveDisabledReason || undefined}
                  className="flex-1 py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  {actionLoading ? (uploadProgress !== null ? `${uploadProgress}%...` : '...') : 'âœ“ à¸œà¹ˆà¸²à¸™à¸£à¸¹à¸›à¹à¸šà¸š'}
                </button>
                <button
                  onClick={handleDocConRejectClick}
                  disabled={isBlocked}
                  title={genericApproveDisabledReason || undefined}
                  className="flex-1 py-3 rounded-lg bg-[#dc3545] hover:bg-[#c82333] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  â†© à¸ªà¹ˆà¸‡à¸à¸¥à¸±à¸šà¹à¸à¹‰à¹„à¸‚
                </button>
              </div>
              )}
              {docConApproveDisabledReason && (
                <p className="text-[0.68rem] text-amber-700">â„¹ {docConApproveDisabledReason}</p>
              )}
            </div>
          )}

          {/* â”€â”€ REVIEWER â”€â”€ */}
          {activeRole === 'REVIEWER' && task.status === 'PENDING_REVIEW' && task.reviewer_id === userId && (
            <div className="mt-2 space-y-3">
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">ðŸ“Ž à¹à¸™à¸šà¹„à¸Ÿà¸¥à¹Œà¸—à¸µà¹ˆà¸¡à¸µà¸£à¸­à¸¢à¹à¸à¹‰/à¸„à¸­à¸¡à¹€à¸¡à¸™à¸•à¹Œ (à¹„à¸¡à¹ˆà¸šà¸±à¸‡à¸„à¸±à¸š):</label>
                <input
                  ref={wordInputRef}
                  type="file"
                  accept=".docx,.pdf"
                  onChange={onWordFileChange}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={onImageFilesChange}
                  className="hidden"
                />
                <div className="mt-2 flex items-center gap-3 min-w-0 text-sm text-gray-600">
                  <button
                    type="button"
                    onClick={openImagePicker}
                    disabled={isBlocked}
                    className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-semibold hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ðŸ–¼ï¸ à¹à¸™à¸šà¸ à¸²à¸ž
                  </button>
                  <span className="flex-1 min-w-0 truncate">{imagePickerStatusText}</span>
                </div>
                {(selectedWordFile || selectedImageFiles.length > 0) && (
                  <p className="text-xs text-green-700 mt-1.5">âœ… à¹€à¸¥à¸·à¸­à¸à¹à¸¥à¹‰à¸§: <span className="font-medium">{selectedFileDisplayName}</span></p>
                )}
                {renderImageQueue()}
                {renderAttachmentSummary(attachmentHintWithLimit)}
                {uploadProgress !== null && (
                  <div className="mt-2"><div className="h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 transition-all rounded-full" style={{ width: `${uploadProgress}%` }} /></div></div>
                )}
              </div>

              {(uploadError || actionError) && (
                <p className="text-xs text-red-600 whitespace-pre-line">âš ï¸ {uploadError || actionError}</p>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => uploadThenExecute('reviewer_approve')}
                  disabled={isBlocked}
                  title={genericApproveDisabledReason || undefined}
                  className="flex-1 py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  {actionLoading ? (uploadProgress !== null ? `${uploadProgress}%...` : '...') : 'âœ“ à¸œà¹ˆà¸²à¸™à¸à¸²à¸£à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸š'}
                </button>
                <button
                  onClick={handleReviewerRejectClick}
                  disabled={isBlocked}
                  title={genericApproveDisabledReason || undefined}
                  className="flex-1 py-3 rounded-lg bg-[#dc3545] hover:bg-[#c82333] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  â†© à¸ªà¹ˆà¸‡à¸à¸¥à¸±à¸šà¹à¸à¹‰à¹„à¸‚
                </button>
              </div>
              {genericApproveDisabledReason && (
                <p className="text-[0.68rem] text-amber-700">â„¹ {genericApproveDisabledReason}</p>
              )}
            </div>
          )}

          {/* â”€â”€ BOSS: pending tab actions â”€â”€ */}
          {activeRole === 'BOSS' && task.status === 'WAITING_BOSS_APPROVAL' && task.created_by === userId && (
            <div className="mt-2 space-y-3">
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">ðŸ“Ž à¹à¸™à¸šà¹„à¸Ÿà¸¥à¹Œ (à¹„à¸¡à¹ˆà¸šà¸±à¸‡à¸„à¸±à¸š):</label>
                <input
                  ref={wordInputRef}
                  type="file"
                  accept=".docx,.pdf"
                  onChange={onWordFileChange}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 cursor-pointer"
                />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={onImageFilesChange}
                  className="hidden"
                />
                <div className="mt-2 flex items-center gap-3 min-w-0 text-sm text-gray-600">
                  <button
                    type="button"
                    onClick={openImagePicker}
                    disabled={isBlocked}
                    className="inline-flex items-center px-4 py-2 rounded-lg bg-purple-50 text-purple-700 text-sm font-semibold hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ðŸ–¼ï¸ à¹à¸™à¸šà¸ à¸²à¸ž
                  </button>
                  <span className="flex-1 min-w-0 truncate">{imagePickerStatusText}</span>
                </div>
                {(selectedWordFile || selectedImageFiles.length > 0) && (
                  <p className="text-xs text-green-700 mt-1.5">âœ… à¹€à¸¥à¸·à¸­à¸à¹à¸¥à¹‰à¸§: <span className="font-medium">{selectedFileDisplayName}</span></p>
                )}
                {renderImageQueue()}
                {renderAttachmentSummary(attachmentHintWithLimit)}
                {uploadProgress !== null && (
                  <div className="mt-2"><div className="h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-purple-500 transition-all rounded-full" style={{ width: `${uploadProgress}%` }} /></div></div>
                )}
              </div>

              {(uploadError || actionError) && (
                <p className="text-xs text-red-600 whitespace-pre-line">âš ï¸ {uploadError || actionError}</p>
              )}

              <button
                onClick={() => uploadThenExecute('boss_approve')}
                disabled={isBlocked}
                title={genericApproveDisabledReason || undefined}
                className="w-full py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                {actionLoading ? (uploadProgress !== null ? `${uploadProgress}%...` : '...') : 'âœ“ à¸­à¸™à¸¸à¸¡à¸±à¸•à¸´'}
              </button>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleBossRejectClick}
                  disabled={isBlocked}
                  title={genericApproveDisabledReason || undefined}
                  className="flex-1 py-3 rounded-lg bg-[#dc3545] hover:bg-[#c82333] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  â†© à¸•à¸µà¸à¸¥à¸±à¸šà¹€à¸ˆà¹‰à¸²à¸«à¸™à¹‰à¸²à¸—à¸µà¹ˆ
                </button>
                <button
                  onClick={handleBossSendToDocCon}
                  disabled={isBlocked}
                  title={genericApproveDisabledReason || undefined}
                  className="flex-1 py-3 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  â†© à¸ªà¹ˆà¸‡ DocCon à¸•à¸£à¸§à¸ˆà¹ƒà¸«à¸¡à¹ˆ
                </button>
              </div>
              {genericApproveDisabledReason && (
                <p className="text-[0.68rem] text-amber-700">â„¹ {genericApproveDisabledReason}</p>
              )}
            </div>
          )}

          {/* â”€â”€ SUPER_BOSS â”€â”€ */}
          {activeRole === 'SUPER_BOSS' && task.status === 'WAITING_SUPER_BOSS_APPROVAL' && (
            <div className="mt-2 space-y-3">
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">ðŸ“Ž à¹à¸™à¸šà¹„à¸Ÿà¸¥à¹Œ (à¹„à¸¡à¹ˆà¸šà¸±à¸‡à¸„à¸±à¸š):</label>
                <input
                  ref={wordInputRef}
                  type="file"
                  accept=".docx,.pdf"
                  onChange={onWordFileChange}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 cursor-pointer"
                />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={onImageFilesChange}
                  className="hidden"
                />
                <div className="mt-2 flex items-center gap-3 min-w-0 text-sm text-gray-600">
                  <button
                    type="button"
                    onClick={openImagePicker}
                    disabled={isBlocked}
                    className="inline-flex items-center px-4 py-2 rounded-lg bg-pink-50 text-pink-700 text-sm font-semibold hover:bg-pink-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ðŸ–¼ï¸ à¹à¸™à¸šà¸ à¸²à¸ž
                  </button>
                  <span className="flex-1 min-w-0 truncate">{imagePickerStatusText}</span>
                </div>
                {(selectedWordFile || selectedImageFiles.length > 0) && (
                  <p className="text-xs text-green-700 mt-1.5">âœ… à¹€à¸¥à¸·à¸­à¸à¹à¸¥à¹‰à¸§: <span className="font-medium">{selectedFileDisplayName}</span></p>
                )}
                {renderImageQueue()}
                {renderAttachmentSummary(attachmentHintWithLimit)}
                {uploadProgress !== null && (
                  <div className="mt-2"><div className="h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-pink-500 transition-all rounded-full" style={{ width: `${uploadProgress}%` }} /></div></div>
                )}
              </div>

              {(uploadError || actionError) && (
                <p className="text-xs text-red-600 whitespace-pre-line">âš ï¸ {uploadError || actionError}</p>
              )}

              <button
                onClick={() => uploadThenExecute('super_boss_approve')}
                disabled={isBlocked}
                title={genericApproveDisabledReason || undefined}
                className="w-full py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                {actionLoading ? (uploadProgress !== null ? `${uploadProgress}%...` : '...') : 'âœ“ à¸­à¸™à¸¸à¸¡à¸±à¸•à¸´à¸‚à¸±à¹‰à¸™à¸ªà¸¸à¸”à¸—à¹‰à¸²à¸¢'}
              </button>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleSuperBossRejectClick}
                  disabled={isBlocked}
                  title={genericApproveDisabledReason || undefined}
                  className="flex-1 py-3 rounded-lg bg-[#dc3545] hover:bg-[#c82333] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  â†© à¸•à¸µà¸à¸¥à¸±à¸šà¹€à¸ˆà¹‰à¸²à¸«à¸™à¹‰à¸²à¸—à¸µà¹ˆ
                </button>
                <button
                  onClick={handleSuperBossSendToDocCon}
                  disabled={isBlocked}
                  title={genericApproveDisabledReason || undefined}
                  className="flex-1 py-3 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  â†© à¸ªà¹ˆà¸‡ DocCon à¸•à¸£à¸§à¸ˆà¹ƒà¸«à¸¡à¹ˆ
                </button>
              </div>
              {genericApproveDisabledReason && (
                <p className="text-[0.68rem] text-amber-700">â„¹ {genericApproveDisabledReason}</p>
              )}
            </div>
          )}

          {/* Shared action error display (outside role blocks) */}
          {actionError && !['STAFF', 'DOCCON', 'REVIEWER', 'BOSS', 'SUPER_BOSS'].some(r => r === activeRole) && (
            <div className="mt-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-md">
              âš ï¸ {actionError}
            </div>
          )}
        </div>
      </div>

      {/* Rejection / Cancel modal */}
      {showRejectModal && (
        <RejectModal
          title={rejectActionKey === 'boss_send_to_doccon' || rejectActionKey === 'super_boss_send_to_doccon' ? 'à¸ªà¹ˆà¸‡ DocCon à¸•à¸£à¸§à¸ˆà¹ƒà¸«à¸¡à¹ˆ' : 'à¸•à¸µà¸à¸¥à¸±à¸šà¹€à¸­à¸à¸ªà¸²à¸£'}
          confirmLabel={rejectActionKey === 'boss_send_to_doccon' || rejectActionKey === 'super_boss_send_to_doccon' ? 'à¸ªà¹ˆà¸‡à¸•à¸£à¸§à¸ˆà¹ƒà¸«à¸¡à¹ˆ' : 'à¸•à¸µà¸à¸¥à¸±à¸š'}
          confirmStyle={rejectActionKey === 'boss_send_to_doccon' || rejectActionKey === 'super_boss_send_to_doccon' ? 'warning' : 'danger'}
          requireComment={requiresRejectReason}
          onConfirm={handleRejectConfirm}
          onCancel={() => setShowRejectModal(false)}
          loading={actionLoading}
        />
      )}
    </>
  );
}

/* â”€â”€ Helper: is staff actionable? â”€â”€ */
function isStaffActionable(task: Task, userId: string): boolean {
  if (task.officer_id !== userId) return false;
  const actionable: TaskStatus[] = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];
  return actionable.includes(task.status);
}


