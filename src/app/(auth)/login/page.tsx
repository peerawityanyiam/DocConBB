'use client';

import { createClient } from '@/lib/supabase/client';
import { AUTH_CONFIG } from '@/lib/auth/config';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';

const ERROR_MESSAGES: Record<string, string> = {
  domain: 'à¸­à¸™à¸¸à¸à¸²à¸•à¹€à¸‰à¸žà¸²à¸°à¸šà¸±à¸à¸Šà¸µ @medicine.psu.ac.th à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™',
  auth_failed: 'à¸à¸²à¸£à¸¢à¸·à¸™à¸¢à¸±à¸™à¸•à¸±à¸§à¸•à¸™à¸¥à¹‰à¸¡à¹€à¸«à¸¥à¸§ à¸à¸£à¸¸à¸“à¸²à¸¥à¸­à¸‡à¹ƒà¸«à¸¡à¹ˆ',
  no_code: 'à¹„à¸¡à¹ˆà¸žà¸šà¸£à¸«à¸±à¸ªà¸¢à¸·à¸™à¸¢à¸±à¸™ à¸à¸£à¸¸à¸“à¸²à¸¥à¸­à¸‡à¹ƒà¸«à¸¡à¹ˆ',
  not_registered: 'à¸šà¸±à¸à¸Šà¸µà¸™à¸µà¹‰à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸¥à¸‡à¸—à¸°à¹€à¸šà¸µà¸¢à¸™à¹ƒà¸™à¸£à¸°à¸šà¸š à¸à¸£à¸¸à¸“à¸²à¸•à¸´à¸”à¸•à¹ˆà¸­à¸œà¸¹à¹‰à¸”à¸¹à¹à¸¥à¸£à¸°à¸šà¸š',
  idle: 'à¸£à¸°à¸šà¸šà¸­à¸­à¸à¸ˆà¸²à¸à¸šà¸±à¸à¸Šà¸µà¸­à¸±à¸•à¹‚à¸™à¸¡à¸±à¸•à¸´ à¹€à¸™à¸·à¹ˆà¸­à¸‡à¸ˆà¸²à¸à¹„à¸¡à¹ˆà¸¡à¸µà¸à¸²à¸£à¹ƒà¸Šà¹‰à¸‡à¸²à¸™',
};

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const [loadingMode, setLoadingMode] = useState<'login' | null>(null);
  const [localError, setLocalError] = useState('');

  const errorMessage = useMemo(() => {
    if (localError) return localError;
    if (!error) return '';
    return ERROR_MESSAGES[error] || 'à¹€à¸à¸´à¸”à¸‚à¹‰à¸­à¸œà¸´à¸”à¸žà¸¥à¸²à¸” à¸à¸£à¸¸à¸“à¸²à¸¥à¸­à¸‡à¹ƒà¸«à¸¡à¹ˆ';
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
      setLocalError('à¹€à¸£à¸´à¹ˆà¸¡à¹€à¸‚à¹‰à¸²à¸ªà¸¹à¹ˆà¸£à¸°à¸šà¸šà¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ à¸à¸£à¸¸à¸“à¸²à¸¥à¸­à¸‡à¹ƒà¸«à¸¡à¹ˆà¸­à¸µà¸à¸„à¸£à¸±à¹‰à¸‡');
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
              à¸£à¸°à¸šà¸šà¸ªà¸™à¸±à¸šà¸ªà¸™à¸¸à¸™à¸à¸²à¸£à¸—à¸³à¸‡à¸²à¸™à¸„à¸¸à¸“à¸ à¸²à¸ž
            </h1>
            <p className="mt-2 text-sm text-cyan-100/90 sm:text-base">
              à¸«à¸™à¹ˆà¸§à¸¢à¸„à¸¥à¸±à¸‡à¹€à¸¥à¸·à¸­à¸” à¸£à¸ž.à¸ªà¸‡à¸‚à¸¥à¸²à¸™à¸„à¸£à¸´à¸™à¸—à¸£à¹Œ
            </p>

          </section>

          <section className="rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_20px_55px_rgba(26,39,63,0.14)] backdrop-blur sm:p-8">
            <div className="mb-6 flex items-center gap-3">
              <div className="relative h-12 w-12 overflow-hidden rounded-2xl bg-gradient-to-br from-[#00c2a8] to-[#0d1b2e] text-white shadow-lg">
                <span className="absolute left-2 top-1 text-[0.58rem] font-bold tracking-wide">BB</span>
                <span className="absolute bottom-1.5 right-2 text-sm">ðŸ“„</span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#2f68ff]">Secure Login</p>
                <p className="text-sm font-semibold text-slate-800">à¹€à¸‚à¹‰à¸²à¸ªà¸¹à¹ˆà¸£à¸°à¸šà¸šà¸”à¹‰à¸§à¸¢à¸šà¸±à¸à¸Šà¸µ Google</p>
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
              className="group w-full rounded-xl bg-[#0d1b2e] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_25px_rgba(13,27,46,0.28)] transition hover:bg-[#132e52] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="inline-flex items-center justify-center gap-2">
                {loadingMode === 'login' ? 'à¸à¸³à¸¥à¸±à¸‡à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­...' : 'à¹€à¸‚à¹‰à¸²à¸ªà¸¹à¹ˆà¸£à¸°à¸šà¸šà¸”à¹‰à¸§à¸¢ Google'}
              </span>
            </button>

            <p className="mt-5 text-center text-xs text-slate-400">
              à¹ƒà¸Šà¹‰à¸šà¸±à¸à¸Šà¸µ @medicine.psu.ac.th à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™
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
        <div className="text-white">à¸à¸³à¸¥à¸±à¸‡à¹‚à¸«à¸¥à¸”...</div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}

