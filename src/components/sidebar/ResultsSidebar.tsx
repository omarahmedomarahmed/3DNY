'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/lib/store';
import { applyFilters, activeFilterCount } from '@/lib/filters';
import type { BuildingWithSpaces, Space } from '@/types';
import SpaceCard, { formatSf } from './SpaceCard';
import RadiusResults from './RadiusResults';

type SortKey =
  | 'rent-asc'
  | 'rent-desc'
  | 'sf-desc'
  | 'floor-asc'
  | 'added-desc'
  | 'expires-asc';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'rent-asc', label: 'Rent (low → high)' },
  { value: 'rent-desc', label: 'Rent (high → low)' },
  { value: 'sf-desc', label: 'Size (large → small)' },
  { value: 'floor-asc', label: 'Floor (low → high)' },
  { value: 'added-desc', label: 'Date added (newest)' },
  { value: 'expires-asc', label: 'Expiration (soonest)' },
];

interface Row {
  building: BuildingWithSpaces;
  space: Space;
}

/** Unknown values always sink to the bottom rather than masquerading as 0. */
const LAST = Number.POSITIVE_INFINITY;

function rentOf(space: Space): number {
  if (space.asking_rent_withheld || space.asking_rent_psf === null) return LAST;
  return Number.isFinite(space.asking_rent_psf) ? space.asking_rent_psf : LAST;
}

function compare(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case 'rent-asc':
      return rentOf(a.space) - rentOf(b.space);
    case 'rent-desc': {
      const ra = rentOf(a.space);
      const rb = rentOf(b.space);
      if (ra === LAST && rb === LAST) return 0;
      if (ra === LAST) return 1;
      if (rb === LAST) return -1;
      return rb - ra;
    }
    case 'sf-desc':
      return (b.space.sf ?? -1) - (a.space.sf ?? -1);
    case 'floor-asc':
      return (a.space.floor_number ?? LAST) - (b.space.floor_number ?? LAST);
    case 'added-desc':
      return (b.space.date_added ?? '').localeCompare(a.space.date_added ?? '');
    case 'expires-asc': {
      const ea = a.space.term_expires ?? '';
      const eb = b.space.term_expires ?? '';
      if (!ea && !eb) return 0;
      if (!ea) return 1;
      if (!eb) return -1;
      return ea.localeCompare(eb);
    }
    default:
      return 0;
  }
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 px-4 py-10 text-center">
      <p className="text-xs font-semibold text-slate-100">{title}</p>
      <div className="space-y-2 text-[11px] leading-snug text-muted">{children}</div>
    </div>
  );
}

export default function ResultsSidebar() {
  const buildings = useApp((s) => s.buildings);
  const filters = useApp((s) => s.filters);
  const visibleBuildingIds = useApp((s) => s.visibleBuildingIds);
  const radius = useApp((s) => s.radius);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);
  const resetFilters = useApp((s) => s.resetFilters);

  const [sort, setSort] = useState<SortKey>('rent-asc');

  const filtered = useMemo(
    () => applyFilters(buildings ?? [], filters),
    [buildings, filters],
  );

  const inView = useMemo(() => {
    if (!visibleBuildingIds || visibleBuildingIds.length === 0) return filtered;
    const ids = new Set(visibleBuildingIds);
    return filtered.filter((b) => ids.has(b.id));
  }, [filtered, visibleBuildingIds]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const building of inView) {
      for (const space of building.spaces ?? []) out.push({ building, space });
    }
    return out.sort((a, b) => compare(a, b, sort));
  }, [inView, sort]);

  // A radius question is explicit and geographic; the viewport stops mattering.
  if (radius) return <RadiusResults />;

  const totalSf = rows.reduce((sum, r) => sum + (r.space.sf ?? 0), 0);
  const filterCount = activeFilterCount(filters);
  const hasData = (buildings?.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col bg-ink">
      <header className="space-y-2 border-b border-edge bg-panel px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold text-slate-100">
            <span className="tabular-nums">{rows.length}</span> space
            {rows.length === 1 ? '' : 's'} in view
            <span className="text-muted"> · </span>
            <span className="tabular-nums">{inView.length}</span> building
            {inView.length === 1 ? '' : 's'}
          </h2>
          <span className="shrink-0 text-[11px] tabular-nums text-muted">
            {formatSf(totalSf)}
          </span>
        </div>

        <label className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort results"
            className="min-w-0 flex-1 rounded border border-edge bg-ink px-2 py-1 text-xs text-slate-100 outline-none focus:border-accent"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value} className="bg-ink">
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {error ? (
          <Empty title="Could not load listings">
            <p>{error}</p>
          </Empty>
        ) : loading && !hasData ? (
          <p className="px-4 py-10 text-center text-xs text-muted">Loading listings…</p>
        ) : !hasData ? (
          <Empty title="No data imported yet">
            <p>Upload an availability sheet to put listings on the map.</p>
            <Link
              href="/import"
              className="inline-block rounded border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/15"
            >
              Go to import
            </Link>
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty title="Filters exclude every listing">
            <p>
              {filterCount} filter{filterCount === 1 ? '' : 's'} active. Loosen a range or
              clear them to see the full set again.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/15"
            >
              Clear all filters
            </button>
          </Empty>
        ) : rows.length === 0 ? (
          <Empty title="Nothing in this part of the map">
            <p>
              {filtered.length} matching building{filtered.length === 1 ? '' : 's'} exist
              elsewhere. Zoom out or pan to bring them into view.
            </p>
          </Empty>
        ) : (
          rows.map(({ building, space }) => (
            <SpaceCard key={space.id} building={building} space={space} />
          ))
        )}
      </div>
    </div>
  );
}
