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
    <div className="pointer-events-auto absolute bottom-4 left-4 z-10 w-64 rounded-lg border border-edge bg-panel/95 p-3 text-xs text-muted shadow-xl backdrop-blur">
      <div className="mb-2 flex gap-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setColorMode(m.id)}
            aria-pressed={colorMode === m.id}
            className={
              'flex-1 rounded px-1.5 py-1 text-[11px] transition-colors ' +
              (colorMode === m.id
                ? 'bg-accent text-ink font-medium'
                : 'bg-ink/60 text-muted hover:text-white')
            }
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="mb-1 text-[11px] text-muted">{CAPTIONS[colorMode]}</div>

      {colorMode === 'class' ? (
        <ul className="space-y-1">
          {stops.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-sm border border-edge"
                style={{ background: cssRgb(s.color) }}
              />
              <span className="text-[11px] text-white/80">{s.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div
            className="h-2.5 w-full rounded-sm border border-edge"
            style={{ background: gradientForMode(colorMode) }}
          />
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted">
            {stops.map((s) => (
              <span key={s.label}>{s.label}</span>
            ))}
          </div>
        </>
      )}

      <div className="mt-2 border-t border-edge pt-2 text-[10px] leading-snug text-muted">
        Floor bands are derived from building height ÷ floor count — accurate to
        roughly one floor.
      </div>
    </div>
  );
}
