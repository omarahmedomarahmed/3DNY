'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/lib/store';
import Icon from '@/components/ui/Icon';
import type { Building } from '@/types';

/**
 * One building, or one floor, without a spreadsheet.
 *
 * The importer assumes a sheet, which is right most weeks and makes the
 * smallest task the most awkward one: hearing about a single floor on a call
 * meant opening a spreadsheet, writing one row with the right headers, saving
 * it and uploading it. Nobody does that mid-conversation, so the floor goes in
 * a notebook and reaches the map on Friday, if at all.
 *
 * The address is the key here, exactly as it is on a sheet. Asking someone to
 * pick a building from a list first is asking them to already know whether it
 * is in the list — and the answer to that is the useful part, so the form
 * resolves the address as you finish typing and says which it is before
 * anything is created. That check is what stops a second row appearing for a
 * tower somebody else already added under a different spelling.
 */

const FIELD =
  'w-full rounded border border-hairline-strong bg-white px-2.5 py-1.5 text-sm font-medium ' +
  'text-ink placeholder:text-subtle disabled:opacity-60';

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-muted';

interface Resolved {
  building: Building | null;
  confidence: string;
  bin: string | null;
  resolvedAddress: string | null;
  explanation: string;
}

interface SpaceDraft {
  floor: string;
  sf: string;
  askingRent: string;
  spaceUse: string;
  leaseType: '' | 'direct' | 'sublet';
  availableFrom: string;
  termExpires: string;
  leasingCompany: string;
  notes: string;
}

