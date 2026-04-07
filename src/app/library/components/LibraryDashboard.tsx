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
    <div style={{ fontFamily: "'Sarabun', 'IBM Plex Sans Thai', sans-serif" }}>
      {/* Hero section (matches ref .hero) */}
      <div
        className="text-center border-b border-white/10"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
          padding: '45px 28px 35px',
        }}
      >
        <h1 className="text-white text-2xl font-bold" style={{ letterSpacing: '-0.02em', marginBottom: '6px' }}>
          📑 ระบบเอกสารคุณภาพ
        </h1>
        <div className="text-white/50 text-sm">ศูนย์ควบคุมเอกสาร (Document Control Dashboard)</div>
      </div>

      {/* Main content */}
      <div className="max-w-[1080px] mx-auto" style={{ padding: '32px 24px 64px' }}>
        {/* Toolbar (matches ref .toolbar) */}
        <div className="flex justify-between items-center gap-4 mb-7 flex-wrap">
          {/* Search */}
          <div className="relative flex-1" style={{ minWidth: '260px', maxWidth: '400px' }}>
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9ca3af] text-sm">🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อเอกสาร..."
              className="w-full bg-white text-[#111827] border border-[#e5e7eb] rounded-[10px] text-sm outline-none transition-all shadow-[0_2px_6px_rgba(0,0,0,0.02)] focus:border-[#3b82f6] focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
              style={{ padding: '10px 16px 10px 40px' }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#111827]">✕</button>
            )}
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-[13px] text-[#6b7280] font-semibold">เรียงตาม</span>
            <select
              value={sort}
              onChange={e => setSort(e.target.value as SortValue)}
              className="border border-[#e5e7eb] rounded-lg text-[13px] text-[#111827] bg-white outline-none cursor-pointer transition-colors focus:border-[#3b82f6]"
              style={{ padding: '9px 14px' }}
            >
              <option value="name_asc">ชื่อ ก→ฮ</option>
              <option value="name_desc">ชื่อ ฮ→ก</option>
              <option value="status">สถานะ (เปิดก่อน)</option>
              <option value="close_date">วันปิดใกล้สุด</option>
            </select>
          </div>

          {/* Action buttons (DocCon only, matches ref #adminActions) */}
          {isDoccon && (
            <div className="flex gap-2.5">
              <button
                onClick={() => { setSettingsMode('create'); setSettingsTarget({} as Standard); }}
                className="inline-flex items-center gap-1.5 rounded-lg border-none text-[13px] font-semibold cursor-pointer transition-all whitespace-nowrap text-white shadow-[0_2px_8px_rgba(37,99,235,0.25)] hover:-translate-y-px"
                style={{ background: '#2563eb', padding: '9px 18px' }}
              >
                📄 สร้างไฟล์ใหม่
              </button>
              <button
                onClick={() => setAddLinkOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e7eb] text-[13px] font-semibold cursor-pointer transition-all whitespace-nowrap bg-white text-[#374151] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#f8fafc] hover:border-[#cbd5e1]"
                style={{ padding: '9px 18px' }}
              >
                🔗 เพิ่มลิงก์
              </button>
            </div>
          )}
        </div>

        {/* Section label (matches ref .sec-label) */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[11.5px] font-bold tracking-wider uppercase text-[#6b7280]">แฟ้มเอกสารในระบบ</span>
          <div className="flex-1 h-px bg-[#e5e7eb]" />
          <span className="text-xs text-[#9ca3af]">{filtered.length} รายการ</span>
        </div>

        {/* Cards Grid (matches ref .cards-grid) */}
        {loading ? (
          <div className="text-center py-16 text-[#6b7280]">
            <div className="w-8 h-8 border-3 border-[#e5e7eb] border-t-[#3b82f6] rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm">กำลังโหลดข้อมูล...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-[42px] mb-3 opacity-30">📭</div>
            <p className="text-sm text-[#6b7280]">
              {search ? `ไม่พบเอกสารที่ตรงกับ "${search}"` : 'ไม่พบเอกสาร หรือคุณไม่มีสิทธิ์เข้าถึง'}
            </p>
          </div>
        ) : (
          <div
            className="grid gap-[18px]"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(285px, 1fr))' }}
          >
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
        )}
      </div>

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

      {/* Delete confirm (matches ref #deleteOverlay) */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-[rgba(15,23,42,0.6)] backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-[92%] max-w-[450px] shadow-[0_24px_64px_rgba(0,0,0,0.22)] animate-[pop_0.2s_ease]" style={{ padding: '32px' }}>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-[22px]">🗑️</span>
              <h3 className="text-[17px] font-bold flex-1">ลบเอกสารออกจากระบบ</h3>
              <button onClick={() => { setDeleteTarget(null); setDeleteReason(''); }}
                className="w-7 h-7 rounded-full bg-[#f8fafc] border border-[#e5e7eb] flex items-center justify-center text-[#6b7280] text-sm hover:bg-[#f1f5f9] hover:text-[#111827] cursor-pointer transition-colors">✕</button>
            </div>
            <p className="text-[13px] font-bold text-[#111827] bg-[#f1f5f9] rounded-lg mb-4" style={{ padding: '10px 14px' }}>
              {deleteTarget.name}
            </p>
            <div className="mb-4">
              <label className="block text-xs font-bold text-[#6b7280] mb-2 tracking-wide">เหตุผลการลบ <span className="text-[#dc2626]">*</span></label>
              <textarea
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                placeholder="ระบุเหตุผล เช่น เอกสารซ้ำ, เวอร์ชันเก่า, ยกเลิกการใช้งาน..."
                rows={3}
                className="w-full border border-[#e5e7eb] rounded-lg text-sm text-[#111827] outline-none resize-y transition-colors focus:border-[#3b82f6] focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
                style={{ padding: '10px 14px', boxSizing: 'border-box' }}
              />
            </div>
            <div className="bg-[#fff1f2] border border-[#fecaca] rounded-lg text-[12.5px] text-[#991b1b] leading-relaxed mb-5" style={{ padding: '12px 14px' }}>
              ⚠️ ลบเฉพาะรายการออกจาก Dashboard — ไฟล์ใน Drive ยังคงอยู่
            </div>
            <div className="flex justify-end gap-2.5">
              <button onClick={() => { setDeleteTarget(null); setDeleteReason(''); }}
                className="inline-flex items-center gap-1.5 bg-white text-[#374151] border border-[#e5e7eb] rounded-lg text-xs font-semibold cursor-pointer transition-all hover:bg-[#f8fafc]"
                style={{ padding: '6px 14px' }}>ยกเลิก</button>
              <button onClick={handleDelete} disabled={deleteLoading || !deleteReason.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all text-white disabled:opacity-50"
                style={{ background: '#dc2626', padding: '6px 14px' }}>
                {deleteLoading ? 'กำลังลบ...' : '🗑️ ยืนยันลบ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename modal (matches ref #renameOverlay) */}
      {renameTarget && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-[rgba(15,23,42,0.6)] backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-[92%] max-w-[450px] shadow-[0_24px_64px_rgba(0,0,0,0.22)] animate-[pop_0.2s_ease]" style={{ padding: '32px' }}>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-[22px]">✏️</span>
              <h3 className="text-[17px] font-bold flex-1">เปลี่ยนชื่อเอกสาร</h3>
              <button onClick={() => { setRenameTarget(null); setRenameName(''); }}
                className="w-7 h-7 rounded-full bg-[#f8fafc] border border-[#e5e7eb] flex items-center justify-center text-[#6b7280] text-sm hover:bg-[#f1f5f9] hover:text-[#111827] cursor-pointer transition-colors">✕</button>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold text-[#6b7280] mb-2 tracking-wide">ชื่อใหม่</label>
              <input
                type="text"
                value={renameName}
                onChange={e => setRenameName(e.target.value)}
                className="w-full border border-[#e5e7eb] rounded-lg text-sm text-[#111827] outline-none transition-all focus:border-[#3b82f6] focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
                style={{ padding: '10px 14px' }}
              />
            </div>
            <div className="flex justify-end gap-2.5 mt-7">
              <button onClick={() => { setRenameTarget(null); setRenameName(''); }}
                className="inline-flex items-center gap-1.5 bg-white text-[#374151] border border-[#e5e7eb] rounded-lg text-xs font-semibold cursor-pointer transition-all hover:bg-[#f8fafc]"
                style={{ padding: '6px 14px' }}>ยกเลิก</button>
              <button onClick={handleRename} disabled={renameLoading || !renameName.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all text-white disabled:opacity-50"
                style={{ background: '#2563eb', padding: '6px 14px' }}>
                {renameLoading ? 'กำลังบันทึก...' : '✓ บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add link modal (matches ref #addLinkOverlay) */}
      {addLinkOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-[rgba(15,23,42,0.6)] backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-[92%] max-w-[450px] shadow-[0_24px_64px_rgba(0,0,0,0.22)] animate-[pop_0.2s_ease]" style={{ padding: '32px' }}>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-[22px]">🔗</span>
              <h3 className="text-[17px] font-bold flex-1">เพิ่มลิงก์ภายนอก</h3>
              <button onClick={() => { setAddLinkOpen(false); setLinkName(''); setLinkUrl(''); }}
                className="w-7 h-7 rounded-full bg-[#f8fafc] border border-[#e5e7eb] flex items-center justify-center text-[#6b7280] text-sm hover:bg-[#f1f5f9] hover:text-[#111827] cursor-pointer transition-colors">✕</button>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold text-[#6b7280] mb-2 tracking-wide">ชื่อลิงก์</label>
              <input
                type="text"
                value={linkName}
                onChange={e => setLinkName(e.target.value)}
                placeholder="เช่น QP ภาควิชา"
                className="w-full border border-[#e5e7eb] rounded-lg text-sm text-[#111827] outline-none transition-all focus:border-[#3b82f6] focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
                style={{ padding: '10px 14px' }}
              />
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold text-[#6b7280] mb-2 tracking-wide">URL</label>
              <input
                type="url"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder="https://..."
                className="w-full border border-[#e5e7eb] rounded-lg text-sm text-[#111827] outline-none transition-all focus:border-[#3b82f6] focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
                style={{ padding: '10px 14px' }}
              />
            </div>
            <div className="flex justify-end gap-2.5 mt-7">
              <button onClick={() => { setAddLinkOpen(false); setLinkName(''); setLinkUrl(''); }}
                className="inline-flex items-center gap-1.5 bg-white text-[#374151] border border-[#e5e7eb] rounded-lg text-xs font-semibold cursor-pointer transition-all hover:bg-[#f8fafc]"
                style={{ padding: '6px 14px' }}>ยกเลิก</button>
              <button onClick={handleAddLink} disabled={addLinkLoading || !linkName.trim() || !linkUrl.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all text-white disabled:opacity-50"
                style={{ background: '#7c3aed', padding: '6px 14px' }}>
                {addLinkLoading ? 'กำลังเพิ่ม...' : '🔗 เพิ่มลิงก์'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
