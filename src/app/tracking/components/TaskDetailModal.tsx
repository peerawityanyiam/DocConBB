'use client';

import { useState, useEffect, useCallback } from 'react';
import StatusBadge from './StatusBadge';
import StatusTimeline from './StatusTimeline';
import type { Task } from './TaskCard';
import type { AppRole } from '@/lib/auth/guards';

interface TaskDetailModalProps {
  taskId: string | null;
  userRoles: AppRole[];
  userId: string;
  onClose: () => void;
  onUpdated: () => void;
}

interface StaffUser {
  id: string;
  display_name: string;
  roles: string[];
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}

const REOPEN_ROLE_LABEL_BY_NOTE_PREFIX: Record<string, string> = {
  'reopenFromCompletedBy:DOCCON': 'DocCon',
  'reopenFromCompletedBy:BOSS': 'ผู้สั่งงาน',
  'reopenFromCompletedBy:SUPER_BOSS': 'หัวหน้างาน',
};

function parseReopenNote(note?: string): { roleLabel: string; reason?: string } | null {
  if (!note) return null;
  const prefix = Object.keys(REOPEN_ROLE_LABEL_BY_NOTE_PREFIX).find((key) => note.startsWith(key));
  if (!prefix) return null;
  const reasonPrefix = '|reason:';
  const reasonIndex = note.indexOf(reasonPrefix);
  const reason = reasonIndex >= 0 ? note.slice(reasonIndex + reasonPrefix.length).trim() : '';
  return {
    roleLabel: REOPEN_ROLE_LABEL_BY_NOTE_PREFIX[prefix],
    reason: reason || undefined,
  };
}

