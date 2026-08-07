'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Field, { type FieldSpec, type FieldValue } from './Field';
import { useApp } from '@/lib/store';

export type EditKind = 'space' | 'building' | 'tenant' | 'landlord';

export interface EditTarget {
  kind: EditKind;
  /** Null creates a new record (tenants and landlords only). */
  id: string | null;
  initial: Record<string, unknown>;
}

export interface EditDrawerProps {
  target: EditTarget | null;
  onClose: () => void;
  /** Receives the API's response body after a successful save. */
  onSaved?: (saved: unknown, target: EditTarget) => void;
}

// ---------------------------------------------------------------------------
// Schemas — which fields each entity exposes, in the order brokers expect.
// ---------------------------------------------------------------------------

const SPACE_FIELDS: FieldSpec[] = [
  { name: 'floor_label', label: 'Floor label', type: 'text', placeholder: 'Entire 14th' },
  { name: 'floor_number', label: 'Floor number', type: 'number' },
  {
    name: 'floor_portion',
    label: 'Portion',
    type: 'select',
    options: [
      { value: 'entire', label: 'Entire floor' },
      { value: 'partial', label: 'Partial floor' },
    ],
  },
  { name: 'sf', label: 'Square feet', type: 'number' },
  { name: 'asking_rent_psf', label: 'Asking rent $/SF', type: 'number' },
  {
    name: 'asking_rent_withheld',
    label: 'Asking rent withheld',
    type: 'boolean',
    hint: 'Withheld rents render as “Withheld”, never as $0.',
  },
  { name: 'space_use', label: 'Space use', type: 'text', placeholder: 'Office' },
  {
    name: 'lease_type',
    label: 'Lease type',
    type: 'select',
    options: [
      { value: 'direct', label: 'Direct' },
      { value: 'sublet', label: 'Sublet' },
    ],
  },
  { name: 'sub_landlord', label: 'Sub-landlord', type: 'text' },
  { name: 'available_from', label: 'Available from', type: 'date' },
  { name: 'term_expires', label: 'Term expires', type: 'date' },
  { name: 'term_raw', label: 'Term (as written)', type: 'text', placeholder: '5 - 10 Years' },
  { name: 'occupancy_raw', label: 'Occupancy (as written)', type: 'text' },
  { name: 'leasing_company', label: 'Leasing company', type: 'text' },
  { name: 'agent_name', label: 'Agent', type: 'text' },
  { name: 'agent_email', label: 'Agent email', type: 'text' },
  {
    name: 'agent_email_suspect',
    label: 'Email looks truncated',
    type: 'boolean',
    hint: 'Clear this once the address has been verified against the source.',
  },
  { name: 'is_active', label: 'Still available', type: 'boolean' },
  { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
];

const BUILDING_FIELDS: FieldSpec[] = [
  { name: 'address_display', label: 'Address', type: 'text', wide: true },
  { name: 'building_name', label: 'Building name', type: 'text', wide: true },
  {
    name: 'class',
    label: 'Class',
    type: 'select',
    options: [
      { value: 'A', label: 'Class A' },
      { value: 'B', label: 'Class B' },
      { value: 'C', label: 'Class C' },
    ],
  },
  {
    name: 'match_confidence',
    label: 'Match confidence',
    type: 'select',
    options: [
      { value: 'exact', label: 'Exact' },
      { value: 'manual', label: 'Manual (confirmed by hand)' },
      { value: 'fuzzy', label: 'Fuzzy' },
      { value: 'unmatched', label: 'Unmatched' },
    ],
    hint: 'Set to Manual once you have confirmed the address is right.',
  },
  { name: 'submarket', label: 'Submarket', type: 'text' },
  { name: 'submarket_cluster', label: 'Submarket cluster', type: 'text' },
  { name: 'year_built', label: 'Year built', type: 'number' },
  { name: 'num_floors', label: 'Floors', type: 'number' },
  { name: 'height_roof_ft', label: 'Roof height (ft)', type: 'number' },
  { name: 'bldg_area_sf', label: 'Building area (SF)', type: 'number' },
  {
    name: 'floor_height_override',
    label: 'Floor height override (ft)',
    type: 'number',
    hint: 'Replaces the derived floor-to-floor height used to place bands on the tower.',
  },
  { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
];

const TENANT_FIELDS: FieldSpec[] = [
  { name: 'company_name', label: 'Company', type: 'text', wide: true },
  { name: 'floors', label: 'Floors', type: 'text', placeholder: '12-14' },
  { name: 'sf', label: 'Square feet', type: 'number' },
  { name: 'lease_expiration', label: 'Lease expiration', type: 'date' },
  { name: 'industry', label: 'Industry', type: 'text' },
  { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
];

const LANDLORD_FIELDS: FieldSpec[] = [
  { name: 'name', label: 'Landlord name', type: 'text', wide: true },
  { name: 'aliases', label: 'Aliases', type: 'string-array', wide: true },
  { name: 'portfolio_sf', label: 'Portfolio SF', type: 'number' },
  { name: 'buildings_owned', label: 'Buildings owned', type: 'number' },
  { name: 'avg_asking_rent', label: 'Avg asking rent $/SF', type: 'number' },
  { name: 'contact_name', label: 'Contact name', type: 'text' },
  { name: 'contact_email', label: 'Contact email', type: 'text' },
  { name: 'contact_phone', label: 'Contact phone', type: 'text' },
  { name: 'amenities', label: 'Amenities', type: 'string-array', wide: true },
  { name: 'notable_tenants', label: 'Notable tenants', type: 'string-array', wide: true },
  {
    name: 'insights_md',
    label: 'Insights',
    type: 'textarea',
    wide: true,
    hint: 'Plain paragraphs. Lines starting with “- ” render as bullets.',
  },
];

const SCHEMAS: Record<EditKind, FieldSpec[]> = {
  space: SPACE_FIELDS,
  building: BUILDING_FIELDS,
  tenant: TENANT_FIELDS,
  landlord: LANDLORD_FIELDS,
};

const TITLES: Record<EditKind, string> = {
  space: 'Edit space',
  building: 'Edit building',
  tenant: 'tenant',
  landlord: 'landlord',
};

function endpoint(kind: EditKind, id: string | null): string {
  const base =
    kind === 'space'
      ? '/api/spaces'
      : kind === 'building'
        ? '/api/buildings'
        : kind === 'tenant'
          ? '/api/tenants'
          : '/api/landlords';
  return id ? `${base}/${id}` : base;
}

function initialValues(spec: FieldSpec[], initial: Record<string, unknown>): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const f of spec) {
    const raw = initial[f.name];
    if (f.type === 'boolean') out[f.name] = raw === true;
    else if (f.type === 'string-array') out[f.name] = Array.isArray(raw) ? (raw as string[]) : [];
    else if (f.type === 'number') out[f.name] = typeof raw === 'number' ? raw : null;
    else out[f.name] = raw === null || raw === undefined ? null : String(raw);
  }
  return out;
}

function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const av = Array.isArray(a) ? a : [];
    const bv = Array.isArray(b) ? b : [];
    return av.length === bv.length && av.every((x, i) => x === bv[i]);
  }
  return a === b;
}

