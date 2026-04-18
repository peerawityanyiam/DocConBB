'use client';

import { useState, useEffect, useRef } from 'react';
import { buildPdfFilesFromPreparedImages, prepareImagesForPdf } from '@/lib/files/image-to-pdf';
import {
  MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES,
  MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL,
  MAX_IMAGE_BATCH_COUNT,
  MAX_IMAGE_BATCH_TOTAL_BYTES,
  MAX_IMAGE_BATCH_TOTAL_LABEL,
  MAX_IMAGE_PDF_PARTS,
} from '@/lib/files/upload-limits';
import { toFriendlyErrorMessage, toUploadFailureMessage } from '@/lib/ui/friendly-error';

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

const MAX_FILE_SIZE = MAX_DIRECT_UPLOAD_FILE_SIZE_BYTES;
const MAX_IMAGE_SOURCE_TOTAL_SIZE = MAX_IMAGE_BATCH_TOTAL_BYTES;
const MAX_UPLOAD_RETRIES = 2;
const MAX_ROLLBACK_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 900;

interface UploadBatchMeta {
  id: string;
  index: number;
  total: number;
  label: string;
}

interface ImageQueueItem {
  name: string;
  status: 'pending' | 'uploading' | 'done';
  outputBytes?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableUploadError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('http_5') ||
    message.includes('http_429') ||
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('connection') ||
    message.includes('econn')
  );
}

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
  const [preparedImageFiles, setPreparedImageFiles] = useState<File[]>([]);
  const [imageQueue, setImageQueue] = useState<ImageQueueItem[]>([]);
  const [pdfImageCount, setPdfImageCount] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isConvertingImages, setIsConvertingImages] = useState(false);
  const wordInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pdfImageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch('/api/tasks/staff-list', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const data: UserOption[] = await res.json();
        setUsers(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(toFriendlyErrorMessage(err, 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ'));
      }
    })();
  }, [open]);

  function reset() {
    setTitle(''); setDetail(''); setOfficerId(''); setReviewerId(''); setError('');
    setWordFile(null);
    setPdfFile(null);
    setPreparedImageFiles([]);
    setImageQueue([]);
    setPdfImageCount(null);
    setUploadProgress(null);
    setIsConvertingImages(false);
    if (wordInputRef.current) wordInputRef.current.value = '';
    if (pdfInputRef.current) pdfInputRef.current.value = '';
    if (pdfImageInputRef.current) pdfImageInputRef.current.value = '';
  }

  function handleWordChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.docx')) { setError('รองรับเฉพาะ .docx'); return; }
    if (selected.size > MAX_FILE_SIZE) { setError(`ขนาดไฟล์ต้องไม่เกิน ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}`); return; }
    setError(''); setWordFile(selected);
  }

  function handlePdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.pdf')) { setError('รองรับเฉพาะ .pdf'); return; }
    if (selected.size > MAX_FILE_SIZE) { setError(`ขนาดไฟล์ต้องไม่เกิน ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}`); return; }
    setError('');
    setPdfFile(selected);
    setPreparedImageFiles([]);
    setImageQueue([]);
    setPdfImageCount(null);
    if (pdfImageInputRef.current) pdfImageInputRef.current.value = '';
  }

  async function handleImageToPdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedImages = Array.from(e.target.files ?? []);
    if (!selectedImages.length) return;
    const sourceTotalBytes = selectedImages.reduce((sum, file) => sum + file.size, 0);

    setError('');
    setPdfFile(null);
    if (pdfInputRef.current) pdfInputRef.current.value = '';
    setImageQueue(selectedImages.map((image) => ({
      name: image.name,
      status: 'pending',
    })));
    setIsConvertingImages(true);
    try {
      if (selectedImages.length > MAX_IMAGE_BATCH_COUNT) {
        throw new Error('too_many_images');
      }
      const nonImageFile = selectedImages.find((file) => !file.type.startsWith('image/'));
      if (nonImageFile) {
        throw new Error(`ไฟล์ ${nonImageFile.name} ไม่ใช่รูปภาพ`);
      }
      if (sourceTotalBytes > MAX_IMAGE_SOURCE_TOTAL_SIZE) {
        throw new Error('image_total_too_large');
      }

      const preparedFiles = await prepareImagesForPdf(selectedImages, (progress) => {
        setImageQueue((prev) => prev.map((item, index) => {
          if (index !== progress.index) return item;
          if (progress.status === 'processing') {
            return { ...item, status: 'uploading' };
          }
          return {
            ...item,
            status: 'done',
            outputBytes: progress.outputBytes,
          };
        }));
      });

      setPreparedImageFiles(preparedFiles);
      setPdfImageCount(selectedImages.length);
    } catch (err) {
      setPreparedImageFiles([]);
      setPdfImageCount(null);
      setImageQueue([]);
      setError(toUploadFailureMessage(err, 'ไม่สามารถเตรียมรูปเพื่อส่งได้'));
    } finally {
      setIsConvertingImages(false);
      e.target.value = '';
    }
  }

  function uploadFileOnceWithProgress(
    taskId: string,
    fileToUpload: File,
    batchMeta?: UploadBatchMeta,
  ): Promise<void> {
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
            const data = JSON.parse(xhr.responseText) as { error?: string };
            reject(new Error(data.error ?? `HTTP_${xhr.status}`));
          } catch {
            reject(new Error(`HTTP_${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error('NETWORK_UPLOAD_FAILED'));
      xhr.onabort = () => reject(new Error('UPLOAD_ABORTED'));

      const formData = new FormData();
      formData.append('file', fileToUpload);
      if (batchMeta) {
        formData.append('upload_batch_id', batchMeta.id);
        formData.append('upload_batch_index', String(batchMeta.index));
        formData.append('upload_batch_total', String(batchMeta.total));
        formData.append('upload_batch_label', batchMeta.label);
      }
      xhr.send(formData);
    });
  }

  async function uploadFileWithProgress(
    taskId: string,
    fileToUpload: File,
    batchMeta?: UploadBatchMeta,
  ): Promise<void> {
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt <= MAX_UPLOAD_RETRIES) {
      try {
        setUploadProgress(0);
        await uploadFileOnceWithProgress(taskId, fileToUpload, batchMeta);
        return;
      } catch (err) {
        lastError = err;
        if (!isRetryableUploadError(err) || attempt === MAX_UPLOAD_RETRIES) {
          throw err;
        }
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
      }
      attempt += 1;
    }
    throw lastError instanceof Error ? lastError : new Error('อัปโหลดไฟล์ไม่สำเร็จ');
  }

  async function rollbackCreatedTask(taskId: string): Promise<boolean> {
    for (let attempt = 0; attempt <= MAX_ROLLBACK_RETRIES; attempt += 1) {
      try {
        const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
        if (res.ok) return true;
      } catch {
        // continue retry
      }

      if (attempt < MAX_ROLLBACK_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
      }
    }
    return false;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!title.trim()) { setError('กรุณากรอกชื่องาน'); return; }
    if (!officerId) { setError('กรุณาเลือกผู้รับผิดชอบ'); return; }
    if (!reviewerId) { setError('กรุณาเลือกผู้ตรวจสอบ'); return; }

    setLoading(true);
    setUploadProgress(null);
    let createdTaskId: string | null = null;
    try {
      // 1) Create the task
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), detail: detail.trim(), officer_id: officerId, reviewer_id: reviewerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'เกิดข้อผิดพลาด');
      createdTaskId = data.id ?? null;
      if (!createdTaskId) throw new Error('MISSING_TASK_ID');

      // 2) Upload files if selected
      if (wordFile) {
        setUploadProgress(0);
        await uploadFileWithProgress(createdTaskId, wordFile);
      }
      if (pdfFile) {
        setUploadProgress(0);
        await uploadFileWithProgress(createdTaskId, pdfFile);
      }
      if (preparedImageFiles.length > 0) {
        setIsConvertingImages(true);
        const generatedPdfFiles = await buildPdfFilesFromPreparedImages(preparedImageFiles);
        if (generatedPdfFiles.length > MAX_IMAGE_PDF_PARTS) {
          throw new Error('too_many_pdf_parts');
        }
        const hasImageBatchMeta = generatedPdfFiles.length > 1;
        const pdfBatchId = hasImageBatchMeta ? `imgpdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : '';
        const pdfBatchLabel = generatedPdfFiles[0].name.replace(/-part-\d+\.pdf$/i, '.pdf');
        for (let index = 0; index < generatedPdfFiles.length; index += 1) {
          const file = generatedPdfFiles[index];
          const batchMeta = hasImageBatchMeta
            ? {
                id: pdfBatchId,
                index: index + 1,
                total: generatedPdfFiles.length,
                label: pdfBatchLabel,
              }
            : undefined;
          setUploadProgress(0);
          await uploadFileWithProgress(createdTaskId, file, batchMeta);
        }
      }

      reset();
      onCreated();
      onClose();
    } catch (err) {
      if (createdTaskId) {
        const rolledBack = await rollbackCreatedTask(createdTaskId);
        if (rolledBack) {
          setError(toUploadFailureMessage(err, 'อัปโหลดไฟล์ไม่สำเร็จ ระบบลบงานที่เพิ่งสร้างอัตโนมัติแล้ว'));
          return;
        }
        setError(toUploadFailureMessage(err, 'อัปโหลดไฟล์ไม่สำเร็จ และไม่สามารถลบงานที่สร้างไว้ได้ กรุณาลบงานด้วยตนเอง'));
        return;
      }
      setError(toFriendlyErrorMessage(err, 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsConvertingImages(false);
      setLoading(false);
      setUploadProgress(null);
    }
  }

  if (!open) return null;

  const isUploading = uploadProgress !== null || isConvertingImages;
  const progressValue = uploadProgress ?? 0;
  const uploadStatusLabel = isConvertingImages ? 'กำลังเตรียมรูป / รวม PDF...' : 'กำลังอัปโหลดไฟล์...';
  const imagePickerStatusText = isConvertingImages
    ? 'กำลังเตรียมรูป...'
    : (pdfImageCount
      ? `เลือกรูปแล้ว ${pdfImageCount} รูป`
      : 'ยังไม่ได้เลือกไฟล์...');
  const attachmentQueue = [
    wordFile ? `Word: ${wordFile.name}` : null,
    pdfFile ? `PDF: ${pdfFile.name}` : null,
    preparedImageFiles.length > 0 ? `ภาพ: ${preparedImageFiles.length} รูป (รวมเป็น PDF ตอนกดสร้างงาน)` : null,
  ].filter((item): item is string => item !== null);
  const attachmentSummaryLabel = attachmentQueue.length > 0
    ? attachmentQueue.join(' | ')
    : 'ยังไม่ได้เลือกไฟล์แนบ';
  const attachmentSummaryHint = attachmentQueue.length > 0
    ? (preparedImageFiles.length > 0
      ? 'ระบบจะรวมภาพที่อัปโหลดครบแล้วเป็น PDF ตอนกดสร้างงาน'
      : 'ระบบจะอัปโหลดไฟล์เหล่านี้ทันทีหลังสร้างงาน')
    : `เลือกไฟล์ Word / PDF (ไม่เกิน ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}) หรือใช้ปุ่มแนบภาพ (สูงสุด ${MAX_IMAGE_BATCH_COUNT} รูป / ${MAX_IMAGE_BATCH_TOTAL_LABEL} ต่อครั้ง, แตก PDF ได้สูงสุด ${MAX_IMAGE_PDF_PARTS} part)`;
  const submitDisabledReason = isConvertingImages
    ? 'กรุณารอระบบเตรียมรูปให้ครบก่อน'
    : (loading ? 'ระบบกำลังสร้างงานและอัปโหลดไฟล์ กรุณารอสักครู่' : '');

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-3 sm:p-4"
      onClick={() => { reset(); onClose(); }}
    >
      <div className="flex min-h-full items-start justify-center sm:items-center">
        <div
          className="bg-white rounded-xl shadow-[0_12px_40px_rgba(13,27,46,0.13)] w-full max-w-lg border-none max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
        {/* Header - matches ref modal with accent bg */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e2e8f0]" style={{ background: '#00c2a8', borderRadius: '12px 12px 0 0' }}>
          <h2 className="text-[0.95rem] font-bold text-white flex items-center gap-2">
            + สร้างงานใหม่
          </h2>
          <button onClick={() => { reset(); onClose(); }} className="text-white/80 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

          {/* File attachments - word + pdf */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-[#0d1b2e]">
              แนบไฟล์เอกสาร <span className="text-[#6b7f96] font-normal">(ไม่บังคับ)</span>
            </label>
            <div className={`rounded-lg border px-3 py-2 text-xs ${attachmentQueue.length > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
              <p className="font-semibold">ไฟล์ที่พร้อมส่ง</p>
              <p className="mt-0.5 break-all">{attachmentSummaryLabel}</p>
              <p className="mt-0.5 text-[0.68rem] opacity-80">{attachmentSummaryHint}</p>
            </div>
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
              <div className="mt-2 flex items-center gap-3 min-w-0 text-sm text-gray-600">
                <button
                  type="button"
                  onClick={() => pdfImageInputRef.current?.click()}
                  disabled={loading || isConvertingImages}
                  className="inline-flex items-center px-4 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-semibold hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  🖼️ แนบภาพ
                </button>
                <span className="flex-1 min-w-0 truncate">{imagePickerStatusText}</span>
              </div>
              {pdfFile && (
                <div className="flex items-center gap-2 mt-1.5 text-xs text-green-700">
                  <span>✅ {pdfFile.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPdfFile(null);
                      setPreparedImageFiles([]);
                      setImageQueue([]);
                      setPdfImageCount(null);
                      if (pdfInputRef.current) pdfInputRef.current.value = '';
                      if (pdfImageInputRef.current) pdfImageInputRef.current.value = '';
                    }}
                    className="text-red-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              )}
              {imageQueue.length > 0 && (
                <div className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-2 max-h-32 overflow-y-auto">
                  {imageQueue.map((item, index) => (
                    <p key={`${item.name}-${index}`} className="text-[0.7rem] text-amber-800 break-all">
                      {`รูป ${index + 1} ${item.status === 'uploading' ? 'กำลังเตรียม' : item.status === 'done' ? 'เตรียมแล้ว' : 'รอเตรียม'}: ${item.name}`}
                    </p>
                  ))}
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
            <div className="bg-[#fee2e2] border border-[#fecaca] rounded-lg px-3 py-2 text-sm text-[#991b1b] whitespace-pre-line">
              {error}
            </div>
          )}

          </div>

          <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-3 border-t border-[#e2e8f0]">
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3">
            <button type="button" onClick={() => { reset(); onClose(); }}
              className="px-4 py-2 text-sm text-[#374f6b] border border-[#e2e8f0] rounded-lg hover:bg-[#f8fafc] font-semibold">
              ยกเลิก
            </button>
            <button type="submit" disabled={loading || isConvertingImages}
              title={submitDisabledReason || undefined}
              className="px-5 py-2 text-white font-semibold text-sm rounded-lg disabled:opacity-50 transition-colors"
              style={{ background: '#00c2a8' }}>
              {loading ? (isUploading ? 'กำลังอัปโหลด...' : 'กำลังสร้าง...') : '📨 สร้างงาน'}
            </button>
          </div>
          {submitDisabledReason && (
            <p className="text-[0.68rem] text-amber-700 text-right mt-2">
              ℹ {submitDisabledReason}
            </p>
          )}
          </div>
        </form>
      </div>
      </div>
    </div>
  );
}

