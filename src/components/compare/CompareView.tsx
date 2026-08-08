'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { BuildingWithSpaces, Landlord, Space } from '@/types';
import { useApp, useCompareDetails } from '@/lib/store';
import {
  MODE_LABEL,
  MODE_RANK,
  nearestStops,
  type NearbyStop,
  type TransitResult,
  type TransitStop,
} from '@/lib/transit';
import Badge, { ClassBadge, LeaseTypeBadge } from '@/components/ui/Badge';
import {
  annualRent,
  formatAnnualRent,
  formatCompactSf,
  formatMonthYear,
  formatNumber,
  formatRent,
  formatSf,
} from '@/components/ui/Money';
import { Markdownish, fetchLandlords } from '@/components/detail/LandlordPanel';
import { fetchSpaceImages } from '@/components/detail/PhotoGallery';

interface Column {
  building: BuildingWithSpaces;
  space: Space;
  landlord: Landlord | null;
  photo: string | null;
  /** Nearest transit, walk-sorted. Null until the lookup has answered. */
  transit: NearbyStop[] | null;
}

type Best = 'min' | 'max' | null;

interface Row {
  key: string;
  label: string;
  /** Lower is better (rent, availability date) or higher is better (SF). */
  best?: Best;
  /** Numeric value used for the best-in-row accent. Null opts the column out. */
  numeric?: (c: Column) => number | null;
  /** Stable string used to detect values identical across every column. */
  compareKey: (c: Column) => string;
  render: (c: Column) => React.ReactNode;
  /** Insights and chip lists need room to breathe. */
  tall?: boolean;
}

const DASH = <span className="text-subtle">—</span>;

/** Inline SVG only — no icon font, no emoji. */
function CloseIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function text(value: string | null | undefined): React.ReactNode {
  return value ? value : DASH;
}

function chips(values: string[]): React.ReactNode {
  if (values.length === 0) return DASH;
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => (
        <Badge key={v} variant="neutral" className="rounded-full bg-midnight-50 text-midnight-700">
          {v}
        </Badge>
      ))}
    </div>
  );
}

function dateValue(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(iso.trim()) ? `${iso.trim()}T00:00:00Z` : iso);
  return Number.isNaN(ms) ? null : ms;
}

