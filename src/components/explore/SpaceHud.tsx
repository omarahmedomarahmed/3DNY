'use client';

import { useMemo, useState } from 'react';
import { useApp } from '@/lib/store';
import { Rent, Sf } from '@/components/ui/Money';
import type { BuildingWithSpaces, Space } from '@/types';

/**
 * The availability's own card, while you are standing in it.
 *
 * A space card on the flat map is anchored to the click that opened it,
 * because the point of clicking a stripe on a tower is that the answer appears
 * next to the thing you pointed at. Inside the space there is no stripe and no
 * click — you are *in* the thing — so the card floats at the edge of the view
 * instead, out of the middle where the window is.
 *
 * Three things it has to do, and nothing else:
 *
 * | | |
 * |---|---|
 * | Say what this is | Address, floor, size, rent. The same numbers the flat map shows, from the same fields |
 * | Offer the way out | Step outside on this floor, or leave the building entirely |
 * | Offer what else to look at | The comparables, one click each — which is what turns a tour of one space into a tour of a shortlist |
 *
 * It can be put away, because sometimes you want the window and nothing else,
 * and it comes back with one button.
 */

/**
 * What counts as comparable.
 *
 * Deliberately crude and deliberately explained on screen: nearby, and a
 * similar size. This is not a valuation model and must not look like one — the
 * job is "here are the other things worth standing in", and a broker's own
 * shortlist beats any scoring this could invent. Distance is the dominant
 * term because a tenant's shortlist is almost always a submarket first.
 */
const COMP_COUNT = 6;
const SIZE_TOLERANCE = 0.6;

export interface Comp {
  space: Space;
  building: BuildingWithSpaces;
  metres: number;
}

export function comparablesFor(
  buildings: BuildingWithSpaces[],
  building: BuildingWithSpaces,
  space: Space | null,
): Comp[] {
  const lon = building.lon;
  const lat = building.lat;
  if (lon === null || lat === null) return [];

  const sf = space?.sf ?? null;
  const out: Comp[] = [];

  for (const b of buildings) {
    if (b.lon === null || b.lat === null) continue;
    // Metres, near enough: at this latitude a degree of longitude is about
    // 84 km and a degree of latitude about 111 km. Ranking does not need a
    // geodesic.
    const dx = (b.lon - lon) * 84_000;
    const dy = (b.lat - lat) * 111_000;
    const metres = Math.hypot(dx, dy);

    for (const s of b.spaces) {
      if (!s.is_active) continue;
      if (space && s.id === space.id) continue;
      // A floor you cannot stand on is not somewhere this mode can take you.
      if (!s.floor_number || s.floor_number <= 0) continue;
      if (sf && s.sf) {
        const ratio = s.sf / sf;
        if (ratio < 1 - SIZE_TOLERANCE || ratio > 1 + SIZE_TOLERANCE) continue;
      }
      out.push({ space: s, building: b, metres });
    }
  }

  return out.sort((a, b) => a.metres - b.metres).slice(0, COMP_COUNT);
}

function walkMinutes(metres: number): string {
  // 80 metres a minute is the figure the rest of this product uses for a
  // Manhattan pavement.
  const mins = Math.max(1, Math.round(metres / 80));
  return `${mins} min`;
}

