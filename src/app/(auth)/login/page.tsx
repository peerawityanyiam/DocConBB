'use client';

import { createClient } from '@/lib/supabase/client';
import { AUTH_CONFIG } from '@/lib/auth/config';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';

const ERROR_MESSAGES: Record<string, string> = {
  domain: 'อนุญาตเฉพาะบัญชี @medicine.psu.ac.th เท่านั้น',
  auth_failed: 'การยืนยันตัวตนล้มเหลว กรุณาลองใหม่',
  no_code: 'ไม่พบรหัสยืนยัน กรุณาลองใหม่',
  not_registered: 'บัญชีนี้ยังไม่ได้ลงทะเบียนในระบบ กรุณาติดต่อผู้ดูแลระบบ',
  idle: 'ระบบออกจากบัญชีอัตโนมัติ เนื่องจากไม่มีการใช้งาน',
};

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const [loadingMode, setLoadingMode] = useState<'login' | null>(null);
  const [localError, setLocalError] = useState('');

  const errorMessage = useMemo(() => {
    if (localError) return localError;
    if (!error) return '';
    return ERROR_MESSAGES[error] || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
  }, [error, localError]);

  const startGoogleLogin = async () => {
    if (loadingMode) return;
    setLocalError('');
    setLoadingMode('login');

    const supabase = createClient();
    try {
      // Shared-device safety: clear existing app session before starting OAuth
      await supabase.auth.signOut();
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          queryParams: {
            ...AUTH_CONFIG.oauthQueryParams,
            prompt: 'select_account',
          },
          redirectTo: `${window.location.origin}/callback`,
        },
      });
    } catch {
      setLocalError('เริ่มเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      setLoadingMode(null);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-x-hidden bg-[#eef3fb] px-4 py-6 sm:px-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-16 h-64 w-64 rounded-full bg-[#12c6ab]/25 blur-3xl sm:h-72 sm:w-72" />
        <div className="absolute top-16 right-0 h-72 w-72 rounded-full bg-[#0d1b2e]/15 blur-3xl sm:h-80 sm:w-80" />
      </div>

      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_24px_55px_rgba(26,39,63,0.18)]">
        <section className="bg-gradient-to-br from-[#0d1b2e] via-[#132a4a] to-[#163965] px-6 py-7 text-white sm:px-7 sm:py-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-white/90">
            BB document center
          </div>
          <h1 className="mt-4 text-xl font-bold leading-tight sm:text-2xl">
            ระบบสนับสนุนการทำงานคุณภาพ
          </h1>
          <p className="mt-2 text-sm text-cyan-100/90">
            หน่วยคลังเลือด รพ.สงขลานครินทร์
          </p>
        </section>

        <section className="px-5 py-5 sm:px-6 sm:py-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="h-12 w-12 overflow-hidden rounded-xl">
              <Image
                src="/icons/icon-192.png"
                alt="BB icon"
                width={48}
                height={48}
                className="h-full w-full scale-110 object-cover"
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#2f68ff]">App login</p>
              <p className="text-sm font-semibold text-slate-800">เข้าสู่ระบบ</p>
            </div>
          </div>

          {errorMessage && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          <button
            onClick={() => void startGoogleLogin()}
            disabled={loadingMode !== null}
            className="w-full rounded-xl bg-[#0d1b2e] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_25px_rgba(13,27,46,0.28)] transition hover:bg-[#132e52] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMode === 'login' ? 'กำลังเชื่อมต่อ...' : 'เข้าสู่ระบบด้วย Google'}
          </button>

          <p className="mt-4 text-center text-xs text-slate-500">
            ใช้บัญชี @medicine.psu.ac.th เท่านั้น
          </p>
        </section>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
          <div className="text-white">กำลังโหลด...</div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
