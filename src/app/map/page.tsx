'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useApp } from '@/lib/store';
import AppHeader from '@/components/shell/AppHeader';
import FilterRail from '@/components/filters/FilterRail';
import ResultsSidebar from '@/components/sidebar/ResultsSidebar';
import ComparePanel from '@/components/compare/ComparePanel';
import { DotMotif } from '@/components/brand/Logo';

// deck.gl and MapLibre touch `window` at module scope, so the map can only be
// loaded in the browser.
const MapView = dynamic(() => import('@/components/map/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-surface-sunken text-sm text-muted">
      Loading map…
    </div>
  ),
});

export default function MapPage() {
  const loadBuildings = useApp((s) => s.loadBuildings);
  const buildings = useApp((s) => s.buildings);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);

  useEffect(() => {
    void loadBuildings();
  }, [loadBuildings]);

  const empty = !loading && !error && buildings.length === 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <AppHeader dense />

      {error && (
        <div className="flex shrink-0 items-center gap-3 border-b border-danger/20 bg-danger-surface px-5 py-2.5 text-sm text-danger">
          <span>{error}</span>
          <Link href="/setup" className="font-medium underline underline-offset-2">
            Open setup
          </Link>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <FilterRail />

        <main className="relative min-w-0 flex-1">
          <MapView />

          {/* Compare lives ON the map: a floating panel over the towers it
              describes, not a page takeover that replaces them. */}
          <ComparePanel />

          {loading && (
            <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
              <span className="rounded-full border border-hairline bg-white px-4 py-1.5 text-xs text-muted shadow-card">
                Loading availability…
              </span>
            </div>
          )}

          {empty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-md rounded-card border border-hairline bg-white p-8 text-center shadow-float">
                <DotMotif size={30} className="mx-auto" />
                <h2 className="mt-5 text-lg font-semibold text-ink">
                  No availability loaded yet
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Upload a weekly availability sheet and every building with new space will
                  light up. Sample sheets are built in if you want to try it first.
                </p>
                <Link
                  href="/import"
                  className="mt-6 inline-block rounded bg-goldenrod px-5 py-2.5 text-sm font-semibold text-midnight transition-transform hover:-translate-y-0.5"
                >
                  Upload a sheet
                </Link>
              </div>
            </div>
          )}
        </main>

        <ResultsSidebar />
      </div>
    </div>
  );
}