const SPACE_ROWS: Row[] = [
  {
    key: 'building',
    label: 'Building',
    compareKey: (c) => c.building.id,
    render: (c) => (
      <div>
        <p className="font-semibold text-ink">{c.building.address_display}</p>
        {c.building.building_name && (
          <p className="text-[13px] font-medium text-muted">{c.building.building_name}</p>
        )}
      </div>
    ),
  },
  {
    key: 'floor',
    label: 'Floor',
    compareKey: (c) => c.space.floor_label,
    render: (c) => (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-ink">{c.space.floor_label || '—'}</span>
        <Badge variant={c.space.floor_portion === 'partial' ? 'neutral' : 'info'}>
          {c.space.floor_portion === 'partial' ? 'Partial' : 'Entire'}
        </Badge>
      </div>
    ),
  },
  {
    key: 'sf',
    label: 'SF',
    best: 'max',
    numeric: (c) => c.space.sf,
    compareKey: (c) => String(c.space.sf ?? ''),
    render: (c) => <span className="tabular">{formatSf(c.space.sf) ?? DASH}</span>,
  },
  {
    key: 'rent',
    label: 'Asking Rent',
    best: 'min',
    numeric: (c) => (c.space.asking_rent_withheld ? null : c.space.asking_rent_psf),
    compareKey: (c) =>
      c.space.asking_rent_withheld ? 'withheld' : String(c.space.asking_rent_psf ?? ''),
    render: (c) =>
      c.space.asking_rent_withheld ? (
        <span className="italic text-muted">Withheld</span>
      ) : (
        <span className="tabular">{formatRent(c.space.asking_rent_psf) ?? DASH}</span>
      ),
  },
  {
    key: 'annual',
    label: 'Annual rent',
    best: 'min',
    numeric: (c) => annualRent(c.space.asking_rent_psf, c.space.sf, c.space.asking_rent_withheld),
    compareKey: (c) =>
      String(annualRent(c.space.asking_rent_psf, c.space.sf, c.space.asking_rent_withheld) ?? ''),
    render: (c) => {
      const value = annualRent(c.space.asking_rent_psf, c.space.sf, c.space.asking_rent_withheld);
      return value === null ? DASH : <span className="tabular">{formatAnnualRent(value)}</span>;
    },
  },
  {
    key: 'use',
    label: 'Space Use',
    compareKey: (c) => c.space.space_use ?? '',
    render: (c) => text(c.space.space_use),
  },
  {
    key: 'lease_type',
    label: 'Direct / Sublet',
    compareKey: (c) => c.space.lease_type ?? '',
    render: (c) => <LeaseTypeBadge value={c.space.lease_type} />,
  },
  {
    key: 'available',
    label: 'Available',
    best: 'min',
    numeric: (c) => dateValue(c.space.available_from),
    compareKey: (c) => c.space.available_from ?? c.space.occupancy_raw ?? '',
    render: (c) =>
      formatMonthYear(c.space.available_from) ??
      (c.space.occupancy_raw ? <span className="text-muted">{c.space.occupancy_raw}</span> : DASH),
  },
  {
    key: 'expires',
    label: 'Expires',
    compareKey: (c) => c.space.term_expires ?? c.space.term_raw ?? '',
    render: (c) =>
      formatMonthYear(c.space.term_expires) ??
      (c.space.term_raw ? <span className="text-muted">{c.space.term_raw}</span> : DASH),
  },
  {
    key: 'class',
    label: 'Class',
    compareKey: (c) => c.building.class ?? '',
    render: (c) => <ClassBadge value={c.building.class} />,
  },
  {
    key: 'submarket',
    label: 'Submarket',
    compareKey: (c) => c.building.submarket_cluster ?? c.building.submarket ?? '',
    render: (c) => text(c.building.submarket_cluster ?? c.building.submarket),
  },
  {
    key: 'leasing_company',
    label: 'Leasing Company',
    compareKey: (c) => c.space.leasing_company ?? '',
    render: (c) => text(c.space.leasing_company),
  },
  {
    key: 'agent',
    label: 'Agent',
    compareKey: (c) => c.space.agent_name ?? '',
    render: (c) => (
      <div>
        <p>{c.space.agent_name ?? DASH}</p>
        {c.space.agent_email &&
          (c.space.agent_email_suspect ? (
            <p
              className="break-all text-[13px] font-medium text-warmorange"
              title="Email looks truncated in the source sheet"
            >
              {c.space.agent_email} (verify)
            </p>
          ) : (
            <a
              href={`mailto:${c.space.agent_email}`}
              className="block break-all text-[13px] font-medium text-info hover:underline"
            >
              {c.space.agent_email}
            </a>
          ))}
      </div>
    ),
  },
];

/** The best stop of a given mode, or null when there is none within range. */
function bestOfMode(c: Column, mode: string): NearbyStop | null {
  return c.transit?.find((s) => s.mode === mode) ?? null;
}

