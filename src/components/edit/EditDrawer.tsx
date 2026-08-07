'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Field, { validateField, type FieldSpec, type FieldValue } from './Field';
import Icon from '@/components/ui/Icon';
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
// `section` groups them under headings in the drawer; `rule` adds the checks
// that stop a negative rent or a half-typed email being saved.
// ---------------------------------------------------------------------------

const SPACE_FIELDS: FieldSpec[] = [
  { section: 'Identity', name: 'floor_label', label: 'Floor label', type: 'text', placeholder: 'Entire 14th' },
  { section: 'Identity', name: 'floor_number', label: 'Floor number', type: 'number' },
  {
    section: 'Identity',
    name: 'floor_portion',
    label: 'Portion',
    type: 'select',
    options: [
      { value: 'entire', label: 'Entire floor' },
      { value: 'partial', label: 'Partial floor' },
    ],
  },
  { section: 'Identity', name: 'space_use', label: 'Space use', type: 'text', placeholder: 'Office' },

  { section: 'Size and price', name: 'sf', label: 'Square feet', type: 'number', rule: 'positive-number' },
  {
    section: 'Size and price',
    name: 'asking_rent_psf',
    label: 'Asking rent $/SF',
    type: 'number',
    rule: 'positive-number',
  },
  {
    section: 'Size and price',
    name: 'asking_rent_withheld',
    label: 'Asking rent withheld',
    type: 'boolean',
    hint: 'Withheld rents render as “Withheld”, never as $0.',
  },

  {
    section: 'Lease',
    name: 'lease_type',
    label: 'Lease type',
    type: 'select',
    options: [
      { value: 'direct', label: 'Direct' },
      { value: 'sublet', label: 'Sublet' },
    ],
  },
  { section: 'Lease', name: 'sub_landlord', label: 'Sub-landlord', type: 'text' },
  { section: 'Lease', name: 'available_from', label: 'Available from', type: 'date', rule: 'date' },
  { section: 'Lease', name: 'term_expires', label: 'Term expires', type: 'date', rule: 'date' },
  { section: 'Lease', name: 'term_raw', label: 'Term (as written)', type: 'text', placeholder: '5 - 10 Years' },
  { section: 'Lease', name: 'occupancy_raw', label: 'Occupancy (as written)', type: 'text' },

  { section: 'Leasing contact', name: 'leasing_company', label: 'Leasing company', type: 'text' },
  { section: 'Leasing contact', name: 'agent_name', label: 'Agent', type: 'text' },
  { section: 'Leasing contact', name: 'agent_email', label: 'Agent email', type: 'text', rule: 'email' },
  {
    section: 'Leasing contact',
    name: 'agent_email_suspect',
    label: 'Email looks truncated',
    type: 'boolean',
    hint: 'Clear this once the address has been verified against the source.',
  },

  { section: 'Status', name: 'is_active', label: 'Still available', type: 'boolean' },
  { section: 'Status', name: 'notes', label: 'Notes', type: 'textarea', wide: true },
];

