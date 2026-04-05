'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import StatusBadge from '../components/StatusBadge';
import StatusTimeline from '../components/StatusTimeline';
import type { Task } from '../components/TaskCard';
import type { AppRole } from '@/lib/auth/guards';
import type { TaskStatus } from '@/lib/constants/status';

type ActionKey =
  | 'submit' | 'doccon_approve' | 'doccon_reject'
  | 'reviewer_approve' | 'reviewer_reject'
  | 'boss_approve' | 'boss_reject' | 'boss_send_to_doccon'
  | 'super_boss_approve' | 'super_boss_reject' | 'super_boss_send_to_doccon'
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

export default function TaskDetailPage({ taskId, userRoles, userId }: { taskId: string; userRoles: AppRole[]; userId: string }) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'detail' | 'timeline' | 'comments'>('detail');
  const [pendingAction, setPendingAction] = useState<ActionDef | null>(null);
  const [comment, setComment] = useState('');
  const [docRef, setDocRef] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [newComment, setNewComment] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const fetchTask = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}`);
    if (res.ok) setTask(await res.json());
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetchTask(); }, [fetchTask]);

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
            <p className="text-xs text-slate-400 font-mono mb-1">{task.task_code}</p>
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
        {(['detail', 'timeline', 'comments'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`py-2.5 px-5 text-sm border-b-2 -mb-px transition-colors ${tab === t ? 'border-yellow-400 text-slate-900 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t === 'detail' ? 'รายละเอียด' : t === 'timeline' ? 'ประวัติสถานะ' : `ความคิดเห็น ${(task.comment_history?.length ?? 0) > 0 ? `(${task.comment_history?.length})` : ''}`}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        {/* Detail */}
        {tab === 'detail' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-slate-400 mb-0.5">ผู้รับผิดชอบ</p><p className="font-medium">{task.officer?.display_name ?? '—'}</p></div>
              <div><p className="text-xs text-slate-400 mb-0.5">ผู้ตรวจสอบ</p><p className="font-medium">{task.reviewer?.display_name ?? '—'}</p></div>
              <div><p className="text-xs text-slate-400 mb-0.5">ผู้สร้างงาน</p><p className="font-medium">{task.creator?.display_name ?? '—'}</p></div>
              <div><p className="text-xs text-slate-400 mb-0.5">อัปเดตล่าสุด</p><p className="text-slate-600">{formatDT(task.updated_at)}</p></div>
              {task.completed_at && (
                <div className="col-span-2"><p className="text-xs text-slate-400 mb-0.5">เสร็จสมบูรณ์</p><p className="text-green-700 font-medium">{formatDT(task.completed_at)}</p></div>
              )}
            </div>
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

            {/* Actions */}
            {availableActions.length > 0 && (
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-medium text-slate-500 mb-3">การดำเนินการ</p>
                <div className="flex flex-wrap gap-2">
                  {availableActions.map(a => (
                    <button key={a.action} onClick={() => { setPendingAction(a); setActionError(''); }}
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
                {pendingAction.needsDocRef && (
                  <input type="text" value={docRef} onChange={e => setDocRef(e.target.value)} placeholder="เลขที่เอกสาร (doc_ref)"
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
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

        {/* Timeline */}
        {tab === 'timeline' && <StatusTimeline history={task.status_history ?? []} />}

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
