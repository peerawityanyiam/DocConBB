'use client';

import { useState, useRef, useCallback } from 'react';
import type { Standard } from './StandardCard';

interface UploadModalProps {
  standard: Standard | null;
  onClose: () => void;
  onUploaded: () => void;
}

export default function UploadModal({ standard, onClose, onUploaded }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  async function handleUpload() {
    if (!file || !standard) return;
    setError('');
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('standardId', standard.id);

      // XMLHttpRequest เพื่อดู progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            try {
              const d = JSON.parse(xhr.responseText);
              reject(new Error(d.error ?? 'อัปโหลดไม่สำเร็จ'));
            } catch {
              reject(new Error('อัปโหลดไม่สำเร็จ'));
            }
          }
        });
        xhr.addEventListener('error', () => reject(new Error('เกิดข้อผิดพลาดในการเชื่อมต่อ')));
        xhr.open('POST', '/api/library/files/upload');
        xhr.send(formData);
      });

      setProgress(100);
      onUploaded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      setProgress(null);
    }
  }

  if (!standard) return null;

  const ALLOWED_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'image/jpeg', 'image/png',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">อัปโหลดไฟล์</h2>
            <p className="text-xs text-slate-500 truncate max-w-xs">{standard.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragging ? 'border-yellow-400 bg-yellow-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.doc,.xlsx,.xls,.jpg,.jpeg,.png"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div>
                <p className="text-2xl mb-2">📄</p>
                <p className="font-medium text-slate-800 text-sm">{file.name}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setFile(null); }}
                  className="mt-2 text-xs text-red-500 hover:text-red-700">
                  เปลี่ยนไฟล์
                </button>
              </div>
            ) : (
              <div>
                <p className="text-3xl mb-2">⬆️</p>
                <p className="text-sm font-medium text-slate-600">ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์</p>
                <p className="text-xs text-slate-400 mt-1">PDF, DOCX, XLSX, JPG, PNG (สูงสุด 50MB)</p>
              </div>
            )}
          </div>

          {/* Progress */}
          {progress !== null && (
            <div>
              <div className="flex justify-between text-xs text-slate-600 mb-1">
                <span>กำลังอัปโหลด...</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div
                  className="bg-yellow-400 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Warning: old file will be replaced */}
          {standard.drive_file_name && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-xs text-orange-700">
              ⚠️ การอัปโหลดใหม่จะแทนที่ไฟล์เดิม: <strong>{standard.drive_file_name}</strong>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">ยกเลิก</button>
            <button
              onClick={handleUpload}
              disabled={!file || progress !== null}
              className="px-5 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-50 transition-colors">
              {progress !== null ? `${progress}%` : 'อัปโหลด'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