export default function SpaceHud() {
  const spaceExplore = useApp((s) => s.spaceExplore);
  const spaceOutside = useApp((s) => s.spaceOutside);
  const setSpaceOutside = useApp((s) => s.setSpaceOutside);
  const enterSpace = useApp((s) => s.enterSpace);
  const leaveSpace = useApp((s) => s.leaveSpace);
  const buildings = useApp((s) => s.buildings);
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  /** Where you have been, so a comparable can be backed out of. */
  const [trail, setTrail] = useState<{ buildingId: string; spaceId: string | null; floorNumber: number }[]>([]);

  const building = useMemo(
    () => buildings.find((b) => b.id === spaceExplore?.buildingId) ?? null,
    [buildings, spaceExplore?.buildingId],
  );
  const space = useMemo(
    () => building?.spaces.find((s) => s.id === spaceExplore?.spaceId) ?? null,
    [building, spaceExplore?.spaceId],
  );
  const comps = useMemo(
    () => (building ? comparablesFor(buildings, building, space) : []),
    [buildings, building, space],
  );

  /**
   * Search, so a shortlist does not have to be walked in distance order.
   *
   * The comparables answer "what else is like this near here", which is the
   * question you ask when you are already standing somewhere. Search answers
   * "take me to the one I was told about", which is the question you ask when
   * a client says an address on the phone — and it is the only way to reach a
   * space that is neither nearby nor a similar size.
   *
   * It matches address, building name and floor label, because those are the
   * three things anybody actually says out loud about a space.
   */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: { space: Space; building: BuildingWithSpaces }[] = [];
    for (const b of buildings) {
      const address = `${b.address_display ?? ''} ${b.building_name ?? ''}`.toLowerCase();
      for (const sp of b.spaces) {
        if (!sp.is_active) continue;
        if (!sp.floor_number || sp.floor_number <= 0) continue;
        const hay = `${address} ${sp.floor_label ?? ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
        out.push({ space: sp, building: b });
        if (out.length >= 20) return out;
      }
    }
    return out;
  }, [buildings, query]);

  if (!spaceExplore || !building) return null;

  const goTo = (buildingId: string, spaceId: string | null, floorNumber: number) => {
    setTrail((t) => [...t, spaceExplore]);
    enterSpace(buildingId, spaceId, floorNumber);
  };

  const back = () => {
    const previous = trail[trail.length - 1];
    if (!previous) return;
    setTrail((t) => t.slice(0, -1));
    enterSpace(previous.buildingId, previous.spaceId, previous.floorNumber);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto absolute right-4 top-20 z-30 rounded-full border border-hairline-strong bg-white/95 px-3.5 py-2 text-xs font-semibold text-ink shadow-float hover:border-midnight"
      >
        Show this space
      </button>
    );
  }

  return (
    <aside
      aria-label="The space you are in"
      /* Right-hand edge and narrow: the middle of the frame is the window, and
         the window is the entire reason for being here. */
      className="pointer-events-auto absolute right-4 top-20 z-30 w-[290px] rounded-lg border border-hairline-strong bg-white/95 shadow-float backdrop-blur"
    >
      <header className="flex items-start gap-2 border-b border-hairline px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-snug text-ink">
            {building.address_display || 'Unknown address'}
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            {space?.floor_label || `Floor ${spaceExplore.floorNumber}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Hide this space"
          className="rounded px-1.5 py-0.5 text-lg leading-none text-muted hover:bg-surface-sunken hover:text-ink"
        >
          ×
        </button>
      </header>

      {space ? (
        <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
          {space.asking_rent_withheld || space.asking_rent_psf === null ? (
            <span className="text-lg font-medium italic text-muted">Withheld</span>
          ) : (
            <Rent psf={space.asking_rent_psf} className="text-lg font-semibold text-ink" />
          )}
          <span className="text-sm font-semibold text-ink">
            <Sf value={space.sf} />
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5 border-t border-hairline px-3.5 py-2.5">
        {/* The altitude-locked walk round the outside. Same floor, same
            height, no plate — see `spaceOutside`. */}
        <button
          type="button"
          onClick={() => setSpaceOutside(!spaceOutside)}
          className={
            'rounded border px-2.5 py-1.5 text-xs font-semibold transition-colors ' +
            (spaceOutside
              ? 'border-goldenrod bg-goldenrod text-midnight'
              : 'border-hairline-strong bg-white text-ink hover:border-midnight')
          }
        >
          {spaceOutside ? 'Back inside' : 'Outside, this floor'}
        </button>
        {trail.length > 0 ? (
          <button
            type="button"
            onClick={back}
            className="rounded border border-hairline-strong bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-midnight"
          >
            Back
          </button>
        ) : null}
        <button
          type="button"
          onClick={leaveSpace}
          className="ml-auto rounded border border-hairline-strong bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-midnight"
        >
          Exit
        </button>
      </div>

      <div className="border-t border-hairline px-3.5 py-2.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Go to a space — address or floor"
          aria-label="Search for a space to explore"
          className="w-full rounded border border-hairline-strong bg-white px-2.5 py-1.5 text-xs text-ink placeholder:text-subtle focus:border-midnight focus:outline-none"
        />
        {results.length > 0 ? (
          <ul className="mt-1.5 max-h-[180px] overflow-y-auto">
            {results.map((r) => (
              <li key={r.space.id}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    goTo(r.building.id, r.space.id, r.space.floor_number as number);
                  }}
                  className="flex w-full items-baseline gap-2 rounded px-1.5 py-1.5 text-left hover:bg-surface-sunken"
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                    {r.building.address_display}
                  </span>
                  <span className="shrink-0 text-[11px] font-medium text-muted">
                    {r.space.floor_label || `Fl ${r.space.floor_number}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {comps.length > 0 ? (
        <div className="border-t border-hairline">
          <p className="px-3.5 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Nearby, similar size
          </p>
          <ul className="max-h-[220px] overflow-y-auto px-1.5 pb-2 pt-1">
            {comps.map((c) => (
              <li key={c.space.id}>
                <button
                  type="button"
                  onClick={() => goTo(c.building.id, c.space.id, c.space.floor_number as number)}
                  className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-sunken"
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                    {c.building.address_display}
                  </span>
                  <span className="shrink-0 text-[11px] font-medium text-muted">
                    {c.space.floor_label || `Fl ${c.space.floor_number}`}
                  </span>
                  <span className="shrink-0 text-[11px] tabular text-subtle">
                    {walkMinutes(c.metres)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
