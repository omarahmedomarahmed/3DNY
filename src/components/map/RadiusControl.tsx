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
    <div className="pointer-events-auto absolute bottom-4 right-4 z-10 rounded-card border border-hairline bg-white p-3 text-xs shadow-raised">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
        Radius search
      </div>
      <div className="flex items-center gap-1.5">
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
                'tabular rounded px-2.5 py-1.5 text-xs transition-colors ' +
                (active
                  ? 'bg-goldenrod font-semibold text-midnight'
                  : 'border border-hairline-strong bg-white text-muted hover:bg-goldenrod-50 hover:text-ink')
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
          className="ml-1 rounded px-2 py-1.5 text-xs text-muted transition-colors hover:text-ink disabled:opacity-40 disabled:hover:text-muted"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