const BUILDING_FIELDS: FieldSpec[] = [
  { section: 'Address', name: 'address_display', label: 'Address', type: 'text', wide: true },
  { section: 'Address', name: 'building_name', label: 'Building name', type: 'text', wide: true },
  {
    section: 'Address',
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
    section: 'Address',
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
  { section: 'Address', name: 'submarket', label: 'Submarket', type: 'text' },
  { section: 'Address', name: 'submarket_cluster', label: 'Submarket cluster', type: 'text' },

  { section: 'Structure', name: 'year_built', label: 'Year built', type: 'number', rule: 'positive-number' },
  { section: 'Structure', name: 'num_floors', label: 'Floors', type: 'number', rule: 'positive-number' },
  {
    section: 'Structure',
    name: 'height_roof_ft',
    label: 'Roof height (ft)',
    type: 'number',
    rule: 'positive-number',
  },
  {
    section: 'Structure',
    name: 'bldg_area_sf',
    label: 'Building area (SF)',
    type: 'number',
    rule: 'positive-number',
  },
  {
    section: 'Structure',
    name: 'floor_height_override',
    label: 'Floor height override (ft)',
    type: 'number',
    rule: 'positive-number',
    hint: 'Replaces the derived floor-to-floor height used to place bands on the tower.',
  },

  { section: 'Notes', name: 'notes', label: 'Notes', type: 'textarea', wide: true },
];

const TENANT_FIELDS: FieldSpec[] = [
  { section: 'Tenant', name: 'company_name', label: 'Company', type: 'text', wide: true },
  { section: 'Tenant', name: 'floors', label: 'Floors', type: 'text', placeholder: '12-14' },
  { section: 'Tenant', name: 'sf', label: 'Square feet', type: 'number', rule: 'positive-number' },
  {
    section: 'Tenant',
    name: 'lease_expiration',
    label: 'Lease expiration',
    type: 'date',
    rule: 'date',
  },
  { section: 'Tenant', name: 'industry', label: 'Industry', type: 'text' },

  { section: 'Notes', name: 'notes', label: 'Notes', type: 'textarea', wide: true },
];

const LANDLORD_FIELDS: FieldSpec[] = [
  { section: 'Identity', name: 'name', label: 'Landlord name', type: 'text', wide: true },
  {
    section: 'Identity',
    name: 'owner_of_record',
    label: 'Owner of record',
    type: 'text',
    wide: true,
    hint: 'The name on the city tax record. Leave it as it is — the landlord name above is the one brokers use.',
  },
  {
    section: 'Identity',
    name: 'needs_review',
    label: 'Still needs review',
    type: 'boolean',
    hint: 'Clear this once the name above is the operating landlord.',
  },
  { section: 'Identity', name: 'aliases', label: 'Aliases', type: 'string-array', wide: true },

  {
    section: 'Portfolio',
    name: 'portfolio_sf',
    label: 'Portfolio SF',
    type: 'number',
    rule: 'positive-number',
  },
  {
    section: 'Portfolio',
    name: 'buildings_owned',
    label: 'Buildings owned',
    type: 'number',
    rule: 'positive-number',
  },
  {
    section: 'Portfolio',
    name: 'avg_asking_rent',
    label: 'Avg asking rent $/SF',
    type: 'number',
    rule: 'positive-number',
  },

  { section: 'Contact', name: 'contact_name', label: 'Contact name', type: 'text' },
  { section: 'Contact', name: 'contact_email', label: 'Contact email', type: 'text', rule: 'email' },
  { section: 'Contact', name: 'contact_phone', label: 'Contact phone', type: 'text' },

  { section: 'Insights', name: 'amenities', label: 'Amenities', type: 'string-array', wide: true },
  {
    section: 'Insights',
    name: 'notable_tenants',
    label: 'Notable tenants',
    type: 'string-array',
    wide: true,
  },
  {
    section: 'Insights',
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

/** Sections in first-appearance order, so the schema arrays stay the source of truth. */
function groupSections(fields: FieldSpec[]): { title: string; fields: FieldSpec[] }[] {
  const order: string[] = [];
  const byTitle = new Map<string, FieldSpec[]>();
  for (const f of fields) {
    const title = f.section ?? 'Details';
    if (!byTitle.has(title)) {
      byTitle.set(title, []);
      order.push(title);
    }
    byTitle.get(title)!.push(f);
  }
  return order.map((title) => ({ title, fields: byTitle.get(title)! }));
}

export default function EditDrawer({ target, onClose, onSaved }: EditDrawerProps) {
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseline = useRef<Record<string, FieldValue>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  const fields = target ? SCHEMAS[target.kind] : [];
  const sections = useMemo(() => groupSections(fields), [fields]);

  useEffect(() => {
    if (!target) return;
    const next = initialValues(SCHEMAS[target.kind], target.initial);
    baseline.current = next;
    setValues(next);
    setError(null);
    setSaving(false);
  }, [target]);

  const changedNames = useMemo(() => {
    const set = new Set<string>();
    for (const f of fields) {
      if (!sameValue(values[f.name] ?? null, baseline.current[f.name] ?? null)) set.add(f.name);
    }
    return set;
  }, [fields, values]);

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of fields) {
      const message = validateField(f, values[f.name] ?? null);
      if (message) out[f.name] = message;
    }
    return out;
  }, [fields, values]);

  const errorCount = Object.keys(errors).length;
  const dirty = changedNames.size > 0;

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
    if (errorCount > 0) return;
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
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
    >
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
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-muted">
              {dirty && <span className="inline-block h-1.5 w-1.5 rounded-full bg-goldenrod" />}
              {dirty
                ? `${changedNames.size} field${changedNames.size === 1 ? '' : 's'} changed`
                : 'No changes yet'}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium text-muted transition-colors hover:text-ink"
          >
            <Icon name="close" size={14} />
            Close
          </button>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-6 py-5">
          {sections.map((section) => {
            const sectionChanged = section.fields.some((f) => changedNames.has(f.name));
            return (
              <fieldset key={section.title}>
                <legend className="mb-3 flex w-full items-center gap-2 border-b border-hairline pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-midnight">
                  {section.title}
                  {sectionChanged && (
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-goldenrod" />
                  )}
                </legend>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  {section.fields.map((f) => (
                    <Field
                      key={f.name}
                      spec={f}
                      value={values[f.name] ?? null}
                      disabled={saving}
                      error={errors[f.name] ?? null}
                      changed={changedNames.has(f.name)}
                      onChange={(next) => setValues((v) => ({ ...v, [f.name]: next }))}
                    />
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>

        <footer className="border-t border-hairline bg-surface-alt px-6 py-4">
          {error && (
            <p className="mb-3 flex items-center gap-2 rounded bg-danger-surface px-3 py-2 text-sm font-medium text-danger">
              <Icon name="warning" size={15} />
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
              {errorCount > 0 && (
                <>
                  <Icon name="warning" size={14} />
                  {errorCount} field{errorCount === 1 ? '' : 's'} need fixing before you can save
                </>
              )}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={requestClose}
                disabled={saving}
                className="rounded px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-ink disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || errorCount > 0 || (!dirty && !creating)}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded px-4 py-2 text-sm font-semibold text-white',
                  'bg-midnight transition-colors hover:bg-midnight-700',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                )}
              >
                <Icon name="check" size={14} />
                {saving ? 'Saving…' : creating ? 'Create' : 'Save changes'}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
