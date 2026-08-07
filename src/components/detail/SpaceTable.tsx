'use client';

import clsx from 'clsx';
import { useMemo } from 'react';
import type { BuildingWithSpaces, Space } from '@/types';
import { useApp } from '@/lib/store';
import Badge, { LeaseTypeBadge } from '@/components/ui/Badge';
import { DateText, Rent, Sf } from '@/components/ui/Money';

/**
 * Brokers read a stack from the top down — the penthouse first — so the
 * default sort is floor descending, with unknown floors last.
 */
export function sortSpacesForStack(spaces: Space[]): Space[] {
  return [...spaces].sort((a, b) => {
    const af = a.floor_number;
    const bf = b.floor_number;
    if (af === null && bf === null) return a.floor_label.localeCompare(b.floor_label);
    if (af === null) return 1;
    if (bf === null) return -1;
    if (bf !== af) return bf - af;
    return a.floor_label.localeCompare(b.floor_label);
  });
}

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted';
const TD = 'px-3 py-2 align-middle';

export default function SpaceTable({
  building,
  onOpenDetail,
}: {
  building: BuildingWithSpaces;
  onOpenDetail?: (spaceId: string) => void;
}) {
  const selectSpace = useApp((s) => s.selectSpace);
  const selectedSpaceId = useApp((s) => s.selectedSpaceId);
  const addToCompare = useApp((s) => s.addToCompare);
  const removeFromCompare = useApp((s) => s.removeFromCompare);
  const compare = useApp((s) => s.compare);

  const spaces = useMemo(
    () => sortSpacesForStack((building.spaces ?? []).filter((s) => s.is_active)),
    [building.spaces],
  );

  if (spaces.length === 0) {
    return (
      <p className="rounded border border-edge bg-panel px-4 py-6 text-center text-sm text-muted">
        No available spaces recorded for this building.
      </p>
    );
  }

  const inCompare = new Set(compare.map((c) => c.spaceId));

  return (
    <div className="overflow-x-auto rounded border border-edge bg-panel">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead className="border-b border-edge bg-ink/40">
          <tr className="text-left">
            <th className={TH}>Floor</th>
            <th className={clsx(TH, 'text-right')}>SF</th>
            <th className={clsx(TH, 'text-right')}>Asking Rent</th>
            <th className={TH}>Use</th>
            <th className={TH}>Type</th>
            <th className={TH}>Available</th>
            <th className={TH}>Expires</th>
            <th className={TH}>Agent</th>
            <th className={clsx(TH, 'text-right')}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {spaces.map((space) => {
            const selected = space.id === selectedSpaceId;
            const added = inCompare.has(space.id);
            return (
              <tr
                key={space.id}
                onClick={() => selectSpace(space.id)}
                className={clsx(
                  'cursor-pointer border-b border-edge/60 transition-colors last:border-b-0',
                  selected ? 'bg-accent/10' : 'hover:bg-white/5',
                )}
              >
                <td className={TD}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{space.floor_label || '—'}</span>
                    {space.floor_portion === 'partial' ? (
                      <Badge variant="neutral" title="Part of the floor only">
                        Partial
                      </Badge>
                    ) : (
                      <Badge variant="info" title="Entire floor available">
                        Entire
                      </Badge>
                    )}
                  </div>
                </td>
                <td className={clsx(TD, 'text-right')}>
                  <Sf value={space.sf} />
                </td>
                <td className={clsx(TD, 'text-right')}>
                  <Rent psf={space.asking_rent_psf} withheld={space.asking_rent_withheld} />
                </td>
                <td className={clsx(TD, 'text-muted')}>{space.space_use ?? '—'}</td>
                <td className={TD}>
                  <LeaseTypeBadge value={space.lease_type} />
                </td>
                <td className={TD}>
                  <DateText value={space.available_from} fallback={space.occupancy_raw} />
                </td>
                <td className={TD}>
                  <DateText value={space.term_expires} fallback={space.term_raw} />
                </td>
                <td className={clsx(TD, 'text-muted')}>
                  <span className="block max-w-[180px] truncate" title={space.agent_name ?? undefined}>
                    {space.agent_name ?? '—'}
                  </span>
                  {space.leasing_company && (
                    <span
                      className="block max-w-[180px] truncate text-[11px] text-muted/70"
                      title={space.leasing_company}
                    >
                      {space.leasing_company}
                    </span>
                  )}
                </td>
                <td className={clsx(TD, 'text-right')}>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (added) removeFromCompare(space.id);
                        else addToCompare(space.id, building.id);
                      }}
                      className={clsx(
                        'whitespace-nowrap rounded border px-2 py-1 text-[11px] transition-colors',
                        added
                          ? 'border-accent/60 bg-accent/15 text-accent'
                          : 'border-edge text-muted hover:border-accent/60 hover:text-accent',
                      )}
                    >
                      {added ? 'In compare' : 'Add to compare'}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        selectSpace(space.id);
                        onOpenDetail?.(space.id);
                      }}
                      className="whitespace-nowrap rounded border border-edge px-2 py-1 text-[11px] text-muted hover:text-white"
                    >
                      Details
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
