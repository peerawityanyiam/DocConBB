'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import TaskCard, { type Task } from './TaskCard';
import CreateTaskModal from './CreateTaskModal';
import TaskDetailModal from './TaskDetailModal';
import DashboardModal from './DashboardModal';
import RegistryModal from './RegistryModal';
import SummaryReportModal from './SummaryReportModal';
import type { AppRole } from '@/lib/auth/guards';

interface TrackingDashboardProps {
  userRoles: AppRole[];
  userId: string;
  userEmail: string;
}

type TabKey = AppRole | 'completed';

const ROLE_TABS: { role: AppRole; label: string; icon: string }[] = [
  { role: 'STAFF', label: 'เจ้าหน้าที่', icon: '📥' },
  { role: 'DOCCON', label: 'DocCon', icon: '🔍' },
  { role: 'REVIEWER', label: 'ผู้ตรวจสอบ', icon: '📝' },
  { role: 'BOSS', label: 'ผู้สั่งงาน', icon: '💼' },
  { role: 'SUPER_BOSS', label: 'หัวหน้างาน', icon: '👑' },
];

type QuickFilter = 'all' | 'pending' | 'rejected';

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'pending', label: 'รอดำเนินการ' },
  { key: 'rejected', label: 'ตีกลับ' },
];

export default function TrackingDashboard({ userRoles, userId, userEmail }: TrackingDashboardProps) {
  // Pick first available tab by priority
  const availableTabs = ROLE_TABS.filter(t => userRoles.includes(t.role));
  const [activeTab, setActiveTab] = useState<TabKey>(availableTabs[0]?.role ?? 'completed');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showRegistry, setShowRegistry] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');

  const isCompletedTab = activeTab === 'completed';

  // Fetch task counts for badges
  const fetchTabCounts = useCallback(async () => {
    const counts: Record<string, number> = {};
    await Promise.all(
      [...availableTabs.map(t => t.role), 'completed' as const].map(async (role) => {
        try {
          const res = await fetch(`/api/tasks?role=${role}`);
          if (res.ok) {
            const data: Task[] = await res.json();
            counts[role] = data.length;
          }
        } catch { /* ignore count fetch errors */ }
      })
    );
    setTabCounts(counts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRoles.join(',')]);

  useEffect(() => { fetchTabCounts(); }, [fetchTabCounts]);

  const fetchTasks = useCallback(async () => {
    if (!activeTab) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?role=${activeTab}`);
      if (res.ok) setTasks(await res.json());
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Reset quick filter when switching tabs
  useEffect(() => { setQuickFilter('all'); }, [activeTab]);

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('tasks-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        fetchTasks();
        fetchTabCounts();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchTasks, fetchTabCounts]);

  // Apply search filter
  const searchFiltered = tasks.filter(t =>
    !search.trim()
    || t.title.toLowerCase().includes(search.toLowerCase())
    || t.task_code.toLowerCase().includes(search.toLowerCase())
    || (t.doc_ref ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // Apply quick filter (client-side, only for non-completed tabs)
  const filtered = searchFiltered.filter(t => {
    if (isCompletedTab || quickFilter === 'all') return true;
    if (quickFilter === 'pending') {
      const pendingStatuses = ['ASSIGNED', 'SUBMITTED_TO_DOCCON', 'PENDING_REVIEW', 'WAITING_BOSS_APPROVAL', 'WAITING_SUPER_BOSS_APPROVAL'];
      return pendingStatuses.includes(t.status);
    }
    if (quickFilter === 'rejected') {
      const rejectedStatuses = ['DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];
      return rejectedStatuses.includes(t.status);
    }
    return true;
  });

  if (availableTabs.length === 0 && userRoles.length === 0) {
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

  // Tab page headers (match reference)
  const TAB_HEADERS: Record<string, { icon: string; title: string }> = {
    STAFF: { icon: '📥', title: 'งานของฉัน' },
    BOSS: { icon: '💼', title: 'งานที่สั่ง' },
    DOCCON: { icon: '🔍', title: 'คิวตรวจรูปแบบ' },
    REVIEWER: { icon: '📝', title: 'รอตรวจสอบเนื้อหา' },
    SUPER_BOSS: { icon: '👑', title: 'รออนุมัติขั้นสุดท้าย' },
    completed: { icon: '✅', title: 'งานที่เสร็จแล้ว' },
  };

  const currentHeader = TAB_HEADERS[activeTab] ?? TAB_HEADERS.completed;

  return (
    <div className="max-w-5xl mx-auto px-4 py-5">
      {/* Role Switcher - pill buttons (matches ref #roleTabBtns) */}
      {availableTabs.length > 1 && (
        <div className="flex gap-1.5 flex-wrap mb-5">
          {availableTabs.map(t => (
            <button key={t.role} onClick={() => setActiveTab(t.role)}
              className={`px-4 py-1.5 text-xs rounded-full font-semibold tracking-wide border transition-all shadow-sm ${
                activeTab === t.role
                  ? 'bg-[#00c2a8] text-white border-[#00c2a8] shadow-[0_2px_8px_rgba(0,194,168,0.3)]'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}>
              {t.label}
              {(tabCounts[t.role] ?? 0) > 0 && (
                <span className={`ml-1.5 inline-flex items-center justify-center min-w-[1.1rem] h-4 px-1 text-[0.6rem] font-bold rounded-full ${
                  activeTab === t.role
                    ? 'bg-white/30 text-white'
                    : 'bg-slate-200 text-slate-600'
                }`}>
                  {tabCounts[t.role]}
                </span>
              )}
            </button>
          ))}
          <button onClick={() => setActiveTab('completed')}
            className={`px-4 py-1.5 text-xs rounded-full font-semibold tracking-wide border transition-all shadow-sm ${
              activeTab === 'completed'
                ? 'bg-[#00c2a8] text-white border-[#00c2a8] shadow-[0_2px_8px_rgba(0,194,168,0.3)]'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}>
            เสร็จแล้ว
            {(tabCounts['completed'] ?? 0) > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-[1.1rem] h-4 px-1 text-[0.6rem] font-bold rounded-full ${
                activeTab === 'completed'
                  ? 'bg-white/30 text-white'
                  : 'bg-slate-200 text-slate-600'
              }`}>
                {tabCounts['completed']}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Page Header (matches ref .page-hdr) */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2 m-0">
          <span style={{ color: '#00c2a8' }}>{currentHeader.icon}</span>
          {currentHeader.title}
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchTasks()}
            className="p-1.5 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-md text-xs transition-colors"
            title="รีเฟรช">
            🔄
          </button>
          {(userRoles.includes('BOSS') || userRoles.includes('DOCCON') || userRoles.includes('SUPER_BOSS')) && (
            <button onClick={() => setShowDashboard(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold text-xs rounded-lg transition-colors shadow-sm">
              📊 ภาพรวม
            </button>
          )}
          {userRoles.includes('BOSS') && (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-white font-semibold text-xs rounded-lg transition-colors shadow-sm"
              style={{ background: '#00c2a8' }}>
              ＋ สร้างงานใหม่
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาชื่องาน, รหัสงาน, เลขที่เอกสาร..."
          className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00c2a8]/30 focus:border-[#00c2a8]"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">✕</button>
        )}
      </div>

      {/* Quick Filter Chips (non-completed tabs only) */}
      {!isCompletedTab && (
        <div className="flex gap-2 mb-4">
          {QUICK_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setQuickFilter(f.key)}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors border ${
                quickFilter === f.key
                  ? 'bg-[#00c2a8] border-[#00c2a8] text-white'
                  : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

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
      <DashboardModal
        open={showDashboard}
        onClose={() => setShowDashboard(false)}
      />
      <RegistryModal
        open={showRegistry}
        onClose={() => setShowRegistry(false)}
      />
      <SummaryReportModal
        open={showReport}
        onClose={() => setShowReport(false)}
      />
    </div>
  );
}
