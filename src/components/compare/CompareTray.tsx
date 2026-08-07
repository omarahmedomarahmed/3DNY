'use client';

import { useEffect, useRef } from 'react';
import { useApp, useCompareDetails } from '@/lib/store';
import CompareView from './CompareView';

/**
 * Docked at the bottom of every screen. The tray is what makes the
 * "add a space in one building, fly to another, add a second" flow work, so it
 * lives above the map and the building profile alike and never unmounts on
 * navigation between them.
 */
export default function CompareTray() {
  const compare = useApp((s) => s.compare);
  const compareOpen = useApp((s) => s.compareOpen);
  const setCompareOpen = useApp((s) => s.setCompareOpen);
  const removeFromCompare = useApp((s) => s.removeFromCompare);
  const clearCompare = useApp((s) => s.clearCompare);
  const buildings = useApp((s) => s.buildings);
  const loadCompareFromUrl = useApp((s) => s.loadCompareFromUrl);
  const details = useCompareDetails();
  const hydratedFromUrl = useRef(false);

  // A shared ?compare=... link has to resolve once the buildings arrive.
  useEffect(() => {
    if (hydratedFromUrl.current || buildings.length === 0) return;
    const param = new URLSearchParams(window.location.search).get('compare');
    if (!param) {
      hydratedFromUrl.current = true;
      return;
    }
    const ids = param.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      hydratedFromUrl.current = true;
      loadCompareFromUrl(ids);
      setCompareOpen(true);
    }
  }, [buildings, loadCompareFromUrl, setCompareOpen]);

  if (compare.length === 0) return null;

  const byId = new Map(details.map((d) => [d.space.id, d]));

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-3">
        <div className="pointer-events-auto flex w-full max-w-6xl flex-wrap items-center gap-2 rounded-lg border border-edge bg-panel/95 px-3 py-2 shadow-2xl backdrop-blur">
          <span className="whitespace-nowrap rounded bg-accent/15 px-2 py-1 text-xs font-medium text-accent">
            {compare.length} {compare.length === 1 ? 'space' : 'spaces'}
          </span>

          <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {compare.map(({ spaceId }) => {
              const entry = byId.get(spaceId);
              const label = entry
                ? `${entry.building.address_display} · ${entry.space.floor_label}`
                : 'Loading…';
              return (
                <li
                  key={spaceId}
                  className="flex max-w-[260px] items-center gap-1.5 rounded border border-edge bg-ink px-2 py-1"
                >
                  <span className="truncate text-xs text-white" title={label}>
                    {label}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${label} from comparison`}
                    onClick={() => removeFromCompare(spaceId)}
                    className="shrink-0 text-muted hover:text-danger"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={clearCompare}
              className="rounded border border-edge px-2.5 py-1.5 text-xs text-muted hover:text-white"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-ink hover:brightness-110"
            >
              Open comparison
            </button>
          </div>
        </div>
      </div>

      {compareOpen && <CompareView onClose={() => setCompareOpen(false)} />}
    </>
  );
}
