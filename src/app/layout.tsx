import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Cresa Spaces — Manhattan office availability',
    template: '%s · Cresa Spaces',
  },
  description:
    'Interactive 3D availability map for Manhattan office space. Upload the weekly sheet, see every available floor, compare across buildings.',
  robots: { index: false, follow: false },
  icons: { icon: '/brand/cresa-mark.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full bg-white font-sans text-body antialiased">{children}</body>
    </html>
  );
}
