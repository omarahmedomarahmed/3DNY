'use client';

import { useMemo } from 'react';
import Link from 'next/link';

import { useApp } from '@/lib/store';
import { DateText, Sf } from '@/components/ui/Money';
import SourceInfo from '@/components/ui/SourceInfo';
import { tenantSource } from '@/lib/provenance';
import { formatFloorList } from '@/lib/floor-list';
import DraggableCard from './DraggableCard';
import type { BuildingWithSpaces, Tenant } from '@/types';

/**
 * The card behind an occupied or client band.
 *
 * Deliberately the same shape and dismissal behaviour as `SpacePopup` — a
 * broker should not have to learn that clicking one stripe on a tower behaves
 * differently from clicking the stripe below it. What differs is the content:
 * an availability answers "what would this cost"; a tenancy answers "who is
 * in there, how much do they have, and when does it roll".
 *
 * The last of those is the one that makes this worth drawing at all. A lease
 * expiring in eleven months is the single most useful fact on this card,
 * because it is a building a tenant could be in next year.
 */

const OFFSET = 14;
const MARGIN = 12;
const WIDTH = 320;

export interface TenantPopupProps {
  /** The card's id in the store, so drag and pin address the right one. */
  popupId: string;
  pinned: boolean;
  tenantId: string;
  buildingId: string;
  at: { x: number; y: number };
  onClose: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium text-body">{children}</div>
    </div>
  );
}

const RELATIONSHIP: Record<string, { label: string; className: string }> = {
  client: {
    label: 'Cresa client',
    className: 'bg-[#00A38C] text-white',
  },
  prospect: {
    label: 'Prospect',
    className: 'bg-midnight-50 text-midnight-700',
  },
  occupier: {
    label: 'Occupier',
    className: 'bg-surface-sunken text-muted',
  },
};

export default function TenantPopup({
  popupId,
  pinned,
  tenantId,
  buildingId,
  at,
  onClose,
}: TenantPopupProps) {
  const buildings = useApp((s) => s.buildings);

  const building = useMemo<BuildingWithSpaces | null>(
    () => buildings.find((b) => b.id === buildingId) ?? null,
    [buildings, buildingId],
  );
  const tenant = useMemo<Tenant | null>(
    () => building?.tenants?.find((t) => t.id === tenantId) ?? null,
    [building, tenantId],
  );


  if (!building || !tenant) return null;

  const badge = RELATIONSHIP[tenant.relationship] ?? RELATIONSHIP.occupier;
  const floors = formatFloorList(tenant.floor_numbers ?? []) || tenant.floors || '—';

  return (
    <DraggableCard
      id={popupId}
      pinned={pinned}
      anchor={at}
      width={WIDTH}
      ariaLabel={`${tenant.company_name} tenancy details`}
      title="Tenant"
      onClose={onClose}
    >
      <header className="flex items-start gap-2 border-b border-hairline px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span
              className={
                'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ' +
                badge.className
              }
            >
              {badge.label}
            </span>
            <SourceInfo
              label="this tenancy"
              note={tenantSource(tenant.source, tenant.import_filename, tenant.last_synced_at)}
            />
          </p>
          <h2 className="mt-1.5 flex items-center gap-1 text-base font-semibold leading-snug text-ink">
            <span className="truncate">{tenant.company_name}</span>
          </h2>
          <p className="truncate text-sm font-medium text-muted">
            {building.address_display}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 px-4 py-3">
        <Row label="Floors">{floors}</Row>
        <Row label="Size">
          <Sf value={tenant.sf} />
        </Row>
        <Row label="Lease expires">
          <DateText value={tenant.lease_expiration} />
        </Row>
        <Row label="Industry">
          {tenant.industry || <span className="text-subtle">—</span>}
        </Row>
      </div>

      {tenant.notes ? (
        <p className="border-t border-hairline px-4 py-2.5 text-[13px] font-medium leading-5 text-body">
          {tenant.notes}
        </p>
      ) : null}

      <footer className="flex items-center gap-2 border-t border-hairline bg-surface-alt px-4 py-2.5">
        {tenant.salesforce_url ? (
          <a
            href={tenant.salesforce_url}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded border border-hairline-strong bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:border-midnight hover:bg-midnight-50"
          >
            Open in Salesforce
          </a>
        ) : null}
        <Link
          href={`/building/${building.id}#tenants`}
          className="ml-auto rounded border border-hairline-strong bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:border-midnight hover:bg-midnight-50"
        >
          Full details
        </Link>
      </footer>
    </DraggableCard>
  );
}
