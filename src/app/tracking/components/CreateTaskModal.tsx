'use client';

import { useState, useEffect, useRef } from 'react';
import { buildPdfFromImages } from '@/lib/files/image-to-pdf';

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

export default function CreateTaskModal({ open, onClose, onCreated }: CreateTaskModalProps) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [officerId, setOfficerId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfImageCount, setPdfImageCount] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isConvertingImages, setIsConvertingImages] = useState(false);
  const wordInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pdfImageInputRef = useRef<HTMLInputElement>(null);

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
    setWordFile(null); setPdfFile(null); setPdfImageCount(null); setUploadProgress(null); setIsConvertingImages(false);
    if (wordInputRef.current) wordInputRef.current.value = '';
    if (pdfInputRef.current) pdfInputRef.current.value = '';
    if (pdfImageInputRef.current) pdfImageInputRef.current.value = '';
  }

  function handleWordChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.docx')) { setError('รองรับเฉพาะ .docx'); return; }
    if (selected.size > MAX_FILE_SIZE) { setError('ขนาดไฟล์ต้องไม่เกิน 50MB'); return; }
    setError(''); setWordFile(selected);
  }

  function handlePdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.pdf')) { setError('รองรับเฉพาะ .pdf'); return; }
    if (selected.size > MAX_FILE_SIZE) { setError('ขนาดไฟล์ต้องไม่เกิน 50MB'); return; }
    setError(''); setPdfFile(selected); setPdfImageCount(null);
  }

  async function handleImageToPdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedImages = Array.from(e.target.files ?? []);
    if (!selectedImages.length) return;

    setError('');
    setIsConvertingImages(true);
    try {
      const nonImageFile = selectedImages.find((file) => !file.type.startsWith('image/'));
      if (nonImageFile) {
        throw new Error(`ไฟล์ ${nonImageFile.name} ไม่ใช่รูปภาพ`);
      }

      const mergedPdf = await buildPdfFromImages(selectedImages);
      if (mergedPdf.size > MAX_FILE_SIZE) {
        throw new Error('ไฟล์ PDF ที่รวมจากรูปมีขนาดเกิน 50MB');
      }

      setPdfFile(mergedPdf);
      setPdfImageCount(selectedImages.length);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถรวมรูปเป็น PDF ได้');
    } finally {
      setIsConvertingImages(false);
      e.target.value = '';
    }
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

      // 2) Upload files if selected
      if (wordFile) {
        setUploadProgress(0);
        await uploadFileWithProgress(data.id, wordFile);
      }
      if (pdfFile) {
        setUploadProgress(0);
        await uploadFileWithProgress(data.id, pdfFile);
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

  const isUploading = uploadProgress !== null || isConvertingImages;
  const progressValue = uploadProgress ?? 0;
  const uploadStatusLabel = isConvertingImages ? 'กำลังรวมภาพเป็น PDF...' : 'กำลังอัปโหลดไฟล์...';
  const pdfDisplayName = pdfFile
    ? (pdfImageCount && pdfFile.name.toLowerCase().endsWith('.pdf')
      ? `${pdfFile.name} (${pdfImageCount} รูป)`
      : pdfFile.name)
    : '';

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

          {/* File attachments — word + pdf */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-[#0d1b2e]">
              แนบไฟล์เอกสาร <span className="text-[#6b7f96] font-normal">(ไม่บังคับ)</span>
            </label>
            {/* Word */}
            <div className="border border-[#e2e8f0] rounded-lg p-3 bg-[#f8fafc]">
              <label className="text-xs font-semibold text-[#374f6b] mb-1.5 block">📄 ไฟล์ Word (.docx)</label>
              <input
                ref={wordInputRef}
                type="file"
                accept=".docx"
                onChange={handleWordChange}
                className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
              />
              {wordFile && (
                <div className="flex items-center gap-2 mt-1.5 text-xs text-green-700">
                  <span>✅ {wordFile.name}</span>
                  <button type="button" onClick={() => { setWordFile(null); if (wordInputRef.current) wordInputRef.current.value = ''; }} className="text-red-400 hover:text-red-600">✕</button>
                </div>
              )}
            </div>
            {/* PDF */}
            <div className="border border-[#e2e8f0] rounded-lg p-3 bg-[#f8fafc]">
              <label className="text-xs font-semibold text-[#374f6b] mb-1.5 block">📋 ไฟล์ PDF (.pdf)</label>
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf"
                onChange={handlePdfChange}
                className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100 cursor-pointer"
              />
              <input
                ref={pdfImageInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageToPdfChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => pdfImageInputRef.current?.click()}
                disabled={loading || isConvertingImages}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#fde68a] bg-[#fffbeb] text-[#b45309] text-xs font-semibold hover:bg-[#fef3c7] disabled:opacity-50"
              >
                {isConvertingImages ? 'กำลังรวมภาพเป็น PDF...' : '🖼️ แนบภาพ'}
              </button>
              <p className="text-[0.65rem] text-[#6b7f96] mt-1">
                หากอัปหลายรูป ระบบจะรวมเป็น PDF อัตโนมัติ
              </p>
              {pdfFile && (
                <div className="flex items-center gap-2 mt-1.5 text-xs text-green-700">
                  <span>✅ {pdfDisplayName}</span>
                  <button type="button" onClick={() => { setPdfFile(null); setPdfImageCount(null); if (pdfInputRef.current) pdfInputRef.current.value = ''; }} className="text-red-400 hover:text-red-600">✕</button>
                </div>
              )}
            </div>
          </div>

          {/* Upload progress */}
          {isUploading && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-[#6b7f96]">
                <span>{uploadStatusLabel}</span>
                <span>{isConvertingImages ? '-' : `${progressValue}%`}</span>
              </div>
              <div className="w-full bg-[#e2e8f0] rounded-full" style={{ height: '6px' }}>
                <div
                  className="rounded-full transition-all duration-200"
                  style={{ width: `${progressValue}%`, height: '6px', background: '#00c2a8' }}
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
            <button type="submit" disabled={loading || isConvertingImages}
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
