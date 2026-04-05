'use client';

import { useState, useEffect, useCallback } from 'react';
import StandardCard, { type Standard } from './StandardCard';
import AdminSettingsModal from './AdminSettingsModal';
import UploadModal from './UploadModal';
import type { AppRole } from '@/lib/auth/guards';
import { calculateDocStatus } from '@/lib/utils/status';

interface LibraryDashboardProps {
  userRoles: AppRole[];
  userEmail: string;
}

type FilterStatus = 'all' | 'open' | 'expired' | 'locked';

export default function LibraryDashboard({ userRoles, userEmail }: LibraryDashboardProps) {
  const [standards, setStandards] = useState<Standard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [settingsTarget, setSettingsTarget] = useState<Standard | null>(null);
  const [settingsMode, setSettingsMode] = useState<'create' | 'edit'>('create');
  const [uploadTarget, setUploadTarget] = useState<Standard | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Standard | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const isDoccon = userRoles.includes('DOCCON') || userRoles.includes('SUPER_ADMIN');

  const fetchStandards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/library');
      if (res.ok) setStandards(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStandards(); }, [fetchStandards]);

  async function handleTogglePin(standard: Standard) {
    await fetch('/api/library/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: standard.id, pinned: !standard.pinned }),
    });
    fetchStandards();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch('/api/library/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      if (res.ok) { setDeleteTarget(null); fetchStandards(); }
    } finally {
      setDeleteLoading(false);
    }
  }

  const filtered = standards.filter(s => {
    const matchSearch = !search.trim() || s.name.toLowerCase().includes(search.toLowerCase());
    const status = calculateDocStatus(s.start_date ?? null, s.end_date ?? null, s.always_open, s.locked);
    const matchFilter =
      filter === 'all' ||
      (filter === 'open' && status === 'OPEN') ||
      (filter === 'expired' && status === 'EXPIRED') ||
      (filter === 'locked' && status === 'LOCKED');
    return matchSearch && matchFilter;
  });

  if (userRoles.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <div className="bg-white rounded-2xl border border-slate-200 p-10">
          <p className="text-4xl mb-4">🔒</p>
          <h2 className="text-lg font-semibold text-slate-700 mb-2">ยังไม่มีสิทธิ์เข้าถึงคลังเอกสาร</h2>
          <p className="text-sm text-slate-500">กรุณาติดต่อผู้ดูแลระบบ</p>
          <p className="text-xs text-slate-400 mt-2">{userEmail}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">คลังเอกสารคุณภาพ</h1>
          <p className="text-sm text-slate-500 mt-0.5">{userEmail}</p>
        </div>
        {isDoccon && (
          <button onClick={() => { setSettingsMode('create'); setSettingsTarget({} as Standard); }}
            className="flex items-center gap-2 px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-semibold text-sm rounded-lg transition-colors shadow-sm">
            <span>+</span>
            เพิ่มเอกสารใหม่
          </button>
        )}
      </div>

      {/* Search + filter */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-52">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อเอกสาร..."
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">✕</button>
          )}
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value as FilterStatus)}
          className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400">
          <option value="all">ทั้งหมด</option>
          <option value="open">🟢 เปิดรับ</option>
          <option value="locked">🔒 ล็อค</option>
          <option value="expired">⛔ หมดเวลา</option>
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 animate-pulse">
              <div className="h-4 w-3/4 bg-slate-100 rounded" />
              <div className="h-3 w-1/2 bg-slate-100 rounded" />
              <div className="h-8 w-full bg-slate-100 rounded-lg" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p className="text-3xl mb-3">{search ? '🔍' : '📂'}</p>
          <p className="text-slate-500 text-sm">
            {search ? `ไม่พบเอกสารที่ตรงกับ "${search}"` : 'ยังไม่มีเอกสารในคลัง'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400 mb-3">{filtered.length} รายการ</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(s => (
              <StandardCard
                key={s.id}
                standard={s}
                userRoles={userRoles}
                onUpload={setUploadTarget}
                onSettings={std => { setSettingsMode('edit'); setSettingsTarget(std); }}
                onDelete={setDeleteTarget}
                onTogglePin={handleTogglePin}
              />
            ))}
          </div>
        </>
      )}

      {/* Modals */}
      {(settingsMode === 'create' ? !!settingsTarget : !!settingsTarget?.id) && (
        <AdminSettingsModal
          standard={settingsMode === 'edit' ? settingsTarget : null}
          mode={settingsMode}
          onClose={() => setSettingsTarget(null)}
          onSaved={fetchStandards}
        />
      )}

      <UploadModal
        standard={uploadTarget}
        onClose={() => setUploadTarget(null)}
        onUploaded={fetchStandards}
      />

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <p className="text-2xl text-center mb-3">🗑️</p>
            <h3 className="text-base font-semibold text-slate-800 text-center mb-2">ยืนยันการลบ</h3>
            <p className="text-sm text-slate-600 text-center mb-4">
              ลบ &ldquo;<strong>{deleteTarget.name}</strong>&rdquo; ?<br />
              <span className="text-xs text-red-500">ไฟล์ใน Google Drive จะถูก trash ด้วย</span>
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteTarget(null)}
                className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
                ยกเลิก
              </button>
              <button onClick={handleDelete} disabled={deleteLoading}
                className="px-5 py-2 text-sm bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg disabled:opacity-50">
                {deleteLoading ? 'กำลังลบ...' : 'ลบ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
