'use client';

import { useState } from 'react';
import clsx from 'clsx';
import type { BuildingWithSpaces, Space } from '@/types';
import { useApp } from '@/lib/store';
import Badge, { LeaseTypeBadge } from '@/components/ui/Badge';
import { DateText, Rent, Sf, formatAnnualRent, annualRent } from '@/components/ui/Money';
import PhotoGallery from './PhotoGallery';
import EditDrawer, { type EditTarget } from '@/components/edit/EditDrawer';

/** Quarter mile is how brokers describe "around the corner". */
const COMPS_RADIUS_MILES = 0.25;

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-hairline pb-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="text-sm font-medium tabular text-ink">{children}</dd>
    </div>
  );
}

const QUIET_BUTTON =
  'rounded border border-hairline-strong bg-white px-2.5 py-1.5 text-xs font-medium text-body transition-colors hover:border-midnight hover:text-ink';

export default function SpaceDetail({
  space,
  building,
  onClose,
}: {
  space: Space;
  building: BuildingWithSpaces;
  onClose?: () => void;
}) {
  const addToCompare = useApp((s) => s.addToCompare);
  const removeFromCompare = useApp((s) => s.removeFromCompare);
  const inCompare = useApp((s) => s.compare.some((c) => c.spaceId === space.id));
  const setRadius = useApp((s) => s.setRadius);
  const radius = useApp((s) => s.radius);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const hasCoords = building.lon !== null && building.lat !== null;
  const compsActive =
    radius !== null && radius.originBuildingId === building.id && radius.miles === COMPS_RADIUS_MILES;

  const annual = annualRent(space.asking_rent_psf, space.sf, space.asking_rent_withheld);
  const emailUsable = Boolean(space.agent_email) && !space.agent_email_suspect;

  return (
    <section className="rounded-card border border-hairline bg-white shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight text-ink">
              {space.floor_label || 'Space'}
            </h3>
            <Badge variant={space.floor_portion === 'partial' ? 'neutral' : 'info'}>
              {space.floor_portion === 'partial' ? 'Partial floor' : 'Entire floor'}
            </Badge>
            <LeaseTypeBadge value={space.lease_type} />
            {!space.is_active && <Badge variant="danger">Off market</Badge>}
          </div>
          <p className="mt-1.5 truncate text-xs text-muted">
            {building.address_display}
            {building.building_name ? ` · ${building.building_name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              inCompare ? removeFromCompare(space.id) : addToCompare(space.id, building.id)
            }
            className={clsx(
              'rounded px-3 py-1.5 text-xs font-semibold transition-colors',
              inCompare
                ? 'border border-goldenrod bg-goldenrod-100 text-goldenrod-700'
                : 'bg-goldenrod text-midnight hover:bg-goldenrod-400',
            )}
          >
            {inCompare ? 'In compare' : 'Add to compare'}
          </button>
          <button
            type="button"
            disabled={!hasCoords}
            title={hasCoords ? undefined : 'This building has no coordinates yet.'}
            onClick={() => {
              if (building.lon === null || building.lat === null) return;
              if (compsActive) {
                setRadius(null);
                return;
              }
              setRadius({
                lon: building.lon,
                lat: building.lat,
                miles: COMPS_RADIUS_MILES,
                originBuildingId: building.id,
              });
            }}
            className={clsx(
              'rounded border px-3 py-1.5 text-xs font-semibold transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-40',
              compsActive
                ? 'border-midnight bg-midnight text-white'
                : 'border-midnight bg-white text-midnight hover:bg-midnight-50',
            )}
          >
            {compsActive ? 'Clear ¼ mile comps' : 'Find comps within ¼ mile'}
          </button>
          <button
            type="button"
            onClick={() =>
              setEditing({ kind: 'space', id: space.id, initial: space as unknown as Record<string, unknown> })
            }
            className={QUIET_BUTTON}
          >
            Edit
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className={QUIET_BUTTON}>
              Close
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-8 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-8">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            <Spec label="Square feet">
              <Sf value={space.sf} />
            </Spec>
            <Spec label="Asking rent">
              <Rent psf={space.asking_rent_psf} withheld={space.asking_rent_withheld} />
            </Spec>
            <Spec label="Annual rent">
              {annual === null ? (
                <span className="text-subtle">—</span>
              ) : (
                <span className="tabular">{formatAnnualRent(annual)}</span>
              )}
            </Spec>
            <Spec label="Space use">{space.space_use ?? <span className="text-subtle">—</span>}</Spec>
            <Spec label="Floor number">
              {space.floor_number ?? <span className="text-subtle">—</span>}
            </Spec>
            <Spec label="Sub-landlord">
              {space.sub_landlord ?? <span className="text-subtle">—</span>}
            </Spec>
            <Spec label="Available">
              <DateText value={space.available_from} full fallback={space.occupancy_raw} />
            </Spec>
            <Spec label="Term expires">
              <DateText value={space.term_expires} full fallback={space.term_raw} />
            </Spec>
            <Spec label="Date added">
              <DateText value={space.date_added} full />
            </Spec>
          </dl>

          {space.notes && (
            <div>
              <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                Notes
              </h4>
              <p className="max-w-prose whitespace-pre-wrap text-sm leading-7 text-body">
                {space.notes}
              </p>
            </div>
          )}

          <PhotoGallery spaceId={space.id} />
        </div>

        <aside className="space-y-3 self-start rounded-card border border-hairline bg-surface-alt p-4">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Leasing contact
          </h4>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-ink">{space.agent_name ?? 'Unnamed agent'}</p>
            {space.leasing_company && <p className="text-xs text-muted">{space.leasing_company}</p>}
          </div>

          {space.agent_email ? (
            emailUsable ? (
              <a
                href={`mailto:${space.agent_email}?subject=${encodeURIComponent(
                  `${building.address_display} — ${space.floor_label}`,
                )}`}
                className="block break-all text-xs font-medium text-info hover:underline"
              >
                {space.agent_email}
              </a>
            ) : (
              <div className="space-y-1.5">
                <p className="break-all text-xs text-body">{space.agent_email}</p>
                <p className="rounded border-l-2 border-warmorange bg-warn-surface px-2.5 py-2 text-[11px] font-medium leading-4 text-warmorange">
                  This email looks truncated in the source sheet — verify before sending.
                </p>
              </div>
            )
          ) : (
            <p className="text-xs text-muted">No email on file.</p>
          )}
        </aside>
      </div>

      <EditDrawer target={editing} onClose={() => setEditing(null)} />
    </section>
  );
}
