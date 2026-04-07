'use client';

import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';

export default function LibraryNavbar() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
    });
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-[1000] flex items-center justify-between shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
      style={{
        backgroundColor: '#1a1d20',
        height: '40px',
        padding: '0 15px',
        color: 'white',
      }}
    >
      <div className="flex items-center text-[0.8rem] font-light text-[#e0e0e0] gap-1.5">
        <span>👤</span>
        <span>{email ?? '—'}</span>
      </div>
      <button
        onClick={handleLogout}
        className="flex items-center gap-1.5 bg-transparent text-white border border-white/30 rounded px-2.5 py-0.5 text-[0.75rem] cursor-pointer transition-all hover:bg-white/10"
        style={{ fontFamily: "'Sarabun', sans-serif" }}
      >
        ↪ Logout
      </button>
    </nav>
  );
}
