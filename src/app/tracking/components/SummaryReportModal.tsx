'use client';

import { useState, useEffect, useMemo } from 'react';
import { STATUS_LABELS, type TaskStatus } from '@/lib/constants/status';

interface SummaryReportModalProps {
  open: boolean;
  onClose: () => void;
}

interface OfficerStat {
  display_name: string;
  email: string;
  activeTasks: number;
  completedTasks: number;
  cancelledTasks: number;
  avgDaysToComplete: number | null;
}

interface PipelineAvg {
  status: string;
  avgDays: number;
  count: number;
}

interface SummaryReport {
  officers: OfficerStat[];
  totals: { active: number; completed: number; cancelled: number };
  pipelineAverages: PipelineAvg[];
  generatedAt: string;
}

type SortKey = 'display_name' | 'activeTasks' | 'completedTasks' | 'cancelledTasks' | 'avgDaysToComplete';
type SortDir = 'asc' | 'desc';

export default function SummaryReportModal({ open, onClose }: SummaryReportModalProps) {
  const [report, setReport] = useState<SummaryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('completedTasks');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchReport = () => {
    setLoading(true);
    setError('');
    fetch('/api/tasks/summary-report')
      .then(r => {
        if (!r.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ');
        return r.json();
      })
      .then((data: SummaryReport) => setReport(data))
      .catch(() => setError('ไม่สามารถโหลดรายงานสรุปได้'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    fetchReport();
  }, [open]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'display_name' ? 'asc' : 'desc');
    }
  };

  const sortedOfficers = useMemo(() => {
    if (!report) return [];
    return [...report.officers].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aVal = av ?? -1;
      const bVal = bv ?? -1;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [report, sortKey, sortDir]);

  if (!open) return null;

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="text-slate-300 ml-1">&#8597;</span>;
    return <span className="text-yellow-500 ml-1">{sortDir === 'asc' ? '&#9650;' : '&#9660;'}</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <h2 className="text-lg font-semibold text-slate-800">รายงานสรุป</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            &#10005;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {loading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-slate-50 rounded-xl p-4 animate-pulse">
                    <div className="h-3 w-16 bg-slate-200 rounded mb-2" />
                    <div className="h-6 w-10 bg-slate-200 rounded" />
                  </div>
                ))}
              </div>
              <div className="bg-slate-50 rounded-xl p-4 animate-pulse">
                <div className="h-4 w-40 bg-slate-200 rounded mb-3" />
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-8 bg-slate-200 rounded mb-2" />
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-10">
              <p className="text-3xl mb-3">&#9888;&#65039;</p>
              <p className="text-sm text-slate-500">{error}</p>
              <button
                onClick={fetchReport}
                className="mt-3 px-4 py-1.5 text-sm bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-medium rounded-lg transition-colors"
              >
                ลองใหม่
              </button>
            </div>
          ) : report ? (
            <>
              {/* Summary Cards */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">ภาพรวมทั้งหมด</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl p-4 bg-yellow-50 text-yellow-700">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-sm">&#9997;&#65039;</span>
                      <span className="text-xs font-medium opacity-80">กำลังดำเนินการ</span>
                    </div>
                    <p className="text-2xl font-bold">{report.totals.active}</p>
                  </div>
                  <div className="rounded-xl p-4 bg-green-50 text-green-700">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-sm">&#9989;</span>
                      <span className="text-xs font-medium opacity-80">เสร็จสมบูรณ์</span>
                    </div>
                    <p className="text-2xl font-bold">{report.totals.completed}</p>
                  </div>
                  <div className="rounded-xl p-4 bg-red-50 text-red-700">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-sm">&#10060;</span>
                      <span className="text-xs font-medium opacity-80">ยกเลิก</span>
                    </div>
                    <p className="text-2xl font-bold">{report.totals.cancelled}</p>
                  </div>
                </div>
              </div>

              {/* Officer Table */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">สถิติรายบุคคล</h3>
                {sortedOfficers.length === 0 ? (
                  <div className="bg-slate-50 rounded-xl p-8 text-center">
                    <p className="text-sm text-slate-400">ไม่มีข้อมูล</p>
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-100">
                            <th
                              className="text-left px-4 py-2.5 font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none"
                              onClick={() => handleSort('display_name')}
                            >
                              ชื่อเจ้าหน้าที่<SortIcon col="display_name" />
                            </th>
                            <th
                              className="text-center px-4 py-2.5 font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none"
                              onClick={() => handleSort('activeTasks')}
                            >
                              กำลังดำเนินการ<SortIcon col="activeTasks" />
                            </th>
                            <th
                              className="text-center px-4 py-2.5 font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none"
                              onClick={() => handleSort('completedTasks')}
                            >
                              เสร็จ<SortIcon col="completedTasks" />
                            </th>
                            <th
                              className="text-center px-4 py-2.5 font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none"
                              onClick={() => handleSort('cancelledTasks')}
                            >
                              ยกเลิก<SortIcon col="cancelledTasks" />
                            </th>
                            <th
                              className="text-center px-4 py-2.5 font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none"
                              onClick={() => handleSort('avgDaysToComplete')}
                            >
                              เฉลี่ย (วัน)<SortIcon col="avgDaysToComplete" />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedOfficers.map((o, i) => (
                            <tr
                              key={o.email || i}
                              className="border-b border-slate-100 last:border-0 hover:bg-slate-100/50 transition-colors"
                            >
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-slate-800">{o.display_name}</div>
                                <div className="text-xs text-slate-400">{o.email}</div>
                              </td>
                              <td className="text-center px-4 py-2.5">
                                <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-700">
                                  {o.activeTasks}
                                </span>
                              </td>
                              <td className="text-center px-4 py-2.5">
                                <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-700">
                                  {o.completedTasks}
                                </span>
                              </td>
                              <td className="text-center px-4 py-2.5">
                                <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700">
                                  {o.cancelledTasks}
                                </span>
                              </td>
                              <td className="text-center px-4 py-2.5 text-slate-600">
                                {o.avgDaysToComplete !== null ? `${o.avgDaysToComplete} วัน` : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Pipeline Average Times */}
              {report.pipelineAverages.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">เวลาเฉลี่ยในแต่ละสถานะ</h3>
                  <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                    {report.pipelineAverages.map(pa => (
                      <div key={pa.status} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">
                          {STATUS_LABELS[pa.status as TaskStatus] ?? pa.status}
                        </span>
                        <span className="text-slate-800 font-medium">
                          {pa.avgDays} วัน <span className="text-xs text-slate-400">({pa.count} ครั้ง)</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Generated At */}
              <p className="text-xs text-slate-400 text-right">
                สร้างเมื่อ {new Date(report.generatedAt).toLocaleString('th-TH')}
              </p>
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
