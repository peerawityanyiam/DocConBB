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
              <label className="block text-sm font-medium text-slate-700 mb-1">เจ้าหน้าที่ผู้รับงาน <span className="text-red-500">*</span></label>
              <select
                value={officerId}
                onChange={e => setOfficerId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              >
                <option value="">-- เลือก --</option>
                {users.filter(u => u.roles?.includes('STAFF')).map(u => (
                  <option key={u.id} value={u.id}>{u.display_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">ผู้ตรวจสอบ <span className="text-red-500">*</span></label>
              <select
                value={reviewerId}
                onChange={e => setReviewerId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              >
                <option value="">-- เลือก --</option>
                {users.filter(u => u.roles?.includes('REVIEWER')).map(u => (
                  <option key={u.id} value={u.id}>{u.display_name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* File attachment */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">แนบไฟล์</label>
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
                className="w-full border-2 border-dashed border-slate-300 rounded-lg px-4 py-3 flex items-center justify-center gap-2 text-sm text-slate-500 hover:border-yellow-400 hover:text-slate-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                แนบไฟล์ (ไม่บังคับ)
              </button>
            ) : (
              <div className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm text-slate-700 truncate flex-1">{file.name}</span>
                <span className="text-xs text-slate-400 shrink-0">{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                <button
                  type="button"
                  onClick={removeFile}
                  className="text-slate-400 hover:text-red-500 text-lg leading-none shrink-0"
                  title="ลบไฟล์"
                >
                  &times;
                </button>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-1">รองรับ .docx, .pdf ขนาดไม่เกิน 50MB</p>
          </div>

          {/* Upload progress */}
          {isUploading && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>กำลังอัปโหลดไฟล์...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div
                  className="bg-yellow-400 h-2 rounded-full transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

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
              {loading ? (isUploading ? 'กำลังอัปโหลด...' : 'กำลังสร้าง...') : 'สร้างงาน'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
