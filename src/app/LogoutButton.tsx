'use client';

import { createClient } from '@/lib/supabase/client';

export default function LogoutButton() {
  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  return (
    <button
      onClick={handleLogout}
      className="px-3 py-1 text-xs bg-transparent hover:bg-[#dc3545] text-white border border-white rounded transition-all hover:border-[#dc3545]"
      style={{ fontFamily: "'Sarabun', sans-serif" }}
    >
      ออกจากระบบ
    </button>
  );
}
