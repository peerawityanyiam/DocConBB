import LibraryNavbar from './components/LibraryNavbar';

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <LibraryNavbar />
      <main className="flex-1" style={{ background: '#f8fafc', paddingTop: '40px' }}>{children}</main>
    </>
  );
}
