'use client';

import { useMemo } from 'react';
import { useApp } from '@/lib/store';
import type { ColorMode, OccupancyKind } from '@/types';
import { OCCUPANCY_COLORS, cssRgb, gradientForMode, stopsForMode } from './colors';

/**
 * The three things a band can mean, in the order they matter.
 *
 * Available is first and cannot be switched off: it is the subject of this
 * map, and the toggle exists so the other two can get out of its way, never
 * the reverse.
 */
const BAND_KINDS: {
  id: OccupancyKind;
  label: string;
  /** Used in the accessible name — "Show occupied space on the towers". */
  bands: string;
  color: string;
}[] = [
  {
    id: 'available',
    label: 'Available',
    bands: 'available space',
    color: OCCUPANCY_COLORS.available.legend,
  },
  {
    id: 'client',
    label: 'Cresa clients',
    bands: 'Cresa client space',
    color: OCCUPANCY_COLORS.client.legend,
  },
  {
    id: 'occupied',
    label: 'Occupied',
    bands: 'occupied space',
    color: OCCUPANCY_COLORS.occupied.legend,
  },
];

const MODES: { id: ColorMode; label: string }[] = [
  { id: 'rent', label: 'Rent' },
  { id: 'availability', label: 'Available' },
  { id: 'class', label: 'Class' },
  { id: 'sf', label: 'Total SF' },
];

const CAPTIONS: Record<ColorMode, string> = {
  rent: 'Lowest asking rent, $/SF/yr',
  availability: 'Soonest availability',
  class: 'Building class',
  sf: 'Total available SF',
};

export default function MapLegend() {
  const colorMode = useApp((s) => s.colorMode);
  const setColorMode = useApp((s) => s.setColorMode);
  const occupancyKinds = useApp((s) => s.occupancyKinds);
  const toggleOccupancyKind = useApp((s) => s.toggleOccupancyKind);
  const buildings = useApp((s) => s.buildings);
  const stops = stopsForMode(colorMode);

  /**
   * How many of each there are to show. A toggle that turns on nothing is a
   * dead control, and the honest thing is to say so rather than let someone
   * conclude the feature is broken.
   */
  const counts = useMemo(() => {
    let available = 0;
    let client = 0;
    let occupied = 0;
    for (const b of buildings) {
      available += b.spaces.filter((s) => s.is_active).length;
      for (const t of b.tenants ?? []) {
        if ((t.floor_numbers ?? []).length === 0) continue;
        if (t.relationship === 'client') client++;
        else occupied++;
      }
    }
    return { available, client, occupied } as Record<OccupancyKind, number>;
  }, [buildings]);

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-10 w-80 rounded-card border border-hairline-strong bg-white p-3.5 text-sm shadow-float">
      {/* Segmented control: one active segment, no ambiguity about the mode. */}
      <div
        role="group"
        aria-label="Colour buildings by"
        className="mb-3 flex overflow-hidden rounded border border-hairline-strong"
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setColorMode(m.id)}
            aria-pressed={colorMode === m.id}
            className={
              'flex-1 border-r border-hairline px-1.5 py-2 text-[13px] font-semibold transition-colors last:border-r-0 ' +
              (colorMode === m.id
                ? 'bg-midnight text-white'
                : 'bg-white text-muted hover:bg-goldenrod-50 hover:text-ink')
            }
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-body">
        {CAPTIONS[colorMode]}
      </div>

      {colorMode === 'class' ? (
        <ul className="space-y-1.5">
          {stops.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-sm border border-hairline-strong"
                style={{ background: cssRgb(s.color) }}
              />
              <span className="text-[13px] font-medium text-ink">{s.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div
            className="h-4 w-full rounded-sm border border-hairline-strong"
            style={{ background: gradientForMode(colorMode) }}
          />
          <div className="tabular mt-1.5 flex justify-between text-[11px] font-semibold text-body">
            {stops.map((s) => (
              <span key={s.label}>{s.label}</span>
            ))}
          </div>
        </>
      )}

      {/* The bands themselves.
          This sits in the legend rather than in the control stack on purpose:
          the legend is where the colour language is explained, so toggling a
          colour from the row that defines it is direct manipulation rather
          than a switch somewhere else that changes what the legend means. */}
      <div className="mt-3 border-t border-hairline pt-2.5">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-body">
          Bands on the towers
        </div>
        <ul className="space-y-0.5">
          {BAND_KINDS.map((k) => {
            const on = occupancyKinds.includes(k.id);
            const locked = k.id === 'available';
            const count = counts[k.id] ?? 0;
            return (
              <li key={k.id}>
                <button
                  type="button"
                  disabled={locked}
                  aria-pressed={on}
                  onClick={() => toggleOccupancyKind(k.id)}
                  // The colour-mode control above has a segment called
                  // "Available" too — it means "colour the buildings by
                  // soonest availability", which is a different thing in the
                  // same small panel. The visible labels stay short; the
                  // accessible names say which control this is.
                  aria-label={`${on ? 'Hide' : 'Show'} ${k.bands} on the towers`}
                  title={
                    locked
                      ? 'Available space is what this map is for — it is always shown.'
                      : undefined
                  }
                  className={
                    'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors ' +
                    (locked
                      ? 'cursor-default'
                      : 'hover:bg-surface-alt disabled:cursor-not-allowed')
                  }
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm border border-hairline-strong"
                    style={{ background: on ? k.color : 'transparent' }}
                  />
                  <span
                    className={
                      'text-[13px] font-medium ' + (on ? 'text-ink' : 'text-subtle')
                    }
                  >
                    {k.label}
                  </span>
                  <span className="tabular ml-auto text-[11px] font-semibold text-muted">
                    {count > 0 ? count : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {counts.client + counts.occupied === 0 ? (
          <p className="mt-1.5 px-1.5 text-[11px] leading-snug text-subtle">
            No tenant data yet — import a roster or sync Salesforce.
          </p>
        ) : null}
      </div>

      <div className="mt-3 border-t border-hairline pt-2.5 text-[11px] leading-snug text-muted">
        Floor bands are derived from building height ÷ floor count — accurate to
        roughly one floor.
      </div>
    </div>
  );
}
