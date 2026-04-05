import Navbar from '@/components/Navbar';

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navbar />
      <main className="flex-1 bg-slate-50">{children}</main>
    </>
  );
}
