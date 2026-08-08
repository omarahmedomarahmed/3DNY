'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from '@/components/brand/Logo';
import Icon, { type IconName } from '@/components/ui/Icon';

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/map', label: 'Map', icon: 'map-pin' },
  { href: '/import', label: 'Import', icon: 'upload' },
  { href: '/landlords', label: 'Landlords', icon: 'building' },
  { href: '/admin', label: 'Data', icon: 'edit' },
  { href: '/setup', label: 'Setup', icon: 'filter' },
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
      <Logo href="/" product="Spaces" height={dense ? 22 : 26} variant="nav" />

      <nav className="ml-2 hidden items-center gap-1 md:flex">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition-colors ${
                active ? 'text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              <Icon
                name={item.icon}
                size={15}
                className={active ? 'text-goldenrod-600' : 'text-subtle'}
              />
              {item.label}
              {active && (
                <span className="absolute inset-x-3 -bottom-[13px] h-[3px] bg-goldenrod" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden items-center gap-1.5 text-xs text-subtle lg:inline-flex">
          <Icon name="map-pin" size={13} />
          Midtown &amp; Midtown South
        </span>
        <Link
          href="/import"
          className="flex items-center gap-1.5 rounded bg-midnight px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-midnight-700"
        >
          <Icon name="upload" size={15} />
          Upload sheet
        </Link>
      </div>
    </header>
  );
}
