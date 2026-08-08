'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { BuildingWithSpaces, Space } from '@/types';
import { useApp } from '@/lib/store';
import Badge, { LeaseTypeBadge } from '@/components/ui/Badge';
import {
  DateText,
  Rent,
  Sf,
  formatAnnualRent,
  formatFullDate,
  annualRent,
} from '@/components/ui/Money';
import Icon from '@/components/ui/Icon';
import SourceInfo from '@/components/ui/SourceInfo';
import { spaceOriginNote, spaceSource, type SourceNote } from '@/lib/provenance';
import PhotoGallery from './PhotoGallery';
import EditDrawer, { type EditTarget } from '@/components/edit/EditDrawer';

/** Quarter mile is how brokers describe "around the corner". */
const COMPS_RADIUS_MILES = 0.25;

function Spec({
  label,
  source,
  children,
}: {
  label: string;
  source?: SourceNote;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-hairline pb-3">
      <dt className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
        {source ? <SourceInfo label={label.toLowerCase()} note={source} /> : null}
      </dt>
      <dd className="text-sm font-medium tabular text-ink">{children}</dd>
    </div>
  );
}

const QUIET_BUTTON =
  'inline-flex items-center gap-1.5 rounded border border-hairline-strong bg-white px-2.5 py-1.5 ' +
  'text-sm font-medium text-body transition-colors hover:border-midnight hover:text-ink ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

const QUICK_INPUT =
  'w-full rounded border border-hairline-strong bg-white px-2.5 py-1.5 text-sm font-medium text-ink ' +
  'tabular placeholder:text-subtle disabled:opacity-60';

/** The four fields a broker changes between showings. */
interface QuickDraft {
  asking_rent_psf: string;
  sf: string;
  available_from: string;
  notes: string;
}

function draftFrom(space: Space): QuickDraft {
  return {
    asking_rent_psf: space.asking_rent_psf === null ? '' : String(space.asking_rent_psf),
    sf: space.sf === null ? '' : String(space.sf),
    available_from: space.available_from ? space.available_from.slice(0, 10) : '',
    notes: space.notes ?? '',
  };
}

function validateDraft(draft: QuickDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.asking_rent_psf.trim() !== '') {
    const n = Number(draft.asking_rent_psf);
    if (!Number.isFinite(n) || n <= 0) errors.asking_rent_psf = 'Asking rent must be above zero.';
  }
  if (draft.sf.trim() !== '') {
    const n = Number(draft.sf);
    if (!Number.isFinite(n) || n <= 0) errors.sf = 'Square feet must be above zero.';
  }
  if (draft.available_from.trim() !== '' && Number.isNaN(Date.parse(draft.available_from))) {
    errors.available_from = 'Use a real date.';
  }
  return errors;
}

