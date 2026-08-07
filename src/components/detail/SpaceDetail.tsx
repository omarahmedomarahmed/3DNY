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
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-sm text-white">{children}</dd>
    </div>
  );
}

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
    <section className="rounded border border-edge bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-white">{space.floor_label || 'Space'}</h3>
            <Badge variant={space.floor_portion === 'partial' ? 'neutral' : 'info'}>
              {space.floor_portion === 'partial' ? 'Partial floor' : 'Entire floor'}
            </Badge>
            <LeaseTypeBadge value={space.lease_type} />
            {!space.is_active && <Badge variant="danger">Off market</Badge>}
          </div>
          <p className="mt-1 truncate text-xs text-muted">
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
              'rounded border px-2.5 py-1.5 text-xs transition-colors',
              inCompare
                ? 'border-accent/60 bg-accent/15 text-accent'
                : 'border-edge text-muted hover:border-accent/60 hover:text-accent',
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
              'rounded border px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              compsActive
                ? 'border-accent/60 bg-accent/15 text-accent'
                : 'border-edge text-muted hover:border-accent/60 hover:text-accent',
            )}
          >
            {compsActive ? 'Clear ¼ mile comps' : 'Find comps within ¼ mile'}
          </button>
          <button
            type="button"
            onClick={() =>
              setEditing({ kind: 'space', id: space.id, initial: space as unknown as Record<string, unknown> })
            }
            className="rounded border border-edge px-2.5 py-1.5 text-xs text-muted hover:text-white"
          >
            Edit
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-edge px-2.5 py-1.5 text-xs text-muted hover:text-white"
            >
              Close
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-6 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Spec label="Square feet">
              <Sf value={space.sf} />
            </Spec>
            <Spec label="Asking rent">
              <Rent psf={space.asking_rent_psf} withheld={space.asking_rent_withheld} />
            </Spec>
            <Spec label="Annual rent">
              {annual === null ? (
                <span className="text-muted">—</span>
              ) : (
                <span className="tabular-nums">{formatAnnualRent(annual)}</span>
              )}
            </Spec>
            <Spec label="Space use">{space.space_use ?? <span className="text-muted">—</span>}</Spec>
            <Spec label="Floor number">
              {space.floor_number ?? <span className="text-muted">—</span>}
            </Spec>
            <Spec label="Sub-landlord">
              {space.sub_landlord ?? <span className="text-muted">—</span>}
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
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Notes
              </h4>
              <p className="whitespace-pre-wrap text-sm leading-6 text-white/90">{space.notes}</p>
            </div>
          )}

          <PhotoGallery spaceId={space.id} />
        </div>

        <aside className="space-y-3 self-start rounded border border-edge bg-ink/40 p-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Leasing contact
          </h4>
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-white">{space.agent_name ?? 'Unnamed agent'}</p>
            {space.leasing_company && <p className="text-xs text-muted">{space.leasing_company}</p>}
          </div>

          {space.agent_email ? (
            emailUsable ? (
              <a
                href={`mailto:${space.agent_email}?subject=${encodeURIComponent(
                  `${building.address_display} — ${space.floor_label}`,
                )}`}
                className="block break-all text-xs text-accent hover:underline"
              >
                {space.agent_email}
              </a>
            ) : (
              <div className="space-y-1">
                <p className="break-all text-xs text-white/80">{space.agent_email}</p>
                <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] leading-4 text-warn">
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
