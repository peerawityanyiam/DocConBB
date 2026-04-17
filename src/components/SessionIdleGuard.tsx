'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_WARNING_MS = 2 * 60 * 1000; // show warning in last 2 minutes
const PUBLIC_PATH_PREFIXES = ['/login', '/callback'];

const LAST_ACTIVITY_KEY = 'bbdc:last_activity_at';
const LOGOUT_SIGNAL_KEY = 'bbdc:idle_logout_signal';
const CHANNEL_NAME = 'bbdc:session';

type SessionChannelMessage =
  | { type: 'activity'; at: number }
  | { type: 'logout'; at: number };

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function SessionIdleGuard() {
  const pathname = usePathname();
  const isPublicPath = useMemo(
    () => PUBLIC_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix)),
    [pathname],
  );

  const [warningVisible, setWarningVisible] = useState(false);
  const [countdownMs, setCountdownMs] = useState(IDLE_WARNING_MS);

  const lastResetAtRef = useRef(0);
  const lastActivityAtRef = useRef(Date.now());
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const signingOutRef = useRef(false);

  const readLastActivityAt = useCallback((): number => {
    try {
      const raw = window.localStorage.getItem(LAST_ACTIVITY_KEY);
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return Date.now();
  }, []);

  const writeLastActivityAt = useCallback((at: number) => {
    lastActivityAtRef.current = at;
    try {
      window.localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
    } catch {
      // ignore storage errors
    }
  }, []);

  const signalLogout = useCallback((at: number) => {
    try {
      window.localStorage.setItem(LOGOUT_SIGNAL_KEY, String(at));
    } catch {
      // ignore storage errors
    }

    try {
      channelRef.current?.postMessage({ type: 'logout', at } satisfies SessionChannelMessage);
    } catch {
      // ignore channel errors
    }
  }, []);

  const signOutForIdle = useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;

    const logoutAt = Date.now();
    signalLogout(logoutAt);

    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      window.location.href = '/login?error=idle';
    }
  }, [signalLogout]);

  const broadcastActivity = useCallback((at: number) => {
    try {
      channelRef.current?.postMessage({ type: 'activity', at } satisfies SessionChannelMessage);
    } catch {
      // ignore channel errors
    }
  }, []);

  const markActivity = useCallback(
    (force = false) => {
      const now = Date.now();
      if (!force && now - lastResetAtRef.current < 1000) return;

      lastResetAtRef.current = now;
      setWarningVisible(false);
      setCountdownMs(IDLE_WARNING_MS);
      writeLastActivityAt(now);
      broadcastActivity(now);
    },
    [broadcastActivity, writeLastActivityAt],
  );

  useEffect(() => {
    if (isPublicPath) {
      setWarningVisible(false);
      return;
    }

    signingOutRef.current = false;

    const initAt = readLastActivityAt();
    lastActivityAtRef.current = initAt;
    if (!window.localStorage.getItem(LAST_ACTIVITY_KEY)) {
      writeLastActivityAt(initAt);
    }

    if (typeof BroadcastChannel !== 'undefined') {
      channelRef.current = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current.onmessage = (event: MessageEvent<SessionChannelMessage>) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'activity' && Number.isFinite(msg.at)) {
          if (msg.at > lastActivityAtRef.current) {
            lastActivityAtRef.current = msg.at;
            setWarningVisible(false);
          }
        }

        if (msg.type === 'logout') {
          window.location.href = '/login?error=idle';
        }
      };
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === LAST_ACTIVITY_KEY && event.newValue) {
        const at = Number(event.newValue);
        if (Number.isFinite(at) && at > lastActivityAtRef.current) {
          lastActivityAtRef.current = at;
          setWarningVisible(false);
        }
      }

      if (event.key === LOGOUT_SIGNAL_KEY && event.newValue) {
        window.location.href = '/login?error=idle';
      }
    };

    const onActivity = () => markActivity(false);

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'scroll',
      'touchstart',
      'mousemove',
    ];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, onActivity, { passive: true });
    });
    window.addEventListener('storage', onStorage);

    tickTimerRef.current = setInterval(() => {
      const idleMs = Date.now() - lastActivityAtRef.current;
      const remainingMs = IDLE_TIMEOUT_MS - idleMs;

      if (remainingMs <= 0) {
        void signOutForIdle();
        return;
      }

      if (remainingMs <= IDLE_WARNING_MS) {
        setWarningVisible(true);
        setCountdownMs(remainingMs);
      } else {
        setWarningVisible(false);
      }
    }, 1000);

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, onActivity);
      });
      window.removeEventListener('storage', onStorage);

      if (tickTimerRef.current) {
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }

      if (channelRef.current) {
        channelRef.current.close();
        channelRef.current = null;
      }
    };
  }, [isPublicPath, markActivity, readLastActivityAt, signOutForIdle, writeLastActivityAt]);

  if (isPublicPath || !warningVisible) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-amber-200 bg-white p-5 shadow-2xl">
        <div className="mb-2 text-base font-bold text-slate-800">กำลังจะออกจากระบบอัตโนมัติ</div>
        <p className="text-sm text-slate-600">
          ไม่มีการใช้งานในช่วงที่ผ่านมา ระบบจะออกจากบัญชีในอีก{' '}
          <span className="font-semibold text-amber-700">{formatCountdown(countdownMs)}</span>
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              void signOutForIdle();
            }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            ออกจากระบบเลย
          </button>
          <button
            type="button"
            onClick={() => markActivity(true)}
            className="rounded-lg bg-[#00c2a8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#00ab93]"
          >
            ใช้งานต่อ
          </button>
        </div>
      </div>
    </div>
  );
}
