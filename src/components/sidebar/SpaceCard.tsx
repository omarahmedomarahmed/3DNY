'use client';

import { useApp } from '@/lib/store';
import type { BuildingWithSpaces, Space } from '@/types';

// ---------------------------------------------------------------------------
// Formatting — shared with the sidebar headers and radius results.
// ---------------------------------------------------------------------------

export function formatSf(sf: number | null | undefined): string {
  if (sf === null || sf === undefined || !Number.isFinite(sf)) return '—';
  return `${Math.round(sf).toLocaleString('en-US')} SF`;
}

export function formatRent(space: Pick<Space, 'asking_rent_psf' | 'asking_rent_withheld'>): {
  text: string;
  withheld: boolean;
} {
  if (space.asking_rent_withheld || space.asking_rent_psf === null) {
    return { text: 'Withheld', withheld: true };
  }
  const value = space.asking_rent_psf;
  if (!Number.isFinite(value)) return { text: 'Withheld', withheld: true };
  return {
    text: `$${value.toLocaleString('en-US', {
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })}`,
    withheld: false,
  };
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** ISO YYYY-MM-DD → "Mar 2027". Parsed by hand to dodge timezone shifts. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso.trim() || null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return m[1];
  return `${MONTHS[month - 1]} ${m[1]}`;
}

export function formatMiles(miles: number | null | undefined): string {
  if (miles === null || miles === undefined || !Number.isFinite(miles)) return '—';
  if (miles < 0.1) return `${Math.round(miles * 5280).toLocaleString('en-US')} ft`;
  return `${miles.toFixed(2)} mi`;
}

// ---------------------------------------------------------------------------

interface SpaceCardProps {
  building: BuildingWithSpaces;
  space: Space;
  /** Shown as a distance chip when the card comes from a radius search. */
  distanceMiles?: number;
}

function Field({
  label,
  children,
  align = 'left',
}: {
  label: string;
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-xs text-slate-200 ${align === 'right' ? 'tabular-nums' : ''}`}>
        {children}
      </div>
    </div>
  );
}

export default function SpaceCard({ building, space, distanceMiles }: SpaceCardProps) {
  const selectSpace = useApp((s) => s.selectSpace);
  const selectBuilding = useApp((s) => s.selectBuilding);
  const setHovered = useApp((s) => s.setHovered);
  const addToCompare = useApp((s) => s.addToCompare);
  const removeFromCompare = useApp((s) => s.removeFromCompare);
  const selectedSpaceId = useApp((s) => s.selectedSpaceId);
  const inCompare = useApp((s) => s.compare.some((c) => c.spaceId === space.id));

  const selected = selectedSpaceId === space.id;
  const rent = formatRent(space);
  const available = formatDate(space.available_from);
  const expires = formatDate(space.term_expires);

  const open = () => {
    // selectBuilding clears the space selection, so it has to come first.
    selectBuilding(building.id);
    selectSpace(space.id);
  };

  return (
    <article
      onMouseEnter={() => setHovered(building.id)}
      onMouseLeave={() => setHovered(null)}
      className={`rounded border bg-panel transition-colors ${
        selected ? 'border-accent' : 'border-edge hover:border-accent/60'
      }`}
    >
      <button
        type="button"
        onClick={open}
        className="w-full space-y-2 px-3 py-2 text-left"
        aria-label={`${building.address_display}, ${space.floor_label}`}
      >
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-xs font-semibold text-slate-100">
              {building.address_display || 'Unknown address'}
            </h3>
            {building.building_name ? (
              <p className="truncate text-[11px] text-muted">{building.building_name}</p>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <div
              className={`text-xs font-semibold tabular-nums ${
                rent.withheld ? 'text-muted' : 'text-slate-100'
              }`}
            >
              {rent.text}
            </div>
            {!rent.withheld ? (
              <div className="text-[10px] text-muted">/ SF</div>
            ) : null}
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-1">
          <span className="rounded border border-edge px-1.5 py-0.5 text-[11px] text-slate-200">
            {space.floor_label || 'Floor —'}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
              space.floor_portion === 'entire'
                ? 'bg-accent/15 text-accent'
                : 'bg-edge/60 text-muted'
            }`}
          >
            {space.floor_portion === 'entire' ? 'Entire' : 'Partial'}
          </span>
          {space.lease_type ? (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                space.lease_type === 'sublet'
                  ? 'bg-warn/15 text-warn'
                  : 'bg-ok/15 text-ok'
              }`}
            >
              {space.lease_type === 'sublet' ? 'Sublet' : 'Direct'}
            </span>
          ) : null}
          {building.class ? (
            <span className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-muted">
              Class {building.class}
            </span>
          ) : null}
          {distanceMiles !== undefined ? (
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] tabular-nums text-accent">
              {formatMiles(distanceMiles)}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Size" align="right">
            {formatSf(space.sf)}
          </Field>
          <Field label="Available" align="right">
            {available ?? <span className="text-muted">—</span>}
          </Field>
          <Field label="Expires" align="right">
            {expires ?? <span className="text-muted">Negotiable</span>}
          </Field>
        </div>

        <div className="truncate text-[11px] text-muted" title={space.leasing_company ?? ''}>
          {space.leasing_company || 'Leasing company unknown'}
        </div>
      </button>

      <footer className="flex justify-end border-t border-edge px-3 py-1.5">
        <button
          type="button"
          onClick={() =>
            inCompare ? removeFromCompare(space.id) : addToCompare(space.id, building.id)
          }
          aria-pressed={inCompare}
          className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
            inCompare
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-edge text-muted hover:border-accent/60 hover:text-slate-100'
          }`}
        >
          {inCompare ? 'In compare · remove' : 'Add to compare'}
        </button>
      </footer>
    </article>
  );
}
