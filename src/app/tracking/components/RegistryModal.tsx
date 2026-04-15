'use client';

import { useState, useEffect, useCallback } from 'react';

interface RegistryModalProps {
  open: boolean;
  onClose: () => void;
}

interface RegistryTask {
  id: string;
  task_code: string;
  title: string;
  completed_at: string | null;
}

interface RegistryEntry {
  doc_ref: string;
  latestTitle: string;
  latestTaskCode: string;
  latestDriveFileId: string | null;
  latestDriveFileName: string | null;
  completedAt: string | null;
  versionCount: number;
  tasks: RegistryTask[];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function RegistryModal({ open, onClose }: RegistryModalProps) {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedRef, setExpandedRef] = useState<string | null>(null);

  const loadEntries = useCallback(() => {
    setLoading(true);
    setSearch('');
    setExpandedRef(null);
    fetch('/api/tasks/registry')
      .then(res => res.ok ? res.json() : [])
      .then((data: RegistryEntry[]) => setEntries(data))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void loadEntries();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, loadEntries]);

  if (!open) return null;

  const filtered = entries.filter(e =>
    !search.trim()
    || e.doc_ref.toLowerCase().includes(search.toLowerCase())
    || e.latestTitle.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">ทะเบียนเอกสาร</h2>
            <p className="text-xs text-slate-500 mt-0.5">เอกสารที่ดำเนินการเสร็จสิ้นแล้ว</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-slate-100">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหาเลขที่เอกสาร หรือชื่อเอกสาร..."
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-slate-50 rounded-xl p-4 animate-pulse">
                  <div className="h-4 w-32 bg-slate-200 rounded mb-2" />
                  <div className="h-3 w-48 bg-slate-200 rounded" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">{search ? '🔍' : '📄'}</p>
              <p className="text-slate-500 text-sm">
                {search ? `ไม่พบเอกสารที่ตรงกับ "${search}"` : 'ยังไม่มีเอกสารในทะเบียน'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-3 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <div className="col-span-3">เลขที่เอกสาร</div>
                <div className="col-span-4">ชื่อเอกสารล่าสุด</div>
                <div className="col-span-2 text-center">จำนวนเวอร์ชัน</div>
                <div className="col-span-3 text-right">วันที่เสร็จ</div>
              </div>

              {filtered.map(entry => (
                <div key={entry.doc_ref}>
                  {/* Row */}
                  <button
                    onClick={() => setExpandedRef(expandedRef === entry.doc_ref ? null : entry.doc_ref)}
                    className="w-full grid grid-cols-12 gap-3 items-center px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left"
                  >
                    <div className="col-span-3">
                      <span className="text-sm font-semibold text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-md">
                        {entry.doc_ref}
                      </span>
                    </div>
                    <div className="col-span-4 text-sm text-slate-700 truncate">
                      {entry.latestDriveFileId ? (
                        <a
                          href={`https://drive.google.com/file/d/${entry.latestDriveFileId}/view`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-700 hover:text-blue-800 hover:underline font-medium"
                          onClick={e => e.stopPropagation()}
                        >
                          📄 {entry.latestTitle}
                        </a>
                      ) : entry.latestTitle}
                    </div>
                    <div className="col-span-2 text-center">
                      <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">
                        {entry.versionCount}
                      </span>
                    </div>
                    <div className="col-span-3 text-right text-sm text-slate-500 flex items-center justify-end gap-2">
                      {formatDate(entry.completedAt)}
                      <span className={`text-xs transition-transform ${expandedRef === entry.doc_ref ? 'rotate-180' : ''}`}>
                        ▼
                      </span>
                    </div>
                  </button>

                  {/* Expanded Version History */}
                  {expandedRef === entry.doc_ref && (
                    <div className="ml-6 mr-4 mb-3 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                      <div className="px-4 py-2 bg-slate-100 text-xs font-semibold text-slate-600">
                        ประวัติเวอร์ชัน
                      </div>
                      {entry.tasks.map((task, idx) => (
                        <div
                          key={task.id}
                          className={`grid grid-cols-12 gap-3 px-4 py-2.5 text-sm items-center ${
                            idx < entry.tasks.length - 1 ? 'border-b border-slate-200' : ''
                          }`}
                        >
                          <div className="col-span-3 text-xs font-mono text-slate-500">
                            {task.task_code}
                          </div>
                          <div className="col-span-6 text-slate-700 truncate">
                            {task.title}
                          </div>
                          <div className="col-span-3 text-right text-xs text-slate-500">
                            {formatDate(task.completed_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200">
          <p className="text-xs text-slate-400">
            {filtered.length} เอกสาร
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
