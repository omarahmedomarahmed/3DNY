'use client';

import { useEffect, useState } from 'react';
import type { BuildingWithSpaces } from '@/types';

interface Stats {
  buildings: number;
  spaces: number;
  sf: number;
  rentLow: number | null;
  rentHigh: number | null;
}

/**
 * Live figures from whatever is actually loaded. If nothing has been imported
 * yet this renders the empty state rather than fake numbers — a landing page
 * showing invented inventory to a partner is worse than showing none.
 */
export default function LandingStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/buildings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((buildings: BuildingWithSpaces[]) => {
        if (cancelled || !Array.isArray(buildings)) {
          if (!cancelled) setReady(true);
          return;
        }
        const spaces = buildings.flatMap((b) => b.spaces ?? []);
        const rents = spaces
          .map((s) => s.asking_rent_psf)
          .filter((r): r is number => r !== null);
        setStats({
          buildings: buildings.length,
          spaces: spaces.length,
          sf: spaces.reduce((sum, s) => sum + (s.sf ?? 0), 0),
          rentLow: rents.length ? Math.min(...rents) : null,
          rentHigh: rents.length ? Math.max(...rents) : null,
        });
        setReady(true);
      })
      .catch(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <div className="mt-12 h-[68px]" aria-hidden />;
  }

  if (!stats || stats.spaces === 0) {
    return (
      <p className="mt-12 border-t border-white/15 pt-6 text-sm text-white/55">
        No availability loaded yet — upload a sheet and it appears here.
      </p>
    );
  }

  const items = [
    { value: stats.spaces.toLocaleString(), label: 'Available spaces' },
    { value: stats.buildings.toLocaleString(), label: 'Buildings' },
    { value: `${Math.round(stats.sf / 1000).toLocaleString()}K`, label: 'Square feet' },
    stats.rentLow !== null
      ? {
          value: `$${stats.rentLow}–${stats.rentHigh}`,
          label: 'Asking rent range',
        }
      : { value: '—', label: 'Asking rent range' },
  ];

  return (
    <dl className="mt-12 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-white/15 pt-6 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-[11px] uppercase tracking-[0.12em] text-white/50">
            {item.label}
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular text-goldenrod">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
