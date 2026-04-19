'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Task } from './TaskCard';
import { toFriendlyErrorMessage } from '@/lib/ui/friendly-error';

interface PrivateDraftFilesProps {
  task: Task;
  userId: string;
  onUpdated?: () => void;
}

interface PrivateDraftFileItem {
  id: string;
  uploader_id?: string;
  drive_file_id: string;
  drive_file_name: string;
  original_file_name: string;
  file_type: string | null;
  file_size_bytes: number | null;
  created_at: string;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DRAFT_NOTICE_STORAGE_KEY = 'tracking:draft_upload_notice_seen_v1';

export default function PrivateDraftFiles({ task, userId, onUpdated }: PrivateDraftFilesProps) {
  const [files, setFiles] = useState<PrivateDraftFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [showFirstUploadNotice, setShowFirstUploadNotice] = useState(false);
  const [hasSeenUploadNotice, setHasSeenUploadNotice] = useState(false);
  const [duplicateFile, setDuplicateFile] = useState<File | null>(null);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isClosedTask = task.status === 'COMPLETED' || task.status === 'CANCELLED';
  const isTaskOwner = task.created_by === userId || task.officer_id === userId || task.reviewer_id === userId;

  const loadFiles = useCallback(async () => {
    if (!isTaskOwner) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/tasks/${task.id}/draft-files`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP_${res.status}`);
      const incoming = Array.isArray(data.files) ? (data.files as PrivateDraftFileItem[]) : [];
      setFiles(incoming.filter((item) => !item.uploader_id || item.uploader_id === userId));
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'โหลดรายการไฟล์ฝากไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  }, [isTaskOwner, task.id, userId]);

  useEffect(() => {
    setSuccess('');
    void loadFiles();
  }, [loadFiles, task.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setHasSeenUploadNotice(window.localStorage.getItem(DRAFT_NOTICE_STORAGE_KEY) === '1');
  }, []);

  const hasDuplicateName = useCallback((incomingName: string) => {
    const incoming = normalizeName(incomingName);
    return files.some((item) => (
      normalizeName(item.original_file_name) === incoming
      || normalizeName(item.drive_file_name) === incoming
    ));
  }, [files]);

  async function uploadDraft(file: File, replaceExisting: boolean) {
    setUploading(true);
    setError('');
    setSuccess('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('replace_existing', replaceExisting ? '1' : '0');

      const res = await fetch(`/api/tasks/${task.id}/draft-files`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP_${res.status}`);

      setSuccess(replaceExisting ? 'แทนที่ไฟล์ฝากเรียบร้อยแล้ว' : 'ฝากไฟล์เรียบร้อยแล้ว');
      await loadFiles();
      onUpdated?.();
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ฝากไฟล์ไม่สำเร็จ'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleUploadButtonClick() {
    if (uploading || isClosedTask) return;
    setError('');
    setSuccess('');
    if (!hasSeenUploadNotice) {
      setShowFirstUploadNotice(true);
      return;
    }
    openFilePicker();
  }

  function handleConfirmFirstNotice() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DRAFT_NOTICE_STORAGE_KEY, '1');
    }
    setHasSeenUploadNotice(true);
    setShowFirstUploadNotice(false);
    openFilePicker();
  }

  function closeDuplicateModal() {
    setShowDuplicateModal(false);
    setDuplicateFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleDuplicateChoice(mode: 'replace' | 'keep' | 'cancel') {
    const targetFile = duplicateFile;
    if (!targetFile) {
      closeDuplicateModal();
      return;
    }
    if (mode === 'cancel') {
      closeDuplicateModal();
      return;
    }
    setShowDuplicateModal(false);
    await uploadDraft(targetFile, mode === 'replace');
    setDuplicateFile(null);
  }

  async function onSelectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (hasDuplicateName(selected.name)) {
      setDuplicateFile(selected);
      setShowDuplicateModal(true);
      return;
    }
    await uploadDraft(selected, false);
  }

  async function deleteDraft(draftId: string) {
    setDeletingId(draftId);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/tasks/${task.id}/draft-files?draft_id=${encodeURIComponent(draftId)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP_${res.status}`);

      setSuccess('ลบไฟล์ฝากเรียบร้อยแล้ว');
      await loadFiles();
      onUpdated?.();
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ลบไฟล์ฝากไม่สำเร็จ'));
    } finally {
      setDeletingId(null);
    }
  }

  if (!isTaskOwner) return null;

  return (
    <>
      <div className="mt-3 rounded-lg border border-slate-300 bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
        >
          <span className="text-[0.72rem] font-semibold text-slate-700">ฝากไฟล์ส่วนตัว</span>
          <span className="text-slate-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
        </button>

        {isExpanded && (
          <div className="border-t border-slate-300 divide-y divide-slate-300">
            {!isClosedTask && (
              <div className="px-3 py-2.5 space-y-2 bg-slate-50/40">
                <p className="text-[0.72rem] font-normal text-slate-700">
                  แนบไฟล์ฝาก (ไม่ใช่การส่งงาน)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,.pdf,image/*"
                  onChange={(event) => void onSelectFile(event)}
                  disabled={uploading}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={handleUploadButtonClick}
                  disabled={uploading}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {uploading ? 'กำลังอัปโหลด...' : 'เลือกไฟล์ฝาก (Word / PDF / รูปภาพ)'}
                </button>
                <p className="text-[0.68rem] text-slate-500">
                  พื้นที่นี้สำหรับเก็บไฟล์ระหว่างทำงานเท่านั้น และไม่ถือว่าเป็นการส่งงาน • จำกัดขนาดต่อไฟล์ 4MB
                </p>
              </div>
            )}

            {isClosedTask && (
              <div className="px-3 py-2.5 bg-slate-50/40">
                <p className="text-[0.72rem] text-slate-700">งานนี้สิ้นสุดแล้ว ระบบปิดการฝากไฟล์ใหม่</p>
              </div>
            )}

            {(error || success) && (
              <div className="px-3 py-2 space-y-1">
                {error && (
                  <p className="text-xs text-red-600 whitespace-pre-line">⚠️ {error}</p>
                )}
                {success && (
                  <p className="text-xs text-emerald-700">{success}</p>
                )}
              </div>
            )}

            <div className="px-3 py-2.5">
              <p className="text-[0.72rem] font-medium text-slate-700">
                ไฟล์ที่ฝากแล้ว
              </p>
              {loading ? (
                <p className="text-xs text-slate-500 mt-2">กำลังโหลดไฟล์ฝาก...</p>
              ) : files.length === 0 ? (
                <p className="text-xs text-slate-500 mt-2">ยังไม่มีไฟล์ฝากในงานนี้</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {files.map((item) => (
                    <li key={item.id} className="rounded-md border border-slate-300 bg-white px-2.5 py-2.5 flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <a
                          href={`https://drive.google.com/file/d/${item.drive_file_id}/view`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-700 hover:text-blue-800 hover:underline break-all"
                        >
                          {item.drive_file_name}
                        </a>
                        <div className="text-[0.68rem] text-slate-500 mt-0.5">
                          {formatDateTime(item.created_at)} • {formatFileSize(item.file_size_bytes)}
                        </div>
                      </div>
                      {!isClosedTask && (
                        <button
                          type="button"
                          onClick={() => void deleteDraft(item.id)}
                          disabled={deletingId === item.id || uploading}
                          className="text-[0.68rem] px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingId === item.id ? '...' : 'ลบ'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {showFirstUploadNotice && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-slate-200 p-4">
            <h4 className="text-sm font-bold text-slate-900">ก่อนฝากไฟล์</h4>
            <p className="mt-2 text-sm text-slate-700 leading-relaxed">
              พื้นที่นี้ใช้สำหรับฝากไฟล์ระหว่างทำงานเท่านั้น
              <br />
              ไม่ถือว่าเป็นการส่งงาน
              <br />
              หากต้องการส่งงาน ให้ใช้ปุ่ม &ldquo;ส่งงาน&rdquo; ด้านล่างการ์ด
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowFirstUploadNotice(false)}
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmFirstNotice}
                className="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-semibold hover:bg-slate-800"
              >
                เข้าใจแล้ว เลือกไฟล์ต่อ
              </button>
            </div>
          </div>
        </div>
      )}

      {showDuplicateModal && duplicateFile && (
        <div className="fixed inset-0 z-[72] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 p-4">
            <h4 className="text-sm font-bold text-slate-900">พบชื่อไฟล์ซ้ำในพื้นที่ฝากไฟล์</h4>
            <p className="mt-2 text-sm text-slate-700 leading-relaxed">
              ไฟล์ <span className="font-semibold break-all">{duplicateFile.name}</span> มีอยู่แล้ว
              <br />
              โปรดเลือกวิธีจัดการ และย้ำอีกครั้งว่าพื้นที่นี้เป็นการฝากไฟล์ ไม่ใช่การส่งงาน
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => void handleDuplicateChoice('replace')}
                className="px-3 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600"
              >
                แทนที่ไฟล์เดิม
              </button>
              <button
                type="button"
                onClick={() => void handleDuplicateChoice('keep')}
                className="px-3 py-2 rounded-lg bg-slate-600 text-white text-sm font-semibold hover:bg-slate-700"
              >
                เก็บไว้ทั้งคู่
              </button>
              <button
                type="button"
                onClick={() => void handleDuplicateChoice('cancel')}
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
