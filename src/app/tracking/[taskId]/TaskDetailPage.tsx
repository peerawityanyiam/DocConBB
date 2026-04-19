'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import StatusBadge from '../components/StatusBadge';
import StatusTimeline from '../components/StatusTimeline';
import type { Task } from '../components/TaskCard';
import type { AppRole } from '@/lib/auth/guards';
import type { TaskStatus } from '@/lib/constants/status';
import { MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES, MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL } from '@/lib/files/upload-limits';

type ActionKey =
  | 'submit' | 'doccon_approve' | 'doccon_reject'
  | 'doccon_reopen_completed'
  | 'reviewer_approve' | 'reviewer_reject'
  | 'boss_approve' | 'boss_reject' | 'boss_send_to_doccon' | 'boss_reopen_completed'
  | 'super_boss_approve' | 'super_boss_reject' | 'super_boss_send_to_doccon' | 'super_boss_reopen_completed'
  | 'cancel';

interface ActionDef {
  label: string;
  action: ActionKey;
  style: 'primary' | 'danger' | 'warning';
  needsComment?: boolean;
  needsDocRef?: boolean;
  confirmText?: string;
}

function getActions(task: Task, roles: AppRole[], userId: string): ActionDef[] {
  const actions: ActionDef[] = [];
  const s = task.status;
  const submitFrom: TaskStatus[] = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];

  if (roles.includes('STAFF') && task.officer_id === userId && submitFrom.includes(s))
    actions.push({ label: 'ส่งงาน', action: 'submit', style: 'primary' });

  if (roles.includes('DOCCON') && s === 'SUBMITTED_TO_DOCCON') {
    actions.push({ label: 'ผ่านตรวจรูปแบบ', action: 'doccon_approve', style: 'primary', needsDocRef: true });
    actions.push({ label: 'ตีกลับ', action: 'doccon_reject', style: 'danger', needsComment: true });
  }
  if (roles.includes('REVIEWER') && task.reviewer_id === userId && s === 'PENDING_REVIEW') {
    actions.push({ label: 'ผ่านตรวจสอบ', action: 'reviewer_approve', style: 'primary' });
    actions.push({ label: 'ตีกลับ', action: 'reviewer_reject', style: 'danger', needsComment: true });
  }
  if (roles.includes('BOSS') && task.created_by === userId && s === 'WAITING_BOSS_APPROVAL') {
    actions.push({ label: 'อนุมัติ', action: 'boss_approve', style: 'primary' });
    actions.push({ label: 'ส่งตรวจรูปแบบใหม่', action: 'boss_send_to_doccon', style: 'warning', needsComment: true });
    actions.push({ label: 'ตีกลับ', action: 'boss_reject', style: 'danger', needsComment: true });
  }
  if (roles.includes('SUPER_BOSS') && s === 'WAITING_SUPER_BOSS_APPROVAL') {
    actions.push({ label: 'อนุมัติขั้นสุดท้าย', action: 'super_boss_approve', style: 'primary', confirmText: 'งานจะเสร็จสมบูรณ์' });
    actions.push({ label: 'ส่งตรวจรูปแบบใหม่', action: 'super_boss_send_to_doccon', style: 'warning', needsComment: true });
    actions.push({ label: 'ตีกลับ', action: 'super_boss_reject', style: 'danger', needsComment: true });
  }
  if (s === 'COMPLETED') {
    if (roles.includes('DOCCON')) {
      actions.push({
        label: 'ดึงงานกลับ (doccon)',
        action: 'doccon_reopen_completed',
        style: 'warning',
        needsComment: true,
      });
    }
    if (roles.includes('BOSS') && task.created_by === userId) {
      actions.push({
        label: 'ดึงงานกลับ (ผู้สั่งงาน)',
        action: 'boss_reopen_completed',
        style: 'warning',
        needsComment: true,
      });
    }
    if (roles.includes('SUPER_BOSS')) {
      actions.push({
        label: 'ดึงงานกลับ (หัวหน้างาน)',
        action: 'super_boss_reopen_completed',
        style: 'warning',
        needsComment: true,
      });
    }
  }
  if (roles.includes('BOSS') && task.created_by === userId && !['COMPLETED', 'CANCELLED'].includes(s))
    actions.push({ label: 'ยกเลิกงาน', action: 'cancel', style: 'danger', needsComment: true, confirmText: 'ไม่สามารถย้อนกลับได้' });

  return actions;
}

