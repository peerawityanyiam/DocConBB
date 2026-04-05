'use client';

import { useState, useEffect, useCallback } from 'react';
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
  primary: 'bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-semibold',
  danger: 'bg-red-500 hover:bg-red-600 text-white font-semibold',
  secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-700',
  warning: 'bg-orange-400 hover:bg-orange-500 text-white font-semibold',
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
  });
}

export default function TaskDetailModal({ taskId, userRoles, userId, onClose, onUpdated }: TaskDetailModalProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'detail' | 'timeline' | 'comments'>('detail');
  const [pendingAction, setPendingAction] = useState<ActionDef | null>(null);
  const [comment, setComment] = useState('');
  const [docRef, setDocRef] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [newComment, setNewComment] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);

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
    fetchTask();
  }, [fetchTask]);

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

  if (!taskId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            {task ? (
              <>
                <p className="text-xs text-slate-400 font-mono">{task.task_code}</p>
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
        <div className="flex border-b border-slate-200 px-6 shrink-0">
          {(['detail', 'timeline', 'comments'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`py-2.5 px-4 text-sm border-b-2 -mb-px transition-colors ${tab === t ? 'border-yellow-400 text-slate-900 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t === 'detail' ? 'รายละเอียด' : t === 'timeline' ? 'ประวัติสถานะ' : 'ความคิดเห็น'}
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
                    <div>
                      <p className="text-slate-500 text-xs mb-0.5">ผู้รับผิดชอบ</p>
                      <p className="font-medium text-slate-800">{task.officer?.display_name ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-0.5">ผู้ตรวจสอบ</p>
                      <p className="font-medium text-slate-800">{task.reviewer?.display_name ?? '—'}</p>
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

                  {task.drive_file_name && (
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <span className="text-blue-500">📎</span>
                      <div>
                        <p className="text-xs text-slate-500">ไฟล์แนบ</p>
                        <p className="text-sm font-medium text-blue-700">{task.drive_file_name}</p>
                      </div>
                    </div>
                  )}

                  {/* Checklist indicators */}
                  <div className="flex gap-4 text-xs">
                    <span className={task.doccon_checked ? 'text-green-600' : 'text-slate-400'}>
                      {task.doccon_checked ? '✅' : '⬜'} ตรวจรูปแบบแล้ว
                    </span>
                  </div>

                  {/* Actions */}
                  {(() => {
                    const availableActions = getAvailableActions(task, userRoles, userId);
                    if (!availableActions.length) return null;
                    return (
                      <div className="border-t border-slate-100 pt-4">
                        <p className="text-xs font-medium text-slate-500 mb-3">การดำเนินการ</p>
                        <div className="flex flex-wrap gap-2">
                          {availableActions.map(a => (
                            <button key={a.action} onClick={() => { setPendingAction(a); setActionError(''); }}
                              className={`px-4 py-2 text-sm rounded-lg transition-colors ${ACTION_STYLE[a.style]}`}>
                              {a.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Action confirm panel */}
                  {pendingAction && (
                    <div className="border border-yellow-300 bg-yellow-50 rounded-xl p-4 space-y-3">
                      <p className="text-sm font-medium text-slate-800">ยืนยัน: {pendingAction.label}</p>
                      {pendingAction.confirmText && (
                        <p className="text-xs text-slate-600">{pendingAction.confirmText}</p>
                      )}
                      {pendingAction.needsDocRef && (
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">เลขที่เอกสาร (doc_ref)</label>
                          <input type="text" value={docRef} onChange={e => setDocRef(e.target.value)}
                            placeholder="เช่น QP-001-2025"
                            className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                        </div>
                      )}
                      {pendingAction.needsComment && (
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">หมายเหตุ</label>
                          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
                            placeholder="ระบุเหตุผลหรือหมายเหตุ"
                            className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none" />
                        </div>
                      )}
                      {actionError && <p className="text-xs text-red-600">{actionError}</p>}
                      <div className="flex gap-2">
                        <button onClick={handleAction} disabled={actionLoading}
                          className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-sm rounded-lg disabled:opacity-50 font-medium transition-colors">
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

              {/* Timeline Tab */}
              {tab === 'timeline' && (
                <StatusTimeline history={task.status_history ?? []} />
              )}

              {/* Comments Tab */}
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
                            <span className="text-xs text-slate-400">{formatDateTime(c.at)}</span>
                          </div>
                          <p className="text-sm text-slate-800">{c.text}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <form onSubmit={handleAddComment} className="flex gap-2 pt-3 border-t border-slate-100">
                    <input
                      type="text"
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      placeholder="เพิ่มความคิดเห็น..."
                      className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    />
                    <button type="submit" disabled={commentLoading || !newComment.trim()}
                      className="px-4 py-2 bg-slate-800 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-slate-900 transition-colors">
                      ส่ง
                    </button>
                  </form>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
