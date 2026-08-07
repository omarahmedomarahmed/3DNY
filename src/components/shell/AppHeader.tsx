'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from '@/components/brand/Logo';

const NAV = [
  { href: '/map', label: 'Map' },
  { href: '/import', label: 'Import' },
  { href: '/landlords', label: 'Landlords' },
  { href: '/setup', label: 'Setup' },
];

/**
 * The application chrome. Deliberately shallow — a broker in a meeting should
 * never be more than one click from the map.
 */
export default function AppHeader({ dense = false }: { dense?: boolean }) {
  const pathname = usePathname();

  return (
    <header
      className={`flex shrink-0 items-center gap-6 border-b border-hairline bg-white px-5 ${
        dense ? 'h-14' : 'h-16'
      }`}
    >
      <Logo href="/" product="Spaces" height={dense ? 22 : 26} />

      <nav className="ml-2 hidden items-center gap-1 md:flex">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative rounded px-3 py-2 text-sm transition-colors ${
                active ? 'text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {item.label}
              {active && (
                <span className="absolute inset-x-3 -bottom-[13px] h-[3px] bg-goldenrod" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-xs text-subtle lg:inline">
          Midtown &amp; Midtown South
        </span>
        <Link
          href="/import"
          className="rounded bg-midnight px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-midnight-700"
        >
          Upload sheet
        </Link>
      </div>
    </header>
  );
}
