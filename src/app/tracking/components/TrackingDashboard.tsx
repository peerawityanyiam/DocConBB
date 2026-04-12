'use client';

import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import { createClient } from '@/lib/supabase/client';
import TaskCard, { type Task } from './TaskCard';
import ActionCard from './ActionCard';
import CreateTaskModal from './CreateTaskModal';
import TaskDetailModal from './TaskDetailModal';
import DashboardModal from './DashboardModal';
import RegistryModal from './RegistryModal';
import SummaryReportModal from './SummaryReportModal';
import type { AppRole } from '@/lib/auth/guards';
import type { TaskStatus } from '@/lib/constants/status';
import { toFriendlyErrorMessage } from '@/lib/ui/friendly-error';

interface TrackingDashboardProps {
  userRoles: AppRole[];
  userId: string;
  userEmail: string;
}

type TabKey = AppRole | 'completed';
type CompletedRange = '1m' | '3m' | '6m' | '1y' | 'all';
type CompletedSort = 'completed_date' | 'alpha';
const TASKS_PAGE_SIZE = 20;

const ROLE_TABS: { role: AppRole; label: string; icon: string }[] = [
  { role: 'STAFF', label: 'เจ้าหน้าที่', icon: '📥' },
  { role: 'DOCCON', label: 'DocCon', icon: '🔍' },
  { role: 'REVIEWER', label: 'ผู้ตรวจสอบ', icon: '📝' },
  { role: 'BOSS', label: 'ผู้สั่งงาน', icon: '💼' },
  { role: 'SUPER_BOSS', label: 'หัวหน้างาน', icon: '👑' },
];

/* ── Sub-tabs per role ── */
interface SubTabDef {
  key: string;
  label: string;
  /** Filter function to select tasks for this sub-tab */
  filter: (t: Task, userId: string) => boolean;
  /** Whether to use ActionCard (true) or TaskCard pipeline view (false) */
  useActionCard: boolean;
}

const ROLE_SUB_TABS: Record<string, SubTabDef[]> = {
  STAFF: [
    {
      key: 'my_tasks',
      label: 'งานรอดำเนินการ',
      filter: (t, userId) => {
        const actionable: TaskStatus[] = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED'];
        return t.officer_id === userId && actionable.includes(t.status);
      },
      useActionCard: true,
    },
    {
      key: 'tracking',
      label: 'ติดตามงาน',
      filter: (t, userId) => {
        const nonTrackable: TaskStatus[] = ['ASSIGNED', 'DOCCON_REJECTED', 'REVIEWER_REJECTED', 'BOSS_REJECTED', 'SUPER_BOSS_REJECTED', 'COMPLETED', 'CANCELLED'];
        return t.officer_id === userId && !nonTrackable.includes(t.status);
      },
      useActionCard: false,
    },
    {
      key: 'completed',
      label: 'เสร็จแล้ว',
      filter: (t, userId) => t.officer_id === userId && t.status === 'COMPLETED',
      useActionCard: false,
    },
  ],
  DOCCON: [
    {
      key: 'pending',
      label: 'รอตรวจ',
      filter: (t) => t.status === 'SUBMITTED_TO_DOCCON',
      useActionCard: true,
    },
    {
      key: 'tracking',
      label: 'ติดตามงาน',
      filter: (t) => !['COMPLETED', 'CANCELLED'].includes(t.status),
      useActionCard: false,
    },
    {
      key: 'registry',
      label: 'ทะเบียนเอกสาร',
      filter: () => false, // special tab — opens registry modal
      useActionCard: false,
    },
  ],
  REVIEWER: [
    {
      key: 'pending',
      label: 'รอตรวจ',
      filter: (t, userId) => t.status === 'PENDING_REVIEW' && t.reviewer_id === userId,
      useActionCard: true,
    },
    {
      key: 'completed',
      label: 'เสร็จแล้ว',
      filter: (t, userId) => t.reviewer_id === userId && t.status === 'COMPLETED',
      useActionCard: false,
    },
  ],
  BOSS: [
    {
      key: 'pending',
      label: 'รออนุมัติ',
      filter: (t, userId) => t.status === 'WAITING_BOSS_APPROVAL' && t.created_by === userId,
      useActionCard: true,
    },
    {
      key: 'tracking',
      label: 'ติดตามงาน',
      filter: (t, userId) => t.created_by === userId && !['COMPLETED', 'CANCELLED'].includes(t.status),
      useActionCard: false,
    },
  ],
  SUPER_BOSS: [
    {
      key: 'pending',
      label: 'รออนุมัติ',
      filter: (t) => t.status === 'WAITING_SUPER_BOSS_APPROVAL',
      useActionCard: true,
    },
    {
      // Bug 4: replace completed with tracking all tasks
      key: 'tracking',
      label: 'ติดตามงานทั้งหมด',
      filter: (t) => !['COMPLETED', 'CANCELLED'].includes(t.status),
      useActionCard: false,
    },
  ],
};

