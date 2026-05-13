import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser, hasGlobalRole } from '@/lib/auth/guards';
import PWAInstallButton from '@/components/PWAInstallButton';
import LogoutButton from './LogoutButton';
import HomeShortcuts from './HomeShortcuts';

export const dynamic = 'force-dynamic';

const cards = [
  {
    title: 'ระบบติดตามเอกสาร',
    icon: '🚀',
    description: 'ส่งงาน สั่งงาน และตรวจสอบความคืบหน้า',
    href: '/tracking',
  },
  {
    title: 'Document Library',
    icon: '📑',
    description: 'จัดการระบบเอกสารคุณภาพ',
    href: '/library',
  },
  {
    title: 'สแกนเอกสารเป็น PDF',
    icon: '📷',
    description: 'ถ่ายรูป ปรับภาพ และรวมเป็น PDF',
    href: '/scan',
  },
];

export default async function Home() {
  const user = await getAuthUser('hub');
  if (!user) redirect('/login');
  // Hub isn't a project slug, so user.roles is typically empty here.
  // Check SUPER_ADMIN across any project assignment + legacy roles.
  const canManageShortcuts = await hasGlobalRole(user.id, ['SUPER_ADMIN']);

  return (
    <div
      className="flex min-h-screen flex-col bg-[#f8f9fa]"
      style={{ fontFamily: "'Sarabun', 'IBM Plex Sans Thai', sans-serif" }}
    >
      <nav className="fixed left-0 right-0 top-0 z-50 bg-[#212529] shadow-sm" style={{ height: '45px' }}>
        <div className="mx-auto flex h-full max-w-[900px] items-center justify-between px-5">
          <span className="min-w-0 flex-1 truncate pr-3 text-sm font-normal tracking-wide text-white/80">
            {user.email}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <PWAInstallButton />
            <LogoutButton />
          </div>
        </div>
      </nav>

      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-10 sm:pb-12" style={{ paddingTop: '60px' }}>
        <div className="w-[90%] max-w-[900px] text-center">
          <h1 className="mb-2.5 text-[2.2rem] font-bold text-[#003366]" style={{ letterSpacing: '-0.5px' }}>
            สวัสดีครับ 👋
          </h1>
          <p className="mb-12 text-[1.05rem] font-normal text-[#555]">
            ยินดีต้อนรับสู่ระบบสนับสนุนการทำงานคุณภาพ
          </p>

          <div className="grid gap-5 sm:gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {cards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="group relative flex cursor-pointer flex-col items-center rounded-xl border border-[#eee] border-t-[4px] border-t-[#003366] bg-white px-6 py-8 text-inherit no-underline shadow-[0_4px_15px_rgba(0,0,0,0.05)] transition-all duration-300 ease-out hover:-translate-y-[4px] hover:border-t-[#c5a059] hover:shadow-[0_10px_22px_rgba(0,0,0,0.09)] active:translate-y-[1px] active:scale-[0.985] active:shadow-[0_6px_14px_rgba(0,0,0,0.08)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003366]/20 sm:px-7 sm:py-9"
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-[#0ea5a3]/40 opacity-0 transition-opacity duration-150 group-active:opacity-100" />
                <div className="mb-4 text-[36px]" style={{ filter: 'grayscale(20%)' }}>
                  {card.icon}
                </div>
                <h2 className="m-0 mb-2 text-[1.2rem] font-semibold text-[#003366] sm:text-[1.25rem]">{card.title}</h2>
                <p className="m-0 text-[0.92rem] leading-relaxed text-[#666]">{card.description}</p>
                <span className="mt-5 rounded border border-[#e2e8f0] bg-[#f1f5f9] px-4 py-1 text-[0.8rem] font-semibold text-[#003366] transition-colors duration-150 group-active:bg-[#e2e8f0]">
                  เข้าสู่การใช้งาน
                </span>
              </Link>
            ))}
          </div>

          <HomeShortcuts canManage={canManageShortcuts} />
        </div>
      </div>

      <footer className="mt-auto w-full border-t border-[#eaeaea] bg-white py-10 text-center text-[0.9rem] text-[#777] sm:py-12">
        <div>
          สงวนสิทธิ์การใช้งานเฉพาะ{' '}
          <span className="font-semibold text-[#333]">
            หน่วยคลังเลือดและเวชศาสตร์บริการโลหิต โรงพยาบาลสงขลานครินทร์
          </span>{' '}
          เท่านั้น
        </div>
        <div className="mt-1">
          หากพบปัญหาการใช้งานหรือต้องการความช่วยเหลือ กรุณาติดต่อ{' '}
          <span className="border-b border-[#ccc] text-[#003366]">ผู้ดูแลระบบ</span>
        </div>
      </footer>
    </div>
  );
}
