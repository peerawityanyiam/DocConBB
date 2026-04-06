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
type SortValue = 'name_asc' | 'name_desc' | 'status' | 'close_date';

export default function LibraryDashboard({ userRoles, userEmail }: LibraryDashboardProps) {
  const [standards, setStandards] = useState<Standard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [sort, setSort] = useState<SortValue>('name_asc');
  const [settingsTarget, setSettingsTarget] = useState<Standard | null>(null);
  const [settingsMode, setSettingsMode] = useState<'create' | 'edit'>('create');
  const [uploadTarget, setUploadTarget] = useState<Standard | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Standard | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [renameTarget, setRenameTarget] = useState<Standard | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [addLinkLoading, setAddLinkLoading] = useState(false);

  const isDoccon = userRoles.includes('DOCCON') || userRoles.includes('SUPER_ADMIN');

  const fetchStandards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/library?sort=${sort}`);
      if (res.ok) setStandards(await res.json());
    } finally {
      setLoading(false);
    }
  }, [sort]);

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
    if (!deleteTarget || !deleteReason.trim()) return;
    setDeleteLoading(true);
    try {
      const res = await fetch('/api/library/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteTarget.id, reason: deleteReason.trim() }),
      });
      if (res.ok) { setDeleteTarget(null); setDeleteReason(''); fetchStandards(); }
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleRename() {
    if (!renameTarget || !renameName.trim()) return;
    setRenameLoading(true);
    try {
      const res = await fetch('/api/library/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: renameTarget.id, newName: renameName.trim() }),
      });
      if (res.ok) { setRenameTarget(null); setRenameName(''); fetchStandards(); }
    } finally {
      setRenameLoading(false);
    }
  }

  async function handleAddLink() {
    if (!linkName.trim() || !linkUrl.trim()) return;
    setAddLinkLoading(true);
    try {
      const res = await fetch('/api/library/add-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: linkName.trim(), url: linkUrl.trim() }),
      });
      if (res.ok) { setAddLinkOpen(false); setLinkName(''); setLinkUrl(''); fetchStandards(); }
    } finally {
      setAddLinkLoading(false);
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
          <div className="flex items-center gap-2">
            <button onClick={() => { setSettingsMode('create'); setSettingsTarget({} as Standard); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-lg transition-colors shadow-sm">
              <span>+</span>
              สร้างไฟล์มาตรฐานใหม่
            </button>
            <button onClick={() => setAddLinkOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-sm rounded-lg transition-colors shadow-sm">
              <span>🔗</span>
              เพิ่มลิงก์
            </button>
          </div>
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
        <select value={sort} onChange={e => setSort(e.target.value as SortValue)}
          className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400">
          <option value="name_asc">ตามชื่อ (ก-ฮ)</option>
          <option value="name_desc">ตามชื่อ (ฮ-ก)</option>
          <option value="status">ตามสถานะ</option>
          <option value="close_date">ตามวันปิด</option>
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
                onRename={std => { setRenameTarget(std); setRenameName(std.name); }}
                onSettings={std => { setSettingsMode('edit'); setSettingsTarget(std); }}
                onDelete={std => { setDeleteTarget(std); setDeleteReason(''); }}
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
            <p className="text-sm text-slate-600 text-center mb-2">
              ลบ &ldquo;<strong>{deleteTarget.name}</strong>&rdquo; ?
            </p>
            <p className="text-xs text-red-500 text-center mb-4">ไฟล์ใน Google Drive จะถูก trash ด้วย</p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">เหตุผลในการลบ <span className="text-red-500">*</span></label>
              <textarea
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                placeholder="ระบุเหตุผลในการลบ..."
                rows={3}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
              />
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => { setDeleteTarget(null); setDeleteReason(''); }}
                className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
                ยกเลิก
              </button>
              <button onClick={handleDelete} disabled={deleteLoading || !deleteReason.trim()}
                className="px-5 py-2 text-sm bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg disabled:opacity-50">
                {deleteLoading ? 'กำลังลบ...' : 'ลบ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename modal */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-slate-800 text-center mb-4">✏️ เปลี่ยนชื่อเอกสาร</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">ชื่อใหม่</label>
              <input
                type="text"
                value={renameName}
                onChange={e => setRenameName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => { setRenameTarget(null); setRenameName(''); }}
                className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
                ยกเลิก
              </button>
              <button onClick={handleRename} disabled={renameLoading || !renameName.trim()}
                className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg disabled:opacity-50">
                {renameLoading ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add link modal */}
      {addLinkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-slate-800 text-center mb-4">🔗 เพิ่มลิงก์</h3>
            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">ชื่อลิงก์ <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={linkName}
                onChange={e => setLinkName(e.target.value)}
                placeholder="ชื่อลิงก์"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">URL <span className="text-red-500">*</span></label>
              <input
                type="url"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder="https://..."
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => { setAddLinkOpen(false); setLinkName(''); setLinkUrl(''); }}
                className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
                ยกเลิก
              </button>
              <button onClick={handleAddLink} disabled={addLinkLoading || !linkName.trim() || !linkUrl.trim()}
                className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg disabled:opacity-50">
                {addLinkLoading ? 'กำลังเพิ่ม...' : 'เพิ่มลิงก์'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
