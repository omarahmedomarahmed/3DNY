'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { BuildingWithSpaces } from '@/types';
import { useApp } from '@/lib/store';
import { floorHeightFt } from '@/lib/floor-bands';
import Badge, { ClassBadge } from '@/components/ui/Badge';
import { Num, RentRange, Sf } from '@/components/ui/Money';
import EditDrawer, { type EditTarget } from '@/components/edit/EditDrawer';
import SpaceTable from './SpaceTable';
import SpaceDetail from './SpaceDetail';
import TenantTable from './TenantTable';
import LandlordPanel from './LandlordPanel';

/**
 * A metadata chip in the header row. Label above, value below — the value is
 * the thing a broker reads aloud, so it carries the weight.
 */
function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded border border-hairline bg-white px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      <span className="text-sm font-semibold tabular text-ink">{children}</span>
    </div>
  );
}

function Section({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-20 overflow-hidden rounded-card border border-hairline bg-white shadow-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          {title}
        </h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function BuildingProfile({ buildingId }: { buildingId: string }) {
  const buildings = useApp((s) => s.buildings);
  const loadBuildings = useApp((s) => s.loadBuildings);
  const selectedSpaceId = useApp((s) => s.selectedSpaceId);
  const selectSpace = useApp((s) => s.selectSpace);
  const selectBuilding = useApp((s) => s.selectBuilding);

  const [fetched, setFetched] = useState<BuildingWithSpaces | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const fromStore = buildings.find((b) => b.id === buildingId) ?? null;
  const building = fromStore ?? fetched;

  useEffect(() => {
    selectBuilding(buildingId);
  }, [buildingId, selectBuilding]);

  // The tray and compare view resolve their entries against the full list, so
  // it has to be in the store even when we arrived straight at this URL.
  useEffect(() => {
    if (buildings.length === 0) void loadBuildings();
  }, [buildings.length, loadBuildings]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/buildings/${buildingId}`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((body as { error?: string }).error ?? `Could not load building (${res.status})`);
        }
        if (!cancelled) setFetched(body as BuildingWithSpaces);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  if (!building) {
    return (
      <div className="px-6 py-16 text-center">
        {loading ? (
          <p className="text-sm text-muted">Loading building…</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-danger">{error ?? 'Building not found.'}</p>
            <Link
              href="/map"
              className="inline-block text-xs font-medium text-brightblue hover:underline"
            >
              ← Back to the map
            </Link>
          </div>
        )}
      </div>
    );
  }

  const activeSpaces = (building.spaces ?? []).filter((s) => s.is_active);
  const totalSf =
    building.totalAvailableSf ?? activeSpaces.reduce((sum, s) => sum + (s.sf ?? 0), 0);
  const rents = activeSpaces
    .filter((s) => !s.asking_rent_withheld)
    .map((s) => s.asking_rent_psf)
    .filter((r): r is number => r !== null);
  const minRent = building.minRent ?? (rents.length ? Math.min(...rents) : null);
  const maxRent = building.maxRent ?? (rents.length ? Math.max(...rents) : null);

  const selected = selectedSpaceId
    ? (building.spaces ?? []).find((s) => s.id === selectedSpaceId) ?? null
    : null;

  const needsConfirmation =
    building.match_confidence === 'fuzzy' || building.match_confidence === 'unmatched';
  const { derived } = floorHeightFt(building);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6 pb-32">
      {needsConfirmation && (
        <div className="flex items-start gap-3 rounded-card border-l-4 border-warmorange bg-warn-surface px-4 py-3">
          <span aria-hidden className="text-lg leading-5 text-warmorange">
            ⚠
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">
              This building was matched approximately — confirm before showing a client.
            </p>
            <p className="mt-0.5 text-xs leading-5 text-midnight-500">
              Match confidence is “{building.match_confidence}”. Verify the address, then set the
              match to Manual in Edit building.
            </p>
          </div>
        </div>
      )}

      {/* Header block ------------------------------------------------------ */}
      <header className="rounded-card border border-hairline bg-white p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold leading-tight tracking-tight text-ink">
                {building.address_display}
              </h1>
              <ClassBadge value={building.class} />
              {activeSpaces.length === 0 && <Badge variant="neutral">No availabilities</Badge>}
            </div>
            <p className="mt-1.5 text-base text-body">
              {building.building_name ?? 'Unnamed building'}
            </p>
            <p className="mt-2 text-xs text-muted">
              Landlord:{' '}
              <a href="#landlord" className="font-medium text-brightblue hover:underline">
                {building.landlord_name ?? 'Not recorded — add insights'}
              </a>
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setEditing({
                kind: 'building',
                id: building.id,
                initial: building as unknown as Record<string, unknown>,
              })
            }
            className="rounded border border-hairline-strong bg-white px-3 py-1.5 text-xs font-medium text-body transition-colors hover:border-midnight hover:text-ink"
          >
            Edit building
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Chip label="Class">{building.class ? `Class ${building.class}` : '—'}</Chip>
          <Chip label="Submarket">{building.submarket_cluster ?? building.submarket ?? '—'}</Chip>
          <Chip label="Year built">
            <Num value={building.year_built} />
          </Chip>
          <Chip label="Floors">
            <Num value={building.num_floors} />
            {derived && building.num_floors ? (
              <span
                className="ml-1 text-[10px] font-normal text-subtle"
                title="Floor heights are derived from roof height ÷ floor count"
              >
                est.
              </span>
            ) : null}
          </Chip>
          <Chip label="Total available">
            <Sf value={totalSf || null} />
          </Chip>
          <Chip label="Asking rent">
            <RentRange min={minRent} max={maxRent} />
          </Chip>
        </div>
      </header>

      <Section id="spaces" title={`Available Spaces (${activeSpaces.length})`}>
        <SpaceTable building={building} />
      </Section>

      {selected && (
        <Section id="space-detail" title="Space Detail">
          <SpaceDetail space={selected} building={building} onClose={() => selectSpace(null)} />
        </Section>
      )}

      <Section id="tenants" title="Current Tenants">
        <TenantTable buildingId={building.id} initialTenants={building.tenants} />
      </Section>

      <Section id="landlord" title="Landlord Insights">
        <LandlordPanel building={building} />
      </Section>

      <EditDrawer
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => setFetched(saved as BuildingWithSpaces)}
      />
    </div>
  );
}
