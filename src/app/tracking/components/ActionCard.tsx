'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import StatusBadge from './StatusBadge';
import type { Task } from './TaskCard';
import type { AppRole } from '@/lib/auth/guards';
import type { TaskStatus } from '@/lib/constants/status';

/* ── Border colors per role context ── */
const ROLE_BORDER_COLOR: Record<string, string> = {
  STAFF: '#f59e0b',       // yellow
  DOCCON: '#0d9488',       // teal
  REVIEWER: '#6366f1',     // indigo/purple
  BOSS: '#8b5cf6',         // purple
  SUPER_BOSS: '#ec4899',   // pink
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

/* ── Rejection Modal ── */
function RejectModal({ title, onConfirm, onCancel, loading }: {
  title: string;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [comment, setComment] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-800 mb-3">{title}</h3>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="ระบุเหตุผลในการตีกลับ..."
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
            className="flex-1 py-2.5 rounded-lg bg-[#dc3545] text-white text-sm font-bold hover:bg-[#c82333] disabled:opacity-50"
          >
            {loading ? 'กำลังดำเนินการ...' : 'ตีกลับ'}
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

  // File upload state — separate for word and pdf
  const [selectedWordFile, setSelectedWordFile] = useState<File | null>(null);
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');
  const wordInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  // Keep legacy ref for backward compat in submit flows
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  /* ── File Upload (XHR with progress) ── */
  const handleFileUpload = useCallback((file: File, taskId: string, cb: () => void) => {
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) { setUploadError('ไฟล์มีขนาดเกิน 50MB'); return; }
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!['.docx', '.pdf'].includes(ext)) {
      setUploadError('รองรับเฉพาะไฟล์ .docx และ .pdf เท่านั้น');
      return;
    }
    setUploadError('');
    setUploadProgress(0);
    const formData = new FormData();
    formData.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/tasks/${taskId}/files`);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      setUploadProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        cb();
      } else {
        try { const d = JSON.parse(xhr.responseText); setUploadError(d.error ?? 'อัปโหลดไม่สำเร็จ'); } catch { setUploadError('อัปโหลดไม่สำเร็จ'); }
      }
    });
    xhr.addEventListener('error', () => { setUploadProgress(null); setUploadError('เกิดข้อผิดพลาดในการอัปโหลด'); });
    xhr.send(formData);
  }, []);

  /* ── Execute action ── */
  async function executeAction(actionKey: string, comment?: string) {
    setActionLoading(true);
    setActionError('');
    try {
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
      onUpdated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setActionLoading(false);
    }
  }

  /* ── Staff: submit with optional file upload first ── */
  async function handleStaffSubmit() {
    if (selectedWordFile) {
      handleFileUpload(selectedWordFile, task.id, () => {
        setSelectedWordFile(null);
        if (wordInputRef.current) wordInputRef.current.value = '';
        executeAction('submit');
      });
    } else {
      executeAction('submit');
    }
  }

  /* ── DocCon approve ── */
  async function handleDocConApprove() {
    executeAction('doccon_approve');
  }

  /* ── DocCon reject ── */
  function handleDocConRejectClick() {
    setRejectActionKey('doccon_reject');
    setShowRejectModal(true);
  }

  /* ── Reviewer approve (with optional file) ── */
  async function handleReviewerApprove() {
    executeAction('reviewer_approve');
  }

  function handleReviewerRejectClick() {
    setRejectActionKey('reviewer_reject');
    setShowRejectModal(true);
  }

  /* ── Boss actions ── */
  async function handleBossApprove() {
    executeAction('boss_approve');
  }

  function handleBossRejectClick() {
    setRejectActionKey('boss_reject');
    setShowRejectModal(true);
  }

  function handleBossSendToDocCon() {
    setRejectActionKey('boss_send_to_doccon');
    setShowRejectModal(true);
  }

  /* ── SuperBoss actions ── */
  async function handleSuperBossApprove() {
    executeAction('super_boss_approve');
  }

  function handleSuperBossRejectClick() {
    setRejectActionKey('super_boss_reject');
    setShowRejectModal(true);
  }

  function handleSuperBossSendToDocCon() {
    setRejectActionKey('super_boss_send_to_doccon');
    setShowRejectModal(true);
  }

  /* ── Rejection confirm handler ── */
  function handleRejectConfirm(comment: string) {
    setShowRejectModal(false);
    executeAction(rejectActionKey, comment);
  }

  function onWordFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedWordFile(file);
    setUploadError('');
  }

  function onPdfFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedPdfFile(file);
    setUploadError('');
  }

  // Upload word file attachment
  function handleWordUpload() {
    if (selectedWordFile) {
      handleFileUpload(selectedWordFile, task.id, () => {
        setSelectedWordFile(null);
        if (wordInputRef.current) wordInputRef.current.value = '';
        onUpdated();
      });
    }
  }

  // Upload pdf file attachment
  function handlePdfUpload() {
    if (selectedPdfFile) {
      handleFileUpload(selectedPdfFile, task.id, () => {
        setSelectedPdfFile(null);
        if (pdfInputRef.current) pdfInputRef.current.value = '';
        onUpdated();
      });
    }
  }

  /* ── Is this a pipeline-only card (DocCon tracking sub-tab)? ── */
  const isPipelineView = activeRole === 'DOCCON' && activeSubTab === 'tracking';

  /* ── Compute file links ── */
  const hasWordFile = !!task.drive_file_id;
  const wordFileUrl = hasWordFile ? `https://drive.google.com/file/d/${task.drive_file_id}/view` : null;
  const hasRefFile = !!task.ref_file_id;
  const refFileUrl = hasRefFile ? `https://drive.google.com/file/d/${task.ref_file_id}/view` : null;

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

          {/* Latest comment (rejection reason) */}
          {task.latest_comment && REJECTED_STATUSES.has(task.status) && (
            <div className="mb-3 px-3 py-2 rounded-md text-xs leading-relaxed bg-red-50 border-l-[3px] border-red-400 text-red-800">
              💬 {task.latest_comment}
            </div>
          )}

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

          {/* ── STAFF: dual file input + submit button ── */}
          {activeRole === 'STAFF' && isStaffActionable(task, userId) && (
            <div className="mt-2 space-y-2">
              {/* Word upload */}
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">📄 อัปโหลด Word (.docx):</label>
                <div className="flex items-center gap-2">
                  <input
                    ref={wordInputRef}
                    type="file"
                    accept=".docx"
                    onChange={onWordFileChange}
                    className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                  />
                  {selectedWordFile && (
                    <button onClick={handleWordUpload} className="text-xs text-blue-600 hover:underline">อัปโหลด</button>
                  )}
                </div>
              </div>
              {/* PDF upload */}
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">📋 อัปโหลด PDF (.pdf):</label>
                <div className="flex items-center gap-2">
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={onPdfFileChange}
                    className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                  />
                  {selectedPdfFile && (
                    <button onClick={handlePdfUpload} className="text-xs text-amber-600 hover:underline">อัปโหลด</button>
                  )}
                </div>
              </div>
              {uploadProgress !== null && (
                <div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-[#00c2a8] transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}
              {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
              <button
                onClick={handleStaffSubmit}
                disabled={actionLoading || uploadProgress !== null}
                className="w-full py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                {actionLoading ? 'กำลังส่ง...' : '✈ ส่งงาน'}
              </button>
            </div>
          )}

          {/* ── DOCCON: รอตรวจ sub-tab ── */}
          {activeRole === 'DOCCON' && activeSubTab === 'pending' && task.status === 'SUBMITTED_TO_DOCCON' && (
            <div className="mt-2 space-y-3">
              {/* Doc ref input */}
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block"># รหัสเอกสาร:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={docRef}
                    onChange={e => setDocRef(e.target.value)}
                    placeholder="เช่น TM-0001"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-teal-400"
                  />
                  <button
                    onClick={() => { /* trigger check */ }}
                    className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-200"
                  >
                    🔍 ตรวจสอบ
                  </button>
                </div>
                {docRefChecking && <p className="text-xs text-gray-400 mt-1">กำลังตรวจสอบ...</p>}
                {docRefCheck?.exists && (
                  <p className="text-xs text-red-600 mt-1">⚠️ ซ้ำกับ {docRefCheck.task_code} - {docRefCheck.title}</p>
                )}
                {docRefCheck && !docRefCheck.exists && docRef.trim() && (
                  <p className="text-xs text-green-600 mt-1">✅ ไม่ซ้ำ</p>
                )}
              </div>

              {/* Optional attachments — dual upload */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-700 block">📎 แนบไฟล์ที่มีรอยแก้ (ไม่บังคับ):</label>
                <div>
                  <span className="text-xs text-gray-500">Word (.docx):</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <input
                      ref={wordInputRef}
                      type="file"
                      accept=".docx"
                      onChange={onWordFileChange}
                      className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                    />
                    {selectedWordFile && (
                      <button onClick={handleWordUpload} className="text-xs text-teal-600 hover:underline">อัปโหลด</button>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-gray-500">PDF (.pdf):</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept=".pdf"
                      onChange={onPdfFileChange}
                      className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                    />
                    {selectedPdfFile && (
                      <button onClick={handlePdfUpload} className="text-xs text-teal-600 hover:underline">อัปโหลด</button>
                    )}
                  </div>
                </div>
                {uploadProgress !== null && (
                  <div className="mt-1"><div className="h-1.5 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-teal-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div></div>
                )}
                {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleDocConApprove}
                  disabled={actionLoading}
                  className="flex-1 py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  {actionLoading ? '...' : '✓ ผ่านรูปแบบ'}
                </button>
                <button
                  onClick={handleDocConRejectClick}
                  disabled={actionLoading}
                  className="flex-1 py-3 rounded-lg bg-[#dc3545] hover:bg-[#c82333] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  ↩ ส่งกลับแก้ไข
                </button>
              </div>
            </div>
          )}

          {/* ── REVIEWER ── */}
          {activeRole === 'REVIEWER' && task.status === 'PENDING_REVIEW' && task.reviewer_id === userId && (
            <div className="mt-2 space-y-3">
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-700 block">📎 แนบไฟล์ที่มีรอยแก้/คอมเมนต์ (ไม่บังคับ):</label>
                <div>
                  <span className="text-xs text-gray-500">Word (.docx):</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <input
                      ref={wordInputRef}
                      type="file"
                      accept=".docx"
                      onChange={onWordFileChange}
                      className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                    />
                    {selectedWordFile && (
                      <button onClick={handleWordUpload} className="text-xs text-indigo-600 hover:underline">อัปโหลด</button>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-gray-500">PDF (.pdf):</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept=".pdf"
                      onChange={onPdfFileChange}
                      className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                    />
                    {selectedPdfFile && (
                      <button onClick={handlePdfUpload} className="text-xs text-indigo-600 hover:underline">อัปโหลด</button>
                    )}
                  </div>
                </div>
                {uploadProgress !== null && (
                  <div className="mt-1"><div className="h-1.5 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div></div>
                )}
                {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleReviewerApprove}
                  disabled={actionLoading}
                  className="flex-1 py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  {actionLoading ? '...' : '✓ ผ่านการตรวจสอบ'}
                </button>
                <button
                  onClick={handleReviewerRejectClick}
                  disabled={actionLoading}
                  className="flex-1 py-3 rounded-lg bg-[#dc3545] hover:bg-[#c82333] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  ↩ ส่งกลับแก้ไข
                </button>
              </div>
            </div>
          )}

          {/* ── BOSS ── */}
          {activeRole === 'BOSS' && task.status === 'WAITING_BOSS_APPROVAL' && task.created_by === userId && (
            <div className="mt-2 space-y-3">
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-700 block">📎 แนบไฟล์ (ไม่บังคับ):</label>
                <div>
                  <span className="text-xs text-gray-500">Word (.docx):</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <input
                      ref={wordInputRef}
                      type="file"
                      accept=".docx"
                      onChange={onWordFileChange}
                      className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                    />
                    {selectedWordFile && (
                      <button onClick={handleWordUpload} className="text-xs text-purple-600 hover:underline">อัปโหลด</button>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-gray-500">PDF (.pdf):</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept=".pdf"
                      onChange={onPdfFileChange}
                      className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                    />
                    {selectedPdfFile && (
                      <button onClick={handlePdfUpload} className="text-xs text-purple-600 hover:underline">อัปโหลด</button>
                    )}
                  </div>
                </div>
                {uploadProgress !== null && (
                  <div className="mt-1"><div className="h-1.5 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-purple-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div></div>
                )}
                {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
              </div>
              <button
                onClick={handleBossApprove}
                disabled={actionLoading}
                className="w-full py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                {actionLoading ? '...' : '✓ อนุมัติ'}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleBossRejectClick}
                  disabled={actionLoading}
                  className="flex-1 py-3 rounded-lg bg-[#dc3545] hover:bg-[#c82333] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  ↩ ตีกลับเจ้าหน้าที่
                </button>
                <button
                  onClick={handleBossSendToDocCon}
                  disabled={actionLoading}
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
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-700 block">📎 แนบไฟล์ (ไม่บังคับ):</label>
                <div>
                  <span className="text-xs text-gray-500">Word (.docx):</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <input
                      ref={wordInputRef}
                      type="file"
                      accept=".docx"
                      onChange={onWordFileChange}
                      className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                    />
                    {selectedWordFile && (
                      <button onClick={handleWordUpload} className="text-xs text-pink-600 hover:underline">อัปโหลด</button>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-gray-500">PDF (.pdf):</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept=".pdf"
                      onChange={onPdfFileChange}
                      className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                    />
                    {selectedPdfFile && (
                      <button onClick={handlePdfUpload} className="text-xs text-pink-600 hover:underline">อัปโหลด</button>
                    )}
                  </div>
                </div>
                {uploadProgress !== null && (
                  <div className="mt-1"><div className="h-1.5 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-pink-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div></div>
                )}
                {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
              </div>
              <button
                onClick={handleSuperBossApprove}
                disabled={actionLoading}
                className="w-full py-3 rounded-lg bg-[#00c2a8] hover:bg-[#009e88] text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                {actionLoading ? '...' : '✓ อนุมัติขั้นสุดท้าย'}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleSuperBossRejectClick}
                  disabled={actionLoading}
                  className="flex-1 py-3 rounded-lg bg-[#dc3545] hover:bg-[#c82333] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  ↩ ตีกลับเจ้าหน้าที่
                </button>
                <button
                  onClick={handleSuperBossSendToDocCon}
                  disabled={actionLoading}
                  className="flex-1 py-3 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  ↩ ส่ง DocCon ตรวจใหม่
                </button>
              </div>
            </div>
          )}

          {/* Action error */}
          {actionError && (
            <div className="mt-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-md">
              ⚠️ {actionError}
            </div>
          )}
        </div>
      </div>

      {/* Rejection modal */}
      {showRejectModal && (
        <RejectModal
          title="ตีกลับเอกสาร"
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