function getCurrentGuideText(activeTab: TabKey, activeSubTab: string, isCompletedView: boolean): string {
  if (isCompletedView) {
    return 'แท็บเสร็จแล้วแสดงงานที่ปิดงานเรียบร้อย สามารถใช้ตัวกรองช่วงเวลาและการเรียงลำดับร่วมกันได้';
  }

  if (activeTab === 'STAFF' && activeSubTab === 'my_tasks') {
    return 'งานในแท็บนี้ต้องแนบไฟล์ Word (.docx) ก่อนจึงจะกดส่งงานได้';
  }
  if (activeTab === 'DOCCON' && activeSubTab === 'pending') {
    return 'งานรอตรวจต้องระบุรหัสเอกสารก่อนกดผ่านรูปแบบ หากถูกส่งกลับจากหัวหน้างานต้องแนบ Word ใหม่';
  }
  if (activeTab === 'REVIEWER' && activeSubTab === 'pending') {
    return 'ผู้ตรวจสอบสามารถแนบไฟล์ Word/PDF หรือแนบภาพเพื่อรวมเป็น PDF ก่อนกดอนุมัติหรือส่งกลับแก้ไข';
  }
  if (activeTab === 'BOSS' && activeSubTab === 'pending') {
    return 'ผู้สั่งงานอนุมัติ ตีกลับ หรือส่งให้ DocCon ตรวจใหม่ได้ โดยปุ่มจะเปิดเมื่อระบบพร้อมดำเนินการ';
  }
  if (activeTab === 'SUPER_BOSS' && activeSubTab === 'pending') {
    return 'หัวหน้างานสามารถอนุมัติขั้นสุดท้าย หรือตีกลับเพื่อแก้ไขพร้อมระบุเหตุผลได้';
  }

  return 'เลือกแท็บงานที่ต้องการและกดการ์ดเพื่อดูรายละเอียดเพิ่มเติม';
}

