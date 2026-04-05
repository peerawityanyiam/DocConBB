'use client';

import { useState } from 'react';

interface User {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  roles: UserRole[];
}

interface UserRole {
  role: string;
  project_id: string;
  project_slug: string;
  project_name: string;
}

interface Props {
  user: User | null; // null = สร้างใหม่
  onSave: (user: User) => void;
  onClose: () => void;
}

export default function UserFormModal({ user, onSave, onClose }: Props) {
  const isEdit = !!user;
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let res: Response;
      if (isEdit) {
        res = await fetch(`/api/users/${user.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name: displayName }),
        });
      } else {
        const fullEmail = email.includes('@') ? email : `${email}@medicine.psu.ac.th`;
        res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: fullEmail, display_name: displayName }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'เกิดข้อผิดพลาด');
        return;
      }

      onSave({ ...data, roles: data.roles ?? user?.roles ?? [] });
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-bold text-lg text-slate-900">
            {isEdit ? 'แก้ไขข้อมูลผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              ชื่อ-นามสกุล <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="เช่น นายสมชาย ใจดี"
              required
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                อีเมล <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center border border-slate-300 rounded-lg focus-within:ring-2 focus-within:ring-slate-900 overflow-hidden">
                <input
                  type="text"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="username"
                  required
                  className="flex-1 px-3 py-2 text-sm focus:outline-none"
                />
                <span className="bg-slate-100 px-3 py-2 text-sm text-slate-500 border-l border-slate-300">
                  @medicine.psu.ac.th
                </span>
              </div>
            </div>
          )}

          {isEdit && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">อีเมล</label>
              <p className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500">
                {user.email}
              </p>
              <p className="text-xs text-slate-400 mt-1">อีเมลไม่สามารถเปลี่ยนได้</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {loading ? 'กำลังบันทึก...' : isEdit ? 'บันทึก' : 'เพิ่มผู้ใช้'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