export default function EditDrawer({ target, onClose, onSaved }: EditDrawerProps) {
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseline = useRef<Record<string, FieldValue>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  const fields = target ? SCHEMAS[target.kind] : [];

  useEffect(() => {
    if (!target) return;
    const next = initialValues(SCHEMAS[target.kind], target.initial);
    baseline.current = next;
    setValues(next);
    setError(null);
    setSaving(false);
  }, [target]);

  const dirty = useMemo(
    () => fields.some((f) => !sameValue(values[f.name] ?? null, baseline.current[f.name] ?? null)),
    [fields, values],
  );

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }, [dirty, onClose, saving]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, requestClose]);

  useEffect(() => {
    if (target) panelRef.current?.focus();
  }, [target]);

  if (!target) return null;

  const creating = target.id === null;
  const heading = creating
    ? `Add ${TITLES[target.kind]}`
    : target.kind === 'tenant' || target.kind === 'landlord'
      ? `Edit ${TITLES[target.kind]}`
      : TITLES[target.kind];

  async function save() {
    if (!target) return;
    setSaving(true);
    setError(null);

    // Only changed fields go over the wire; every route takes a partial patch.
    const patch: Record<string, unknown> = {};
    for (const f of fields) {
      const next = values[f.name] ?? null;
      if (creating || !sameValue(next, baseline.current[f.name] ?? null)) {
        patch[f.name] = next;
      }
    }
    if (creating && target.initial.building_id) {
      patch.building_id = target.initial.building_id;
    }

    try {
      const res = await fetch(endpoint(target.kind, target.id), {
        method: creating ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: string }).error ?? `Save failed (${res.status})`,
        );
      }
      await useApp.getState().loadBuildings();
      onSaved?.(body, target);
      baseline.current = { ...values };
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={heading}>
      <button
        type="button"
        aria-label="Close editor"
        onClick={requestClose}
        className="absolute inset-0 h-full w-full cursor-default bg-midnight/70"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={clsx(
          'relative flex h-full w-full max-w-xl flex-col bg-white',
          'shadow-float outline-none animate-slide-in',
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-hairline px-6 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-ink">{heading}</h2>
            <p className="mt-0.5 text-[11px] text-muted">
              {dirty ? 'Unsaved changes' : 'No changes yet'}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="rounded px-2 py-1 text-xs font-medium text-muted transition-colors hover:text-ink"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {fields.map((f) => (
              <Field
                key={f.name}
                spec={f}
                value={values[f.name] ?? null}
                disabled={saving}
                onChange={(next) => setValues((v) => ({ ...v, [f.name]: next }))}
              />
            ))}
          </div>
        </div>

        <footer className="border-t border-hairline bg-surface-alt px-6 py-4">
          {error && (
            <p className="mb-3 rounded bg-danger-surface px-3 py-2 text-xs font-medium text-danger">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="rounded px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || (!dirty && !creating)}
              className={clsx(
                'rounded px-4 py-2 text-xs font-semibold text-white',
                'bg-midnight transition-colors hover:bg-midnight-700',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              {saving ? 'Saving…' : creating ? 'Create' : 'Save changes'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
