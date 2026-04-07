import Navbar from '@/components/Navbar';

export default function TrackingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navbar />
      <main className="flex-1" style={{ background: '#f0f4f8' }}>{children}</main>
    </>
  );
}
