'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import type { BuildingWithSpaces, Space } from '@/types';
import { useApp } from '@/lib/store';
import Badge, { LeaseTypeBadge } from '@/components/ui/Badge';
import { DateText, Rent, Sf, monthsUntil } from '@/components/ui/Money';
import Icon from '@/components/ui/Icon';
import SourceInfo from '@/components/ui/SourceInfo';
import { spaceOriginNote, spaceSource, type SpaceField } from '@/lib/provenance';
import PhotoGallery, { fetchSpaceImages } from './PhotoGallery';
import EditDrawer, { type EditTarget } from '@/components/edit/EditDrawer';

/**
 * A source marker on a table cell, but only when the cell disagrees with its
 * row.
 *
 * The stack is nine columns wide and can run to sixteen rows. Every value in a
 * row shares one origin — the sheet the space arrived on — so a marker in
 * every cell would be a hundred and forty identical icons saying one thing,
 * and the floor numbers would be harder to read for it. The row carries its
 * origin once, beside the floor; a cell only speaks up when something has
 * overwritten it since, which is exactly the case the row's answer gets wrong.
 */
function Stamped({ space, field, label }: { space: Space; field: SpaceField; label: string }) {
  if (!space.field_sources?.[field]) return null;
  return <SourceInfo label={label} note={spaceSource(space, field)} />;
}

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

const TH =
  'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted whitespace-nowrap';
const TD = 'px-3 py-2.5 align-middle text-ink';

const ROW_ACTION =
  'inline-flex items-center justify-center gap-1 rounded border border-hairline-strong bg-white ' +
  'px-1.5 py-1 text-muted transition-colors hover:border-midnight hover:text-ink ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

