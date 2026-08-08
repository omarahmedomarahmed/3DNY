'use client';

import { useApp } from '@/lib/store';
import SourceInfo from '@/components/ui/SourceInfo';
import { spaceOriginNote, spaceSource, type SpaceField } from '@/lib/provenance';
import type { BuildingWithSpaces, Space } from '@/types';

/** Space fields this card actually shows, so a stamp on one is worth flagging. */
const CARD_FIELDS: SpaceField[] = [
  'floor_label',
  'sf',
  'asking_rent_psf',
  'available_from',
  'term_expires',
  'leasing_company',
];

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
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        {label}
      </div>
      <div className={`mt-0.5 text-xs text-body ${align === 'right' ? 'tabular' : ''}`}>
        {children}
      </div>
    </div>
  );
}

/** Badge styles, kept in one place so the colour language stays consistent. */
const BADGE = 'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]';

/** Presentational only — a listing already available reads as vacant today. */
function isVacantNow(availableFrom: string | null | undefined): boolean {
  if (!availableFrom) return false;
  const m = /^\d{4}-\d{2}-\d{2}/.exec(availableFrom.trim());
  if (!m) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return m[0] <= today;
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
  const corrected = CARD_FIELDS.filter((f) => space.field_sources?.[f]);
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
      className={`border-b border-l-[3px] border-hairline bg-white transition-colors ${
        selected
          ? 'border-l-goldenrod bg-goldenrod-50'
          : 'border-l-transparent hover:bg-goldenrod-50'
      }`}
    >
      <button
        type="button"
        onClick={open}
        className="w-full space-y-2 px-4 py-3 text-left"
        aria-label={`${building.address_display}, ${space.floor_label}`}
      >
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink">
              {building.address_display || 'Unknown address'}
            </h3>
            {building.building_name ? (
              <p className="truncate text-xs text-muted">{building.building_name}</p>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <div
              className={`tabular text-base font-semibold leading-none ${
                rent.withheld ? 'text-sm italic font-normal text-subtle' : 'text-ink'
              }`}
            >
              {rent.text}
            </div>
            {!rent.withheld ? (
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-subtle">/ SF</div>
            ) : null}
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-1">
          <span className="rounded border border-hairline-strong px-1.5 py-0.5 text-[11px] font-medium text-ink">
            {space.floor_label || 'Floor —'}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
              space.floor_portion === 'entire'
                ? 'bg-midnight-50 text-midnight-700'
                : 'bg-surface-sunken text-muted'
            }`}
          >
            {space.floor_portion === 'entire' ? 'Entire' : 'Partial'}
          </span>
          {space.lease_type ? (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                space.lease_type === 'sublet'
                  ? 'bg-info-surface text-stadium'
                  : 'bg-midnight-50 text-midnight-700'
              }`}
            >
              {space.lease_type === 'sublet' ? 'Sublet' : 'Direct'}
            </span>
          ) : null}
          {building.class ? (
            <span className="rounded border border-hairline-strong px-1.5 py-0.5 text-[10px] text-muted">
              Class {building.class}
            </span>
          ) : null}
          {distanceMiles !== undefined ? (
            <span className="tabular rounded bg-goldenrod-100 px-1.5 py-0.5 text-[10px] font-medium text-goldenrod-700">
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

        <div className="truncate text-xs text-subtle" title={space.leasing_company ?? ''}>
          {space.leasing_company || 'Leasing company unknown'}
        </div>
      </button>

      {/* One marker per card, not one per value.
          The whole card is a single row off a single sheet — address, rent,
          size and dates all have the same answer — so six icons would be six
          copies of one sentence in the densest list in the product. The one
          exception is a field somebody has corrected since, which genuinely
          differs from the rest of the card and so gets its own marker. */}
      <footer className="flex items-center gap-2 px-4 pb-3">
        <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">
          Source
          <SourceInfo label="this listing" note={spaceOriginNote(space)} />
        </span>
        {corrected.map((field) => (
          <SourceInfo
            key={field}
            label={`this ${field.replace(/_/g, ' ')}`}
            note={spaceSource(space, field)}
          />
        ))}
        <button
          type="button"
          onClick={() =>
            inCompare ? removeFromCompare(space.id) : addToCompare(space.id, building.id)
          }
          aria-pressed={inCompare}
          className={`ml-auto rounded border px-2.5 py-1 text-[11px] font-medium transition-colors ${
            inCompare
              ? 'border-goldenrod bg-goldenrod text-midnight'
              : 'border-hairline-strong text-muted hover:border-midnight hover:text-ink'
          }`}
        >
          {inCompare ? '✓ In compare' : 'Add to compare'}
        </button>
      </footer>
    </article>
  );
}
