import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/guards';
import LogoutButton from './LogoutButton';

export const dynamic = 'force-dynamic';

const DOCUMENT_CONTROL_GAS_URL =
  process.env.NEXT_PUBLIC_DOCUMENT_CONTROL_GAS_URL ||
  'https://accounts.google.com/AccountChooser?continue=https://script.google.com/a/macros/medicine.psu.ac.th/s/AKfycbx0oytFnXvNDaMfPkfLTUQKd8zr-uHpNhuaJNv2csLnM3pKADaWxpa0laQcVciTvRe-/exec';

const cards = [
  {
    title: 'à¸£à¸°à¸šà¸šà¸•à¸´à¸”à¸•à¸²à¸¡à¹€à¸­à¸à¸ªà¸²à¸£',
    icon: 'ðŸš€',
    description: 'à¸ªà¹ˆà¸‡à¸‡à¸²à¸™ à¸ªà¸±à¹ˆà¸‡à¸‡à¸²à¸™ à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¸„à¸§à¸²à¸¡à¸„à¸·à¸šà¸«à¸™à¹‰à¸²',
    href: '/tracking',
  },
  {
    title: 'BB Document Control',
    icon: 'ðŸ“‘',
    description: 'à¸ˆà¸±à¸”à¸à¸²à¸£à¸£à¸°à¸šà¸šà¹€à¸­à¸à¸ªà¸²à¸£à¸„à¸¸à¸“à¸ à¸²à¸ž',
    href: DOCUMENT_CONTROL_GAS_URL,
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
            à¸ªà¸§à¸±à¸ªà¸”à¸µà¸„à¸£à¸±à¸š ðŸ‘‹
          </h1>
          <p className="text-[1.1rem] text-[#555] font-normal mb-12">
            à¸¢à¸´à¸™à¸”à¸µà¸•à¹‰à¸­à¸™à¸£à¸±à¸šà¸ªà¸¹à¹ˆà¸£à¸°à¸šà¸šà¸ªà¸™à¸±à¸šà¸ªà¸™à¸¸à¸™à¸à¸²à¸£à¸—à¸³à¸‡à¸²à¸™à¸„à¸¸à¸“à¸ à¸²à¸ž
          </p>

          <div className="grid gap-[30px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            {cards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="group relative flex cursor-pointer flex-col items-center rounded-xl border border-[#eee] border-t-[5px] border-t-[#003366] bg-white text-inherit no-underline shadow-[0_4px_15px_rgba(0,0,0,0.05)] transition-all duration-300 ease-out hover:-translate-y-[5px] hover:border-t-[#c5a059] hover:shadow-[0_12px_25px_rgba(0,0,0,0.1)] active:translate-y-[1px] active:scale-[0.985] active:shadow-[0_6px_14px_rgba(0,0,0,0.08)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003366]/20"
                style={{ padding: '45px 35px' }}
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-[#0ea5a3]/40 opacity-0 transition-opacity duration-150 group-active:opacity-100" />
                <div className="text-[45px] mb-6" style={{ filter: 'grayscale(20%)' }}>{card.icon}</div>
                <h2 className="text-[1.5rem] font-semibold text-[#003366] mb-3 m-0">{card.title}</h2>
                <p className="text-base text-[#666] leading-relaxed m-0">{card.description}</p>
                <span className="mt-6 rounded border border-[#e2e8f0] bg-[#f1f5f9] px-5 py-1.5 text-[0.85rem] font-semibold text-[#003366] transition-colors duration-150 group-active:bg-[#e2e8f0]">
                  à¹€à¸‚à¹‰à¸²à¹ƒà¸Šà¹‰à¸‡à¸²à¸™à¸£à¸°à¸šà¸š
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Footer - matches ref */}
      <footer className="w-full py-8 bg-white border-t border-[#eaeaea] text-center text-[0.9rem] text-[#777]">
        <div>
          à¸ªà¸‡à¸§à¸™à¸ªà¸´à¸—à¸˜à¸´à¹Œà¸à¸²à¸£à¹ƒà¸Šà¹‰à¸‡à¸²à¸™à¹€à¸‰à¸žà¸²à¸°{' '}
          <span className="font-semibold text-[#333]">à¸«à¸™à¹ˆà¸§à¸¢à¸„à¸¥à¸±à¸‡à¹€à¸¥à¸·à¸­à¸”à¹à¸¥à¸°à¹€à¸§à¸Šà¸¨à¸²à¸ªà¸•à¸£à¹Œà¸šà¸£à¸´à¸à¸²à¸£à¹‚à¸¥à¸«à¸´à¸• à¹‚à¸£à¸‡à¸žà¸¢à¸²à¸šà¸²à¸¥à¸ªà¸‡à¸‚à¸¥à¸²à¸™à¸„à¸£à¸´à¸™à¸—à¸£à¹Œ</span>{' '}
          à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™
        </div>
        <div className="mt-1">
          à¸«à¸²à¸à¸žà¸šà¸›à¸±à¸à¸«à¸²à¸à¸²à¸£à¹ƒà¸Šà¹‰à¸‡à¸²à¸™à¸«à¸£à¸·à¸­à¸•à¹‰à¸­à¸‡à¸à¸²à¸£à¸„à¸§à¸²à¸¡à¸Šà¹ˆà¸§à¸¢à¹€à¸«à¸¥à¸·à¸­ à¸à¸£à¸¸à¸“à¸²à¸•à¸´à¸”à¸•à¹ˆà¸­{' '}
          <span className="text-[#003366] border-b border-[#ccc]">à¸œà¸¹à¹‰à¸”à¸¹à¹à¸¥à¸£à¸°à¸šà¸š</span>
        </div>
      </footer>
    </div>
  );
}


