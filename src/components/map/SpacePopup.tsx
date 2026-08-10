'use client';

import { useMemo } from 'react';
import Link from 'next/link';

import { useApp } from '@/lib/store';
import { DateText, Rent, Sf } from '@/components/ui/Money';
import SourceInfo from '@/components/ui/SourceInfo';
import { buildingSource, spaceOriginNote, spaceSource } from '@/lib/provenance';
import type { BuildingWithSpaces, Space } from '@/types';
import DraggableCard from './DraggableCard';

/**
 * The card that opens when a floor band or a building is clicked.
 *
 * It is a *floating* card anchored to the click rather than a docked panel:
 * the point of clicking a specific stripe on a specific tower is that the
 * answer appears next to the thing you pointed at.
 *
 * Where it sits, how it is dragged, and whether it survives the next click
 * all belong to `DraggableCard` — this file is only the contents. That split
 * is what lets a tenant card behave identically without either of them
 * knowing about the other.
 */

/** How wide the card is. Placement and dragging belong to DraggableCard. */
const MAX_WIDTH = 330;

export interface PopupAnchor {
  /** Viewport (client) coordinates of the click. */
  x: number;
  y: number;
}

interface SpacePopupProps {
  /** The card's id in the store, so drag and pin address the right one. */
  popupId: string;
  pinned: boolean;
  buildingId: string;
  /** Null means "the building was clicked" — show its floor list instead. */
  spaceId: string | null;
  at: PopupAnchor;
  onClose: () => void;
  onSelectSpace: (spaceId: string) => void;
}

function activeSpaces(building: BuildingWithSpaces): Space[] {
  return building.spaces
    .filter((s) => s.is_active)
    .sort((a, b) => (a.floor_number ?? 9999) - (b.floor_number ?? 9999));
}

function portionLabel(space: Space): string {
  return space.floor_portion === 'entire' ? 'Entire floor' : 'Partial floor';
}

/**
 * A labelled value. The source marker rides on the LABEL, not the value —
 * beside the value it would sit between the number and the eye, which is the
 * one place on this card nothing is allowed to go.
 */
function Row({
  label,
  source,
  children,
}: {
  label: string;
  source?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
        {source}
      </div>
      <div className="mt-0.5 text-sm font-medium text-body">{children}</div>
    </div>
  );
}