export default function TrackingDashboard({ userRoles, userId, userEmail }: TrackingDashboardProps) {
  const availableTabs = ROLE_TABS.filter(t => userRoles.includes(t.role));
  const [activeTab, setActiveTab] = useState<TabKey>(availableTabs[0]?.role ?? 'completed');
  const [activeSubTab, setActiveSubTab] = useState<string>('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showRegistry, setShowRegistry] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});
  const countsRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchTasksAbortRef = useRef<AbortController | null>(null);
  const [completedRange, setCompletedRange] = useState<CompletedRange>('all');
  const [completedSort, setCompletedSort] = useState<CompletedSort>('completed_date');
  const [visibleCount, setVisibleCount] = useState(TASKS_PAGE_SIZE);
  const deferredSearch = useDeferredValue(search);

  const isCompletedTab = activeTab === 'completed';
  const subTabs = !isCompletedTab ? (ROLE_SUB_TABS[activeTab] ?? []) : [];
  const currentSubTab = subTabs.find(st => st.key === activeSubTab) ?? subTabs[0];
  const isCompletedView = isCompletedTab || currentSubTab?.key === 'completed';
  const fetchScope = useMemo<'active' | 'completed'>(() => (
    isCompletedView ? 'completed' : 'active'
  ), [isCompletedView]);

  // Reset sub-tab on role tab change
  useEffect(() => {
    const subs = ROLE_SUB_TABS[activeTab as string] ?? [];
    setActiveSubTab(subs[0]?.key ?? '');
  }, [activeTab]);

  // Fetch task counts for badges — show only actionable tasks per role
  const fetchTabCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks/counts', { cache: 'no-store' });
      if (!res.ok) return;
      const data: { counts?: Record<string, number> } = await res.json();
      if (data.counts) setTabCounts(data.counts);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchTabCounts(); }, [fetchTabCounts]);

  const fetchTasks = useCallback(async () => {
    if (!activeTab) return;
    if (fetchTasksAbortRef.current) {
      fetchTasksAbortRef.current.abort();
    }
    const controller = new AbortController();
    fetchTasksAbortRef.current = controller;
    setLoading(true);
    setListError('');
    try {
      const res = await fetch(`/api/tasks?role=${activeTab}&scope=${fetchScope}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setTasks(await res.json());
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setListError(toFriendlyErrorMessage(err, 'โหลดรายการงานไม่สำเร็จ'));
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
      if (fetchTasksAbortRef.current === controller) {
        fetchTasksAbortRef.current = null;
      }
    }
  }, [activeTab, fetchScope]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    return () => {
      if (fetchTasksAbortRef.current) {
        fetchTasksAbortRef.current.abort();
      }
    };
  }, []);

  const refreshTasksAndCounts = useCallback(() => {
    fetchTasks();
    fetchTabCounts();
  }, [fetchTasks, fetchTabCounts]);

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('tasks-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        if (countsRefreshTimerRef.current) {
          clearTimeout(countsRefreshTimerRef.current);
        }
        countsRefreshTimerRef.current = setTimeout(() => {
          refreshTasksAndCounts();
        }, 500);
      })
      .subscribe();
    return () => {
      if (countsRefreshTimerRef.current) {
        clearTimeout(countsRefreshTimerRef.current);
        countsRefreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [refreshTasksAndCounts]);

  const normalizedSearch = deferredSearch.trim().toLowerCase();
  const searchFiltered = useMemo(() => (
    tasks.filter((t) =>
      !normalizedSearch
      || t.title.toLowerCase().includes(normalizedSearch)
      || (t.drive_file_name ?? '').toLowerCase().includes(normalizedSearch)
      || t.task_code.toLowerCase().includes(normalizedSearch)
      || (t.doc_ref ?? '').toLowerCase().includes(normalizedSearch)
    )
  ), [tasks, normalizedSearch]);

  const baseFiltered = useMemo(() => (
    isCompletedTab
      ? searchFiltered
      : currentSubTab
        ? searchFiltered.filter((t) => currentSubTab.filter(t, userId))
        : searchFiltered
  ), [currentSubTab, isCompletedTab, searchFiltered, userId]);

  const rangeWindowDays: Record<Exclude<CompletedRange, 'all'>, number> = {
    '1m': 30,
    '3m': 90,
    '6m': 180,
    '1y': 365,
  };

  const getCompletedTime = (task: Task) => {
    const parsed = Date.parse(task.completed_at ?? task.updated_at ?? task.created_at);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const filtered = useMemo(() => {
    if (!isCompletedView) {
      return baseFiltered;
    }

    let next = [...baseFiltered];

    if (completedRange !== 'all') {
      const cutoff = Date.now() - (rangeWindowDays[completedRange] * 24 * 60 * 60 * 1000);
      next = next.filter((t) => getCompletedTime(t) >= cutoff);
    }

    if (completedSort === 'alpha') {
      next.sort((a, b) =>
        (a.drive_file_name ?? a.title).localeCompare(
          (b.drive_file_name ?? b.title),
          'th',
          { sensitivity: 'base' },
        ),
      );
    } else {
      next.sort((a, b) => getCompletedTime(b) - getCompletedTime(a));
    }

    return next;
  }, [baseFiltered, completedRange, completedSort, isCompletedView]);

  const subTabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const st of subTabs) {
      if (st.key === 'registry') continue;
      counts[st.key] = searchFiltered.filter((t) => st.filter(t, userId)).length;
    }
    return counts;
  }, [searchFiltered, subTabs, userId]);

  useEffect(() => {
    setVisibleCount(TASKS_PAGE_SIZE);
  }, [activeTab, activeSubTab, normalizedSearch, completedRange, completedSort]);

  const visibleTasks = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );
  const hasMoreTasks = visibleTasks.length < filtered.length;
  const currentGuideText = getCurrentGuideText(activeTab, activeSubTab, isCompletedView);

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

  // Handle special sub-tabs
  const handleSubTabClick = (key: string) => {
    if (key === 'registry') {
      setShowRegistry(true);
      return;
    }
    setActiveSubTab(key);
  };

  // Section header text
  const sectionHeader = currentSubTab?.key === 'my_tasks'
    ? `งานรอดำเนินการ (${filtered.length})`
    : currentSubTab?.key === 'pending'
      ? `รอดำเนินการ (${filtered.length})`
      : currentSubTab?.key === 'tracking'
        ? `ติดตามงาน (${filtered.length})`
        : currentSubTab?.key === 'completed'
          ? `เสร็จสิ้น (${filtered.length})`
          : `${filtered.length} รายการ`;
  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-5 overflow-x-hidden">
      {/* Role Switcher - pill buttons */}
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
          {/* Bug 8: completed pill only for DOCCON, BOSS, SUPER_BOSS */}
          {(userRoles.includes('DOCCON') || userRoles.includes('BOSS') || userRoles.includes('SUPER_BOSS')) && (
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
          )}
        </div>
      )}

      {/* Header bar with action buttons */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between mb-4 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <button onClick={() => fetchTasks()}
            className="p-1.5 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-md text-xs transition-colors"
            title="รีเฟรช">
            🔄
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:justify-end">
          {(userRoles.includes('BOSS') || userRoles.includes('DOCCON') || userRoles.includes('SUPER_BOSS')) && (
            <button onClick={() => setShowDashboard(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold text-xs rounded-lg transition-colors shadow-sm">
              📊 ภาพรวม
            </button>
          )}
          {/* Bug 6: report visible to DOCCON, BOSS, SUPER_BOSS */}
          {(userRoles.includes('DOCCON') || userRoles.includes('BOSS') || userRoles.includes('SUPER_BOSS')) && (
            <button onClick={() => setShowReport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold text-xs rounded-lg transition-colors shadow-sm">
              📈 รายงาน
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

      {/* Sub-tabs per role */}
      {!isCompletedTab && subTabs.length > 0 && (
        <div className="w-full border-b border-gray-200 mb-4 overflow-x-auto">
          <div className="flex min-w-max pb-1">
            {subTabs.map(st => {
              const isActive = st.key === activeSubTab;
              const count = subTabCounts[st.key];
              return (
                <button
                  key={st.key}
                  onClick={() => handleSubTabClick(st.key)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-[#00c2a8] text-[#00c2a8]'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {st.label}
                  {count !== undefined && count > 0 && (
                    <span className={`ml-1.5 inline-flex items-center justify-center min-w-[1.2rem] h-5 px-1.5 text-[0.65rem] font-bold rounded-full ${
                      isActive ? 'bg-[#00c2a8]/15 text-[#00c2a8]' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

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

      <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[0.72rem] text-sky-800">
        ℹ {currentGuideText}
      </div>

      {isCompletedView && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
          <label className="text-xs font-semibold text-slate-600">
            ช่วงเวลา
            <select
              value={completedRange}
              onChange={(e) => setCompletedRange(e.target.value as CompletedRange)}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00c2a8]/30 focus:border-[#00c2a8]"
            >
              <option value="1m">1 เดือน</option>
              <option value="3m">3 เดือน</option>
              <option value="6m">6 เดือน</option>
              <option value="1y">1 ปี</option>
              <option value="all">ทั้งหมด</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            เรียงลำดับ
            <select
              value={completedSort}
              onChange={(e) => setCompletedSort(e.target.value as CompletedSort)}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00c2a8]/30 focus:border-[#00c2a8]"
            >
              <option value="completed_date">วันที่เสร็จ (ล่าสุดก่อน)</option>
              <option value="alpha">ตัวอักษร (ก-ฮ)</option>
            </select>
          </label>
        </div>
      )}

      {/* Section header */}
      {!isCompletedTab && (
        <h3 className="text-sm font-bold text-gray-700 mb-3">{sectionHeader}</h3>
      )}

      {/* Task list — single column */}
      {listError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠️ {listError}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
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
        <div className="space-y-4">
          {visibleTasks.map(task => {
            // Use ActionCard for action sub-tabs, TaskCard for pipeline/completed views
            const useAction = !isCompletedTab && currentSubTab?.useActionCard;

            if (useAction) {
              return (
                <ActionCard
                  key={task.id}
                  task={task}
                  activeRole={activeTab as string}
                  activeSubTab={activeSubTab}
                  userId={userId}
                  userRoles={userRoles}
                  onUpdated={refreshTasksAndCounts}
                  onOpenHistory={(id) => setSelectedTaskId(id)}
                />
              );
            }

            // Pipeline / completed view — use TaskCard with click-to-detail
            return (
              <TaskCard
                key={task.id}
                task={task}
                onClick={t => setSelectedTaskId(t.id)}
                activeRole={isCompletedTab ? undefined : (activeTab as string)}
                userId={userId}
                isCompletedView={isCompletedView}
                userRoles={userRoles}
                onChecklistUpdated={refreshTasksAndCounts}
              />
            );
          })}
          {hasMoreTasks && (
            <button
              onClick={() => setVisibleCount((prev) => prev + TASKS_PAGE_SIZE)}
              className="w-full py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              โหลดเพิ่ม ({filtered.length - visibleTasks.length} รายการ)
            </button>
          )}
        </div>
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
        onUpdated={refreshTasksAndCounts}
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
