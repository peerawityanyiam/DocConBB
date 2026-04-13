'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ui/Toast';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_WARNING_MS = 2 * 60 * 1000; // 2 minutes before auto-logout
const PUBLIC_PATH_PREFIXES = ['/login', '/callback'];

export default function SessionIdleGuard() {
  const pathname = usePathname();
  const { toast } = useToast();
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResetAtRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (warnTimerRef.current) {
      clearTimeout(warnTimerRef.current);
      warnTimerRef.current = null;
    }
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
  }, []);

  const signOutForIdle = useCallback(async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      window.location.href = '/login?error=idle';
    }
  }, []);

  const resetIdleTimers = useCallback(() => {
    const now = Date.now();
    // Avoid resetting too often on noisy events (scroll/mousemove)
    if (now - lastResetAtRef.current < 1000) return;
    lastResetAtRef.current = now;

    clearTimers();

    warnTimerRef.current = setTimeout(() => {
      toast('ไม่มีการใช้งาน ระบบจะออกจากบัญชีอัตโนมัติในอีก 2 นาที', 'warning');
    }, IDLE_TIMEOUT_MS - IDLE_WARNING_MS);

    logoutTimerRef.current = setTimeout(() => {
      void signOutForIdle();
    }, IDLE_TIMEOUT_MS);
  }, [clearTimers, signOutForIdle, toast]);

  useEffect(() => {
    if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix))) {
      clearTimers();
      return;
    }

    const onActivity = () => {
      resetIdleTimers();
    };

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

    resetIdleTimers();

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, onActivity);
      });
      clearTimers();
    };
  }, [clearTimers, pathname, resetIdleTimers]);

  return null;
}
