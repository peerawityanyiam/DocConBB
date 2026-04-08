'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import StatusBadge from './StatusBadge';
import StatusTimeline from './StatusTimeline';
import type { Task } from './TaskCard';
import type { AppRole } from '@/lib/auth/guards';
import type { TaskStatus } from '@/lib/constants/status';

interface TaskDetailModalProps {
  taskId: string | null;
  userRoles: AppRole[];
  userId: string;      // DB user id
  onClose: () => void;
  onUpdated: () => void;
}

type ActionKey =
  | 'submit'
  | 'doccon_approve'
  | 'doccon_reject'
  | 'reviewer_approve'
  | 'reviewer_reject'
  | 'boss_approve'
  | 'boss_reject'
  | 'boss_send_to_doccon'
  | 'super_boss_approve'
  | 'super_boss_reject'
  | 'super_boss_send_to_doccon'
  | 'cancel';

interface ActionDef {
  label: string;
  action: ActionKey;
  style: 'primary' | 'danger' | 'secondary' | 'warning';
  needsComment?: boolean;
  needsDocRef?: boolean;
  confirmText?: string;
}

interface StaffUser {
  id: string;
  display_name: string;
  role: string;
}

interface DocRefCheckResult {
  exists: boolean;
  task_code?: string;
  title?: string;
}

interface PreCheckResult {
  hasDuplicate: boolean;
  existingTask?: {
    task_code: string;
    title: string;
    doc_ref: string;
    status: string;
  };
}

function getAvailableActions(task: Task, roles: AppRole[], userId: string): ActionDef[] {
  const actions: ActionDef[] = [];
  const s = task.status;

  if (roles.includes('STAFF') && task.officer_id === userId) {
    const submitableFrom: TaskStatus[] = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];
    if (submitableFrom.includes(s)) {
      actions.push({ label: 'ส่งงาน', action: 'submit', style: 'primary' });
    }
  }

  if (roles.includes('DOCCON') && s === 'SUBMITTED_TO_DOCCON') {
    actions.push({ label: 'ผ่านตรวจรูปแบบ', action: 'doccon_approve', style: 'primary', needsDocRef: true });
    actions.push({ label: 'ตีกลับ (DocCon)', action: 'doccon_reject', style: 'danger', needsComment: true });
  }

  if (roles.includes('REVIEWER') && task.reviewer_id === userId && s === 'PENDING_REVIEW') {
    actions.push({ label: 'ผ่านตรวจสอบเนื้อหา', action: 'reviewer_approve', style: 'primary' });
    actions.push({ label: 'ตีกลับ (ผู้ตรวจสอบ)', action: 'reviewer_reject', style: 'danger', needsComment: true });
  }

  if (roles.includes('BOSS') && task.created_by === userId && s === 'WAITING_BOSS_APPROVAL') {
    actions.push({ label: 'อนุมัติ (หัวหน้า)', action: 'boss_approve', style: 'primary' });
    actions.push({ label: 'ส่งตรวจรูปแบบใหม่', action: 'boss_send_to_doccon', style: 'warning', needsComment: true });
    actions.push({ label: 'ตีกลับ (หัวหน้า)', action: 'boss_reject', style: 'danger', needsComment: true });
  }

  if (roles.includes('SUPER_BOSS') && s === 'WAITING_SUPER_BOSS_APPROVAL') {
    actions.push({ label: 'อนุมัติ (ผู้บริหาร)', action: 'super_boss_approve', style: 'primary', confirmText: 'เมื่ออนุมัติแล้ว งานจะเสร็จสมบูรณ์และถูก archive' });
    actions.push({ label: 'ส่งตรวจรูปแบบใหม่', action: 'super_boss_send_to_doccon', style: 'warning', needsComment: true });
    actions.push({ label: 'ตีกลับ (ผู้บริหาร)', action: 'super_boss_reject', style: 'danger', needsComment: true });
  }

  if (roles.includes('BOSS') && task.created_by === userId && !['COMPLETED', 'CANCELLED'].includes(s)) {
    actions.push({ label: 'ยกเลิกงาน', action: 'cancel', style: 'danger', needsComment: true, confirmText: 'การยกเลิกงานไม่สามารถย้อนกลับได้' });
  }

  return actions;
}

