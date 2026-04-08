'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import StatusBadge from './StatusBadge';
import type { Task } from './TaskCard';
import type { AppRole } from '@/lib/auth/guards';
import type { TaskStatus } from '@/lib/constants/status';

/* ── Border colors per role context ── */
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

/* ── Helpers ── */
function formatDateThai(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'Asia/Bangkok',
  });
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/* ── Pipeline visualization (for DocCon tracking tab) ── */
const PIPELINE_STAGES: { key: string; label: string }[] = [
  { key: 'ASSIGNED', label: 'เจ้าหน้าที่' },
  { key: 'SUBMITTED_TO_DOCCON', label: 'ตรวจรูปแบบ' },
  { key: 'PENDING_REVIEW', label: 'ตรวจเนื้อหา' },
  { key: 'WAITING_BOSS_APPROVAL', label: 'Boss' },
  { key: 'WAITING_SUPER_BOSS_APPROVAL', label: 'หัวหน้างาน' },
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
                {isDone ? '✓' : i + 1}
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

/* ── Rejection / Cancel Modal ── */
function RejectModal({ title, onConfirm, onCancel, loading, confirmLabel = 'ตีกลับ', confirmStyle = 'danger' }: {
  title: string;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
  loading: boolean;
  confirmLabel?: string;
  confirmStyle?: 'danger' | 'warning';
}) {
  const [comment, setComment] = useState('');
  const bgColor = confirmStyle === 'warning' ? 'bg-[#f59e0b] hover:bg-[#d97706]' : 'bg-[#dc3545] hover:bg-[#c82333]';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-800 mb-3">{title}</h3>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="ระบุเหตุผล..."
          rows={3}
          className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 resize-none"
        />
        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => onConfirm(comment)}
            disabled={loading}
            className={`flex-1 py-2.5 rounded-lg ${bgColor} text-white text-sm font-bold disabled:opacity-50`}
          >
            {loading ? 'กำลังดำเนินการ...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── DocRef Check Result ── */
interface DocRefCheckResult {
  exists: boolean;
  task_code?: string;
  title?: string;
}

export default function ActionCard({ task, activeRole, activeSubTab, userId, userRoles, onUpdated, onOpenHistory }: ActionCardProps) {
  const borderColor = ROLE_BORDER_COLOR[activeRole] ?? '#94a3b8';
  const age = daysAgo(task.created_at);

  // File selection state — just tracks what user selected, NOT auto-uploaded
  const [selectedWordFile, setSelectedWordFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');
  const wordInputRef = useRef<HTMLInputElement>(null);

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

  /* ── uploadFileAsync: returns Promise (no callback) ── */
  const uploadFileAsync = useCallback((file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!['.docx', '.pdf'].includes(ext)) {
        reject(new Error('รองรับเฉพาะไฟล์ .docx และ .pdf เท่านั้น'));
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        reject(new Error('ไฟล์มีขนาดเกิน 50MB'));
        return;
      }
      setUploadProgress(0);
      const formData = new FormData();
      formData.append('file', file);
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
          try { const d = JSON.parse(xhr.responseText); reject(new Error(d.error ?? 'อัปโหลดไม่สำเร็จ')); }
          catch { reject(new Error('อัปโหลดไม่สำเร็จ')); }
        }
      });
      xhr.addEventListener('error', () => { setUploadProgress(null); reject(new Error('เกิดข้อผิดพลาดในการอัปโหลด')); });
      xhr.send(formData);
    });
  }, [task.id]);

  /* ── callStatusApi: calls the status PATCH endpoint ── */
  async function callStatusApi(actionKey: string, comment?: string): Promise<void> {
    const body: Record<string, string> = { action: actionKey };
    if (comment?.trim()) body.comment = comment.trim();
    if (docRef.trim() && activeRole === 'DOCCON') body.doc_ref = docRef.trim();
    const res = await fetch(`/api/tasks/${task.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'เกิดข้อผิดพลาด');
  }

  /* ── uploadThenExecute: optionally upload selected file, then execute action ── */
  async function uploadThenExecute(actionKey: string, comment?: string) {
    setActionLoading(true);
    setActionError('');
    setUploadError('');
    let fileUploaded = false;
    try {
      if (selectedWordFile) {
        await uploadFileAsync(selectedWordFile);
        fileUploaded = true;
        setSelectedWordFile(null);
        if (wordInputRef.current) wordInputRef.current.value = '';
      }
      await callStatusApi(actionKey, comment);
      onUpdated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      if (!fileUploaded && selectedWordFile) {
        // upload failed — clear selection so user can pick again
        setSelectedWordFile(null);
        if (wordInputRef.current) wordInputRef.current.value = '';
        setUploadError(msg);
      } else {
        setActionError(msg);
      }
    } finally {
      setActionLoading(false);
      setUploadProgress(null);
    }
  }

  /* ── STAFF: always requires a new file ── */
  async function handleStaffSubmit() {
    if (!selectedWordFile) {
      setActionError('กรุณาเลือกไฟล์ Word (.docx) ก่อนส่งงาน');
      return;
    }
    await uploadThenExecute('submit');
  }

  /* ── DocCon approve — require doc_ref (unless sent back from Boss where it's already set) ── */
  async function handleDocConApprove() {
    if (!docRef.trim() && !task.doc_ref) {
      setActionError('กรุณาระบุรหัสเอกสารก่อน');
      return;
    }
    if (docconSentBackFromBoss && !hasDocxSelected) {
      setActionError('กรุณาอัปโหลดไฟล์ Word (.docx) ก่อนส่งกลับไปหัวหน้างานหรือผู้สั่งงาน');
      return;
    }
    await uploadThenExecute('doccon_approve');
  }

  /* ── Reject/cancel modal triggers ── */
  function handleDocConRejectClick() { setRejectActionKey('doccon_reject'); setShowRejectModal(true); }
  function handleReviewerRejectClick() { setRejectActionKey('reviewer_reject'); setShowRejectModal(true); }
  function handleBossRejectClick() { setRejectActionKey('boss_reject'); setShowRejectModal(true); }
  function handleBossSendToDocCon() { setRejectActionKey('boss_send_to_doccon'); setShowRejectModal(true); }
  function handleBossCancelClick() { setRejectActionKey('cancel'); setShowRejectModal(true); }
  function handleSuperBossRejectClick() { setRejectActionKey('super_boss_reject'); setShowRejectModal(true); }
  function handleSuperBossSendToDocCon() { setRejectActionKey('super_boss_send_to_doccon'); setShowRejectModal(true); }

  /* ── Rejection/cancel confirm — uploads file (if any) then executes action ── */
  function handleRejectConfirm(comment: string) {
    setShowRejectModal(false);
    uploadThenExecute(rejectActionKey, comment);
  }

  /* ── File input change: ONLY updates state, never auto-uploads ── */
  function onWordFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedWordFile(file);
    setUploadError('');
    setActionError('');
  }

  const hasDocxSelected = !!selectedWordFile && selectedWordFile.name.toLowerCase().endsWith('.docx');

  /* ── Is this a pipeline-only card (DocCon tracking sub-tab)? ── */
  const isPipelineView = activeRole === 'DOCCON' && activeSubTab === 'tracking';

  /* ── Compute file links ── */
  const hasWordFile = !!task.drive_file_id;
  const wordFileUrl = hasWordFile ? `https://drive.google.com/file/d/${task.drive_file_id}/view` : null;
  const hasRefFile = !!task.ref_file_id;
  const refFileUrl = hasRefFile ? `https://drive.google.com/file/d/${task.ref_file_id}/view` : null;

  /* ── Derived state for staff submit button (Bug 3: always require new file) ── */
  const isRejectedStatus = REJECTED_STATUSES.has(task.status as TaskStatus);
  const staffCanSubmit = selectedWordFile !== null;

  /* ── Bug 4: Derive who sent back for rejected statuses ── */
  const lastHistoryEntry = task.status_history?.slice().reverse().find(h => h.status === task.status);
  const sentBackByName = lastHistoryEntry?.changedByName;

  /* ── Bug 5: DocCon context — is this a "sent back from Boss/SuperBoss"? ── */
  const docconSentBackFromBoss = task.status === 'SUBMITTED_TO_DOCCON' && (() => {
    const history = task.status_history ?? [];
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h.status === 'SUBMITTED_TO_DOCCON' && h.note?.startsWith('sentBackToDocconBy:')) return true;
      if (h.status === 'SUBMITTED_TO_DOCCON') return false;
    }
    return false;
  })();

  /* ── Is boss cancel available? ── */
  const bossCanCancel = activeRole === 'BOSS' &&
    task.created_by === userId &&
    !['COMPLETED', 'CANCELLED'].includes(task.status);

  const isBlocked = actionLoading || uploadProgress !== null;

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
              <h3 className="font-bold text-gray-900 text-sm leading-snug">{task.title}</h3>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={task.status} size="sm" />
              {task.doc_ref && (
                <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded"># {task.doc_ref}</span>
              )}
              <button
                onClick={() => onOpenHistory(task.id)}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                title="ประวัติและรายละเอียด"
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
              <span className="text-gray-400 text-sm mt-0.5">ℹ️</span>
              <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{task.detail}</p>
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 mb-3">
            {activeRole === 'STAFF' && (
              <>
                <span>📅 สั่งงานวันที่ {formatDateThai(task.created_at)}</span>
                <span className={age > 7 ? 'text-red-600 font-medium' : ''}>
                  👤 ค้างที่คุณ {age} วัน
                </span>
              </>
            )}
            {activeRole === 'DOCCON' && (
              <>
                <span>👤 ผู้ส่ง: {task.officer?.display_name ?? '—'}</span>
                <span>📅 ส่ง {formatDateThai(task.updated_at)}</span>
                {isPipelineView && age > 0 && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${age > 7 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                    ค้าง {age} วัน
                  </span>
                )}
              </>
            )}
            {activeRole === 'REVIEWER' && (
              <>
                <span>👤 ผู้ส่ง: {task.officer?.display_name ?? '—'}</span>
                <span>📅 ส่ง {formatDateThai(task.updated_at)}</span>
              </>
            )}
            {activeRole === 'BOSS' && (
              <>
                <span>👤 เจ้าหน้าที่: {task.officer?.display_name ?? '—'}</span>
                <span>📋 ผู้ตรวจ: {task.reviewer?.display_name ?? '—'}</span>
                <span>📅 {formatDateThai(task.updated_at)}</span>
              </>
            )}
            {activeRole === 'SUPER_BOSS' && (
              <>
                <span>👤 ผู้สร้าง: {task.creator?.display_name ?? '—'}</span>
                <span>📅 {formatDateThai(task.updated_at)}</span>
              </>
            )}
          </div>

          {/* Latest comment (rejection reason) + who sent back */}
          {/* Rejected: show who sent back + comment */}
          {REJECTED_STATUSES.has(task.status) && (
            <div className="mb-3 px-3 py-2 rounded-md text-xs leading-relaxed bg-red-50 border-l-[3px] border-red-400 text-red-800 space-y-0.5">
              {sentBackByName && (
                <p className="font-semibold">↩ ส่งกลับโดย: {sentBackByName}</p>
              )}
              {task.latest_comment && (
                <p>💬 {task.latest_comment}</p>
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
                ↩ ส่งกลับตรวจรูปแบบโดย: <span className="font-semibold">{sentBackEntry.changedByName}</span>
                {task.latest_comment && <p className="mt-0.5">💬 {task.latest_comment}</p>}
              </div>
            ) : null;
          })()}

          {/* Pipeline visualization (DocCon tracking tab) */}
          {isPipelineView && <PipelineViz status={task.status} />}

          {/* File links — word (blue) + pdf (orange) */}
          {!isPipelineView && (hasWordFile || hasRefFile) && (
            <div className="flex flex-col gap-2 mb-3">
              {hasWordFile && (
                <a
                  href={wordFileUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 hover:bg-blue-100 transition-colors text-sm text-blue-800"
                >
                  <span>📄</span>
                  <span>Word: <span className="font-medium">{task.drive_file_name ?? 'document.docx'}</span></span>
                </a>
              )}
              {hasRefFile && (
                <a
                  href={refFileUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors text-sm text-amber-800"
                >
                  <span>📋</span>
                  <span>PDF: <span className="font-medium">{task.ref_file_name ?? 'document.pdf'}</span></span>
                </a>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════ */}
          {/* ──  ROLE-SPECIFIC INLINE ACTIONS  ──  */}
          {/* ══════════════════════════════════════ */}

          {/* ── STAFF: word upload + submit ── */}
          {activeRole === 'STAFF' && isStaffActionable(task, userId) && (
            <div className="mt-2 space-y-3">
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                  📄 {isRejectedStatus ? 'อัปโหลดไฟล์ Word ที่แก้ไขแล้ว' : 'อัปโหลดไฟล์ Word (.docx)'}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  ref={wordInputRef}
                  type="file"
                  accept=".docx"
                  onChange={onWordFileChange}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                />
                {selectedWordFile ? (
                  <p className="text-xs text-green-700 mt-1.5 flex items-center gap-1">
                    ✅ เลือกแล้ว: <span className="font-medium">{selectedWordFile.name}</span>
                  </p>
                ) : (
                  <p className="text-[0.65rem] text-red-500 mt-1">กรุณาเลือกไฟล์ Word (.docx) เพื่อส่งงาน</p>
                )}
              </div>

              {/* Upload progress */}
              {uploadProgress !== null && (
                <div className="px-1">
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                    <span>กำลังอัปโหลด...</span><span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-[#00c2a8] transition-all rounded-full" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}

              {uploadError && <p className="text-xs text-red-600 px-1">⚠️ {uploadError}</p>}
              {actionError && <p className="text-xs text-red-600 px-1">⚠️ {actionError}</p>}

              <button
                onClick={handleStaffSubmit}
                disabled={isBlocked || !staffCanSubmit}
                className="w-full py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                {actionLoading ? (uploadProgress !== null ? `กำลังอัปโหลด ${uploadProgress}%...` : 'กำลังส่ง...') : '✈ ส่งงาน'}
              </button>
            </div>
          )}

          {/* ── DOCCON: รอตรวจ sub-tab ── */}
          {activeRole === 'DOCCON' && activeSubTab === 'pending' && task.status === 'SUBMITTED_TO_DOCCON' && (
            <div className="mt-2 space-y-3">
              {/* Doc ref input — required before approve (hidden when sent back from Boss) */}
              {!docconSentBackFromBoss && <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block"># รหัสเอกสาร: <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={docRef}
                    onChange={e => setDocRef(e.target.value)}
                    placeholder="กรอกรหัสเอกสาร เช่น FIN - 001"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-teal-400 bg-white"
                  />
                </div>
                {docRefChecking && <p className="text-xs text-gray-400 mt-1">กำลังตรวจสอบ...</p>}
                {docRefCheck?.exists && (
                  <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded-md">
                    <p className="text-xs text-amber-700 font-medium">⚠️ รหัสซ้ำ — มีเอกสาร: {docRefCheck.task_code} — {docRefCheck.title}</p>
                    <p className="text-[0.65rem] text-amber-600 mt-0.5">โปรดตรวจสอบให้มั่นใจว่าเป็นการแก้ไขเอกสารฉบับเดิมหรือไม่ (กดผ่านได้หากใช่)</p>
                  </div>
                )}
                {docRefCheck && !docRefCheck.exists && docRef.trim() && (
                  <p className="text-xs text-green-600 mt-1">✅ รหัสไม่ซ้ำ</p>
                )}
                {!docRef.trim() && !task.doc_ref && (
                  <p className="text-xs text-red-500 mt-1">กรุณากรอกรหัสเอกสารก่อนกดผ่านรูปแบบ</p>
                )}
              </div>}

              {docconSentBackFromBoss && (
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block"># รหัสเอกสารเดิม</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={docRef}
                      readOnly={!isDocRefEditing}
                      onChange={e => setDocRef(e.target.value)}
                      placeholder="กรอกรหัสเอกสาร เช่น FIN - 001"
                      className={`flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-teal-400 ${isDocRefEditing ? 'bg-white' : 'bg-gray-100 text-gray-600'}`}
                    />
                    <button
                      type="button"
                      onClick={() => setIsDocRefEditing(v => !v)}
                      className="px-3 py-2 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    >
                      {isDocRefEditing ? 'ปิดแก้ไข' : 'แก้ไขรหัส'}
                    </button>
                  </div>
                  <p className="text-[0.65rem] text-gray-500 mt-1">ค่าเดิมถูกล็อกไว้ หากต้องการแก้ให้กดปุ่มแก้ไข</p>
                  {docRefChecking && <p className="text-xs text-gray-400 mt-1">กำลังตรวจสอบ...</p>}
                  {docRefCheck?.exists && (
                    <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded-md">
                      <p className="text-xs text-amber-700 font-medium">⚠️ รหัสซ้ำ — มีเอกสาร: {docRefCheck.task_code} — {docRefCheck.title}</p>
                      <p className="text-[0.65rem] text-amber-600 mt-0.5">โปรดตรวจสอบให้มั่นใจว่าเป็นการแก้ไขเอกสารฉบับเดิมหรือไม่ (กดส่งต่อกลับได้หากใช่)</p>
                    </div>
                  )}
                  {docRefCheck && !docRefCheck.exists && docRef.trim() && (
                    <p className="text-xs text-green-600 mt-1">✅ รหัสไม่ซ้ำ</p>
                  )}
                </div>
              )}

              {/* Optional file attachment */}
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">
                  {docconSentBackFromBoss ? '📎 แนบไฟล์ Word ที่แก้ไข (บังคับ):' : '📎 แนบไฟล์ที่มีรอยแก้ (ไม่บังคับ):'}
                </label>
                <input
                  ref={wordInputRef}
                  type="file"
                  accept={docconSentBackFromBoss ? '.docx' : '.docx,.pdf'}
                  onChange={onWordFileChange}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 cursor-pointer"
                />
                {selectedWordFile && (
                  <p className="text-xs text-green-700 mt-1.5">✅ เลือกแล้ว: <span className="font-medium">{selectedWordFile.name}</span></p>
                )}
                <p className="text-[0.65rem] text-gray-400 mt-1">
                  {docconSentBackFromBoss ? 'Word (.docx) เท่านั้น (งานที่ส่งกลับจาก Boss)' : 'Word (.docx) หรือ PDF (.pdf)'} — จะอัปโหลดพร้อมกับการดำเนินการ
                </p>
                {uploadProgress !== null && (
                  <div className="mt-2"><div className="h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-teal-500 transition-all rounded-full" style={{ width: `${uploadProgress}%` }} /></div></div>
                )}
              </div>

              {(uploadError || actionError) && (
                <p className="text-xs text-red-600">⚠️ {uploadError || actionError}</p>
              )}

              {/* Action buttons: sent-back from Boss → only forward, no reject */}
              {docconSentBackFromBoss ? (
                <button
                  onClick={handleDocConApprove}
                  disabled={isBlocked || !hasDocxSelected}
                  className="w-full py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  {actionLoading ? (uploadProgress !== null ? `${uploadProgress}%...` : '...') : '✈ ส่งต่อกลับ'}
                </button>
              ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleDocConApprove}
                  disabled={isBlocked || (!docRef.trim() && !task.doc_ref)}
                  className="flex-1 py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  {actionLoading ? (uploadProgress !== null ? `${uploadProgress}%...` : '...') : '✓ ผ่านรูปแบบ'}
                </button>
                <button
                  onClick={handleDocConRejectClick}
                  disabled={isBlocked}
                  className="flex-1 py-3 rounded-lg bg-[#dc3545] hover:bg-[#c82333] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  ↩ ส่งกลับแก้ไข
                </button>
              </div>
              )}
            </div>
          )}

          {/* ── REVIEWER ── */}
          {activeRole === 'REVIEWER' && task.status === 'PENDING_REVIEW' && task.reviewer_id === userId && (
            <div className="mt-2 space-y-3">
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">📎 แนบไฟล์ที่มีรอยแก้/คอมเมนต์ (ไม่บังคับ):</label>
                <input
                  ref={wordInputRef}
                  type="file"
                  accept=".docx,.pdf"
                  onChange={onWordFileChange}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                />
                {selectedWordFile && (
                  <p className="text-xs text-green-700 mt-1.5">✅ เลือกแล้ว: <span className="font-medium">{selectedWordFile.name}</span></p>
                )}
                <p className="text-[0.65rem] text-gray-400 mt-1">Word (.docx) หรือ PDF (.pdf) — จะอัปโหลดพร้อมกับการดำเนินการ</p>
                {uploadProgress !== null && (
                  <div className="mt-2"><div className="h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 transition-all rounded-full" style={{ width: `${uploadProgress}%` }} /></div></div>
                )}
              </div>

              {(uploadError || actionError) && (
                <p className="text-xs text-red-600">⚠️ {uploadError || actionError}</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => uploadThenExecute('reviewer_approve')}
                  disabled={isBlocked}
                  className="flex-1 py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  {actionLoading ? (uploadProgress !== null ? `${uploadProgress}%...` : '...') : '✓ ผ่านการตรวจสอบ'}
                </button>
                <button
                  onClick={handleReviewerRejectClick}
                  disabled={isBlocked}
                  className="flex-1 py-3 rounded-lg bg-[#dc3545] hover:bg-[#c82333] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  ↩ ส่งกลับแก้ไข
                </button>
              </div>
            </div>
          )}

          {/* ── BOSS: pending tab actions ── */}
          {activeRole === 'BOSS' && task.status === 'WAITING_BOSS_APPROVAL' && task.created_by === userId && (
            <div className="mt-2 space-y-3">
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">📎 แนบไฟล์ (ไม่บังคับ):</label>
                <input
                  ref={wordInputRef}
                  type="file"
                  accept=".docx,.pdf"
                  onChange={onWordFileChange}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 cursor-pointer"
                />
                {selectedWordFile && (
                  <p className="text-xs text-green-700 mt-1.5">✅ เลือกแล้ว: <span className="font-medium">{selectedWordFile.name}</span></p>
                )}
                <p className="text-[0.65rem] text-gray-400 mt-1">Word (.docx) หรือ PDF (.pdf) — จะอัปโหลดพร้อมกับการดำเนินการ</p>
                {uploadProgress !== null && (
                  <div className="mt-2"><div className="h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-purple-500 transition-all rounded-full" style={{ width: `${uploadProgress}%` }} /></div></div>
                )}
              </div>

              {(uploadError || actionError) && (
                <p className="text-xs text-red-600">⚠️ {uploadError || actionError}</p>
              )}

              <button
                onClick={() => uploadThenExecute('boss_approve')}
                disabled={isBlocked}
                className="w-full py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                {actionLoading ? (uploadProgress !== null ? `${uploadProgress}%...` : '...') : '✓ อนุมัติ'}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleBossRejectClick}
                  disabled={isBlocked}
                  className="flex-1 py-3 rounded-lg bg-[#dc3545] hover:bg-[#c82333] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  ↩ ตีกลับเจ้าหน้าที่
                </button>
                <button
                  onClick={handleBossSendToDocCon}
                  disabled={isBlocked}
                  className="flex-1 py-3 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  ↩ ส่ง DocCon ตรวจใหม่
                </button>
              </div>
            </div>
          )}

          {/* ── SUPER_BOSS ── */}
          {activeRole === 'SUPER_BOSS' && task.status === 'WAITING_SUPER_BOSS_APPROVAL' && (
            <div className="mt-2 space-y-3">
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">📎 แนบไฟล์ (ไม่บังคับ):</label>
                <input
                  ref={wordInputRef}
                  type="file"
                  accept=".docx,.pdf"
                  onChange={onWordFileChange}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 cursor-pointer"
                />
                {selectedWordFile && (
                  <p className="text-xs text-green-700 mt-1.5">✅ เลือกแล้ว: <span className="font-medium">{selectedWordFile.name}</span></p>
                )}
                <p className="text-[0.65rem] text-gray-400 mt-1">Word (.docx) หรือ PDF (.pdf) — จะอัปโหลดพร้อมกับการดำเนินการ</p>
                {uploadProgress !== null && (
                  <div className="mt-2"><div className="h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-pink-500 transition-all rounded-full" style={{ width: `${uploadProgress}%` }} /></div></div>
                )}
              </div>

              {(uploadError || actionError) && (
                <p className="text-xs text-red-600">⚠️ {uploadError || actionError}</p>
              )}

              <button
                onClick={() => uploadThenExecute('super_boss_approve')}
                disabled={isBlocked}
                className="w-full py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                {actionLoading ? (uploadProgress !== null ? `${uploadProgress}%...` : '...') : '✓ อนุมัติขั้นสุดท้าย'}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleSuperBossRejectClick}
                  disabled={isBlocked}
                  className="flex-1 py-3 rounded-lg bg-[#dc3545] hover:bg-[#c82333] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  ↩ ตีกลับเจ้าหน้าที่
                </button>
                <button
                  onClick={handleSuperBossSendToDocCon}
                  disabled={isBlocked}
                  className="flex-1 py-3 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  ↩ ส่ง DocCon ตรวจใหม่
                </button>
              </div>
            </div>
          )}

          {/* ── BOSS: cancel (always available for creator, non-terminal tasks) ── */}
          {bossCanCancel && (
            <div className={`mt-3 ${task.status === 'WAITING_BOSS_APPROVAL' ? 'border-t border-gray-100 pt-3' : ''}`}>
              <button
                onClick={handleBossCancelClick}
                disabled={isBlocked}
                className="w-full py-2.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium transition-colors disabled:opacity-50"
              >
                🗑 ยกเลิกงาน
              </button>
            </div>
          )}

          {/* Shared action error display (outside role blocks) */}
          {actionError && !['STAFF', 'DOCCON', 'REVIEWER', 'BOSS', 'SUPER_BOSS'].some(r => r === activeRole) && (
            <div className="mt-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-md">
              ⚠️ {actionError}
            </div>
          )}
        </div>
      </div>

      {/* Rejection / Cancel modal */}
      {showRejectModal && (
        <RejectModal
          title={rejectActionKey === 'cancel' ? 'ยกเลิกงาน — ระบุเหตุผล' : rejectActionKey === 'boss_send_to_doccon' || rejectActionKey === 'super_boss_send_to_doccon' ? 'ส่ง DocCon ตรวจใหม่' : 'ตีกลับเอกสาร'}
          confirmLabel={rejectActionKey === 'cancel' ? 'ยืนยันยกเลิก' : rejectActionKey === 'boss_send_to_doccon' || rejectActionKey === 'super_boss_send_to_doccon' ? 'ส่งตรวจใหม่' : 'ตีกลับ'}
          confirmStyle={rejectActionKey === 'boss_send_to_doccon' || rejectActionKey === 'super_boss_send_to_doccon' ? 'warning' : 'danger'}
          onConfirm={handleRejectConfirm}
          onCancel={() => setShowRejectModal(false)}
          loading={actionLoading}
        />
      )}
    </>
  );
}

/* ── Helper: is staff actionable? ── */
function isStaffActionable(task: Task, userId: string): boolean {
  if (task.officer_id !== userId) return false;
  const actionable: TaskStatus[] = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];
  return actionable.includes(task.status);
}
