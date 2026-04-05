'use client';

import { useState, useEffect } from 'react';
import type { Standard } from './StandardCard';

interface AdminSettingsModalProps {
  standard: Standard | null;
  onClose: () => void;
  onSaved: () => void;
  mode: 'create' | 'edit';
}

export default function AdminSettingsModal({ standard, onClose, onSaved, mode }: AdminSettingsModalProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [isLink, setIsLink] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [alwaysOpen, setAlwaysOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode === 'edit' && standard) {
      setName(standard.name);
      setUrl(standard.url ?? '');
      setIsLink(standard.is_link);
      setStartDate(standard.start_date?.substring(0, 10) ?? '');
      setEndDate(standard.end_date?.substring(0, 10) ?? '');
      setAlwaysOpen(standard.always_open);
      setHidden(standard.hidden);
      setLocked(standard.locked);
    } else {
      setName(''); setUrl(''); setIsLink(false); setStartDate(''); setEndDate('');
      setAlwaysOpen(false); setHidden(false); setLocked(false);
    }
    setError('');
  }, [standard, mode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('กรุณากรอกชื่อเอกสาร'); return; }
    setLoading(true);
    setError('');

    try {
      const body = {
        name: name.trim(),
        url: url.trim(),
        is_link: isLink,
        start_date: startDate || null,
        end_date: endDate || null,
        always_open: alwaysOpen,
        hidden,
        locked,
      };

      let res: Response;
      if (mode === 'create') {
        res = await fetch('/api/library/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/library/${standard!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'เกิดข้อผิดพลาด');
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }

  if (mode === 'edit' && !standard) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-slate-800">
            {mode === 'create' ? 'เพิ่มเอกสารใหม่' : 'ตั้งค่าเอกสาร'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ชื่อเอกสาร <span className="text-red-500">*</span></label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="เช่น WI-MED-001 ขั้นตอนการตรวจผู้ป่วย"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">URL (ลิงก์ภายนอก)</label>
            <input type="url" value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
            <label className="flex items-center gap-2 mt-2 text-sm text-slate-600">
              <input type="checkbox" checked={isLink} onChange={e => setIsLink(e.target.checked)} className="rounded" />
              เป็นลิงก์ภายนอก (ไม่ใช่ไฟล์ Drive)
            </label>
          </div>

          {/* Date range */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">ช่วงเวลาเปิดรับ</label>
            <label className="flex items-center gap-2 text-sm text-slate-600 mb-2">
              <input type="checkbox" checked={alwaysOpen} onChange={e => setAlwaysOpen(e.target.checked)} className="rounded" />
              เปิดตลอดเวลา
            </label>
            {!alwaysOpen && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">วันเริ่มต้น</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">วันสิ้นสุด</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                </div>
              </div>
            )}
          </div>

          {/* Flags */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={locked} onChange={e => setLocked(e.target.checked)} className="rounded" />
              <span>🔒 ล็อค (ปิดรับชั่วคราว)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} className="rounded" />
              <span>👁️‍🗨️ ซ่อน (เฉพาะ DocCon เห็น)</span>
            </label>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">ยกเลิก</button>
            <button type="submit" disabled={loading}
              className="px-5 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-50 transition-colors">
              {loading ? 'กำลังบันทึก...' : mode === 'create' ? 'เพิ่มเอกสาร' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
