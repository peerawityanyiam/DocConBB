'use client';

import { useState, useEffect } from 'react';

interface UserOption {
  id: string;
  display_name: string;
  email: string;
}

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateTaskModal({ open, onClose, onCreated }: CreateTaskModalProps) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [officerId, setOfficerId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    fetch('/api/users')
      .then(r => r.json())
      .then((data: { users?: UserOption[] } | UserOption[]) => {
        const list = Array.isArray(data) ? data : (data.users ?? []);
        setUsers(list.filter((u: UserOption & { is_active?: boolean }) => u.is_active !== false));
      })
      .catch(() => {});
  }, [open]);

  function reset() {
    setTitle(''); setDetail(''); setOfficerId(''); setReviewerId(''); setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!title.trim()) { setError('กรุณากรอกชื่องาน'); return; }
    if (!officerId) { setError('กรุณาเลือกผู้รับผิดชอบ'); return; }
    if (!reviewerId) { setError('กรุณาเลือกผู้ตรวจสอบ'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), detail: detail.trim(), officer_id: officerId, reviewer_id: reviewerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'เกิดข้อผิดพลาด');
      reset();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">สร้างงานใหม่</h2>
          <button onClick={() => { reset(); onClose(); }} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ชื่องาน / เอกสาร <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="เช่น ขั้นตอนการรับผู้ป่วยใหม่"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">รายละเอียด</label>
            <textarea
              value={detail}
              onChange={e => setDetail(e.target.value)}
              rows={3}
              placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">ผู้รับผิดชอบ (STAFF) <span className="text-red-500">*</span></label>
              <select
                value={officerId}
                onChange={e => setOfficerId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              >
                <option value="">-- เลือก --</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.display_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">ผู้ตรวจสอบ (REVIEWER) <span className="text-red-500">*</span></label>
              <select
                value={reviewerId}
                onChange={e => setReviewerId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              >
                <option value="">-- เลือก --</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.display_name}</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => { reset(); onClose(); }}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
              ยกเลิก
            </button>
            <button type="submit" disabled={loading}
              className="px-5 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-50 transition-colors">
              {loading ? 'กำลังสร้าง...' : 'สร้างงาน'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
