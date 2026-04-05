'use client';

import { useState } from 'react';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/constants/roles';
import type { AppRole } from '@/lib/auth/guards';
import UserFormModal from './UserFormModal';
import RoleAssignmentModal from './RoleAssignmentModal';

export interface UserRole {
  role: AppRole;
  project_id: string;
  project_slug: string;
  project_name: string;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  roles: UserRole[];
}

export interface Project {
  id: string;
  name: string;
  slug: string;
}

interface Props {
  initialUsers: UserRow[];
  projects: Project[];
  currentUserId: string;
}

export default function UserManagement({ initialUsers, projects, currentUserId }: Props) {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [roleUser, setRoleUser] = useState<UserRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const filtered = users.filter(
    u =>
      u.display_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: users.length,
    active: users.filter(u => u.is_active).length,
    inactive: users.filter(u => !u.is_active).length,
  };

  /* ─── Actions ─────────────────────────────────────────────── */

  const handleToggleActive = async (user: UserRow) => {
    setTogglingId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      if (res.ok) {
        setUsers(prev =>
          prev.map(u => u.id === user.id ? { ...u, is_active: !u.is_active } : u)
        );
      }
    } finally {
      setTogglingId(null);
    }
  };

  const handleUserSaved = (saved: UserRow) => {
    setUsers(prev => {
      const idx = prev.findIndex(u => u.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...prev[idx], ...saved };
        return next;
      }
      return [saved, ...prev];
    });
    setAddOpen(false);
    setEditUser(null);
  };

  const handleRolesSaved = (userId: string, newRoles: UserRole[]) => {
    setUsers(prev =>
      prev.map(u => u.id === userId ? { ...u, roles: newRoles } : u)
    );
    setRoleUser(null);
  };

  /* ─── Render ───────────────────────────────────────────────── */

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">จัดการผู้ใช้งาน</h1>
        <p className="text-slate-500 text-sm mt-1">
          บริหารสิทธิ์บุคลากร {stats.total} คน
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'ทั้งหมด', value: stats.total, color: 'text-slate-900' },
          { label: 'ใช้งานอยู่', value: stats.active, color: 'text-green-600' },
          { label: 'ปิดใช้งาน', value: stats.inactive, color: 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-5 py-4">
            <p className="text-slate-500 text-xs mb-1">{s.label}</p>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="ค้นหาชื่อหรืออีเมล..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="px-4 py-2 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
        >
          + เพิ่มผู้ใช้
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                <th className="px-4 py-3 font-semibold text-slate-600 w-64">ชื่อ-อีเมล</th>
                <th className="px-4 py-3 font-semibold text-slate-600">สิทธิ์การใช้งาน</th>
                <th className="px-4 py-3 font-semibold text-slate-600 text-center w-24">สถานะ</th>
                <th className="px-4 py-3 font-semibold text-slate-600 text-right w-52">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(user => (
                <tr key={user.id} className="hover:bg-slate-50/60 transition-colors">
                  {/* Name + email */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-sm font-bold text-slate-600 shrink-0">
                        {user.display_name[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{user.display_name}</p>
                        <p className="text-slate-400 text-xs truncate">{user.email}</p>
                      </div>
                    </div>
                  </td>

                  {/* Roles */}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.length === 0 ? (
                        <span className="text-slate-400 text-xs italic">ยังไม่กำหนดสิทธิ์</span>
                      ) : (
                        user.roles.map((r, i) => (
                          <span
                            key={i}
                            title={r.project_name}
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[r.role]}`}
                          >
                            {ROLE_LABELS[r.role]}
                          </span>
                        ))
                      )}
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                      user.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {user.is_active ? 'ใช้งาน' : 'ปิดแล้ว'}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setRoleUser(user)}
                        className="px-3 py-1.5 text-xs bg-purple-100 text-purple-700 hover:bg-purple-200 rounded-lg transition-colors"
                      >
                        สิทธิ์
                      </button>
                      <button
                        onClick={() => setEditUser(user)}
                        className="px-3 py-1.5 text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
                      >
                        แก้ไข
                      </button>
                      {user.id !== currentUserId && (
                        <button
                          onClick={() => handleToggleActive(user)}
                          disabled={togglingId === user.id}
                          className={`px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-40 ${
                            user.is_active
                              ? 'bg-red-100 text-red-700 hover:bg-red-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {togglingId === user.id
                            ? '...'
                            : user.is_active ? 'ปิด' : 'เปิด'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400 text-sm">
                    {search ? `ไม่พบผู้ใช้ที่ค้นหา "${search}"` : 'ยังไม่มีผู้ใช้ในระบบ'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {(addOpen || editUser) && (
        <UserFormModal
          user={editUser}
          onSave={saved => handleUserSaved(saved as UserRow)}
          onClose={() => { setAddOpen(false); setEditUser(null); }}
        />
      )}
      {roleUser && (
        <RoleAssignmentModal
          user={roleUser}
          projects={projects}
          onSave={handleRolesSaved}
          onClose={() => setRoleUser(null)}
        />
      )}
    </div>
  );
}
