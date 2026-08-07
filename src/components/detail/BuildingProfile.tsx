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

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-edge bg-ink/40 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm font-medium text-white">{children}</p>
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
    <section id={id} className="scroll-mt-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white">{title}</h2>
        {action}
      </div>
      {children}
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
      <div className="px-4 py-10 text-center">
        {loading ? (
          <p className="text-sm text-muted">Loading building…</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-danger">{error ?? 'Building not found.'}</p>
            <Link href="/" className="text-xs text-accent hover:underline">
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
    <div className="space-y-6 px-4 py-4 pb-28">
      {needsConfirmation && (
        <div className="flex items-start gap-3 rounded border border-warn/50 bg-warn/10 px-4 py-3">
          <span aria-hidden className="text-lg leading-5 text-warn">
            ⚠
          </span>
          <div>
            <p className="text-sm font-semibold text-warn">
              This building was matched approximately — confirm before showing a client.
            </p>
            <p className="mt-0.5 text-xs text-warn/80">
              Match confidence is “{building.match_confidence}”. Verify the address, then set the
              match to Manual in Edit building.
            </p>
          </div>
        </div>
      )}

      <header className="space-y-3 rounded border border-edge bg-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-white">{building.address_display}</h1>
              <ClassBadge value={building.class} />
              {activeSpaces.length === 0 && <Badge variant="neutral">No availabilities</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted">
              {building.building_name ?? 'Unnamed building'}
              {building.submarket_cluster ? ` · ${building.submarket_cluster}` : ''}
            </p>
            <p className="mt-1 text-xs text-muted">
              Landlord:{' '}
              {building.landlord_name ? (
                <a href="#landlord" className="text-accent hover:underline">
                  {building.landlord_name}
                </a>
              ) : (
                <a href="#landlord" className="text-accent hover:underline">
                  Not recorded — add insights
                </a>
              )}
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
            className="rounded border border-edge px-3 py-1.5 text-xs text-muted hover:text-white"
          >
            Edit building
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Year built">
            <Num value={building.year_built} />
          </Stat>
          <Stat label="Floors">
            <Num value={building.num_floors} />
            {derived && building.num_floors ? (
              <span className="ml-1 text-[11px] text-muted" title="Floor heights are derived from roof height ÷ floor count">
                (est. heights)
              </span>
            ) : null}
          </Stat>
          <Stat label="Available spaces">
            <Num value={activeSpaces.length} />
          </Stat>
          <Stat label="Total available SF">
            <Sf value={totalSf || null} />
          </Stat>
          <Stat label="Asking rent range">
            <RentRange min={minRent} max={maxRent} />
          </Stat>
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
