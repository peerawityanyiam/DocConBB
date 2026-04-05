'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import TaskCard, { type Task } from './TaskCard';
import CreateTaskModal from './CreateTaskModal';
import TaskDetailModal from './TaskDetailModal';
import type { AppRole } from '@/lib/auth/guards';

interface TrackingDashboardProps {
  userRoles: AppRole[];
  userId: string;
  userEmail: string;
}

const ROLE_TABS: { role: AppRole; label: string }[] = [
  { role: 'STAFF', label: 'งานของฉัน' },
  { role: 'DOCCON', label: 'ตรวจรูปแบบ' },
  { role: 'REVIEWER', label: 'ตรวจเนื้อหา' },
  { role: 'BOSS', label: 'งานในฝ่าย' },
  { role: 'SUPER_BOSS', label: 'รออนุมัติ' },
];

export default function TrackingDashboard({ userRoles, userId, userEmail }: TrackingDashboardProps) {
  // Pick first available tab by priority
  const availableTabs = ROLE_TABS.filter(t => userRoles.includes(t.role));
  const [activeRole, setActiveRole] = useState<AppRole | null>(availableTabs[0]?.role ?? null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!activeRole) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?role=${activeRole}`);
      if (res.ok) setTasks(await res.json());
    } finally {
      setLoading(false);
    }
  }, [activeRole]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('tasks-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        fetchTasks();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchTasks]);

  const filtered = tasks.filter(t =>
    !search.trim()
    || t.title.toLowerCase().includes(search.toLowerCase())
    || t.task_code.toLowerCase().includes(search.toLowerCase())
    || (t.doc_ref ?? '').toLowerCase().includes(search.toLowerCase())
  );

  if (availableTabs.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <div className="bg-white rounded-2xl border border-slate-200 p-10">
          <p className="text-4xl mb-4">🔒</p>
          <h2 className="text-lg font-semibold text-slate-700 mb-2">ยังไม่มีสิทธิ์เข้าถึงระบบนี้</h2>
          <p className="text-sm text-slate-500">กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดสิทธิ์</p>
          <p className="text-xs text-slate-400 mt-2">{userEmail}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ระบบติดตามเอกสาร</h1>
          <p className="text-sm text-slate-500 mt-0.5">{userEmail}</p>
        </div>
        {userRoles.includes('BOSS') && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-semibold text-sm rounded-lg transition-colors shadow-sm">
            <span className="text-base leading-none">+</span>
            สร้างงานใหม่
          </button>
        )}
      </div>

      {/* Role Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-5 overflow-x-auto">
        {availableTabs.map(t => (
          <button key={t.role} onClick={() => setActiveRole(t.role)}
            className={`flex-1 min-w-max px-4 py-2 text-sm rounded-lg font-medium transition-colors whitespace-nowrap ${
              activeRole === t.role
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาชื่องาน, รหัสงาน, เลขที่เอกสาร..."
          className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">✕</button>
        )}
      </div>

      {/* Task Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 animate-pulse">
              <div className="h-3 w-20 bg-slate-100 rounded" />
              <div className="h-4 w-3/4 bg-slate-100 rounded" />
              <div className="h-3 w-1/2 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p className="text-3xl mb-3">{search ? '🔍' : '📭'}</p>
          <p className="text-slate-500 text-sm">
            {search ? `ไม่พบงานที่ตรงกับ "${search}"` : 'ไม่มีงานในขณะนี้'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400 mb-3">{filtered.length} รายการ</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.map(task => (
              <TaskCard key={task.id} task={task} onClick={t => setSelectedTaskId(t.id)} />
            ))}
          </div>
        </>
      )}

      {/* Modals */}
      <CreateTaskModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={fetchTasks}
      />
      <TaskDetailModal
        taskId={selectedTaskId}
        userRoles={userRoles}
        userId={userId}
        onClose={() => setSelectedTaskId(null)}
        onUpdated={fetchTasks}
      />
    </div>
  );
}
