'use client';

import { useState } from 'react';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/constants/roles';
import type { AppRole } from '@/lib/auth/guards';

interface UserRole {
  role: AppRole;
  project_id: string;
  project_slug: string;
  project_name: string;
}

interface User {
  id: string;
  email: string;
  display_name: string;
  roles: UserRole[];
}

interface Project {
  id: string;
  name: string;
  slug: string;
}

interface Props {
  user: User;
  projects: Project[];
  onSave: (userId: string, newRoles: UserRole[]) => void;
  onClose: () => void;
}

const ALL_ROLES: AppRole[] = ['STAFF', 'DOCCON', 'REVIEWER', 'BOSS', 'SUPER_BOSS', 'SUPER_ADMIN'];

export default function RoleAssignmentModal({ user, projects, onSave, onClose }: Props) {
  // currentRoles: set of "projectId|role" strings
  const [currentRoles, setCurrentRoles] = useState<Set<string>>(
    new Set(user.roles.map(r => `${r.project_id}|${r.role}`))
  );
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const hasRole = (projectId: string, role: AppRole) =>
    currentRoles.has(`${projectId}|${role}`);

  const toggleRole = async (project: Project, role: AppRole) => {
    const key = `${project.id}|${role}`;
    const isCurrentlyOn = currentRoles.has(key);

    setLoading(prev => new Set([...prev, key]));
    setError('');

    try {
      const res = await fetch(`/api/users/${user.id}/roles`, {
        method: isCurrentlyOn ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id, role }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'เกิดข้อผิดพลาด');
        return;
      }

      setCurrentRoles(prev => {
        const next = new Set(prev);
        if (isCurrentlyOn) next.delete(key);
        else next.add(key);
        return next;
      });
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setLoading(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleClose = () => {
    // ส่ง roles ที่อัปเดตแล้วกลับไป
    const newRoles: UserRole[] = [];
    currentRoles.forEach(key => {
      const [projectId, role] = key.split('|');
      const project = projects.find(p => p.id === projectId);
      if (project) {
        newRoles.push({
          role: role as AppRole,
          project_id: projectId,
          project_slug: project.slug,
          project_name: project.name,
        });
      }
    });
    onSave(user.id, newRoles);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="font-bold text-lg text-slate-900">กำหนดสิทธิ์การใช้งาน</h2>
            <p className="text-sm text-slate-500">{user.display_name} · {user.email}</p>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {projects.map(project => (
            <div key={project.id}>
              <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3">
                {project.name}
              </h3>
              <div className="space-y-2">
                {ALL_ROLES.map(role => {
                  const key = `${project.id}|${role}`;
                  const isOn = hasRole(project.id, role);
                  const isLoading = loading.has(key);

                  return (
                    <label
                      key={role}
                      className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                        isOn
                          ? 'border-slate-900 bg-slate-50'
                          : 'border-slate-200 hover:border-slate-300'
                      } ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={isOn}
                          onChange={() => toggleRole(project, role)}
                          className="sr-only"
                        />
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          isOn ? 'bg-slate-900 border-slate-900' : 'border-slate-300'
                        }`}>
                          {isOn && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-1">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[role]}`}>
                          {ROLE_LABELS[role]}
                        </span>
                        {isLoading && (
                          <svg className="animate-spin w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 shrink-0">
          <button
            onClick={handleClose}
            className="w-full px-4 py-2 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-800 transition-colors"
          >
            เสร็จสิ้น
          </button>
        </div>
      </div>
    </div>
  );
}