/** A lease rolling inside a year is the thing worth flagging on the stack. */
function expiryVariant(iso: string | null): 'warn' | 'danger' | null {
  const months = monthsUntil(iso);
  if (months === null) return null;
  if (months < 0) return 'danger';
  if (months <= 12) return 'warn';
  return null;
}

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

  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [photosFor, setPhotosFor] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});

  const spaces = useMemo(
    () => sortSpacesForStack((building.spaces ?? []).filter((s) => s.is_active)),
    [building.spaces],
  );

  const spaceIds = useMemo(() => spaces.map((s) => s.id).join(','), [spaces]);

  /** Photo counts drive the camera badge; a failed lookup just leaves it blank. */
  useEffect(() => {
    let cancelled = false;
    const ids = spaceIds ? spaceIds.split(',') : [];
    if (ids.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        ids.map(async (id) => [id, (await fetchSpaceImages(id)).length] as const),
      );
      if (!cancelled) setPhotoCounts(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceIds, photosFor]);

  if (spaces.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-hairline bg-surface-alt px-4 py-8 text-center text-sm font-medium text-muted">
        No available spaces recorded for this building.
      </p>
    );
  }

  const inCompare = new Set(compare.map((c) => c.spaceId));

  async function deleteSpace(space: Space) {
    setDeleting(space.id);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${space.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      if (selectedSpaceId === space.id) selectSpace(null);
      removeFromCompare(space.id);
      await useApp.getState().loadBuildings();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
      setConfirmingDelete(null);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="flex items-center gap-2 rounded border-l-2 border-danger bg-danger-surface px-3 py-2 text-sm font-medium text-danger">
          <Icon name="warning" size={15} />
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-card border border-hairline bg-white">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead className="border-b border-hairline bg-surface-alt">
            <tr className="text-left">
              <th className={TH}>Floor</th>
              <th className={clsx(TH, 'text-right')}>SF</th>
              <th className={clsx(TH, 'text-right')}>Asking Rent</th>
              <th className={TH}>Use</th>
              <th className={TH}>Type</th>
              <th className={clsx(TH, 'text-right')}>Available</th>
              <th className={TH}>Expires</th>
              <th className={TH}>Listing broker</th>
              <th className={clsx(TH, 'text-right')}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {spaces.map((space) => {
              const selected = space.id === selectedSpaceId;
              const added = inCompare.has(space.id);
              const expiry = expiryVariant(space.term_expires);
              const photoCount = photoCounts[space.id] ?? 0;
              const confirming = confirmingDelete === space.id;
              const photosOpen = photosFor === space.id;

              return (
                <tr
                  key={space.id}
                  onClick={() => selectSpace(space.id)}
                  className={clsx(
                    'group cursor-pointer transition-colors',
                    selected ? 'bg-goldenrod-50' : 'hover:bg-goldenrod-50',
                  )}
                >
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{space.floor_label || '—'}</span>
                      <SourceInfo
                        label={`floor ${space.floor_label || 'row'}`}
                        note={spaceOriginNote(space)}
                      />
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
                  <td className={clsx(TD, 'text-right tabular font-medium')}>
                    <span className="inline-flex items-center gap-1">
                      <Sf value={space.sf} />
                      <Stamped space={space} field="sf" label="this square footage" />
                    </span>
                  </td>
                  <td className={clsx(TD, 'text-right tabular font-semibold')}>
                    <span className="inline-flex items-center gap-1">
                      <Rent psf={space.asking_rent_psf} withheld={space.asking_rent_withheld} />
                      <Stamped space={space} field="asking_rent_psf" label="this asking rent" />
                    </span>
                  </td>
                  <td className={clsx(TD, 'font-medium text-body')}>
                    <span className="inline-flex items-center gap-1">
                      {space.space_use ?? '—'}
                      <Stamped space={space} field="space_use" label="this space use" />
                    </span>
                  </td>
                  <td className={TD}>
                    <span className="inline-flex items-center gap-1">
                      <LeaseTypeBadge value={space.lease_type} />
                      <Stamped space={space} field="lease_type" label="this lease type" />
                    </span>
                  </td>
                  <td className={clsx(TD, 'text-right tabular font-medium text-body')}>
                    <span className="inline-flex items-center gap-1">
                      <DateText value={space.available_from} fallback={space.occupancy_raw} />
                      <Stamped
                        space={space}
                        field="available_from"
                        label="this availability date"
                      />
                    </span>
                  </td>
                  <td className={clsx(TD, 'font-medium text-body')}>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <span className="tabular">
                        <DateText value={space.term_expires} fallback={space.term_raw} />
                      </span>
                      {expiry === 'warn' && <Badge variant="warn">Rolls within 12 mo</Badge>}
                      {expiry === 'danger' && <Badge variant="danger">Expired</Badge>}
                      <Stamped space={space} field="term_expires" label="this expiry date" />
                    </div>
                  </td>
                  <td className={clsx(TD, 'font-medium text-body')}>
                    {/* The firm, never the named agent. */}
                    {space.leasing_company ? (
                      <span className="flex max-w-[180px] items-center gap-1">
                        <span className="truncate" title={space.leasing_company}>
                          {space.leasing_company}
                        </span>
                        <Stamped
                          space={space}
                          field="leasing_company"
                          label="this listing broker"
                        />
                      </span>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <td className={clsx(TD, 'text-right')} onClick={(e) => e.stopPropagation()}>
                    {confirming ? (
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        <span className="text-sm font-semibold text-danger">Delete this space?</span>
                        <button
                          type="button"
                          disabled={deleting === space.id}
                          onClick={() => void deleteSpace(space)}
                          className="inline-flex items-center gap-1 rounded bg-danger px-2 py-1 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                        >
                          <Icon name="trash" size={13} />
                          {deleting === space.id ? 'Deleting…' : 'Delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(null)}
                          className="rounded border border-hairline-strong bg-white px-2 py-1 text-sm font-medium text-body transition-colors hover:border-midnight hover:text-ink"
                        >
                          Keep
                        </button>
                      </div>
                    ) : (
                      <div
                        className={clsx(
                          'flex items-center justify-end gap-1.5 transition-opacity',
                          selected ? 'opacity-100' : 'opacity-60 group-hover:opacity-100',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setEditing({
                              kind: 'space',
                              id: space.id,
                              initial: space as unknown as Record<string, unknown>,
                            })
                          }
                          title="Edit this space"
                          className={ROW_ACTION}
                        >
                          <Icon name="edit" size={14} title="Edit this space" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setPhotosFor(photosOpen ? null : space.id)}
                          title={photoCount > 0 ? `${photoCount} photos` : 'Add photos'}
                          className={clsx(
                            ROW_ACTION,
                            'relative',
                            photosOpen && 'border-midnight text-ink',
                          )}
                        >
                          <Icon
                            name="camera"
                            size={14}
                            title={photoCount > 0 ? `${photoCount} photos` : 'Add photos'}
                          />
                          {photoCount > 0 && (
                            <span className="tabular ml-0.5 rounded-full bg-goldenrod px-1.5 text-[11px] font-semibold leading-4 text-midnight">
                              {photoCount}
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (added) removeFromCompare(space.id);
                            else addToCompare(space.id, building.id);
                          }}
                          title={added ? 'Remove from compare' : 'Add to compare'}
                          className={clsx(
                            'inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-1 text-sm font-medium transition-colors',
                            added
                              ? 'border-goldenrod bg-goldenrod text-midnight'
                              : 'border-hairline-strong bg-white text-body hover:border-midnight hover:text-ink',
                          )}
                        >
                          <Icon name="compare" size={14} />
                          {added ? 'In compare' : 'Compare'}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            selectSpace(space.id);
                            onOpenDetail?.(space.id);
                          }}
                          className="whitespace-nowrap rounded border border-hairline-strong bg-white px-2 py-1 text-sm font-medium text-body transition-colors hover:border-midnight hover:text-ink"
                        >
                          Details
                        </button>

                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(space.id)}
                          title="Delete this space"
                          className={clsx(ROW_ACTION, 'hover:border-danger hover:text-danger')}
                        >
                          <Icon name="trash" size={14} title="Delete this space" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {photosFor && (
        <div className="rounded-card border border-hairline bg-white p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink">
              Photos ·{' '}
              {spaces.find((s) => s.id === photosFor)?.floor_label || 'Space'}
            </p>
            <button
              type="button"
              onClick={() => setPhotosFor(null)}
              className="inline-flex items-center gap-1.5 rounded border border-hairline-strong bg-white px-2 py-1 text-sm font-medium text-body transition-colors hover:border-midnight hover:text-ink"
            >
              <Icon name="close" size={14} />
              Close
            </button>
          </div>
          <PhotoGallery spaceId={photosFor} />
        </div>
      )}

      <EditDrawer target={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