const ACTION_STYLE: Record<string, string> = {
  primary: 'bg-[#00c2a8] hover:bg-[#009e88] text-white font-semibold',
  danger: 'bg-[#ef4444] hover:bg-[#dc2626] text-white font-semibold',
  secondary: 'bg-[#f8fafc] hover:bg-[#e2e8f0] text-[#374f6b] border border-[#e2e8f0]',
  warning: 'bg-[#f59e0b] hover:bg-[#d97706] text-white font-semibold',
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
  });
}

function calcAgeDays(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

/* Upload context per role (matches reference GAS getUploadContext) */
function getUploadContext(task: Task, roles: AppRole[], userId: string): { canUpload: boolean; acceptDocx: boolean; acceptPdf: boolean; hint: string } {
  const s = task.status;
  const officerStatuses: TaskStatus[] = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];

  // Officer: docx only at actionable statuses
  if ((roles.includes('STAFF') || task.officer_id === userId) && officerStatuses.includes(s)) {
    return { canUpload: true, acceptDocx: true, acceptPdf: false, hint: 'รองรับเฉพาะ .docx (Word)' };
  }
  // DocCon: docx + pdf at SUBMITTED_TO_DOCCON
  if (roles.includes('DOCCON') && s === 'SUBMITTED_TO_DOCCON') {
    return { canUpload: true, acceptDocx: true, acceptPdf: true, hint: 'Word (.docx) หรือ PDF อ้างอิง (.pdf)' };
  }
  // Reviewer: docx + pdf at PENDING_REVIEW
  if (roles.includes('REVIEWER') && task.reviewer_id === userId && s === 'PENDING_REVIEW') {
    return { canUpload: true, acceptDocx: true, acceptPdf: true, hint: 'Word (.docx) หรือ PDF อ้างอิง (.pdf)' };
  }
  // Boss: docx + pdf at WAITING_BOSS_APPROVAL
  if (roles.includes('BOSS') && s === 'WAITING_BOSS_APPROVAL') {
    return { canUpload: true, acceptDocx: true, acceptPdf: true, hint: 'Word (.docx) หรือ PDF อ้างอิง (.pdf)' };
  }
  // Super Boss: docx + pdf at WAITING_SUPER_BOSS_APPROVAL
  if (roles.includes('SUPER_BOSS') && s === 'WAITING_SUPER_BOSS_APPROVAL') {
    return { canUpload: true, acceptDocx: true, acceptPdf: true, hint: 'Word (.docx) หรือ PDF อ้างอิง (.pdf)' };
  }
  return { canUpload: false, acceptDocx: false, acceptPdf: false, hint: '' };
}