const STYLE_MAP: Record<string, string> = {
  primary: 'bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-semibold',
  danger: 'bg-red-500 hover:bg-red-600 text-white font-semibold',
  warning: 'bg-orange-400 hover:bg-orange-500 text-white font-semibold',
};

function formatDT(iso: string) {
  return new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

function getAgeDays(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

function AgeChip({ createdAt }: { createdAt: string }) {
  const days = getAgeDays(createdAt);
  let colorClass = 'bg-slate-100 text-slate-600';
  if (days > 14) colorClass = 'bg-red-100 text-red-700';
  else if (days > 7) colorClass = 'bg-orange-100 text-orange-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {days} วัน
    </span>
  );
}

interface StaffOption {
  id: string;
  display_name: string;
  email: string;
  roles: string[];
}

export default function TaskDetailPage({ taskId, userRoles, userId }: { taskId: string; userRoles: AppRole[]; userId: string }) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'detail' | 'files' | 'timeline' | 'comments'>('detail');
  const [pendingAction, setPendingAction] = useState<ActionDef | null>(null);
  const [comment, setComment] = useState('');
  const [docRef, setDocRef] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [newComment, setNewComment] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // File upload state
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // DocRef duplicate check state
  const [docRefChecking, setDocRefChecking] = useState(false);
  const [docRefExists, setDocRefExists] = useState<boolean | null>(null);
  const docRefTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reassign state
  const [reassignTarget, setReassignTarget] = useState<'officer' | 'reviewer' | null>(null);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [reassignLoading, setReassignLoading] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState('');

  // SuperBoss pre-check state
  const [preCheckResult, setPreCheckResult] = useState<{ hasDuplicate: boolean; existingTask?: { task_code: string; title: string; doc_ref: string } } | null>(null);
  const [preCheckLoading, setPreCheckLoading] = useState(false);

  // DocCon checklist state
  const [checklistDriveUploaded, setChecklistDriveUploaded] = useState(false);
  const [checklistSentToBranch, setChecklistSentToBranch] = useState(false);
  const [checklistSaving, setChecklistSaving] = useState(false);

  const fetchTask = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}`);
    if (res.ok) setTask(await res.json());
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetchTask(); }, [fetchTask]);

  // Sync checklist state when task loads
  useEffect(() => {
    if (task) {
      setChecklistDriveUploaded(!!task.drive_uploaded);
      setChecklistSentToBranch(!!task.sent_to_branch);
    }
  }, [task]);

  // DocRef duplicate check with debounce
  useEffect(() => {
    if (!pendingAction?.needsDocRef || !docRef.trim()) {
      setDocRefExists(null);
      setDocRefChecking(false);
      return;
    }
    setDocRefChecking(true);
    setDocRefExists(null);
    if (docRefTimerRef.current) clearTimeout(docRefTimerRef.current);
    docRefTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tasks/check-doc-ref?doc_ref=${encodeURIComponent(docRef.trim())}&task_id=${taskId}`);
        if (res.ok) {
          const data = await res.json();
          setDocRefExists(data.exists);
        }
      } catch {
        // ignore
      } finally {
        setDocRefChecking(false);
      }
    }, 500);
    return () => { if (docRefTimerRef.current) clearTimeout(docRefTimerRef.current); };
  }, [docRef, pendingAction?.needsDocRef, taskId]);

  async function handleAction() {
    if (!pendingAction || !task) return;
    setActionLoading(true); setActionError('');
    try {
      const body: Record<string, string> = { action: pendingAction.action };
      if (comment.trim()) body.comment = comment.trim();
      if (docRef.trim()) body.doc_ref = docRef.trim();
      const res = await fetch(`/api/tasks/${task.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'เกิดข้อผิดพลาด');
      setPendingAction(null); setComment(''); setDocRef('');
      setSuccessMsg(`ดำเนินการ "${pendingAction.label}" เรียบร้อย`);
      setTimeout(() => setSuccessMsg(''), 4000);
      fetchTask();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally { setActionLoading(false); }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim() || !task) return;
    setCommentLoading(true);
    await fetch(`/api/tasks/${task.id}/comment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: newComment.trim() }),
    });
    setNewComment(''); fetchTask(); setCommentLoading(false);
  }

  // File upload handler
  function handleFileUpload(file: File) {
    if (!task) return;
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/pdf',
    ];
    if (!validTypes.includes(file.type) && !file.name.endsWith('.docx') && !file.name.endsWith('.pdf')) {
      setUploadError('รองรับเฉพาะไฟล์ .docx และ .pdf เท่านั้น');
      return;
    }
    if (file.size > MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES) {
      setUploadError(`ขนาดไฟล์ต้องไม่เกิน ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}`);
      return;
    }
    setUploadError('');
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/tasks/${task.id}/files`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      setUploadProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        setSuccessMsg('อัปโหลดไฟล์เรียบร้อย');
        setTimeout(() => setSuccessMsg(''), 4000);
        fetchTask();
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          setUploadError(data.error ?? 'อัปโหลดไม่สำเร็จ');
        } catch {
          setUploadError('อัปโหลดไม่สำเร็จ');
        }
      }
    };
    xhr.onerror = () => {
      setUploadProgress(null);
      setUploadError('เกิดข้อผิดพลาดในการอัปโหลด');
    };
    xhr.send(formData);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Determine if file upload should show
  function canUploadFile(): boolean {
    if (!task) return false;
    const s = task.status;
    const submitFrom: TaskStatus[] = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];
    if (userRoles.includes('STAFF') && task.officer_id === userId && submitFrom.includes(s)) return true;
    if (userRoles.includes('DOCCON') && s === 'SUBMITTED_TO_DOCCON') return true;
    return false;
  }

  // Reassign handlers
  async function openReassign(target: 'officer' | 'reviewer') {
    setReassignTarget(target);
    setSelectedStaffId('');
    if (staffList.length === 0) {
      setStaffLoading(true);
      try {
        const res = await fetch('/api/tasks/staff-list');
        if (res.ok) setStaffList(await res.json());
      } catch {
        // ignore
      } finally {
        setStaffLoading(false);
      }
    }
  }

  async function handleReassign() {
    if (!task || !reassignTarget || !selectedStaffId) return;
    setReassignLoading(true);
    try {
      const field = reassignTarget === 'officer' ? 'officer_id' : 'reviewer_id';
      const res = await fetch(`/api/tasks/${task.id}/reassign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, new_user_id: selectedStaffId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'เกิดข้อผิดพลาด');
      setReassignTarget(null);
      setSelectedStaffId('');
      setSuccessMsg(`โอนงานเรียบร้อย`);
      setTimeout(() => setSuccessMsg(''), 4000);
      fetchTask();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setReassignLoading(false);
    }
  }

  const isBossOwner = task && userRoles.includes('BOSS') && task.created_by === userId && !['COMPLETED', 'CANCELLED'].includes(task.status);
  const filteredStaffForReassign = reassignTarget === 'officer'
    ? staffList.filter((s) => s.roles?.includes('STAFF'))
    : staffList.filter((s) => s.roles?.includes('REVIEWER'));

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-slate-200 rounded" />
        <div className="h-4 w-3/4 bg-slate-100 rounded" />
        <div className="h-32 bg-slate-100 rounded-xl" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <p className="text-4xl mb-4">🔍</p>
        <p className="text-slate-500">ไม่พบงาน</p>
        <Link href="/tracking" className="mt-4 inline-block text-sm text-yellow-600 hover:underline">← กลับหน้าหลัก</Link>
      </div>
    );
  }

  const availableActions = getActions(task, userRoles, userId);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <Link href="/tracking" className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1 mb-4">
        ← กลับหน้าติดตามเอกสาร
      </Link>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs text-slate-400 font-mono">{task.task_code}</p>
              <AgeChip createdAt={task.created_at} />
            </div>
            <h1 className="text-xl font-bold text-slate-800">{task.title}</h1>
            {task.doc_ref && <p className="text-sm text-slate-500 mt-1">เลขที่: <span className="font-medium">{task.doc_ref}</span></p>}
          </div>
          <StatusBadge status={task.status} />
        </div>
      </div>

      {/* Success toast */}
      {successMsg && (
        <div className="bg-green-50 border border-green-300 text-green-800 rounded-xl px-4 py-3 text-sm mb-4 flex items-center gap-2">
          ✅ {successMsg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-4">
        {(['detail', 'files', 'timeline', 'comments'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`py-2.5 px-5 text-sm border-b-2 -mb-px transition-colors ${tab === t ? 'border-yellow-400 text-slate-900 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t === 'detail' ? 'รายละเอียด' : t === 'files' ? `ประวัติไฟล์ ${(task.file_history?.length ?? 0) > 0 ? `(${task.file_history?.length})` : ''}` : t === 'timeline' ? 'ประวัติสถานะ' : `ความคิดเห็น ${(task.comment_history?.length ?? 0) > 0 ? `(${task.comment_history?.length})` : ''}`}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        {/* Detail */}
        {tab === 'detail' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-400 mb-0.5">ผู้รับผิดชอบ</p>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{task.officer?.display_name ?? '—'}</p>
                  {isBossOwner && (
                    <button onClick={() => openReassign('officer')}
                      className="text-xs text-yellow-600 hover:text-yellow-700 border border-yellow-300 rounded px-1.5 py-0.5 hover:bg-yellow-50 transition-colors">
                      โอนงาน
                    </button>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">ผู้ตรวจสอบ</p>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{task.reviewer?.display_name ?? '—'}</p>
                  {isBossOwner && (
                    <button onClick={() => openReassign('reviewer')}
                      className="text-xs text-yellow-600 hover:text-yellow-700 border border-yellow-300 rounded px-1.5 py-0.5 hover:bg-yellow-50 transition-colors">
                      โอนงาน
                    </button>
                  )}
                </div>
              </div>
              <div><p className="text-xs text-slate-400 mb-0.5">ผู้สร้างงาน</p><p className="font-medium">{task.creator?.display_name ?? '—'}</p></div>
              <div><p className="text-xs text-slate-400 mb-0.5">อัปเดตล่าสุด</p><p className="text-slate-600">{formatDT(task.updated_at)}</p></div>
              {task.completed_at && (
                <div className="col-span-2"><p className="text-xs text-slate-400 mb-0.5">เสร็จสมบูรณ์</p><p className="text-green-700 font-medium">{formatDT(task.completed_at)}</p></div>
              )}
            </div>

            {/* Reassign panel */}
            {reassignTarget && (
              <div className="border border-yellow-300 bg-yellow-50 rounded-xl p-4 space-y-3">
                <p className="text-sm font-medium text-slate-800">
                  โอนงาน ({reassignTarget === 'officer' ? 'ผู้รับผิดชอบ' : 'ผู้ตรวจสอบ'})
                </p>
                {staffLoading ? (
                  <p className="text-xs text-slate-500">กำลังโหลดรายชื่อ...</p>
                ) : (
                  <select value={selectedStaffId} onChange={e => setSelectedStaffId(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400">
                    <option value="">-- เลือกบุคลากร --</option>
                    {filteredStaffForReassign.map(s => (
                      <option key={s.id} value={s.id}>{s.display_name} ({s.email})</option>
                    ))}
                  </select>
                )}
                <div className="flex gap-2">
                  <button onClick={handleReassign} disabled={reassignLoading || !selectedStaffId}
                    className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-sm rounded-lg disabled:opacity-50 font-medium">
                    {reassignLoading ? 'กำลังโอน...' : 'ยืนยันโอนงาน'}
                  </button>
                  <button onClick={() => setReassignTarget(null)}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}

            {task.detail && (
              <div><p className="text-xs text-slate-400 mb-1">รายละเอียด</p><p className="text-sm bg-slate-50 rounded-lg p-3">{task.detail}</p></div>
            )}
            {task.drive_file_name && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                <span className="text-blue-500">📎</span>
                <a href={`https://drive.google.com/file/d/${task.drive_file_id}/view`} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-blue-700 hover:underline">{task.drive_file_name}</a>
              </div>
            )}

            {/* Ref PDF display */}
            {task.ref_file_name && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <span className="text-amber-500">📄</span>
                <a href={`https://drive.google.com/file/d/${task.ref_file_id}/view`} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-amber-700 hover:underline">{task.ref_file_name}</a>
                <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                  ไฟล์อ้างอิง (PDF)
                </span>
              </div>
            )}

            {/* File upload zone */}
            {canUploadFile() && (
              <div className="space-y-2">
                <p className="text-xs text-slate-400 font-medium">อัปโหลดไฟล์</p>
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${isDragging ? 'border-yellow-400 bg-yellow-50' : 'border-slate-300 hover:border-slate-400 bg-slate-50'}`}
                >
                  <input ref={fileInputRef} type="file" accept=".docx,.pdf" onChange={handleFileInputChange} className="hidden" />
                  <p className="text-sm text-slate-500">
                    ลากไฟล์มาวาง หรือ <span className="text-yellow-600 font-medium">คลิกเพื่อเลือกไฟล์</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-1">รองรับ .docx, .pdf (สูงสุด {MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL})</p>
                </div>
                {uploadProgress !== null && (
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div className="bg-yellow-400 h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
                {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
              </div>
            )}

            {/* DocCon checklist for completed tasks */}
            {task.status === 'COMPLETED' && userRoles.includes('DOCCON') && (
              <div className="border border-green-200 bg-green-50 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-green-700 flex items-center gap-1.5">
                  ✅ รายการตรวจหลังเสร็จสมบูรณ์ {checklistSaving && <span className="text-slate-400 text-[10px]">กำลังบันทึก...</span>}
                </p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={checklistDriveUploaded} onChange={async (e) => {
                    const val = e.target.checked;
                    setChecklistDriveUploaded(val);
                    setChecklistSaving(true);
                    try {
                      await fetch(`/api/tasks/${task.id}/checklist`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ drive_uploaded: val, sent_to_branch: checklistSentToBranch }),
                      });
                      fetchTask();
                    } finally { setChecklistSaving(false); }
                  }} className="rounded border-slate-300 text-green-600 focus:ring-green-500" />
                  <span className="text-sm text-slate-700">อัปโหลดลง Drive เรียบร้อย</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={checklistSentToBranch} onChange={async (e) => {
                    const val = e.target.checked;
                    setChecklistSentToBranch(val);
                    setChecklistSaving(true);
                    try {
                      await fetch(`/api/tasks/${task.id}/checklist`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ drive_uploaded: checklistDriveUploaded, sent_to_branch: val }),
                      });
                      fetchTask();
                    } finally { setChecklistSaving(false); }
                  }} className="rounded border-slate-300 text-green-600 focus:ring-green-500" />
                  <span className="text-sm text-slate-700">ส่งสำเนาให้หน่วยงานแล้ว</span>
                </label>
              </div>
            )}

            {/* Actions */}
            {availableActions.length > 0 && (
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-medium text-slate-500 mb-3">การดำเนินการ</p>
                <div className="flex flex-wrap gap-2">
                  {availableActions.map(a => (
                    <button key={a.action} onClick={async () => {
                      setPendingAction(a); setActionError(''); setPreCheckResult(null);
                      if (a.action === 'super_boss_approve' && task.doc_ref) {
                        setPreCheckLoading(true);
                        try {
                          const res = await fetch(`/api/tasks/${task.id}/pre-check`);
                          if (res.ok) setPreCheckResult(await res.json());
                        } catch { /* ignore */ } finally { setPreCheckLoading(false); }
                      }
                    }}
                      className={`px-4 py-2 text-sm rounded-lg transition-colors ${STYLE_MAP[a.style]}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {pendingAction && (
              <div className="border border-yellow-300 bg-yellow-50 rounded-xl p-4 space-y-3">
                <p className="text-sm font-medium text-slate-800">ยืนยัน: {pendingAction.label}</p>
                {pendingAction.confirmText && <p className="text-xs text-slate-600">{pendingAction.confirmText}</p>}
                {/* SuperBoss pre-check warning */}
                {pendingAction.action === 'super_boss_approve' && preCheckLoading && (
                  <p className="text-xs text-slate-400">กำลังตรวจสอบเอกสารซ้ำ...</p>
                )}
                {pendingAction.action === 'super_boss_approve' && preCheckResult?.hasDuplicate && (
                  <div className="bg-orange-50 border border-orange-300 rounded-lg p-3">
                    <p className="text-xs font-medium text-orange-700">⚠️ พบเอกสารที่มีเลขที่เดียวกันในระบบแล้ว</p>
                    {preCheckResult.existingTask && (
                      <p className="text-xs text-orange-600 mt-1">
                        {preCheckResult.existingTask.task_code} — {preCheckResult.existingTask.title}
                      </p>
                    )}
                  </div>
                )}
                {pendingAction.needsDocRef && (
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">เลขที่เอกสาร (doc_ref)</label>
                    <input type="text" value={docRef} onChange={e => setDocRef(e.target.value)} placeholder="เช่น QP-001-2025"
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                    {docRef.trim() && (
                      <div className="mt-1">
                        {docRefChecking && <p className="text-xs text-slate-400">กำลังตรวจสอบ...</p>}
                        {!docRefChecking && docRefExists === true && (
                          <p className="text-xs text-orange-600">⚠️ เลขที่เอกสารนี้มีอยู่แล้วในระบบ</p>
                        )}
                        {!docRefChecking && docRefExists === false && (
                          <p className="text-xs text-green-600">✓ เลขที่เอกสารนี้สามารถใช้ได้</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {pendingAction.needsComment && (
                  <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="หมายเหตุ"
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none" />
                )}
                {actionError && <p className="text-xs text-red-600">{actionError}</p>}
                <div className="flex gap-2">
                  <button onClick={handleAction} disabled={actionLoading}
                    className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-sm rounded-lg disabled:opacity-50 font-medium">
                    {actionLoading ? 'กำลังดำเนินการ...' : 'ยืนยัน'}
                  </button>
                  <button onClick={() => { setPendingAction(null); setActionError(''); }}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* File History Tab */}
        {tab === 'files' && (
          <div className="space-y-3">
            {(task.file_history ?? []).length === 0 ? (
              <p className="text-sm text-slate-400 italic text-center py-4">ยังไม่มีประวัติไฟล์</p>
            ) : (
              [...(task.file_history ?? [])].reverse().map((f, idx) => (
                <div key={idx} className="flex items-center gap-3 bg-slate-50 rounded-lg p-3">
                  <span className="text-blue-500 text-lg">📄</span>
                  <div className="flex-1 min-w-0">
                    <a href={`https://drive.google.com/file/d/${f.driveFileId}/view`} target="_blank" rel="noopener noreferrer"
                      className="text-sm font-medium text-blue-700 hover:underline truncate block">{f.fileName}</a>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-500">{f.uploadedByName}</span>
                      <span className="text-xs text-slate-400">{formatDT(f.uploadedAt)}</span>
                    </div>
                  </div>
                  {f.isPdf && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">PDF</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Timeline */}
        {tab === 'timeline' && (
          <StatusTimeline
            history={task.status_history ?? []}
            currentStatus={task.status}
            updatedAt={task.updated_at}
            completedAt={task.completed_at}
          />
        )}

        {/* Comments */}
        {tab === 'comments' && (
          <div className="space-y-4">
            {(task.comment_history ?? []).length === 0 ? (
              <p className="text-sm text-slate-400 italic text-center py-4">ยังไม่มีความคิดเห็น</p>
            ) : (
              <div className="space-y-3">
                {[...(task.comment_history ?? [])].reverse().map((c, idx) => (
                  <div key={idx} className="bg-slate-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-slate-700">{c.byName}</span>
                      <span className="text-xs text-slate-400">{formatDT(c.at)}</span>
                    </div>
                    <p className="text-sm text-slate-800">{c.text}</p>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAddComment} className="flex gap-2 pt-3 border-t border-slate-100">
              <input type="text" value={newComment} onChange={e => setNewComment(e.target.value)}
                placeholder="เพิ่มความคิดเห็น..."
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
              <button type="submit" disabled={commentLoading || !newComment.trim()}
                className="px-4 py-2 bg-slate-800 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-slate-900">ส่ง</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
