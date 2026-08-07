'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useApp } from '@/lib/store';
import FilterRail from '@/components/filters/FilterRail';
import ResultsSidebar from '@/components/sidebar/ResultsSidebar';
import CompareTray from '@/components/compare/CompareTray';
import CompareView from '@/components/compare/CompareView';

// deck.gl and MapLibre touch `window` at module scope, so the map can only be
// loaded in the browser.
const MapView = dynamic(() => import('@/components/map/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted">
      Loading map…
    </div>
  ),
});

export default function HomePage() {
  const loadBuildings = useApp((s) => s.loadBuildings);
  const buildings = useApp((s) => s.buildings);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);
  const compareOpen = useApp((s) => s.compareOpen);

  useEffect(() => {
    void loadBuildings();
  }, [loadBuildings]);

  const needsSetup = !loading && !error && buildings.length === 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink">
      <header className="flex shrink-0 items-center gap-4 border-b border-edge bg-panel px-4 py-2.5">
        <span className="text-sm font-semibold tracking-tight">3DNYC</span>
        <span className="hidden text-xs text-muted sm:inline">
          Manhattan office availability
        </span>
        <nav className="ml-auto flex items-center gap-4 text-xs">
          <Link href="/import" className="text-muted hover:text-accent">
            Import
          </Link>
          <Link href="/setup" className="text-muted hover:text-accent">
            Setup
          </Link>
        </nav>
      </header>

      {error && (
        <div className="shrink-0 border-b border-edge bg-danger/10 px-4 py-2 text-xs text-danger">
          {error}{' '}
          <Link href="/setup" className="underline">
            Open Setup
          </Link>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <FilterRail />

        <main className="relative min-w-0 flex-1">
          <MapView />

          {needsSetup && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-md rounded-lg border border-edge bg-panel/95 p-6 text-center backdrop-blur">
                <h2 className="text-base font-semibold">No availability data yet</h2>
                <p className="mt-2 text-sm text-muted">
                  Upload a weekly availability sheet and every building with new space will
                  light up on the map. Sample sheets are built in if you want to try it first.
                </p>
                <Link
                  href="/import"
                  className="mt-4 inline-block rounded bg-accent px-4 py-2 text-sm font-medium text-ink"
                >
                  Import a sheet
                </Link>
              </div>
            </div>
          )}
        </main>

        <ResultsSidebar />
      </div>

      <CompareTray />

      {compareOpen && (
        <Suspense fallback={null}>
          <CompareView />
        </Suspense>
      )}

      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-12 flex justify-center">
          <span className="rounded-full border border-edge bg-panel px-3 py-1 text-xs text-muted">
            Loading availability…
          </span>
        </div>
      )}
    </div>
  );
}
