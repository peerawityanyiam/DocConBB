'use client';

import { useState } from 'react';

interface ImportExcelModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function ImportExcelModal({ open, onClose, onImported }: ImportExcelModalProps) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  async function handleImport() {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const guessedName = file.name.replace(/\.[^/.]+$/, '').trim();
      const finalName = (name.trim() || guessedName).trim();

      const createRes = await fetch('/api/library/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: finalName,
          url: '',
          is_link: false,
          always_open: false,
        }),
      });
      if (!createRes.ok) {
        const d = await createRes.json().catch(() => ({}));
        throw new Error(d.error ?? 'สร้างรายการเอกสารไม่สำเร็จ');
      }
      const created = await createRes.json();

      const form = new FormData();
      form.append('file', file);
      form.append('standardId', created.id);
      const uploadRes = await fetch('/api/library/files/upload', {
        method: 'POST',
        body: form,
      });
      if (!uploadRes.ok) {
        const d = await uploadRes.json().catch(() => ({}));
        throw new Error(d.error ?? 'นำเข้าไฟล์ไม่สำเร็จ');
      }

      setName('');
      setFile(null);
      onClose();
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'นำเข้าไฟล์ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-[rgba(15,23,42,0.6)] backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-[92%] max-w-[510px] shadow-[0_24px_64px_rgba(0,0,0,0.22)] animate-[pop_0.2s_ease]" style={{ padding: '32px' }}>
        <div className="flex items-center gap-3 mb-6">
          <span className="text-[22px]">📤</span>
          <h3 className="text-[17px] font-bold flex-1">นำเข้าไฟล์ Excel</h3>
          <button
            onClick={() => {
              setName('');
              setFile(null);
              setError('');
              onClose();
            }}
            className="w-7 h-7 rounded-full bg-[#f8fafc] border border-[#e5e7eb] flex items-center justify-center text-[#6b7280] text-sm hover:bg-[#f1f5f9] hover:text-[#111827] cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-bold text-[#6b7280] mb-2 tracking-wide">ชื่อเอกสาร (ไม่บังคับ)</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="เว้นว่างเพื่อใช้ชื่อไฟล์"
            className="w-full border border-[#e5e7eb] rounded-lg text-sm text-[#111827] outline-none transition-all focus:border-[#3b82f6] focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
            style={{ padding: '10px 14px' }}
          />
        </div>

        <div className="mb-4">
          <label className="block text-xs font-bold text-[#6b7280] mb-2 tracking-wide">ไฟล์ Excel</label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="w-full border border-[#e5e7eb] rounded-lg text-sm text-[#111827] bg-white"
            style={{ padding: '10px 14px' }}
          />
          {file && (
            <p className="text-xs text-[#15803d] mt-2">📄 {file.name}</p>
          )}
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="flex justify-end gap-2.5 mt-7">
          <button
            onClick={() => {
              setName('');
              setFile(null);
              setError('');
              onClose();
            }}
            className="inline-flex items-center gap-1.5 bg-white text-[#374151] border border-[#e5e7eb] rounded-lg text-xs font-semibold cursor-pointer transition-all hover:bg-[#f8fafc]"
            style={{ padding: '6px 14px' }}
          >
            ยกเลิก
          </button>
          <button
            onClick={handleImport}
            disabled={loading || !file}
            className="inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all text-white disabled:opacity-50"
            style={{ background: '#16a34a', padding: '6px 14px' }}
          >
            {loading ? 'กำลังนำเข้า...' : '📊 เริ่มนำเข้า'}
          </button>
        </div>
      </div>
    </div>
  );
}

