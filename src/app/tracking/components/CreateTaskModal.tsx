'use client';

import { useState, useEffect, useRef } from 'react';

interface UserOption {
  id: string;
  display_name: string;
  email: string;
  roles?: string[];
}

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ACCEPTED_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
];

export default function CreateTaskModal({ open, onClose, onCreated }: CreateTaskModalProps) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [officerId, setOfficerId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch('/api/tasks/staff-list')
      .then(r => r.json())
      .then((data: UserOption[]) => {
        setUsers(Array.isArray(data) ? data : []);
      })
      .catch(() => setError('โหลดรายชื่อผู้ใช้ไม่สำเร็จ'));
  }, [open]);

  function reset() {
    setTitle(''); setDetail(''); setOfficerId(''); setReviewerId(''); setError('');
    setFile(null); setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    const ext = selected.name.toLowerCase().split('.').pop();
    if (!['docx', 'pdf'].includes(ext ?? '')) {
      setError('รองรับเฉพาะไฟล์ .docx และ .pdf');
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      setError('ขนาดไฟล์ต้องไม่เกิน 50MB');
      return;
    }

    setError('');
    setFile(selected);
  }

  function removeFile() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function uploadFileWithProgress(taskId: string, fileToUpload: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/tasks/${taskId}/files`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          try {
            const data = JSON.parse(xhr.responseText);
            reject(new Error(data.error ?? 'อัปโหลดไฟล์ไม่สำเร็จ'));
          } catch {
            reject(new Error('อัปโหลดไฟล์ไม่สำเร็จ'));
          }
        }
      };

      xhr.onerror = () => reject(new Error('อัปโหลดไฟล์ไม่สำเร็จ'));

      const formData = new FormData();
      formData.append('file', fileToUpload);
      xhr.send(formData);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!title.trim()) { setError('กรุณากรอกชื่องาน'); return; }
    if (!officerId) { setError('กรุณาเลือกผู้รับผิดชอบ'); return; }
    if (!reviewerId) { setError('กรุณาเลือกผู้ตรวจสอบ'); return; }

    setLoading(true);
    setUploadProgress(null);
    try {
      // 1) Create the task
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), detail: detail.trim(), officer_id: officerId, reviewer_id: reviewerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'เกิดข้อผิดพลาด');

      // 2) Upload file if selected
      if (file) {
        setUploadProgress(0);
        await uploadFileWithProgress(data.id, file);
      }

      reset();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  }

  if (!open) return null;

  const isUploading = uploadProgress !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-[0_12px_40px_rgba(13,27,46,0.13)] w-full max-w-lg border-none">
        {/* Header - matches ref modal with accent bg */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e2e8f0]" style={{ background: '#00c2a8', borderRadius: '12px 12px 0 0' }}>
          <h2 className="text-[0.95rem] font-bold text-white flex items-center gap-2">
            ＋ สร้างงานใหม่
          </h2>
          <button onClick={() => { reset(); onClose(); }} className="text-white/80 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[#0d1b2e] mb-1.5">ชื่องาน <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="ชื่องาน / ชื่อเอกสาร"
              className="w-full border border-[#e2e8f0] rounded-md px-3.5 py-2.5 text-sm text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#00c2a8]/30 focus:border-[#00c2a8]"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#0d1b2e] mb-1.5">รายละเอียด</label>
            <textarea
              value={detail}
              onChange={e => setDetail(e.target.value)}
              rows={3}
              placeholder="รายละเอียดเพิ่มเติม"
              className="w-full border border-[#e2e8f0] rounded-md px-3.5 py-2.5 text-sm text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#00c2a8]/30 focus:border-[#00c2a8] resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[#0d1b2e] mb-1.5">เจ้าหน้าที่ผู้รับงาน <span className="text-red-500">*</span></label>
              <select
                value={officerId}
                onChange={e => setOfficerId(e.target.value)}
                className="w-full border border-[#e2e8f0] rounded-md px-3.5 py-2.5 text-sm text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#00c2a8]/30 focus:border-[#00c2a8]"
              >
                <option value="">-- เลือก --</option>
                {users.filter(u => u.roles?.includes('STAFF')).map(u => (
                  <option key={u.id} value={u.id}>{u.display_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#0d1b2e] mb-1.5">ผู้ตรวจสอบ <span className="text-red-500">*</span></label>
              <select
                value={reviewerId}
                onChange={e => setReviewerId(e.target.value)}
                className="w-full border border-[#e2e8f0] rounded-md px-3.5 py-2.5 text-sm text-[#0d1b2e] focus:outline-none focus:ring-2 focus:ring-[#00c2a8]/30 focus:border-[#00c2a8]"
              >
                <option value="">-- เลือก --</option>
                {users.filter(u => u.roles?.includes('REVIEWER')).map(u => (
                  <option key={u.id} value={u.id}>{u.display_name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* File attachment (matches ref upload zone) */}
          <div>
            <label className="block text-sm font-semibold text-[#0d1b2e] mb-1.5">
              แนบไฟล์เอกสาร <span className="text-[#6b7f96] font-normal">(ไม่บังคับ)</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.pdf"
              onChange={handleFileChange}
              className="hidden"
            />
            {!file ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-[#cbd5e1] rounded-xl px-4 py-5 flex flex-col items-center gap-2 text-sm text-[#94a3b8] hover:border-[#00c2a8] hover:bg-[#e0faf7] transition-all cursor-pointer"
              >
                <span className="text-2xl">📎</span>
                <span>คลิกเพื่อเลือกไฟล์</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-[#dcfce7] border border-[#bbf7d0] rounded-lg px-3 py-2">
                <span>📄</span>
                <span className="text-sm text-[#15803d] font-semibold truncate flex-1">{file.name}</span>
                <span className="text-xs text-[#6b7f96] shrink-0">{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                <button type="button" onClick={removeFile}
                  className="text-[#6b7f96] hover:text-red-500 text-lg leading-none shrink-0" title="ลบไฟล์">&times;</button>
              </div>
            )}
            <p className="text-xs text-[#6b7f96] mt-1.5 flex items-center gap-1">
              ℹ️ รองรับ Word (.docx) และ PDF (.pdf)
            </p>
          </div>

          {/* Upload progress */}
          {isUploading && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-[#6b7f96]">
                <span>กำลังอัปโหลดไฟล์...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-[#e2e8f0] rounded-full" style={{ height: '6px' }}>
                <div
                  className="rounded-full transition-all duration-200"
                  style={{ width: `${uploadProgress}%`, height: '6px', background: '#00c2a8' }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="bg-[#fee2e2] border border-[#fecaca] rounded-lg px-3 py-2 text-sm text-[#991b1b]">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-[#e2e8f0]" style={{ paddingTop: '12px' }}>
            <button type="button" onClick={() => { reset(); onClose(); }}
              className="px-4 py-2 text-sm text-[#374f6b] border border-[#e2e8f0] rounded-lg hover:bg-[#f8fafc] font-semibold">
              ยกเลิก
            </button>
            <button type="submit" disabled={loading}
              className="px-5 py-2 text-white font-semibold text-sm rounded-lg disabled:opacity-50 transition-colors"
              style={{ background: '#00c2a8' }}>
              {loading ? (isUploading ? 'กำลังอัปโหลด...' : 'กำลังสร้าง...') : '📨 สร้างงาน'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