export default function SpaceDetail({
  space,
  building,
  onClose,
  importFilename,
}: {
  space: Space;
  building: BuildingWithSpaces;
  onClose?: () => void;
  /** Source sheet name, when the caller knows it. Falls back to the import id. */
  importFilename?: string | null;
}) {
  const addToCompare = useApp((s) => s.addToCompare);
  const removeFromCompare = useApp((s) => s.removeFromCompare);
  const inCompare = useApp((s) => s.compare.some((c) => c.spaceId === space.id));
  const setRadius = useApp((s) => s.setRadius);
  const radius = useApp((s) => s.radius);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const [quickOpen, setQuickOpen] = useState(false);
  const [draft, setDraft] = useState<QuickDraft>(() => draftFrom(space));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setQuickOpen(false);
    setSaveError(null);
    setDraft(draftFrom(space));
  }, [space]);

  const hasCoords = building.lon !== null && building.lat !== null;
  const compsActive =
    radius !== null &&
    radius.originBuildingId === building.id &&
    radius.miles === COMPS_RADIUS_MILES;

  const annual = annualRent(space.asking_rent_psf, space.sf, space.asking_rent_withheld);

  const errors = validateDraft(draft);
  const invalid = Object.keys(errors).length > 0;

  async function saveQuick() {
    if (invalid) return;
    setSaving(true);
    setSaveError(null);
    const patch: Partial<Space> = {
      asking_rent_psf: draft.asking_rent_psf.trim() === '' ? null : Number(draft.asking_rent_psf),
      sf: draft.sf.trim() === '' ? null : Number(draft.sf),
      available_from: draft.available_from.trim() === '' ? null : draft.available_from,
      notes: draft.notes.trim() === '' ? null : draft.notes,
    };
    try {
      const res = await fetch(`/api/spaces/${space.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? `Save failed (${res.status})`);
      }
      useApp.getState().updateSpace(space.id, body as Partial<Space>);
      await useApp.getState().loadBuildings();
      setQuickOpen(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

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
          <p className="mt-1.5 flex items-center gap-1.5 truncate text-sm font-medium text-muted">
            <Icon name="map-pin" size={14} />
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
              'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold transition-colors',
              inCompare
                ? 'border border-goldenrod bg-goldenrod-100 text-goldenrod-700'
                : 'bg-goldenrod text-midnight hover:bg-goldenrod-400',
            )}
          >
            <Icon name="compare" size={14} />
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
              'inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-semibold transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-40',
              compsActive
                ? 'border-midnight bg-midnight text-white'
                : 'border-midnight bg-white text-midnight hover:bg-midnight-50',
            )}
          >
            <Icon name="map-pin" size={14} />
            {compsActive ? 'Clear ¼ mile comps' : 'Find comps within ¼ mile'}
          </button>
          <button
            type="button"
            onClick={() =>
              setEditing({
                kind: 'space',
                id: space.id,
                initial: space as unknown as Record<string, unknown>,
              })
            }
            className={QUIET_BUTTON}
          >
            <Icon name="edit" size={14} />
            Edit all fields
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className={QUIET_BUTTON}>
              <Icon name="close" size={14} />
              Close
            </button>
          )}
        </div>
      </header>

      {/* The two numbers the room is looking at. */}
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline bg-surface-alt px-5 py-5">
        <div className="flex flex-wrap items-end gap-10">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              <Icon name="dollar" size={13} />
              Asking rent
              <SourceInfo
                label="the asking rent"
                note={spaceSource(space, 'asking_rent_psf')}
              />
            </p>
            <p className="mt-1 text-3xl font-semibold tabular leading-none text-midnight">
              <Rent psf={space.asking_rent_psf} withheld={space.asking_rent_withheld} />
            </p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              <Icon name="ruler" size={13} />
              Square feet
              <SourceInfo label="the square footage" note={spaceSource(space, 'sf')} />
            </p>
            <p className="mt-1 text-3xl font-semibold tabular leading-none text-midnight">
              <Sf value={space.sf} />
            </p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              <Icon name="calendar" size={13} />
              Available
              <SourceInfo
                label="the availability date"
                note={spaceSource(space, 'available_from')}
              />
            </p>
            <p className="mt-1 text-xl font-semibold tabular leading-none text-midnight">
              <DateText value={space.available_from} full fallback={space.occupancy_raw} />
            </p>
          </div>
        </div>
        {!quickOpen && (
          <button
            type="button"
            onClick={() => {
              setDraft(draftFrom(space));
              setSaveError(null);
              setQuickOpen(true);
            }}
            className={QUIET_BUTTON}
          >
            <Icon name="edit" size={14} />
            Quick edit
          </button>
        )}
      </div>

      {quickOpen && (
        <div className="border-b border-hairline bg-goldenrod-50 px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <QuickField label="Asking rent $/SF" error={errors.asking_rent_psf}>
              <input
                type="number"
                step="any"
                inputMode="decimal"
                disabled={saving}
                value={draft.asking_rent_psf}
                onChange={(e) => setDraft((d) => ({ ...d, asking_rent_psf: e.target.value }))}
                className={QUICK_INPUT}
                placeholder="—"
              />
            </QuickField>
            <QuickField label="Square feet" error={errors.sf}>
              <input
                type="number"
                step="any"
                inputMode="numeric"
                disabled={saving}
                value={draft.sf}
                onChange={(e) => setDraft((d) => ({ ...d, sf: e.target.value }))}
                className={QUICK_INPUT}
                placeholder="—"
              />
            </QuickField>
            <QuickField label="Available from" error={errors.available_from}>
              <input
                type="date"
                disabled={saving}
                value={draft.available_from}
                onChange={(e) => setDraft((d) => ({ ...d, available_from: e.target.value }))}
                className={QUICK_INPUT}
              />
            </QuickField>
          </div>
          <div className="mt-4">
            <QuickField label="Notes">
              <textarea
                rows={3}
                disabled={saving}
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                className={clsx(QUICK_INPUT, 'resize-y leading-6')}
                placeholder="What a broker needs to remember about this space."
              />
            </QuickField>
          </div>

          {saveError && (
            <p className="mt-3 flex items-center gap-2 rounded bg-danger-surface px-3 py-2 text-sm font-medium text-danger">
              <Icon name="warning" size={15} />
              {saveError}
            </p>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setQuickOpen(false);
                setDraft(draftFrom(space));
                setSaveError(null);
              }}
              className={QUIET_BUTTON}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || invalid}
              onClick={() => void saveQuick()}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded bg-midnight px-4 py-2 text-sm font-semibold text-white',
                'transition-colors hover:bg-midnight-700 disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              <Icon name="check" size={14} />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-8 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-8">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            <Spec label="Annual rent" source={spaceSource(space, 'annual_rent')}>
              {annual === null ? (
                <span className="text-subtle">—</span>
              ) : (
                <span className="tabular">{formatAnnualRent(annual)}</span>
              )}
            </Spec>
            <Spec label="Space use" source={spaceSource(space, 'space_use')}>
              {space.space_use ?? <span className="text-subtle">—</span>}
            </Spec>
            <Spec label="Floor number" source={spaceSource(space, 'floor_number')}>
              {space.floor_number ?? <span className="text-subtle">—</span>}
            </Spec>
            <Spec label="Sub-landlord" source={spaceSource(space, 'sub_landlord')}>
              {space.sub_landlord ?? <span className="text-subtle">—</span>}
            </Spec>
            <Spec label="Term expires" source={spaceSource(space, 'term_expires')}>
              <DateText value={space.term_expires} full fallback={space.term_raw} />
            </Spec>
            <Spec label="Date added" source={spaceSource(space, 'date_added')}>
              <DateText value={space.date_added} full />
            </Spec>
          </dl>

          {space.notes && (
            <div>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Notes
              </h4>
              <p className="max-w-prose whitespace-pre-wrap text-sm font-medium leading-7 text-body">
                {space.notes}
              </p>
            </div>
          )}

          <Provenance space={space} filename={importFilename ?? null} />

          <PhotoGallery spaceId={space.id} />
        </div>

        {/* The listing broker, not the person.
            Individual agent names and email addresses are deliberately never
            displayed anywhere in this product — see the note in types/index.ts.
            The firm marketing the space is genuine market context; the
            competitor's named broker and their inbox are not ours to put on a
            screen in front of a client. */}
        <aside className="space-y-3 self-start rounded-card border border-hairline bg-surface-alt p-4">
          <h4 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Listing broker
            <SourceInfo
              label="the listing broker"
              note={spaceSource(space, 'leasing_company')}
            />
          </h4>
          {space.leasing_company ? (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Icon name="building" size={13} />
              {space.leasing_company}
            </p>
          ) : (
            <p className="text-sm font-medium text-muted">Not stated on the sheet.</p>
          )}
        </aside>
      </div>

      <EditDrawer target={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

function QuickField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
      {error && <span className="text-sm font-medium text-danger">{error}</span>}
    </div>
  );
}

/**
 * Where the record as a whole came from, under the fields themselves.
 *
 * The per-value markers answer "where did THIS number come from"; this answers
 * "where did this record come from", which is the question someone asks before
 * they trust any of it. The caller may know the sheet name from a route that
 * did not join the import in, so an explicitly passed filename wins.
 */
function Provenance({ space, filename }: { space: Space; filename: string | null }) {
  const note = spaceOriginNote(filename ? { ...space, import_filename: filename } : space);
  const edited = formatFullDate(space.updated_at);

  return (
    <p className="flex items-center gap-1.5 text-sm font-medium text-subtle">
      <Icon name={note.kind === 'manual' ? 'edit' : 'info'} size={13} />
      {note.label}
      {edited && note.kind !== 'manual' ? ` · last edited ${edited}` : ''}
      <SourceInfo label="this record" note={note} />
    </p>
  );
}
