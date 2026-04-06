'use client';

import { useState, useEffect } from 'react';
import { STATUS_LABELS, STATUS_COLORS, type TaskStatus } from '@/lib/constants/status';

interface DashboardModalProps {
  open: boolean;
  onClose: () => void;
}

interface DashboardStats {
  total: number;
  byStatus: Partial<Record<TaskStatus, number>>;
  pending: number;
  waitingApproval: number;
}

// Bar color mapping for the pipeline chart (extract bg color from STATUS_COLORS classes)
const BAR_COLORS: Record<TaskStatus, string> = {
  ASSIGNED: 'bg-yellow-400',
  SUBMITTED_TO_DOCCON: 'bg-cyan-400',
  DOCCON_REJECTED: 'bg-red-400',
  PENDING_REVIEW: 'bg-blue-400',
  REVIEWER_REJECTED: 'bg-red-400',
  WAITING_BOSS_APPROVAL: 'bg-purple-400',
  BOSS_REJECTED: 'bg-red-300',
  WAITING_SUPER_BOSS_APPROVAL: 'bg-pink-400',
  SUPER_BOSS_REJECTED: 'bg-red-300',
  COMPLETED: 'bg-green-500',
  CANCELLED: 'bg-gray-400',
};

export default function DashboardModal({ open, onClose }: DashboardModalProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    fetch('/api/dashboard/stats')
      .then(r => {
        if (!r.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ');
        return r.json();
      })
      .then((data: DashboardStats) => setStats(data))
      .catch(() => setError('ไม่สามารถโหลดข้อมูลภาพรวมได้'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const completedCount = stats?.byStatus?.COMPLETED ?? 0;
  const maxCount = stats ? Math.max(...Object.values(stats.byStatus).map(v => v ?? 0), 1) : 1;

  // Pipeline stages in workflow order
  const pipelineStages: TaskStatus[] = [
    'ASSIGNED',
    'SUBMITTED_TO_DOCCON',
    'DOCCON_REJECTED',
    'PENDING_REVIEW',
    'REVIEWER_REJECTED',
    'WAITING_BOSS_APPROVAL',
    'BOSS_REJECTED',
    'WAITING_SUPER_BOSS_APPROVAL',
    'SUPER_BOSS_REJECTED',
    'COMPLETED',
    'CANCELLED',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <h2 className="text-lg font-semibold text-slate-800">ภาพรวมระบบ</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {loading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="bg-slate-50 rounded-xl p-4 animate-pulse">
                    <div className="h-3 w-16 bg-slate-200 rounded mb-2" />
                    <div className="h-6 w-10 bg-slate-200 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-10">
              <p className="text-3xl mb-3">⚠️</p>
              <p className="text-sm text-slate-500">{error}</p>
              <button
                onClick={() => {
                  setLoading(true);
                  setError('');
                  fetch('/api/dashboard/stats')
                    .then(r => {
                      if (!r.ok) throw new Error('');
                      return r.json();
                    })
                    .then((data: DashboardStats) => setStats(data))
                    .catch(() => setError('ไม่สามารถโหลดข้อมูลภาพรวมได้'))
                    .finally(() => setLoading(false));
                }}
                className="mt-3 px-4 py-1.5 text-sm bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-medium rounded-lg transition-colors"
              >
                ลองใหม่
              </button>
            </div>
          ) : stats ? (
            <>
              {/* Summary Cards */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">สรุปภาพรวม</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <SummaryCard label="งานทั้งหมด" value={stats.total} accent="bg-slate-100 text-slate-700" icon="📋" />
                  <SummaryCard label="รอดำเนินการ" value={stats.pending} accent="bg-yellow-50 text-yellow-700" icon="⏳" />
                  <SummaryCard label="รออนุมัติ" value={stats.waitingApproval} accent="bg-purple-50 text-purple-700" icon="✍️" />
                  <SummaryCard label="เสร็จสมบูรณ์" value={completedCount} accent="bg-green-50 text-green-700" icon="✅" />
                </div>
              </div>

              {/* Status Breakdown */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">แยกตามสถานะ</h3>
                <div className="bg-slate-50 rounded-xl p-4 space-y-2.5">
                  {pipelineStages.map(status => {
                    const count = stats.byStatus[status] ?? 0;
                    if (count === 0) return null;
                    const pct = Math.max((count / maxCount) * 100, 2);
                    return (
                      <div key={status} className="flex items-center gap-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border whitespace-nowrap min-w-[7rem] justify-center ${STATUS_COLORS[status]}`}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                        <div className="flex-1 h-5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${BAR_COLORS[status]}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-sm font-semibold text-slate-700 min-w-[2rem] text-right">
                          {count}
                        </span>
                      </div>
                    );
                  })}
                  {Object.values(stats.byStatus).every(v => !v) && (
                    <p className="text-sm text-slate-400 text-center py-2">ไม่มีข้อมูล</p>
                  )}
                </div>
              </div>

              {/* Pipeline Summary */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">สถานะใน Pipeline</h3>
                <div className="bg-slate-50 rounded-xl p-4">
                  <div className="space-y-2">
                    {pipelineStages.map(status => {
                      const count = stats.byStatus[status] ?? 0;
                      const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                      return (
                        <div key={status} className="group">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-slate-600">{STATUS_LABELS[status]}</span>
                            <span className="text-slate-500">
                              {count} รายการ ({pct}%)
                            </span>
                          </div>
                          <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${BAR_COLORS[status]}`}
                              style={{ width: `${Math.max(pct, count > 0 ? 1 : 0)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent, icon }: { label: string; value: number; accent: string; icon: string }) {
  return (
    <div className={`rounded-xl p-4 ${accent}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-medium opacity-80">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
