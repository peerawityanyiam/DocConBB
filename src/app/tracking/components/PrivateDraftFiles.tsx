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

export default function PrivateDraftFiles({ task, userId, onUpdated }: PrivateDraftFilesProps) {
  const [files, setFiles] = useState<PrivateDraftFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'โหลดรายการไฟล์ฝากไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  }, [isTaskOwner, task.id]);

  useEffect(() => {
    setSuccess('');
    void loadFiles();
  }, [loadFiles, task.id]);

  const askReplaceIfDuplicate = useCallback((incomingName: string) => {
    const incoming = normalizeName(incomingName);
    const duplicated = files.some((item) => (
      normalizeName(item.original_file_name) === incoming
      || normalizeName(item.drive_file_name) === incoming
    ));
    if (!duplicated) return false;
    return window.confirm(
      'พบไฟล์ชื่อซ้ำในไฟล์ฝากส่วนตัวของงานนี้\nกด "ตกลง" เพื่อแทนที่ไฟล์เดิม\nกด "ยกเลิก" เพื่อบันทึกเป็นชื่อใหม่แบบ (2)'
    );
  }, [files]);

  async function uploadDraft(file: File) {
    setUploading(true);
    setError('');
    setSuccess('');
    try {
      const replaceExisting = askReplaceIfDuplicate(file.name);
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

  async function onSelectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    await uploadDraft(selected);
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
    <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50/40 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-cyan-700">
          🧳 ไฟล์ฝากส่วนตัว (เห็นเฉพาะคุณ)
        </p>
        <span className="text-[0.68rem] text-cyan-700/80">
          ลบอัตโนมัติเมื่องานเสร็จ/ยกเลิก
        </span>
      </div>

      {!isClosedTask && (
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.pdf,image/*"
            onChange={(event) => void onSelectFile(event)}
            disabled={uploading}
            className="w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-cyan-100 file:text-cyan-800 hover:file:bg-cyan-200 cursor-pointer disabled:opacity-60"
          />
          <p className="text-[0.68rem] text-slate-600">
            รองรับ Word / PDF / รูปภาพ • จำกัดขนาดต่อไฟล์ 4MB
          </p>
        </div>
      )}

      {isClosedTask && (
        <p className="text-[0.72rem] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2">
          งานนี้สิ้นสุดแล้ว ระบบปิดการฝากไฟล์ใหม่
        </p>
      )}

      {error && (
        <p className="text-xs text-red-600 whitespace-pre-line">⚠️ {error}</p>
      )}
      {success && (
        <p className="text-xs text-green-700">{success}</p>
      )}

      <div className="rounded-md border border-cyan-100 bg-white">
        {loading ? (
          <p className="text-xs text-slate-500 px-3 py-3">กำลังโหลดไฟล์ฝาก...</p>
        ) : files.length === 0 ? (
          <p className="text-xs text-slate-500 px-3 py-3">ยังไม่มีไฟล์ฝากในงานนี้</p>
        ) : (
          <ul className="divide-y divide-cyan-100">
            {files.map((item) => (
              <li key={item.id} className="px-3 py-2.5 flex items-start gap-2">
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
  );
}