export default function TaskDetailModal({ taskId, userRoles, userId, onClose, onUpdated }: TaskDetailModalProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'detail' | 'files' | 'timeline'>('detail');
  const [pendingAction, setPendingAction] = useState<ActionDef | null>(null);
  const [comment, setComment] = useState('');
  const [docRef, setDocRef] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [newComment, setNewComment] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);

  // File upload state
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // DocRef check state
  const [docRefCheck, setDocRefCheck] = useState<DocRefCheckResult | null>(null);
  const [docRefChecking, setDocRefChecking] = useState(false);
  const docRefTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reassign state
  const [reassignField, setReassignField] = useState<'officer_id' | 'reviewer_id' | null>(null);
  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [staffListLoading, setStaffListLoading] = useState(false);
  const [reassignLoading, setReassignLoading] = useState(false);

  // SuperBoss pre-check state
  const [preCheckResult, setPreCheckResult] = useState<PreCheckResult | null>(null);
  const [preCheckLoading, setPreCheckLoading] = useState(false);

  // DocCon checklist state
  const [checklistDriveUploaded, setChecklistDriveUploaded] = useState(false);
  const [checklistSentToBranch, setChecklistSentToBranch] = useState(false);
  const [checklistSaving, setChecklistSaving] = useState(false);

  const fetchTask = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (res.ok) setTask(await res.json());
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    setTask(null);
    setTab('detail');
    setPendingAction(null);
    setComment('');
    setDocRef('');
    setActionError('');
    setUploadProgress(null);
    setUploadError('');
    setDocRefCheck(null);
    setReassignField(null);
    setPreCheckResult(null);
    setPreCheckLoading(false);
    fetchTask();
  }, [fetchTask]);

  // Sync checklist state when task loads/changes
  useEffect(() => {
    if (task) {
      setChecklistDriveUploaded(!!task.drive_uploaded);
      setChecklistSentToBranch(!!task.sent_to_branch);
    }
  }, [task]);

  // DocRef duplicate check with debounce
  useEffect(() => {
    if (!pendingAction?.needsDocRef || !docRef.trim() || !taskId) {
      setDocRefCheck(null);
      return;
    }
    if (docRefTimerRef.current) clearTimeout(docRefTimerRef.current);
    docRefTimerRef.current = setTimeout(async () => {
      setDocRefChecking(true);
      try {
        const res = await fetch(`/api/tasks/check-doc-ref?doc_ref=${encodeURIComponent(docRef.trim())}&task_id=${taskId}`);
        if (res.ok) {
          setDocRefCheck(await res.json());
        }
      } catch {
        // ignore check errors
      } finally {
        setDocRefChecking(false);
      }
    }, 500);
    return () => {
      if (docRefTimerRef.current) clearTimeout(docRefTimerRef.current);
    };
  }, [docRef, pendingAction?.needsDocRef, taskId]);

  async function handleAction() {
    if (!pendingAction || !task) return;
    setActionLoading(true);
    setActionError('');
    try {
      const body: Record<string, string> = { action: pendingAction.action };
      if (comment.trim()) body.comment = comment.trim();
      if (docRef.trim()) body.doc_ref = docRef.trim();

      const res = await fetch(`/api/tasks/${task.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'เกิดข้อผิดพลาด');
      setPendingAction(null);
      setComment('');
      setDocRef('');
      setDocRefCheck(null);
      onUpdated();
      fetchTask();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim() || !task) return;
    setCommentLoading(true);
    try {
      await fetch(`/api/tasks/${task.id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newComment.trim() }),
      });
      setNewComment('');
      fetchTask();
    } finally {
      setCommentLoading(false);
    }
  }

  function handleFileUpload(file: File) {
    if (!task) return;
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      setUploadError('ไฟล์มีขนาดเกิน 50MB');
      return;
    }
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/pdf',
    ];
    const allowedExts = ['.docx', '.pdf'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
      setUploadError('รองรับเฉพาะไฟล์ .docx และ .pdf เท่านั้น');
      return;
    }

    setUploadError('');
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/tasks/${task.id}/files`);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      setUploadProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        fetchTask();
        onUpdated();
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          setUploadError(data.error ?? 'อัปโหลดไม่สำเร็จ');
        } catch {
          setUploadError('อัปโหลดไม่สำเร็จ');
        }
      }
    });

    xhr.addEventListener('error', () => {
      setUploadProgress(null);
      setUploadError('เกิดข้อผิดพลาดในการอัปโหลด');
    });

    xhr.send(formData);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = '';
  }

  async function openReassign(field: 'officer_id' | 'reviewer_id') {
    setReassignField(field);
    setStaffListLoading(true);
    try {
      const res = await fetch('/api/tasks/staff-list');
      if (res.ok) {
        setStaffList(await res.json());
      }
    } finally {
      setStaffListLoading(false);
    }
  }

  async function handleReassign(newUserId: string) {
    if (!task || !reassignField) return;
    setReassignLoading(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/reassign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: reassignField, new_user_id: newUserId }),
      });
      if (res.ok) {
        setReassignField(null);
        onUpdated();
        fetchTask();
      }
    } finally {
      setReassignLoading(false);
    }
  }

  const uploadCtx = task ? getUploadContext(task, userRoles, userId) : null;
  const canUploadFile = uploadCtx?.canUpload ?? false;

  const canReassign = task &&
    userRoles.includes('BOSS') &&
    task.created_by === userId &&
    !['COMPLETED', 'CANCELLED'].includes(task.status);

  if (!taskId) return null;

  const ageDays = task ? calcAgeDays(task.created_at) : 0;
  const ageColor = ageDays > 14 ? 'bg-red-100 text-red-700' : ageDays > 7 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600';

  const filteredStaffForReassign = reassignField === 'officer_id'
    ? staffList.filter(u => u.role === 'STAFF')
    : staffList.filter(u => u.role === 'REVIEWER');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            {task ? (
              <>
                <div className="flex items-center gap-2 mb-0.5">
                  {/* Age Chip */}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ageColor}`}>
                    ⏱ {ageDays} วัน
                  </span>
                </div>
                <h2 className="text-lg font-semibold text-slate-800 leading-snug">{task.title}</h2>
              </>
            ) : (
              <div className="h-6 w-48 bg-slate-100 rounded animate-pulse" />
            )}
          </div>
          <div className="flex items-center gap-3">
            {task && <StatusBadge status={task.status} />}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none ml-2">&times;</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#e2e8f0] px-6 shrink-0">
          {(['detail', 'files', 'timeline'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`py-2 px-4 text-[0.8rem] font-semibold border-b-2 -mb-px transition-colors ${tab === t ? 'border-[#00c2a8] text-[#00c2a8]' : 'border-transparent text-[#6b7f96] hover:text-[#374f6b] hover:border-[#e2e8f0]'}`}>
              {t === 'detail' ? 'รายละเอียด' : t === 'files' ? 'ประวัติไฟล์' : 'ประวัติสถานะ'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && !task ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />)}
            </div>
          ) : !task ? (
            <p className="text-slate-400 text-sm text-center py-8">ไม่พบข้อมูลงาน</p>
          ) : (
            <>
              {/* Detail Tab */}
              {tab === 'detail' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {/* Officer with reassign */}
                    <div>
                      <p className="text-slate-500 text-xs mb-0.5">ผู้รับผิดชอบ</p>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-800">{task.officer?.display_name ?? '—'}</p>
                        {canReassign && (
                          <button
                            onClick={() => openReassign('officer_id')}
                            className="text-xs text-yellow-600 hover:text-yellow-700 border border-yellow-300 rounded px-1.5 py-0.5 hover:bg-yellow-50 transition-colors"
                          >
                            โอนงาน
                          </button>
                        )}
                      </div>
                      {reassignField === 'officer_id' && (
                        <div className="mt-2">
                          {staffListLoading ? (
                            <p className="text-xs text-slate-400">กำลังโหลด...</p>
                          ) : (
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                              <select
                                className="w-full text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                defaultValue=""
                                onChange={e => { if (e.target.value) handleReassign(e.target.value); }}
                                disabled={reassignLoading}
                              >
                                <option value="" disabled>เลือกผู้รับผิดชอบใหม่</option>
                                {filteredStaffForReassign.map(u => (
                                  <option key={u.id} value={u.id}>{u.display_name}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => setReassignField(null)}
                                className="w-full text-xs text-slate-500 hover:bg-slate-50 py-1 border-t border-slate-200"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Reviewer with reassign */}
                    <div>
                      <p className="text-slate-500 text-xs mb-0.5">ผู้ตรวจสอบ</p>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-800">{task.reviewer?.display_name ?? '—'}</p>
                        {canReassign && (
                          <button
                            onClick={() => openReassign('reviewer_id')}
                            className="text-xs text-yellow-600 hover:text-yellow-700 border border-yellow-300 rounded px-1.5 py-0.5 hover:bg-yellow-50 transition-colors"
                          >
                            โอนงาน
                          </button>
                        )}
                      </div>
                      {reassignField === 'reviewer_id' && (
                        <div className="mt-2">
                          {staffListLoading ? (
                            <p className="text-xs text-slate-400">กำลังโหลด...</p>
                          ) : (
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                              <select
                                className="w-full text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                defaultValue=""
                                onChange={e => { if (e.target.value) handleReassign(e.target.value); }}
                                disabled={reassignLoading}
                              >
                                <option value="" disabled>เลือกผู้ตรวจสอบใหม่</option>
                                {filteredStaffForReassign.map(u => (
                                  <option key={u.id} value={u.id}>{u.display_name}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => setReassignField(null)}
                                className="w-full text-xs text-slate-500 hover:bg-slate-50 py-1 border-t border-slate-200"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="text-slate-500 text-xs mb-0.5">ผู้สร้างงาน</p>
                      <p className="font-medium text-slate-800">{task.creator?.display_name ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-0.5">เลขที่เอกสาร</p>
                      <p className="font-medium text-slate-800">{task.doc_ref ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-0.5">สร้างเมื่อ</p>
                      <p className="text-slate-700">{formatDateTime(task.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-0.5">อัปเดตล่าสุด</p>
                      <p className="text-slate-700">{formatDateTime(task.updated_at)}</p>
                    </div>
                    {task.completed_at && (
                      <div className="col-span-2">
                        <p className="text-slate-500 text-xs mb-0.5">เสร็จสมบูรณ์เมื่อ</p>
                        <p className="text-green-700 font-medium">{formatDateTime(task.completed_at)}</p>
                      </div>
                    )}
                  </div>

                  {task.detail && (
                    <div>
                      <p className="text-slate-500 text-xs mb-1">รายละเอียด</p>
                      <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3">{task.detail}</p>
                    </div>
                  )}

                  {/* Main file display */}
                  {task.drive_file_name && (
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <span className="text-blue-500">📎</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-500">ไฟล์แนบ</p>
                        {task.drive_file_id ? (
                          <a
                            href={`https://drive.google.com/file/d/${task.drive_file_id}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline truncate block"
                          >
                            {task.drive_file_name}
                          </a>
                        ) : (
                          <p className="text-sm font-medium text-blue-700 truncate">{task.drive_file_name}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Ref PDF display */}
                  {task.ref_file_name && (
                    <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg p-3">
                      <span className="text-orange-500">📄</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-orange-600 font-medium">ไฟล์อ้างอิง (PDF)</p>
                        {task.ref_file_id ? (
                          <a
                            href={`https://drive.google.com/file/d/${task.ref_file_id}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-orange-700 hover:text-orange-800 hover:underline truncate block"
                          >
                            {task.ref_file_name}
                          </a>
                        ) : (
                          <p className="text-sm font-medium text-orange-700 truncate">{task.ref_file_name}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Upload zone removed — use ActionCard inline actions instead */}

                  {/* DocCon post-completion checklist (only for DOCCON role on completed tasks) */}
                  {userRoles.includes('DOCCON') && task.status === 'COMPLETED' && (
                    <div className="border border-teal-200 bg-teal-50/50 rounded-xl p-4 space-y-3">
                      <p className="text-xs font-bold text-teal-700 flex items-center gap-1.5">
                        📋 Checklist หลังอนุมัติ (DocCon)
                      </p>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checklistDriveUploaded}
                          onChange={async (e) => {
                            const val = e.target.checked;
                            setChecklistDriveUploaded(val);
                            setChecklistSaving(true);
                            try {
                              await fetch(`/api/tasks/${task.id}/checklist`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ drive_uploaded: val }),
                              });
                              fetchTask();
                            } finally { setChecklistSaving(false); }
                          }}
                          className="accent-teal-600 w-4 h-4"
                        />
                        <span className="text-sm text-slate-700">อัปโหลดไฟล์ขึ้น Drive แล้ว</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checklistSentToBranch}
                          onChange={async (e) => {
                            const val = e.target.checked;
                            setChecklistSentToBranch(val);
                            setChecklistSaving(true);
                            try {
                              await fetch(`/api/tasks/${task.id}/checklist`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sent_to_branch: val }),
                              });
                              fetchTask();
                            } finally { setChecklistSaving(false); }
                          }}
                          className="accent-teal-600 w-4 h-4"
                        />
                        <span className="text-sm text-slate-700">ส่งหน่วยงานแล้ว</span>
                      </label>
                      {checklistSaving && <p className="text-xs text-slate-400">กำลังบันทึก...</p>}
                    </div>
                  )}

                  {/* Actions removed — use ActionCard inline actions instead */}
                </div>
              )}

              {/* Files Tab */}
              {tab === 'files' && (
                <div className="space-y-3">
                  {(task.file_history ?? []).length === 0 ? (
                    <p className="text-sm text-slate-400 italic text-center py-4">ยังไม่มีประวัติไฟล์</p>
                  ) : (
                    <div className="space-y-2">
                      {[...(task.file_history ?? [])].reverse().map((f, idx) => (
                        <div key={idx} className="bg-slate-50 rounded-lg p-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <a
                                href={`https://drive.google.com/file/d/${f.driveFileId}/view`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline truncate"
                              >
                                {f.fileName}
                              </a>
                              {f.isPdf && (
                                <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium shrink-0">
                                  PDF
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span>{f.uploadedByName}</span>
                              <span>·</span>
                              <span>{formatDateTime(f.uploadedAt)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Timeline Tab */}
              {tab === 'timeline' && (
                <StatusTimeline history={task.status_history ?? []} />
              )}

              {/* Comments tab removed — comments are only collected during rejections */}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
