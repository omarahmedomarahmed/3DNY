'use client';

import { useApp } from '@/lib/store';

const OPTIONS = [0.1, 0.25, 0.5, 1] as const;

export default function RadiusControl() {
  const radius = useApp((s) => s.radius);
  const setRadius = useApp((s) => s.setRadius);
  const selectedBuildingId = useApp((s) => s.selectedBuildingId);
  const buildings = useApp((s) => s.buildings);

  const selected = selectedBuildingId
    ? buildings.find((b) => b.id === selectedBuildingId)
    : undefined;

  // Nothing to anchor a new circle to and no circle on screen — stay hidden.
  if (!radius && !selected) return null;

  const origin =
    selected && selected.lon !== null && selected.lat !== null
      ? { lon: selected.lon, lat: selected.lat, id: selected.id }
      : radius
        ? { lon: radius.lon, lat: radius.lat, id: radius.originBuildingId }
        : null;

  if (!origin) return null;

  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 z-10 rounded-lg border border-edge bg-panel/95 p-3 text-xs text-muted shadow-xl backdrop-blur">
      <div className="mb-2 text-[11px] font-medium text-white/80">
        Radius search
      </div>
      <div className="flex items-center gap-1">
        {OPTIONS.map((miles) => {
          const active = radius?.miles === miles;
          return (
            <button
              key={miles}
              type="button"
              aria-pressed={active}
              onClick={() =>
                setRadius({
                  lon: origin.lon,
                  lat: origin.lat,
                  miles,
                  originBuildingId: origin.id,
                })
              }
              className={
                'rounded px-2 py-1 text-[11px] tabular-nums transition-colors ' +
                (active
                  ? 'bg-accent text-ink font-medium'
                  : 'bg-ink/60 text-muted hover:text-white')
              }
            >
              {miles} mi
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setRadius(null)}
          disabled={!radius}
          className="ml-1 rounded px-2 py-1 text-[11px] text-muted transition-colors hover:text-white disabled:opacity-40 disabled:hover:text-muted"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
