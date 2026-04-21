'use client';

import { useCallback, useEffect, useState } from 'react';
import { SHORTCUT_ICONS, getShortcutEmoji } from '@/lib/shortcuts/icons';

export interface Shortcut {
  id: string;
  label: string;
  url: string;
  icon_key: string | null;
  sort_order: number;
  is_active: boolean;
}

interface HomeShortcutsProps {
  canManage: boolean;
}

type DraftState = {
  id: string | null; // null = creating new
  label: string;
  url: string;
  icon_key: string | null;
};

const EMPTY_DRAFT: DraftState = { id: null, label: '', url: '', icon_key: null };

export default function HomeShortcuts({ canManage }: HomeShortcutsProps) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminOpen, setAdminOpen] = useState(false);

  const loadShortcuts = useCallback(async () => {
    try {
      const res = await fetch('/api/shortcuts', { cache: 'no-store' });
      if (!res.ok) throw new Error('load_failed');
      const data = (await res.json()) as { shortcuts: Shortcut[] };
      setShortcuts(data.shortcuts ?? []);
    } catch {
      // Silent fail — the section just renders empty. Surfaces via admin modal if they try to manage.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShortcuts();
  }, [loadShortcuts]);

  if (!canManage && !loading && shortcuts.length === 0) {
    // Non-admins see nothing when empty.
    return null;
  }

  return (
    <section className="mt-10 w-full">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[1rem] font-semibold text-[#003366]">ลิงก์ที่เกี่ยวข้อง</h3>
        {canManage && (
          <button
            type="button"
            onClick={() => setAdminOpen(true)}
            className="rounded-md border border-[#003366]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[#003366] shadow-sm transition-colors hover:bg-[#003366] hover:text-white"
          >
            ⚙️ จัดการลิงก์
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-left text-xs text-slate-400">กำลังโหลด…</div>
      ) : shortcuts.length === 0 ? (
        <p className="text-left text-xs text-slate-400">
          {canManage ? 'ยังไม่มีลิงก์ กดปุ่ม "จัดการลิงก์" เพื่อเพิ่ม' : ''}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {shortcuts.map((s) => {
            const emoji = getShortcutEmoji(s.icon_key);
            return (
              <a
                key={s.id}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3.5 py-2 text-[0.88rem] font-medium text-[#0d1b2e] shadow-sm transition-all hover:-translate-y-[1px] hover:border-[#c5a059] hover:text-[#003366] hover:shadow-md active:translate-y-0"
              >
                {emoji && <span className="text-base leading-none">{emoji}</span>}
                <span>{s.label}</span>
              </a>
            );
          })}
        </div>
      )}

      {adminOpen && canManage && (
        <AdminModal
          shortcuts={shortcuts}
          onClose={() => setAdminOpen(false)}
          onChanged={() => void loadShortcuts()}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Admin modal: list + add/edit form
// ---------------------------------------------------------------------------

interface AdminModalProps {
  shortcuts: Shortcut[];
  onClose: () => void;
  onChanged: () => void;
}

function AdminModal({ shortcuts, onClose, onChanged }: AdminModalProps) {
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function startEdit(s: Shortcut) {
    setDraft({ id: s.id, label: s.label, url: s.url, icon_key: s.icon_key });
    setError('');
  }

  function resetDraft() {
    setDraft(EMPTY_DRAFT);
    setError('');
  }

  async function handleSave() {
    setError('');
    const label = draft.label.trim();
    const url = draft.url.trim();
    if (!label) {
      setError('กรุณากรอกชื่อปุ่ม');
      return;
    }
    if (!url) {
      setError('กรุณากรอก URL');
      return;
    }
    try {
      new URL(url);
    } catch {
      setError('URL ไม่ถูกต้อง (ต้องขึ้นต้นด้วย http:// หรือ https://)');
      return;
    }

    setSaving(true);
    try {
      const isEditing = draft.id !== null;
      const res = await fetch(
        isEditing ? `/api/shortcuts/${draft.id}` : '/api/shortcuts',
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, url, icon_key: draft.icon_key }),
        },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || 'บันทึกไม่สำเร็จ');
      }
      resetDraft();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('ยืนยันลบลิงก์นี้?')) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/shortcuts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('ลบไม่สำเร็จ');
      if (draft.id === id) resetDraft();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function moveItem(id: string, direction: -1 | 1) {
    const index = shortcuts.findIndex((s) => s.id === id);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= shortcuts.length) return;
    const a = shortcuts[index];
    const b = shortcuts[swapIndex];
    setSaving(true);
    setError('');
    try {
      await Promise.all([
        fetch(`/api/shortcuts/${a.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort_order: b.sort_order }),
        }),
        fetch(`/api/shortcuts/${b.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort_order: a.sort_order }),
        }),
      ]);
      onChanged();
    } catch {
      setError('จัดลำดับไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  const previewEmoji = getShortcutEmoji(draft.icon_key);
  const isEditing = draft.id !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-2xl rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-800">จัดการลิงก์ที่เกี่ยวข้อง</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-slate-600">
            &times;
          </button>
        </div>

        <div className="max-h-[75vh] space-y-5 overflow-y-auto px-6 py-5">
          {/* Existing list */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">ลิงก์ปัจจุบัน</h3>
            {shortcuts.length === 0 ? (
              <p className="text-xs text-slate-400">ยังไม่มีลิงก์</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50">
                {shortcuts.map((s, i) => {
                  const emoji = getShortcutEmoji(s.icon_key);
                  return (
                    <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="w-5 text-base leading-none">{emoji ?? ''}</span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-800">{s.label}</div>
                          <div className="truncate text-xs text-slate-400">{s.url}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveItem(s.id, -1)}
                          disabled={i === 0 || saving}
                          className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
                          title="เลื่อนขึ้น"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => moveItem(s.id, 1)}
                          disabled={i === shortcuts.length - 1 || saving}
                          className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
                          title="เลื่อนลง"
                        >
                          ▼
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(s)}
                          className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                        >
                          แก้
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(s.id)}
                          disabled={saving}
                          className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          ลบ
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Add/Edit form */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              {isEditing ? 'แก้ไขลิงก์' : 'เพิ่มลิงก์ใหม่'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">ชื่อปุ่ม</label>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  maxLength={60}
                  placeholder="เช่น ระเบียบงานคุณภาพ"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#003366] focus:outline-none focus:ring-2 focus:ring-[#003366]/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">URL</label>
                <input
                  type="url"
                  value={draft.url}
                  onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#003366] focus:outline-none focus:ring-2 focus:ring-[#003366]/20"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600">ไอคอน (เลือกหรือไม่เลือกก็ได้)</label>
                  {draft.icon_key && (
                    <button
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, icon_key: null }))}
                      className="text-xs text-slate-500 underline hover:text-slate-700"
                    >
                      เอาไอคอนออก
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-9 gap-1 rounded-md border border-slate-200 bg-slate-50 p-2">
                  {SHORTCUT_ICONS.map((ic) => {
                    const active = draft.icon_key === ic.key;
                    return (
                      <button
                        key={ic.key}
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, icon_key: ic.key }))}
                        className={`flex aspect-square items-center justify-center rounded text-xl transition-all ${
                          active
                            ? 'bg-[#003366] text-white ring-2 ring-[#003366]/50'
                            : 'bg-white hover:bg-slate-200'
                        }`}
                        title={ic.label}
                      >
                        {ic.emoji}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Preview */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">ตัวอย่าง</label>
                <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[0.88rem] font-medium text-[#0d1b2e] shadow-sm">
                  {previewEmoji && <span className="text-base leading-none">{previewEmoji}</span>}
                  <span>{draft.label || 'ชื่อปุ่ม'}</span>
                </div>
              </div>

              {error && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                {isEditing && (
                  <button
                    type="button"
                    onClick={resetDraft}
                    disabled={saving}
                    className="rounded-md px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                  >
                    ยกเลิกการแก้ไข
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md bg-[#003366] px-5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#00264d] disabled:opacity-50"
                >
                  {saving ? 'กำลังบันทึก…' : isEditing ? 'บันทึก' : 'เพิ่ม'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-200 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