function calcAgeDays(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

export default function TaskDetailModal({ taskId, userRoles, userId, onClose, onUpdated }: TaskDetailModalProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'detail' | 'files' | 'timeline'>('detail');

  const [reassignField, setReassignField] = useState<'officer_id' | 'reviewer_id' | null>(null);
  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [staffListLoading, setStaffListLoading] = useState(false);
  const [reassignLoading, setReassignLoading] = useState(false);
  const [reassignError, setReassignError] = useState('');

  const [bossCancelReason, setBossCancelReason] = useState('');
  const [bossCancelLoading, setBossCancelLoading] = useState(false);
  const [bossCancelError, setBossCancelError] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [reopenLoadingAction, setReopenLoadingAction] = useState<
    'doccon_reopen_completed' | 'boss_reopen_completed' | 'super_boss_reopen_completed' | null
  >(null);
  const [reopenError, setReopenError] = useState('');

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
    setReassignField(null);
    setReassignError('');
    setBossCancelReason('');
    setBossCancelLoading(false);
    setBossCancelError('');
    setReopenReason('');
    setReopenLoadingAction(null);
    setReopenError('');
    void fetchTask();
  }, [fetchTask]);

  async function handleBossCancelFromDetail() {
    if (!task) return;
    if (!bossCancelReason.trim()) {
      setBossCancelError('กรุณาระบุเหตุผลการยกเลิกงาน');
      return;
    }

    setBossCancelLoading(true);
    setBossCancelError('');
    try {
      const res = await fetch(`/api/tasks/${task.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel',
          comment: bossCancelReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'เกิดข้อผิดพลาด');

      setBossCancelReason('');
      onUpdated();
      await fetchTask();
    } catch (err) {
      setBossCancelError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setBossCancelLoading(false);
    }
  }

  async function openReassign(field: 'officer_id' | 'reviewer_id') {
    setReassignField(field);
    setReassignError('');
    setStaffListLoading(true);
    try {
      const res = await fetch('/api/tasks/staff-list');
      if (res.ok) setStaffList(await res.json());
    } finally {
      setStaffListLoading(false);
    }
  }

  async function handleReassign(newUserId: string) {
    if (!task || !reassignField) return;
    setReassignLoading(true);
    setReassignError('');
    try {
      const res = await fetch(`/api/tasks/${task.id}/reassign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: reassignField, new_user_id: newUserId }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) throw new Error(data.error ?? 'โอนงานไม่สำเร็จ');

      setReassignField(null);
      onUpdated();
      await fetchTask();
    } catch (err) {
      setReassignError(err instanceof Error ? err.message : 'โอนงานไม่สำเร็จ');
    } finally {
      setReassignLoading(false);
    }
  }

  async function handleReopenCompleted(
    action: 'doccon_reopen_completed' | 'boss_reopen_completed' | 'super_boss_reopen_completed'
  ) {
    if (!task) return;
    if (!reopenReason.trim()) {
      setReopenError('กรุณาระบุเหตุผลการดึงงานกลับมาแก้ไข');
      return;
    }

    setReopenLoadingAction(action);
    setReopenError('');
    try {
      const res = await fetch(`/api/tasks/${task.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          comment: reopenReason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) throw new Error(data.error ?? 'ดึงงานกลับมาแก้ไขไม่สำเร็จ');

      setReopenReason('');
      onUpdated();
      await fetchTask();
    } catch (err) {
      setReopenError(err instanceof Error ? err.message : 'ดึงงานกลับมาแก้ไขไม่สำเร็จ');
    } finally {
      setReopenLoadingAction(null);
    }
  }

  if (!taskId) return null;

  const ageDays = task ? calcAgeDays(task.created_at) : 0;
  const ageColor = ageDays > 14 ? 'bg-red-100 text-red-700' : ageDays > 7 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600';
  const isSupersededCompleted = !!task && task.status === 'COMPLETED' && !!task.superseded_by;

  const canReassign = !!task &&
    userRoles.includes('BOSS') &&
    task.created_by === userId &&
    !['COMPLETED', 'CANCELLED'].includes(task.status);
  const canDocconReopenCompleted = !!task && task.status === 'COMPLETED' && userRoles.includes('DOCCON');
  const canBossReopenCompleted =
    !!task &&
    task.status === 'COMPLETED' &&
    userRoles.includes('BOSS') &&
    task.created_by === userId;
  const canSuperBossReopenCompleted = !!task && task.status === 'COMPLETED' && userRoles.includes('SUPER_BOSS');
  const canReopenCompleted = canDocconReopenCompleted || canBossReopenCompleted || canSuperBossReopenCompleted;
  const latestReopenInfo = (() => {
    if (!task?.status_history?.length) return null;
    const history = task.status_history.slice().reverse();
    for (const entry of history) {
      const parsed = parseReopenNote(entry.note);
      if (parsed) {
        return {
          ...parsed,
          changedAt: entry.changedAt,
        };
      }
    }
    return null;
  })();

  const filteredStaffForReassign = reassignField === 'officer_id'
    ? staffList.filter(u => u.roles?.includes('STAFF'))
    : staffList.filter(u => u.roles?.includes('REVIEWER'));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            {task ? (
              <>
                <div className="flex items-center gap-2 mb-0.5">
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

        <div className="flex border-b border-[#e2e8f0] px-6 shrink-0">
          {(['detail', 'files', 'timeline'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2 px-4 text-[0.8rem] font-semibold border-b-2 -mb-px transition-colors ${tab === t ? 'border-[#00c2a8] text-[#00c2a8]' : 'border-transparent text-[#6b7f96] hover:text-[#374f6b] hover:border-[#e2e8f0]'}`}
            >
              {t === 'detail' ? 'รายละเอียด' : t === 'files' ? 'ประวัติไฟล์' : 'ประวัติสถานะ'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && !task ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />)}
            </div>
          ) : !task ? (
            <p className="text-slate-400 text-sm text-center py-8">ไม่พบข้อมูลงาน</p>
          ) : (
            <>
              {tab === 'detail' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4 text-sm">
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
                            <div className="space-y-2">
                              <div className="border border-slate-200 rounded-lg overflow-hidden">
                                <select
                                  className="w-full text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                  defaultValue=""
                                  onChange={e => { if (e.target.value) void handleReassign(e.target.value); }}
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
                              {reassignError && <p className="text-xs text-red-600">⚠️ {reassignError}</p>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

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
                            <div className="space-y-2">
                              <div className="border border-slate-200 rounded-lg overflow-hidden">
                                <select
                                  className="w-full text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                  defaultValue=""
                                  onChange={e => { if (e.target.value) void handleReassign(e.target.value); }}
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
                              {reassignError && <p className="text-xs text-red-600">⚠️ {reassignError}</p>}
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

                  {(task.detail || latestReopenInfo) && (
                    <div>
                      <p className="text-slate-500 text-xs mb-1">รายละเอียด</p>
                      <div className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 space-y-1.5">
                        {task.detail && <p>{task.detail}</p>}
                        {latestReopenInfo && (
                          <p className="text-amber-700">
                            #{latestReopenInfo.roleLabel} ดึงกลับมาแก้ไข ({formatDateTime(latestReopenInfo.changedAt)})
                            {latestReopenInfo.reason ? ` เพราะ ${latestReopenInfo.reason}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {isSupersededCompleted && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-3 text-sm">
                      มีเอกสารใหม่ทับรหัสเดียวกันแล้ว จึงไม่อนุญาตให้โหลด Word จากรายการนี้
                    </div>
                  )}

                  {task.drive_file_name && (
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <span className="text-blue-500">📎</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-500">ไฟล์แนบ</p>
                        {task.drive_file_id && !isSupersededCompleted ? (
                          <a
                            href={`https://drive.google.com/file/d/${task.drive_file_id}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline truncate block"
                          >
                            {task.drive_file_name}
                          </a>
                        ) : isSupersededCompleted ? (
                          <p className="text-sm font-medium text-slate-500 truncate">{task.drive_file_name} (ไม่อนุญาตให้โหลด)</p>
                        ) : (
                          <p className="text-sm font-medium text-blue-700 truncate">{task.drive_file_name}</p>
                        )}
                      </div>
                    </div>
                  )}

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

                  {canReopenCompleted && (
                    <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-amber-800">ดึงงานที่เสร็จแล้วกลับมาแก้ไข</p>
                        <span className="text-[11px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                          ต้องระบุเหตุผล
                        </span>
                      </div>
                      <p className="text-xs text-amber-700">
                        ใช้เมื่อจำเป็นต้องแก้เอกสารหลังงานเสร็จแล้วเท่านั้น
                      </p>
                      <textarea
                        value={reopenReason}
                        onChange={(e) => {
                          setReopenReason(e.target.value);
                          if (reopenError) setReopenError('');
                        }}
                        placeholder="ระบุเหตุผลที่ต้องดึงงานกลับมาแก้ไข"
                        rows={2}
                        className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 resize-none"
                      />
                      {reopenError && <p className="text-xs text-red-600">⚠️ {reopenError}</p>}
                      <div className="flex flex-wrap gap-2 justify-end">
                        {canDocconReopenCompleted && (
                          <button
                            onClick={() => void handleReopenCompleted('doccon_reopen_completed')}
                            disabled={reopenLoadingAction !== null || !reopenReason.trim()}
                            className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {reopenLoadingAction === 'doccon_reopen_completed'
                              ? 'กำลังดึงกลับ...'
                              : 'ดึงงานกลับ (doccon)'}
                          </button>
                        )}
                        {canBossReopenCompleted && (
                          <button
                            onClick={() => void handleReopenCompleted('boss_reopen_completed')}
                            disabled={reopenLoadingAction !== null || !reopenReason.trim()}
                            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {reopenLoadingAction === 'boss_reopen_completed'
                              ? 'กำลังดึงกลับ...'
                              : 'ดึงงานกลับ (ผู้สั่งงาน)'}
                          </button>
                        )}
                        {canSuperBossReopenCompleted && (
                          <button
                            onClick={() => void handleReopenCompleted('super_boss_reopen_completed')}
                            disabled={reopenLoadingAction !== null || !reopenReason.trim()}
                            className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {reopenLoadingAction === 'super_boss_reopen_completed'
                              ? 'กำลังดึงกลับ...'
                              : 'ดึงงานกลับ (หัวหน้างาน)'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {canReassign && (
                    <div className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
                      <p className="text-sm font-semibold text-red-700">ยกเลิกงาน (ผู้สั่งงาน)</p>
                      <textarea
                        value={bossCancelReason}
                        onChange={e => {
                          setBossCancelReason(e.target.value);
                          if (bossCancelError) setBossCancelError('');
                        }}
                        placeholder="ระบุเหตุผล เช่น สั่งงานผิดคน / สร้างงานซ้ำ"
                        rows={2}
                        className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 resize-none"
                      />
                      {bossCancelError && <p className="text-xs text-red-600">⚠️ {bossCancelError}</p>}
                      <div className="flex justify-end">
                        <button
                          onClick={() => void handleBossCancelFromDetail()}
                          disabled={bossCancelLoading || !bossCancelReason.trim()}
                          className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {bossCancelLoading ? 'กำลังยกเลิก...' : '🗑 ยกเลิกงาน'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tab === 'files' && (
                <div className="space-y-3">
                  {isSupersededCompleted ? (
                    <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-3 text-sm">
                      ปิดลิงก์ดาวน์โหลดไฟล์จากการ์ดเก่า เนื่องจากมีเอกสารใหม่แล้ว
                    </div>
                  ) : (task.file_history ?? []).length === 0 ? (
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

              {tab === 'timeline' && (
                <StatusTimeline
                  history={task.status_history ?? []}
                  currentStatus={task.status}
                  updatedAt={task.updated_at}
                  completedAt={task.completed_at}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
