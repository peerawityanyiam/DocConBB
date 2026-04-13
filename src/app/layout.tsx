import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";
import SessionIdleGuard from "@/components/SessionIdleGuard";

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  variable: "--font-thai",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ระบบเอกสารคุณภาพ - รพ.สงขลานครินทร์",
  description: "ระบบติดตามและจัดการเอกสารคุณภาพ โรงพยาบาลสงขลานครินทร์",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "BBDC",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1b2e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${ibmPlexSansThai.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-[family-name:var(--font-thai)]">
        <ToastProvider>
          <SessionIdleGuard />
          {children}
          <PWAInstallPrompt />
        </ToastProvider>
      </body>
    </html>
  );
}
