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
    accent: 'border-l-[#003366]',
  },
  {
    title: 'Document Control',
    icon: '📑',
    description: 'จัดการระบบเอกสารคุณภาพ',
    href: '/library',
    accent: 'border-l-[#c5a059]',
  },
];

export default async function Home() {
  const user = await getAuthUser('hub');
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f5f5]">
      {/* Navbar */}
      <nav className="sticky top-0 z-40 bg-[#003366] shadow-md">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏥</span>
            <span className="text-white font-semibold text-sm">ระบบเอกสารคุณภาพ</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-white/80 text-xs hidden sm:block">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl text-center">
          <h1 className="text-4xl font-bold text-[#003366]">สวัสดีครับ 👋</h1>
          <p className="mt-2 text-lg text-gray-600">
            ยินดีต้อนรับสู่ระบบสนับสนุนการทำงานคุณภาพ
          </p>

          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {cards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className={`group relative rounded-2xl border border-gray-200 border-l-4 ${card.accent} bg-white p-6 shadow-sm transition hover:shadow-md`}
              >
                <span className="absolute right-3 top-3 rounded-full bg-[#c5a059] px-3 py-0.5 text-xs font-medium text-white">
                  เข้าใช้งานระบบ
                </span>
                <div className="mb-3 text-4xl">{card.icon}</div>
                <h2 className="text-xl font-semibold text-[#003366]">{card.title}</h2>
                <p className="mt-1 text-sm text-gray-500">{card.description}</p>
              </Link>
            ))}
          </div>

          <footer className="mt-16 text-xs text-gray-400">
            สงวนสิทธิ์การใช้งานเฉพาะ หน่วยคลังเลือดและเวชศาสตร์บริการโลหิต
            โรงพยาบาลสงขลานครินทร์ เท่านั้น
          </footer>
        </div>
      </div>
    </div>
  );
}
