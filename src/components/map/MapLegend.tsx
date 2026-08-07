'use client';

import { useApp } from '@/lib/store';
import type { ColorMode } from '@/types';
import { cssRgb, gradientForMode, stopsForMode } from './colors';

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
  const stops = stopsForMode(colorMode);

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

      <div className="mt-3 border-t border-hairline pt-2.5 text-[11px] leading-snug text-muted">
        Floor bands are derived from building height ÷ floor count — accurate to
        roughly one floor.
      </div>
    </div>
  );
}
