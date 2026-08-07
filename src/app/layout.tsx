import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '3DNYC — Manhattan Office Leasing',
  description: 'Interactive 3D availability map for Manhattan office space.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full bg-ink text-[#e6edf3]">{children}</body>
    </html>
  );
}
