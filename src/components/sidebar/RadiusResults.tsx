'use client';

import { useMemo } from 'react';
import { useApp } from '@/lib/store';
import { applyFilters } from '@/lib/filters';
import { spacesWithin } from '@/lib/radius';
import SpaceCard, { formatSf } from './SpaceCard';

const RADIUS_CHOICES = [0.1, 0.25, 0.5, 1] as const;

/** Brokers say "quarter mile", not "0.25 mi". */
export function radiusLabel(miles: number): string {
  if (miles === 0.25) return '¼ mile';
  if (miles === 0.5) return '½ mile';
  if (miles === 0.75) return '¾ mile';
  if (miles === 1) return '1 mile';
  return `${miles} mile${miles === 1 ? '' : 's'}`;
}

export default function RadiusResults() {
  const buildings = useApp((s) => s.buildings);
  const filters = useApp((s) => s.filters);
  const radius = useApp((s) => s.radius);
  const setRadius = useApp((s) => s.setRadius);
  const addToCompare = useApp((s) => s.addToCompare);

  const origin = useMemo(() => {
    if (!radius?.originBuildingId) return null;
    return buildings.find((b) => b.id === radius.originBuildingId) ?? null;
  }, [buildings, radius?.originBuildingId]);

  const results = useMemo(() => {
    if (!radius) return [];
    return spacesWithin(
      applyFilters(buildings ?? [], filters),
      { lon: radius.lon, lat: radius.lat },
      radius.miles,
    );
  }, [buildings, filters, radius]);

  if (!radius) return null;

  const originLabel =
    origin?.address_display ||
    origin?.building_name ||
    `${radius.lat.toFixed(4)}, ${radius.lon.toFixed(4)}`;

  const totalSf = results.reduce((sum, r) => sum + (r.space.sf ?? 0), 0);
  const buildingCount = new Set(results.map((r) => r.building.id)).size;

  return (
    <div className="flex h-full flex-col border-l border-hairline bg-white">
      <header className="sticky top-0 z-10 space-y-2.5 border-b border-hairline bg-white px-4 py-3">
        <h2 className="text-sm font-semibold leading-snug text-ink">
          <span className="tabular">{results.length}</span> available space
          {results.length === 1 ? '' : 's'} within {radiusLabel(radius.miles)} of {originLabel}
        </h2>
        <p className="tabular text-xs text-muted">
          {buildingCount} building{buildingCount === 1 ? '' : 's'} · {formatSf(totalSf)} available
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
            Radius
          </span>
          {RADIUS_CHOICES.map((miles) => {
            const active = Math.abs(radius.miles - miles) < 1e-6;
            return (
              <button
                key={miles}
                type="button"
                aria-pressed={active}
                onClick={() => setRadius({ ...radius, miles })}
                className={`tabular rounded px-2 py-1 text-xs transition-colors ${
                  active
                    ? 'bg-goldenrod font-semibold text-midnight'
                    : 'border border-hairline-strong bg-white text-muted hover:bg-goldenrod-50 hover:text-ink'
                }`}
              >
                {miles} mi
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={results.length === 0}
            onClick={() => {
              for (const { space, building } of results) addToCompare(space.id, building.id);
            }}
            className="rounded bg-midnight px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-midnight-700 disabled:cursor-not-allowed disabled:bg-midnight-200"
          >
            Add all to compare
          </button>
          <button
            type="button"
            onClick={() => setRadius(null)}
            className="rounded border border-hairline-strong bg-white px-3 py-1.5 text-xs text-muted transition-colors hover:border-danger hover:text-danger"
          >
            Clear radius
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {results.length === 0 ? (
          <div className="space-y-3 px-6 py-14 text-center">
            <p className="text-base font-semibold text-ink">
              No available spaces within {radiusLabel(radius.miles)} of {originLabel}.
            </p>
            <p className="text-sm leading-relaxed text-muted">
              Widen the radius above, or clear it to go back to the map view.
            </p>
          </div>
        ) : (
          results.map(({ building, space, distanceMiles }) => (
            <SpaceCard
              key={space.id}
              building={building}
              space={space}
              distanceMiles={distanceMiles}
            />
          ))
        )}
      </div>
    </div>
  );
}