export default function SpacePopup({
  popupId,
  pinned,
  buildingId,
  spaceId,
  at,
  onClose,
  onSelectSpace,
}: SpacePopupProps) {
  const buildings = useApp((s) => s.buildings);
  const compare = useApp((s) => s.compare);
  const addToCompare = useApp((s) => s.addToCompare);
  const removeFromCompare = useApp((s) => s.removeFromCompare);

  const building = useMemo(
    () => buildings.find((b) => b.id === buildingId) ?? null,
    [buildings, buildingId],
  );

  const spaces = useMemo(() => (building ? activeSpaces(building) : []), [building]);

  // A building click with exactly one availability should behave like a band
  // click — there is no list worth showing.
  const space = useMemo(() => {
    if (!building) return null;
    if (spaceId) return spaces.find((s) => s.id === spaceId) ?? null;
    return spaces.length === 1 ? spaces[0] : null;
  }, [building, spaceId, spaces]);

  // The one origin every listed floor shares, or null when they disagree.
  const sharedOrigin = useMemo(() => {
    if (spaces.length === 0) return null;
    const notes = spaces.map(spaceOriginNote);
    return notes.every((n) => n.label === notes[0].label) ? notes[0] : null;
  }, [spaces]);


  if (!building) return null;

  const inCompare = space ? compare.some((c) => c.spaceId === space.id) : false;

  return (
    <DraggableCard
      id={popupId}
      pinned={pinned}
      anchor={at}
      width={MAX_WIDTH}
      ariaLabel={`${building.address_display || 'Building'} details`}
      title={space ? space.floor_label || 'Floor' : 'Building'}
      onClose={onClose}
    >
      <header className="flex items-start gap-2 border-b border-hairline px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1 text-base font-semibold leading-snug text-ink">
            <span className="truncate">{building.address_display || 'Unknown address'}</span>
            <SourceInfo
              label="this address"
              note={buildingSource(building, 'address_display')}
            />
          </h2>
          {building.building_name ? (
            <p className="truncate text-sm font-medium text-muted">
              {building.building_name}
            </p>
          ) : null}
          {space ? (
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded border border-hairline-strong px-1.5 py-0.5 text-[11px] font-semibold text-ink">
                {space.floor_label || 'Floor —'}
              </span>
              <span
                className={
                  'rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.09em] ' +
                  (space.floor_portion === 'entire'
                    ? 'bg-midnight-50 text-midnight-700'
                    : 'bg-surface-sunken text-muted')
                }
              >
                {portionLabel(space)}
              </span>
            </p>
          ) : (
            <p className="mt-1 flex items-center gap-1 text-sm font-medium text-muted">
              <span className="tabular">{spaces.length}</span> available floor
              {spaces.length === 1 ? '' : 's'}
              {/* Each row below is a button, so it cannot hold a button of its
                  own. When every floor arrived on the same sheet one marker
                  covers the list honestly; when they did not, the list has no
                  single answer and the floor's own card carries it instead. */}
              {sharedOrigin ? (
                <SourceInfo label="these floors" note={sharedOrigin} />
              ) : null}
            </p>
          )}
        </div>
      </header>

      {space ? (
        <div className="space-y-3 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-1">
              {space.asking_rent_withheld || space.asking_rent_psf === null ? (
                <span
                  className="text-xl font-medium italic text-muted"
                  title="Asking rent withheld"
                >
                  Withheld
                </span>
              ) : (
                <Rent
                  psf={space.asking_rent_psf}
                  className="text-xl font-semibold text-ink"
                />
              )}
              <SourceInfo
                label="the asking rent"
                note={spaceSource(space, 'asking_rent_psf')}
              />
            </div>
            <div className="flex items-baseline gap-1 text-right text-sm font-semibold text-ink">
              <Sf value={space.sf} />
              <SourceInfo label="the square footage" note={spaceSource(space, 'sf')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Row
              label="Use"
              source={<SourceInfo label="the space use" note={spaceSource(space, 'space_use')} />}
            >
              {space.space_use || <span className="text-subtle">—</span>}
            </Row>
            <Row
              label="Type"
              source={<SourceInfo label="the lease type" note={spaceSource(space, 'lease_type')} />}
            >
              {space.lease_type
                ? space.lease_type === 'sublet'
                  ? 'Sublet'
                  : 'Direct'
                : <span className="text-subtle">—</span>}
            </Row>
            <Row
              label="Available"
              source={
                <SourceInfo
                  label="the availability date"
                  note={spaceSource(space, 'available_from')}
                />
              }
            >
              <DateText value={space.available_from} fallback={space.occupancy_raw} />
            </Row>
            <Row
              label="Expires"
              source={
                <SourceInfo
                  label="the expiry date"
                  note={spaceSource(space, 'term_expires')}
                />
              }
            >
              <DateText value={space.term_expires} fallback={space.term_raw} />
            </Row>
          </div>

          <div className="border-t border-hairline pt-2.5">
            {/* The firm marketing the space, never the named agent. */}
            <Row
              label="Listing broker"
              source={
                <SourceInfo
                  label="the listing broker"
                  note={spaceSource(space, 'leasing_company')}
                />
              }
            >
              <span className="block truncate" title={space.leasing_company ?? ''}>
                {space.leasing_company || <span className="text-subtle">Unknown</span>}
              </span>
            </Row>
          </div>
        </div>
      ) : (
        // Several availabilities: a compact floor list, each row switching the
        // popup to that space rather than opening a second card.
        <ul className="max-h-64 overflow-y-auto py-1">
          {spaces.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelectSpace(s.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-goldenrod-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {s.floor_label || 'Floor —'}
                  </span>
                  <span className="block text-[11px] font-medium uppercase tracking-[0.09em] text-muted">
                    {portionLabel(s)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold text-ink">
                    {s.asking_rent_withheld || s.asking_rent_psf === null ? (
                      <span className="font-medium italic text-muted">Withheld</span>
                    ) : (
                      <Rent psf={s.asking_rent_psf} />
                    )}
                  </span>
                  <span className="block text-[11px] font-medium text-muted">
                    <Sf value={s.sf} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="flex items-center gap-2 border-t border-hairline bg-surface-alt px-4 py-2.5">
        {space ? (
          <button
            type="button"
            aria-pressed={inCompare}
            onClick={() =>
              inCompare
                ? removeFromCompare(space.id)
                : addToCompare(space.id, building.id)
            }
            className={
              'rounded px-3 py-1.5 text-sm font-semibold transition-colors ' +
              (inCompare
                ? 'bg-goldenrod text-midnight hover:bg-goldenrod-400'
                : 'border border-goldenrod bg-goldenrod text-midnight hover:bg-goldenrod-400')
            }
          >
            {inCompare ? 'In compare' : 'Add to compare'}
          </button>
        ) : null}
        <Link
          href={`/building/${building.id}`}
          className="ml-auto rounded border border-hairline-strong bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:border-midnight hover:bg-midnight-50"
        >
          Full details
        </Link>
      </footer>
    </DraggableCard>
  );
}
