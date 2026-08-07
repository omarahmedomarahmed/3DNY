'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { BuildingWithSpaces, Landlord, Space } from '@/types';
import { useApp, useCompareDetails } from '@/lib/store';
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

const DASH = <span className="text-muted">—</span>;

function text(value: string | null | undefined): React.ReactNode {
  return value ? value : DASH;
}

function chips(values: string[]): React.ReactNode {
  if (values.length === 0) return DASH;
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => (
        <Badge key={v} variant="neutral">
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
        <p className="font-medium text-white">{c.building.address_display}</p>
        {c.building.building_name && (
          <p className="text-[11px] text-muted">{c.building.building_name}</p>
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
        <span className="text-white">{c.space.floor_label || '—'}</span>
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
    render: (c) => <span className="tabular-nums">{formatSf(c.space.sf) ?? DASH}</span>,
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
        <span className="tabular-nums">{formatRent(c.space.asking_rent_psf) ?? DASH}</span>
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
      return value === null ? DASH : <span className="tabular-nums">{formatAnnualRent(value)}</span>;
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
            <p className="break-all text-[11px] text-warn" title="Email looks truncated in the source sheet">
              {c.space.agent_email} (verify)
            </p>
          ) : (
            <a
              href={`mailto:${c.space.agent_email}`}
              className="block break-all text-[11px] text-accent hover:underline"
            >
              {c.space.agent_email}
            </a>
          ))}
      </div>
    ),
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
      <span className="tabular-nums">{formatCompactSf(c.landlord?.portfolio_sf) ?? DASH}</span>
    ),
  },
  {
    key: 'buildings_owned',
    label: 'Buildings owned',
    best: 'max',
    numeric: (c) => c.landlord?.buildings_owned ?? null,
    compareKey: (c) => String(c.landlord?.buildings_owned ?? ''),
    render: (c) => (
      <span className="tabular-nums">{formatNumber(c.landlord?.buildings_owned) ?? DASH}</span>
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
          className="space-y-1.5 text-[13px] leading-5 text-white/85"
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

export default function CompareView({ onClose }: { onClose?: () => void }) {
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
        photo: photos[space.id] ?? null,
      })),
    [details, landlords, photos],
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

  const colWidth = 'min-w-[260px] w-[260px]';

  function renderSection(title: string, rows: Row[]) {
    return (
      <>
        <tr>
          <th
            colSpan={columns.length + 1}
            className="sticky left-0 z-10 bg-ink px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted"
          >
            {title}
          </th>
        </tr>
        {rows.map((row) => {
          const best = bestIndices(columns, row);
          const identical = allIdentical(columns, row);
          return (
            <tr key={row.key} className="border-b border-edge/60 last:border-b-0">
              <th
                scope="row"
                className="sticky left-0 z-10 w-[170px] min-w-[170px] border-r border-edge bg-panel px-3 py-2 text-left align-top text-[11px] font-medium uppercase tracking-wide text-muted"
              >
                {row.label}
              </th>
              {columns.map((c, i) => (
                <td
                  key={c.space.id}
                  className={clsx(
                    colWidth,
                    'px-3 py-2 align-top text-sm',
                    row.tall ? 'text-white/90' : 'text-white',
                    identical && 'text-muted',
                    best.has(i) && 'bg-accent/10 text-accent',
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Comparison{' '}
            <span className="text-muted">
              ({columns.length} {columns.length === 1 ? 'space' : 'spaces'})
            </span>
          </h2>
          <p className="text-[11px] text-muted">
            Best value in each numeric row is highlighted; values identical across every column are
            dimmed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {copied && <span className="text-[11px] text-ok">{copied}</span>}
          <button
            type="button"
            onClick={() => void copyLink()}
            disabled={columns.length === 0}
            className="rounded border border-edge px-2.5 py-1.5 text-xs text-muted hover:text-white disabled:opacity-40"
          >
            Copy shareable link
          </button>
          <button
            type="button"
            onClick={clearCompare}
            className="rounded border border-edge px-2.5 py-1.5 text-xs text-muted hover:text-white"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-ink hover:brightness-110"
          >
            Close
          </button>
        </div>
      </header>

      {columns.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm text-muted">
            Nothing to compare yet — add spaces from a building profile or the map.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge">
                <th className="sticky left-0 top-0 z-20 w-[170px] min-w-[170px] border-r border-edge bg-panel px-3 py-2" />
                {columns.map((c) => (
                  <td
                    key={c.space.id}
                    className={clsx(colWidth, 'sticky top-0 z-10 border-l border-edge bg-panel px-3 py-3 align-top')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white" title={c.building.address_display}>
                          {c.building.address_display}
                        </p>
                        <p className="truncate text-[11px] text-muted">{c.space.floor_label}</p>
                      </div>
                      <button
                        type="button"
                        aria-label="Remove from comparison"
                        onClick={() => removeFromCompare(c.space.id)}
                        className="shrink-0 text-muted hover:text-danger"
                      >
                        ✕
                      </button>
                    </div>
                    {c.photo ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={c.photo}
                        alt=""
                        className="mt-2 h-28 w-full rounded border border-edge bg-ink object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="mt-2 flex h-28 w-full items-center justify-center rounded border border-dashed border-edge text-[11px] text-muted">
                        No photo
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {renderSection('Space', SPACE_ROWS)}
              {renderSection('Landlord', LANDLORD_ROWS)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
