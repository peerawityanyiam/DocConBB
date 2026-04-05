'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // แสดงหลังจาก 3 วินาที ไม่รบกวนทันที
      setTimeout(() => setShow(true), 3000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setShow(false);
    }
  }

  if (!show || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 bg-slate-900 text-white rounded-2xl shadow-2xl p-4 max-w-xs w-full flex items-center gap-3 animate-in slide-in-from-bottom-4 fade-in">
      <div className="text-2xl shrink-0">📱</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">ติดตั้งแอป</p>
        <p className="text-xs text-slate-400">ใช้งานได้แบบ offline บนมือถือ</p>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button onClick={handleInstall}
          className="px-3 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-slate-900 text-xs font-bold rounded-lg transition-colors">
          ติดตั้ง
        </button>
        <button onClick={() => setShow(false)}
          className="px-3 py-1 text-slate-400 hover:text-white text-xs rounded-lg transition-colors text-center">
          ไม่ใช่ตอนนี้
        </button>
      </div>
    </div>
  );
}