function stopCell(stop: NearbyStop | null, pending: boolean): React.ReactNode {
  if (pending) return <span className="text-subtle">Checking…</span>;
  if (!stop) return DASH;
  return (
    <div>
      <p className="font-semibold text-ink">
        {stop.minutes} min <span className="font-normal text-muted">walk</span>
      </p>
      <p className="mt-0.5 text-xs leading-snug text-muted">{stop.name}</p>
      {stop.routes.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-1">
          {stop.routes.slice(0, 5).map((r) => (
            <span
              key={r}
              className="rounded bg-midnight px-1.5 py-0.5 text-[10px] font-bold text-white"
            >
              {r}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * Transit rows. Walk time is the number a tenant actually argues about, so it
 * drives the best-in-row accent; the station name and its routes sit under it
 * because "7 minutes" means nothing without knowing to what.
 */
const TRANSIT_ROWS: Row[] = [
  {
    key: 'transit_subway',
    label: 'Nearest subway',
    best: 'min',
    numeric: (c) => bestOfMode(c, 'subway')?.minutes ?? null,
    compareKey: (c) => bestOfMode(c, 'subway')?.name ?? '',
    render: (c) => stopCell(bestOfMode(c, 'subway'), c.transit === null),
    tall: true,
  },
  {
    key: 'transit_rail',
    label: 'Nearest rail / PATH',
    best: 'min',
    numeric: (c) => {
      const rail = bestOfMode(c, 'rail');
      const path = bestOfMode(c, 'path');
      const best = [rail, path].filter(Boolean) as NearbyStop[];
      return best.length ? Math.min(...best.map((s) => s.minutes)) : null;
    },
    compareKey: (c) => (bestOfMode(c, 'rail') ?? bestOfMode(c, 'path'))?.name ?? '',
    render: (c) => {
      const rail = bestOfMode(c, 'rail');
      const path = bestOfMode(c, 'path');
      const best =
        rail && path ? (rail.minutes <= path.minutes ? rail : path) : (rail ?? path);
      return stopCell(best, c.transit === null);
    },
    tall: true,
  },
  {
    key: 'transit_bus',
    label: 'Nearest bus',
    best: 'min',
    numeric: (c) => bestOfMode(c, 'bus')?.minutes ?? null,
    compareKey: (c) => bestOfMode(c, 'bus')?.name ?? '',
    render: (c) => stopCell(bestOfMode(c, 'bus'), c.transit === null),
    tall: true,
  },
  {
    key: 'transit_ferry',
    label: 'Nearest ferry',
    best: 'min',
    numeric: (c) => bestOfMode(c, 'ferry')?.minutes ?? null,
    compareKey: (c) => bestOfMode(c, 'ferry')?.name ?? '',
    render: (c) => stopCell(bestOfMode(c, 'ferry'), c.transit === null),
    tall: true,
  },
  {
    key: 'transit_within_10',
    label: 'Stops within 10 min',
    best: 'max',
    numeric: (c) => c.transit?.filter((s) => s.minutes <= 10).length ?? null,
    compareKey: (c) => String(c.transit?.filter((s) => s.minutes <= 10).length ?? ''),
    render: (c) => {
      if (c.transit === null) return <span className="text-subtle">Checking…</span>;
      const within = c.transit.filter((s) => s.minutes <= 10);
      if (within.length === 0) return DASH;
      const byMode = new Map<string, number>();
      for (const stop of within) byMode.set(stop.mode, (byMode.get(stop.mode) ?? 0) + 1);
      const parts = [...byMode.entries()]
        .sort((a, b) => (MODE_RANK[a[0] as never] ?? 9) - (MODE_RANK[b[0] as never] ?? 9))
        .map(([mode, n]) => `${n} ${MODE_LABEL[mode as never] ?? mode}`);
      return (
        <div>
          <p className="tabular font-semibold text-ink">{within.length}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted">{parts.join(' · ')}</p>
        </div>
      );
    },
    tall: true,
  },
];

const LANDLORD_ROWS: Row[] = [
  {
    key: 'landlord',
    label: 'Landlord',
    compareKey: (c) => c.landlord?.name ?? c.building.landlord_name ?? '',
    render: (c) => text(c.landlord?.name ?? c.building.landlord_name),
  },
  {
    key: 'portfolio_sf',
    label: 'Portfolio SF',
    best: 'max',
    numeric: (c) => c.landlord?.portfolio_sf ?? null,
    compareKey: (c) => String(c.landlord?.portfolio_sf ?? ''),
    render: (c) => (
      <span className="tabular">{formatCompactSf(c.landlord?.portfolio_sf) ?? DASH}</span>
    ),
  },
  {
    key: 'buildings_owned',
    label: 'Buildings owned',
    best: 'max',
    numeric: (c) => c.landlord?.buildings_owned ?? null,
    compareKey: (c) => String(c.landlord?.buildings_owned ?? ''),
    render: (c) => (
      <span className="tabular">{formatNumber(c.landlord?.buildings_owned) ?? DASH}</span>
    ),
  },
  {
    key: 'amenities',
    label: 'Amenities',
    tall: true,
    compareKey: (c) => (c.landlord?.amenities ?? []).join('|'),
    render: (c) => chips(c.landlord?.amenities ?? []),
  },
  {
    key: 'notable_tenants',
    label: 'Notable tenants',
    tall: true,
    compareKey: (c) => (c.landlord?.notable_tenants ?? []).join('|'),
    render: (c) => chips(c.landlord?.notable_tenants ?? []),
  },
  {
    key: 'insights',
    label: 'Insights',
    tall: true,
    compareKey: (c) => c.landlord?.insights_md ?? '',
    render: (c) =>
      c.landlord?.insights_md ? (
        <Markdownish
          text={c.landlord.insights_md}
          className="max-w-[46ch] space-y-2 text-[13px] leading-6 text-body"
        />
      ) : (
        DASH
      ),
  },
];

/** Indices holding the best numeric value in a row; empty when it is a tie. */
function bestIndices(columns: Column[], row: Row): Set<number> {
  const out = new Set<number>();
  if (!row.best || !row.numeric || columns.length < 2) return out;
  const values = columns.map(row.numeric);
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length < 2) return out;
  const target = row.best === 'min' ? Math.min(...present) : Math.max(...present);
  values.forEach((v, i) => {
    if (v !== null && v === target) out.add(i);
  });
  // Every column sharing the value means nothing stands out.
  if (out.size === columns.length) out.clear();
  return out;
}

function allIdentical(columns: Column[], row: Row): boolean {
  if (columns.length < 2) return false;
  const first = row.compareKey(columns[0]);
  return columns.every((c) => row.compareKey(c) === first);
}

/**
 * Two shells around identical content.
 *
 * `modal` is the page takeover, still used from the building profile where
 * there is no map to float over. `panel` is a floating card on the map, which
 * is where a broker actually works: the comparison sits beside the towers it
 * describes rather than replacing them, and dismissing it puts you straight
 * back on the map with nothing lost.
 *
 * The rows, the best-in-row accents and every lookup are shared — a comparison
 * that said different things in the two places would be worse than having only
 * one of them.
 */
export type CompareVariant = 'modal' | 'panel';

export default function CompareView({
  onClose,
  variant = 'modal',
  panelRef,
}: {
  onClose?: () => void;
  variant?: CompareVariant;
  /** Lets the map tell a click apart from a click inside the panel. */
  panelRef?: React.Ref<HTMLDivElement>;
}) {
  const details = useCompareDetails();
  const buildings = useApp((s) => s.buildings);
  const compare = useApp((s) => s.compare);
  const removeFromCompare = useApp((s) => s.removeFromCompare);
  const clearCompare = useApp((s) => s.clearCompare);
  const setCompareOpen = useApp((s) => s.setCompareOpen);
  const loadCompareFromUrl = useApp((s) => s.loadCompareFromUrl);

  const [landlords, setLandlords] = useState<Landlord[]>([]);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [transitStops, setTransitStops] = useState<TransitStop[] | null>(null);
  const hydrated = useRef(false);

  const close = onClose ?? (() => setCompareOpen(false));

  // A pasted ?compare=... link rehydrates the tray as soon as data is there.
  useEffect(() => {
    if (hydrated.current || buildings.length === 0) return;
    const param = new URLSearchParams(window.location.search).get('compare');
    const ids = (param ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    hydrated.current = true;
    if (ids.length > 0) loadCompareFromUrl(ids);
  }, [buildings, loadCompareFromUrl]);

  useEffect(() => {
    let cancelled = false;
    void fetchLandlords().then((all) => {
      if (!cancelled) setLandlords(all);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const spaceIds = compare.map((c) => c.spaceId).join(',');
  useEffect(() => {
    let cancelled = false;
    const ids = spaceIds ? spaceIds.split(',') : [];
    void Promise.all(
      ids.map(async (id) => {
        const images = await fetchSpaceImages(id);
        return [id, images[0]?.blob_url ?? null] as const;
      }),
    ).then((pairs) => {
      if (!cancelled) setPhotos(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [spaceIds]);

  // One transit lookup covering every compared building, rather than one per
  // column: they are usually within a few blocks of each other, and Overpass
  // is a volunteer service.
  const transitBounds = details
    .map(({ building }) =>
      building.lon !== null && building.lat !== null
        ? `${building.lon.toFixed(3)},${building.lat.toFixed(3)}`
        : '',
    )
    .filter(Boolean)
    .sort()
    .join('|');

  useEffect(() => {
    if (!transitBounds) {
      setTransitStops(null);
      return;
    }
    const points = transitBounds.split('|').map((p) => p.split(',').map(Number));
    let west = 180;
    let south = 90;
    let east = -180;
    let north = -90;
    for (const [lon, lat] of points) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    // A margin wide enough that a station just outside the group still counts.
    const pad = 0.012;
    const bbox = [west - pad, south - pad, east + pad, north + pad];
    // Two compared buildings can be a mile apart; past the API's own limit the
    // lookup is skipped rather than failed.
    if (bbox[2] - bbox[0] > 0.19 || bbox[3] - bbox[1] > 0.19) {
      setTransitStops([]);
      return;
    }

    let cancelled = false;
    void fetch(`/api/transit?bbox=${bbox.map((v) => v.toFixed(3)).join(',')}`)
      .then((res) => (res.ok ? (res.json() as Promise<TransitResult>) : null))
      .then((data) => {
        if (!cancelled) setTransitStops(data?.stops ?? []);
      })
      .catch(() => {
        if (!cancelled) setTransitStops([]);
      });
    return () => {
      cancelled = true;
    };
  }, [transitBounds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const columns: Column[] = useMemo(
    () =>
      details.map(({ building, space }) => ({
        building,
        space,
        landlord:
          landlords.find((l) => l.id === building.landlord_id) ??
          landlords.find((l) => l.name === building.landlord_name) ??
          null,
        transit:
          transitStops === null || building.lon === null || building.lat === null
            ? null
            : nearestStops([building.lon, building.lat], transitStops, {
                limit: 12,
                maxMeters: 1200,
                perMode: 4,
              }),
        photo: photos[space.id] ?? null,
      })),
    [details, landlords, photos, transitStops],
  );

  async function copyLink() {
    const url = new URL(window.location.href);
    url.searchParams.set('compare', compare.map((c) => c.spaceId).join(','));
    window.history.replaceState(null, '', url.toString());
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied('Link copied');
    } catch {
      setCopied('Link is in the address bar — copy it from there');
    }
    window.setTimeout(() => setCopied(null), 3000);
  }

  // With two or three spaces the table would otherwise be a thin ribbon in a
  // wide panel, so the column track widens (to a cap) and the whole table is
  // centred with auto margins rather than left-aligned against dead space.
  const colWidth =
    columns.length <= 3 ? 'min-w-[300px] w-[340px]' : 'min-w-[260px] w-[260px]';

  function renderSection(title: string, rows: Row[], divided?: boolean) {
    return (
      <>
        <tr>
          <th
            colSpan={columns.length + 1}
            className={clsx(
              'sticky left-0 z-10 bg-white px-4 pb-2 text-left text-[12px] font-semibold uppercase tracking-[0.14em] text-midnight',
              divided ? 'border-t-2 border-hairline-strong pt-6' : 'pt-4',
            )}
          >
            <span className="inline-block border-b-2 border-goldenrod pb-1">{title}</span>
          </th>
        </tr>
        {rows.map((row) => {
          const best = bestIndices(columns, row);
          const identical = allIdentical(columns, row);
          return (
            <tr key={row.key} className="border-b border-hairline last:border-b-0">
              <th
                scope="row"
                className="sticky left-0 z-10 w-[180px] min-w-[180px] border-r border-hairline bg-surface-alt px-4 py-3 text-left align-top text-[11px] font-semibold uppercase tracking-[0.12em] text-muted"
              >
                {row.label}
              </th>
              {columns.map((c, i) => (
                <td
                  key={c.space.id}
                  className={clsx(
                    colWidth,
                    'border-l border-hairline px-4 py-3 align-top text-sm font-medium',
                    row.tall ? 'text-body' : 'text-ink',
                    identical && 'text-subtle',
                    best.has(i) &&
                      'border-l-[3px] border-l-goldenrod bg-goldenrod-50 font-semibold text-ink',
                  )}
                >
                  {row.render(c)}
                </td>
              ))}
            </tr>
          );
        })}
      </>
    );
  }

  const isPanel = variant === 'panel';

  const card = (
    <div
      ref={panelRef}
      role="dialog"
      // Only the modal traps the page. The panel deliberately does not: the
      // map behind it stays live, and clicking a tower is how you dismiss it.
      aria-modal={isPanel ? undefined : 'true'}
      aria-label="Space comparison"
      className={clsx(
        'flex flex-col overflow-hidden rounded-card bg-white',
        isPanel
          ? // Sized so the map stays the larger thing on screen. A panel that
            // fills the frame is the page takeover this was moved away from.
            'pointer-events-auto max-h-[48vh] w-full max-w-4xl border border-hairline-strong shadow-float'
          : 'max-h-[92vh] w-full max-w-[min(96rem,95vw)] shadow-float',
      )}
    >
        <header
          className={clsx(
            'flex flex-wrap items-center justify-between gap-3 border-b border-hairline',
            isPanel ? 'px-4 py-2.5' : 'px-6 py-4',
          )}
        >
          <div>
            <h2
              className={clsx(
                'font-semibold tracking-tight text-ink',
                isPanel ? 'text-base' : 'text-xl',
              )}
            >
              Comparison{' '}
              <span className="font-medium tabular text-muted">
                ({columns.length} {columns.length === 1 ? 'space' : 'spaces'})
              </span>
            </h2>
            {/* The panel is short, and every line of explanation is a row of
                the table the broker cannot see. */}
            {!isPanel && (
              <p className="mt-1 text-[13px] font-medium leading-5 text-muted">
                Best value in each numeric row is highlighted; values identical across every column
                are dimmed.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {copied && <span className="text-sm font-medium text-ok">{copied}</span>}
            <button
              type="button"
              onClick={() => void copyLink()}
              disabled={columns.length === 0}
              className="rounded border border-hairline-strong bg-white px-3 py-2 text-sm font-medium text-body transition-colors hover:border-midnight hover:text-ink disabled:opacity-40"
            >
              Copy shareable link
            </button>
            <button
              type="button"
              onClick={clearCompare}
              className="rounded px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-ink"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={close}
              aria-label="Close comparison"
              title="Close comparison"
              className="rounded-full border border-hairline-strong bg-white p-2 text-muted transition-colors hover:border-midnight hover:text-ink"
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        {columns.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
            <p className="text-sm font-medium text-muted">
              Nothing to compare yet — add spaces from a building profile or the map.
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="mx-auto w-max border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 w-[180px] min-w-[180px] border-b border-r border-hairline bg-surface-alt px-4 py-3" />
                  {columns.map((c) => (
                    <td
                      key={c.space.id}
                      className={clsx(
                        colWidth,
                        'sticky top-0 z-20 border-b border-l border-hairline bg-white px-4 py-4 align-top',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p
                            className="truncate text-base font-semibold text-ink"
                            title={c.building.address_display}
                          >
                            {c.building.address_display}
                          </p>
                          <p className="truncate text-[13px] font-medium text-muted">
                            {c.space.floor_label}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label="Remove from comparison"
                          onClick={() => removeFromCompare(c.space.id)}
                          className="shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-surface-alt hover:text-danger"
                        >
                          <CloseIcon />
                        </button>
                      </div>
                      {c.photo ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={c.photo}
                          alt=""
                          className="mt-3 h-28 w-full rounded border border-hairline bg-surface-sunken object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="mt-3 flex h-28 w-full items-center justify-center rounded border border-dashed border-hairline-strong bg-surface-alt text-[13px] font-medium text-muted">
                          No photo
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {renderSection('Space', SPACE_ROWS)}
                {renderSection('Transit', TRANSIT_ROWS, true)}
                {renderSection('Landlord', LANDLORD_ROWS, true)}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );

  // The panel has no shell of its own: whoever mounts it decides where it
  // floats and owns the click-outside rule, because on the map that rule is
  // "clicking a building", not "clicking a scrim".
  if (isPanel) return card;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-midnight/60 p-4 sm:p-6"
      onMouseDown={(e) => {
        // Scrim click only — a drag that starts inside the panel must not close it.
        if (e.target === e.currentTarget) close();
      }}
      role="presentation"
    >
      {card}
    </div>
  );
}
