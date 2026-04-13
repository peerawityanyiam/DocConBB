'use client';

import { createClient } from '@/lib/supabase/client';
import { AUTH_CONFIG } from '@/lib/auth/config';
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
  const [loadingMode, setLoadingMode] = useState<'login' | 'switch' | null>(null);
  const [localError, setLocalError] = useState('');

  const errorMessage = useMemo(() => {
    if (localError) return localError;
    if (!error) return '';
    return ERROR_MESSAGES[error] || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
  }, [error, localError]);

  const startGoogleLogin = async (mode: 'login' | 'switch') => {
    if (loadingMode) return;
    setLocalError('');
    setLoadingMode(mode);
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
    <div className="relative min-h-screen overflow-hidden bg-[#eef3fb]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-16 h-72 w-72 rounded-full bg-[#12c6ab]/25 blur-3xl" />
        <div className="absolute top-20 right-0 h-80 w-80 rounded-full bg-[#0d1b2e]/15 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-[#2f68ff]/15 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-8 sm:px-6 lg:px-10">
        <div className="grid w-full gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <section className="rounded-3xl border border-white/30 bg-gradient-to-br from-[#0d1b2e] via-[#132a4a] to-[#163965] p-7 text-white shadow-[0_20px_60px_rgba(13,27,46,0.28)] sm:p-9">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-white/90">
              BB Document Control
            </div>
            <h1 className="mt-4 text-2xl font-bold leading-tight sm:text-3xl">
              ระบบสนับสนุนการทำงานคุณภาพ
            </h1>
            <p className="mt-2 text-sm text-cyan-100/90 sm:text-base">
              หน่วยคลังเลือด รพ.สงขลานครินทร์
            </p>

            <div className="mt-7 space-y-3 text-sm text-white/90">
              <div className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <p>รองรับการใช้งานหลายบทบาทในระบบเดียว</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <p>เข้าสู่ระบบเฉพาะบัญชีองค์กรที่ได้รับสิทธิ์</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <p>มีการออกจากระบบอัตโนมัติเมื่อไม่ใช้งาน</p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_20px_55px_rgba(26,39,63,0.14)] backdrop-blur sm:p-8">
            <div className="mb-6 flex items-center gap-3">
              <div className="relative h-12 w-12 overflow-hidden rounded-2xl bg-gradient-to-br from-[#00c2a8] to-[#0d1b2e] text-white shadow-lg">
                <span className="absolute left-2 top-1 text-[0.58rem] font-bold tracking-wide">BB</span>
                <span className="absolute bottom-1.5 right-2 text-sm">📄</span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#2f68ff]">Secure Login</p>
                <p className="text-sm font-semibold text-slate-800">เข้าสู่ระบบด้วยบัญชี Google</p>
              </div>
            </div>

            {errorMessage && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            <button
              onClick={() => void startGoogleLogin('login')}
              disabled={loadingMode !== null}
              className="group w-full rounded-xl bg-[#0d1b2e] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_25px_rgba(13,27,46,0.28)] transition hover:bg-[#132e52] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="inline-flex items-center justify-center gap-2">
                {loadingMode === 'login' ? 'กำลังเชื่อมต่อ...' : 'เข้าสู่ระบบด้วย Google'}
              </span>
            </button>

            <button
              onClick={() => void startGoogleLogin('switch')}
              disabled={loadingMode !== null}
              className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMode === 'switch' ? 'กำลังสลับบัญชี...' : 'สลับบัญชี / ใช้บัญชีอื่น'}
            </button>

            <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-800">
              เหมาะสำหรับเครื่องที่มีหลายคนใช้งานร่วมกัน: ระบบจะล้าง session เดิมก่อนเริ่มเข้าสู่ระบบทุกครั้ง
            </div>

            <p className="mt-5 text-center text-xs text-slate-400">
              ใช้บัญชี @medicine.psu.ac.th เท่านั้น
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="text-white">กำลังโหลด...</div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
