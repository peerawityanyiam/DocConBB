'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';

const NAV_ITEMS = [
  { href: '/tracking', label: 'ติดตามเอกสาร' },
  { href: '/library', label: 'คลังเอกสาร' },
  { href: '/admin', label: 'จัดการผู้ใช้' },
];

const ROLE_LABEL: Record<string, string> = {
  STAFF: 'เจ้าหน้าที่',
  BOSS: 'ผู้สั่งงาน',
  DOCCON: 'DocCon',
  REVIEWER: 'ผู้ตรวจสอบ',
  SUPER_BOSS: 'หัวหน้างาน',
  SUPER_ADMIN: 'ผู้ดูแลระบบ',
};

const ROLE_BADGE_COLOR: Record<string, string> = {
  STAFF: 'bg-[#00c2a8] text-white',
  BOSS: 'bg-[#fbbf24] text-black',
  DOCCON: 'bg-[#a78bfa] text-white',
  REVIEWER: 'bg-[#10b981] text-white',
  SUPER_BOSS: 'bg-[#ec4899] text-white',
  SUPER_ADMIN: 'bg-[#f97316] text-white',
};

export default function Navbar() {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      setEmail(user?.email ?? null);
      if (user?.email) {
        // Fetch user info including roles
        try {
          const res = await fetch('/api/me');
          if (res.ok) {
            const data = await res.json();
            setDisplayName(data.display_name ?? null);
            setRoles(data.roles ?? []);
          }
        } catch { /* ignore */ }
      }
    });
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <nav
      className="sticky top-0 z-50 shadow-[0_2px_12px_rgba(0,0,0,0.15)]"
      style={{
        background: '#0d1b2e',
        borderBottom: '3px solid #00c2a8',
        padding: '0.55rem 0',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
        {/* Brand */}
        <Link href="/tracking" className="flex items-center gap-2 text-white font-bold text-sm no-underline" style={{ letterSpacing: '-0.2px' }}>
          <span style={{ color: '#00c2a8' }}>📋</span>
          <span>ระบบติดตามเอกสาร</span>
        </Link>

        {/* Desktop Nav Links */}
        <div className="hidden md:flex items-center gap-1 ml-6">
          {NAV_ITEMS.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                pathname.startsWith(item.href)
                  ? 'bg-[#00c2a8] text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        {/* User Info + Role Badges */}
        <div className="hidden md:flex items-center gap-3 ml-auto">
          <div className="text-right leading-tight">
            {displayName && (
              <div className="text-white font-semibold text-xs">{displayName}</div>
            )}
            {email && (
              <div className="text-cyan-300 text-[0.7rem]">{email}</div>
            )}
          </div>
          {/* Role badges */}
          <div className="flex gap-1">
            {roles.map(r => (
              <span
                key={r}
                className={`text-[0.62rem] px-2 py-0.5 rounded-full font-bold tracking-wide whitespace-nowrap ${ROLE_BADGE_COLOR[r] ?? 'bg-slate-500 text-white'}`}
              >
                {ROLE_LABEL[r] ?? r}
              </span>
            ))}
          </div>
          <button
            onClick={handleLogout}
            className="ml-1 p-1.5 text-slate-400 hover:text-white border border-white/20 rounded-md transition-colors"
            title="ออกจากระบบ"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

        {/* Mobile menu button */}
        <button
          className="md:hidden p-2 text-white"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile Nav */}
      {menuOpen && (
        <div className="md:hidden px-4 pb-3 space-y-1 mt-2">
          {NAV_ITEMS.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                pathname.startsWith(item.href)
                  ? 'bg-[#00c2a8] text-white'
                  : 'text-slate-300 hover:bg-white/10'
              }`}
            >
              {item.label}
            </Link>
          ))}
          <div className="border-t border-white/10 pt-2 mt-2">
            {/* Role badges mobile */}
            {roles.length > 0 && (
              <div className="flex flex-wrap gap-1 px-3 mb-2">
                {roles.map(r => (
                  <span key={r} className={`text-[0.62rem] px-2 py-0.5 rounded-full font-bold ${ROLE_BADGE_COLOR[r] ?? 'bg-slate-500 text-white'}`}>
                    {ROLE_LABEL[r] ?? r}
                  </span>
                ))}
              </div>
            )}
            {email && (
              <p className="px-3 py-1 text-xs text-slate-400">{email}</p>
            )}
            <button
              onClick={handleLogout}
              className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/10 rounded-lg"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
