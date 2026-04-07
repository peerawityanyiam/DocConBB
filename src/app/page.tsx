import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/guards';
import LogoutButton from './LogoutButton';

export const dynamic = 'force-dynamic';

const cards = [
  {
    title: 'ระบบติดตามเอกสาร',
    icon: '🚀',
    description: 'ส่งงาน สั่งงาน ตรวจสอบความคืบหน้า',
    href: '/tracking',
  },
  {
    title: 'Document Control',
    icon: '📑',
    description: 'จัดการระบบเอกสารคุณภาพ',
    href: '/library',
  },
];

export default async function Home() {
  const user = await getAuthUser('hub');
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen flex-col bg-[#f8f9fa]" style={{ fontFamily: "'Sarabun', 'IBM Plex Sans Thai', sans-serif" }}>
      {/* Navbar - matches ref: dark #212529 */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#212529] shadow-sm" style={{ height: '45px' }}>
        <div className="max-w-[900px] mx-auto px-5 h-full flex items-center justify-between">
          <span className="text-white/80 text-sm font-normal tracking-wide">
            {user.email}
          </span>
          <LogoutButton />
        </div>
      </nav>

      {/* Content - centered vertically */}
      <div className="flex-1 flex flex-col items-center justify-center px-4" style={{ paddingTop: '50px' }}>
        <div className="w-[90%] max-w-[900px] text-center">
          <h1 className="text-[2.4rem] font-bold text-[#003366] mb-2.5" style={{ letterSpacing: '-0.5px' }}>
            สวัสดีครับ 👋
          </h1>
          <p className="text-[1.1rem] text-[#555] font-normal mb-12">
            ยินดีต้อนรับสู่ระบบสนับสนุนการทำงานคุณภาพ
          </p>

          <div className="grid gap-[30px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            {cards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="group flex flex-col items-center bg-white rounded-xl border border-[#eee] border-t-[5px] border-t-[#003366] shadow-[0_4px_15px_rgba(0,0,0,0.05)] no-underline text-inherit transition-all duration-400 hover:-translate-y-[5px] hover:shadow-[0_12px_25px_rgba(0,0,0,0.1)] hover:border-t-[#c5a059]"
                style={{ padding: '45px 35px' }}
              >
                <div className="text-[45px] mb-6" style={{ filter: 'grayscale(20%)' }}>{card.icon}</div>
                <h2 className="text-[1.5rem] font-semibold text-[#003366] mb-3 m-0">{card.title}</h2>
                <p className="text-base text-[#666] leading-relaxed m-0">{card.description}</p>
                <span className="mt-6 bg-[#f1f5f9] text-[#003366] px-5 py-1.5 rounded text-[0.85rem] font-semibold border border-[#e2e8f0]">
                  เข้าใช้งานระบบ
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Footer - matches ref */}
      <footer className="w-full py-8 bg-white border-t border-[#eaeaea] text-center text-[0.9rem] text-[#777]">
        <div>
          สงวนสิทธิ์การใช้งานเฉพาะ{' '}
          <span className="font-semibold text-[#333]">หน่วยคลังเลือดและเวชศาสตร์บริการโลหิต โรงพยาบาลสงขลานครินทร์</span>{' '}
          เท่านั้น
        </div>
        <div className="mt-1">
          หากพบปัญหาการใช้งานหรือต้องการความช่วยเหลือ กรุณาติดต่อ{' '}
          <span className="text-[#003366] border-b border-[#ccc]">ผู้ดูแลระบบ</span>
        </div>
      </footer>
    </div>
  );
}