const EMPTY_SPACE: SpaceDraft = {
  floor: '',
  sf: '',
  askingRent: '',
  spaceUse: '',
  leaseType: '',
  availableFrom: '',
  termExpires: '',
  leasingCompany: '',
  notes: '',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

/**
 * The space fields, shared by this panel and the one on a building's page.
 *
 * Only the floor is required. Everything else on a listing is routinely
 * unknown when you first hear about it, and a form that demands a rent before
 * it will record a floor is a form that does not get used on a call.
 */
export function SpaceFields({
  draft,
  set,
  disabled,
}: {
  draft: SpaceDraft;
  set: (next: SpaceDraft) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Floor *">
          <input
            className={FIELD}
            placeholder="14, Partial 45th"
            value={draft.floor}
            disabled={disabled}
            onChange={(e) => set({ ...draft, floor: e.target.value })}
          />
        </Field>
        <Field label="Square feet">
          <input
            className={FIELD}
            inputMode="numeric"
            placeholder="24,394"
            value={draft.sf}
            disabled={disabled}
            onChange={(e) => set({ ...draft, sf: e.target.value })}
          />
        </Field>
        <Field label="Asking rent $/SF">
          <input
            className={FIELD}
            inputMode="decimal"
            placeholder="Blank = withheld"
            value={draft.askingRent}
            disabled={disabled}
            onChange={(e) => set({ ...draft, askingRent: e.target.value })}
          />
        </Field>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Field label="Use">
          <input
            className={FIELD}
            placeholder="Office"
            value={draft.spaceUse}
            disabled={disabled}
            onChange={(e) => set({ ...draft, spaceUse: e.target.value })}
          />
        </Field>
        <Field label="Type">
          <select
            className={FIELD}
            value={draft.leaseType}
            disabled={disabled}
            onChange={(e) =>
              set({ ...draft, leaseType: e.target.value as SpaceDraft['leaseType'] })
            }
          >
            <option value="">—</option>
            <option value="direct">Direct</option>
            <option value="sublet">Sublet</option>
          </select>
        </Field>
        <Field label="Available from">
          <input
            className={FIELD}
            type="date"
            value={draft.availableFrom}
            disabled={disabled}
            onChange={(e) => set({ ...draft, availableFrom: e.target.value })}
          />
        </Field>
        <Field label="Term expires">
          <input
            className={FIELD}
            type="date"
            value={draft.termExpires}
            disabled={disabled}
            onChange={(e) => set({ ...draft, termExpires: e.target.value })}
          />
        </Field>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Listing broker">
          <input
            className={FIELD}
            placeholder="The firm, not a person"
            value={draft.leasingCompany}
            disabled={disabled}
            onChange={(e) => set({ ...draft, leasingCompany: e.target.value })}
          />
        </Field>
        <Field label="Notes">
          <input
            className={FIELD}
            value={draft.notes}
            disabled={disabled}
            onChange={(e) => set({ ...draft, notes: e.target.value })}
          />
        </Field>
      </div>
    </>
  );
}

export function spacePayload(draft: SpaceDraft) {
  return {
    floor: draft.floor,
    sf: draft.sf,
    askingRent: draft.askingRent,
    spaceUse: draft.spaceUse,
    leaseType: draft.leaseType || null,
    availableFrom: draft.availableFrom || null,
    termExpires: draft.termExpires || null,
    leasingCompany: draft.leasingCompany,
    notes: draft.notes,
  };
}

export { EMPTY_SPACE, type SpaceDraft };

export default function AddByHand() {
  const [address, setAddress] = useState('');
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; buildingId: string } | null>(null);
  const [draft, setDraft] = useState<SpaceDraft>(EMPTY_SPACE);

  // The resolve is a geocode, so it is not run on every keystroke — only once
  // typing stops, and never for something too short to be an address.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);

  const resolve = useCallback(async (value: string) => {
    const id = ++latest.current;
    setResolving(true);
    try {
      const res = await fetch('/api/buildings/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: value }),
      });
      const body = (await res.json()) as Resolved & { error?: string };
      // A slow answer to an old query must not overwrite a fast answer to the
      // current one.
      if (id !== latest.current) return;
      setResolved(res.ok ? body : null);
    } catch {
      if (id === latest.current) setResolved(null);
    } finally {
      if (id === latest.current) setResolving(false);
    }
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const value = address.trim();
    setDone(null);
    if (value.length < 6 || !/\d/.test(value)) {
      setResolved(null);
      setResolving(false);
      return;
    }
    timer.current = setTimeout(() => void resolve(value), 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [address, resolve]);

  const existing = resolved?.building ?? null;
  const canCreate = resolved !== null && resolved.confidence !== 'unmatched' && !existing;

  async function addBuilding() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/buildings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address.trim() }),
      });
      const body = (await res.json()) as {
        building?: Building;
        created?: boolean;
        error?: string;
      };
      if (!res.ok || !body.building) throw new Error(body.error ?? `Failed (${res.status})`);
      setResolved((prev) => (prev ? { ...prev, building: body.building! } : prev));
      setDone({
        text: body.created
          ? `${body.building.address_display} added.`
          : `${body.building.address_display} was already on the map.`,
        buildingId: body.building.id,
      });
      await useApp.getState().loadBuildings();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addSpace() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(existing ? { buildingId: existing.id } : { address: address.trim() }),
          // Adding a floor in a tower nobody has recorded yet is the common
          // case, and making it two steps helps nobody.
          createBuilding: true,
          ...spacePayload(draft),
        }),
      });
      const body = (await res.json()) as {
        buildingId?: string;
        buildingCreated?: boolean;
        error?: string;
        remedy?: string;
      };
      if (!res.ok || !body.buildingId) {
        throw new Error([body.error, body.remedy].filter(Boolean).join(' ') || `Failed (${res.status})`);
      }
      setDone({
        text: body.buildingCreated
          ? `Building and floor ${draft.floor} added.`
          : `Floor ${draft.floor} added.`,
        buildingId: body.buildingId,
      });
      setDraft(EMPTY_SPACE);
      await useApp.getState().loadBuildings();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-card border border-hairline bg-white p-6 shadow-card">
      <h2 className="text-lg font-semibold tracking-tight text-ink">Add one by hand</h2>
      <p className="mt-1.5 max-w-prose text-sm leading-6 text-muted">
        For a single building or a single floor, when writing a one-row spreadsheet would take
        longer than the call it came up on. The address goes through the same matcher the
        importer uses, so it lands on the same building with the same city records behind it.
      </p>

      <div className="mt-5 max-w-xl">
        <Field label="Building address">
          <input
            className={FIELD}
            placeholder="100 Park Avenue"
            value={address}
            disabled={busy}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>
      </div>

      {/* What the address is, before anything is created. */}
      <div className="mt-2 min-h-[1.5rem] text-[13px] leading-5">
        {resolving && <span className="text-muted">Looking it up…</span>}
        {!resolving && existing && (
          <span className="flex flex-wrap items-center gap-1.5 font-medium text-ok">
            <Icon name="check" size={14} />
            Already on the map as{' '}
            <Link href={`/building/${existing.id}`} className="underline underline-offset-2">
              {existing.address_display}
            </Link>
            — a floor added below goes on this building.
          </span>
        )}
        {!resolving && canCreate && (
          <span className="font-medium text-body">
            New building. Resolves to{' '}
            <span className="font-semibold text-ink">
              {resolved!.resolvedAddress ?? address.trim()}
            </span>
            {resolved!.bin ? ` · BIN ${resolved!.bin}` : ''}
            {resolved!.confidence !== 'exact' ? ` · matched ${resolved!.confidence}` : ''}.
          </span>
        )}
        {!resolving && resolved && resolved.confidence === 'unmatched' && (
          <span className="font-medium text-warn">{resolved.explanation}</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !canCreate}
          onClick={() => void addBuilding()}
          className="rounded border border-midnight bg-white px-3 py-1.5 text-sm font-semibold text-midnight transition-colors hover:bg-midnight-50 disabled:cursor-not-allowed disabled:border-hairline-strong disabled:text-subtle"
        >
          Add the building only
        </button>
        <span className="self-center text-[13px] text-subtle">
          A building with nothing available is a real record — it shows on the availability map
          once it has a floor, and holds tenants and landlord notes in the meantime.
        </span>
      </div>

      <div className="mt-5 border-t border-hairline pt-4">
        <h3 className="text-sm font-semibold text-ink">…and a floor, if you have one</h3>
        <p className="mt-1 text-[13px] leading-5 text-muted">
          Only the floor is required — a listing you have just heard about is usually missing
          most of the rest, and a form that will not record it without a rent is a form nobody
          uses on a call.
        </p>
        <div className="mt-3">
          <SpaceFields draft={draft} set={setDraft} disabled={busy} />
        </div>
        <button
          type="button"
          disabled={busy || !draft.floor.trim() || !resolved || resolved.confidence === 'unmatched'}
          onClick={() => void addSpace()}
          className="mt-4 rounded bg-goldenrod px-4 py-2 text-sm font-semibold text-midnight transition-colors hover:bg-goldenrod-400 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-subtle"
        >
          {existing ? 'Add the floor' : 'Add the building and the floor'}
        </button>
      </div>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded bg-danger-surface px-3 py-2 text-sm font-medium leading-5 text-danger">
          <Icon name="warning" size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {done && (
        <p className="mt-4 flex flex-wrap items-center gap-2 rounded bg-ok-surface px-3 py-2 text-sm font-medium text-ok">
          <Icon name="check" size={15} />
          {done.text}
          <Link
            href={`/building/${done.buildingId}`}
            className="font-semibold underline underline-offset-2"
          >
            Open the building
          </Link>
        </p>
      )}
    </section>
  );
}
