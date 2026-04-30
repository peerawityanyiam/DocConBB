'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}

function isIOSDevice() {
  if (typeof window === 'undefined') return false;
  const platform = window.navigator.platform;
  const userAgent = window.navigator.userAgent;
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
}

export default function PWAInstallButton() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installedByEvent, setInstalledByEvent] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const isInstalled = installedByEvent || (mounted && isStandaloneDisplay());
  const isIOS = mounted && isIOSDevice();

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setInstalledByEvent(true);
      setShowInstructions(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  async function handleInstallClick() {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (outcome === 'accepted') {
        setInstalledByEvent(true);
      }
      return;
    }

    setShowInstructions(true);
  }

  if (!mounted || isInstalled) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className="whitespace-nowrap rounded border border-white/70 bg-transparent px-3 py-1 text-xs text-white transition-all hover:border-[#c5a059] hover:bg-[#c5a059] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        style={{ fontFamily: "'Sarabun', sans-serif" }}
      >
        ติดตั้งแอป
      </button>

      {showInstructions ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 text-left shadow-2xl">
            <h2 className="text-lg font-semibold text-[#003366]">ติดตั้งแอป</h2>
            {isIOS ? (
              <div className="mt-3 space-y-2 text-sm leading-6 text-[#334155]">
                <p>บน iPhone/iPad ให้เปิดหน้านี้ด้วย Safari</p>
                <p>กดปุ่ม Share แล้วเลือก Add to Home Screen</p>
              </div>
            ) : (
              <div className="mt-3 space-y-2 text-sm leading-6 text-[#334155]">
                <p>ถ้า browser ไม่แสดงหน้าติดตั้ง ให้เปิดเมนูของ Chrome หรือ Edge</p>
                <p>เลือก Install app หรือ Add to Home screen</p>
              </div>
            )}
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                className="rounded bg-[#003366] px-4 py-2 text-sm font-semibold text-white hover:bg-[#002244] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003366]/40"
              >
                เข้าใจแล้ว
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
