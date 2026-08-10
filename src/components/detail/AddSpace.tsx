'use client';

import { useState } from 'react';
import { useApp } from '@/lib/store';
import Icon from '@/components/ui/Icon';
import {
  EMPTY_SPACE,
  SpaceFields,
  spacePayload,
  type SpaceDraft,
} from '@/components/import/AddByHand';

/**
 * Adding a floor to the building you are already looking at.
 *
 * The same fields as the by-hand panel on the import page, minus the address —
 * you are on the building, so which building it is has already been answered.
 * Sharing the fields rather than rewriting them means a change to what a
 * listing carries reaches both places, and the two cannot drift into asking
 * for different things.
 *
 * Closed by default. A building profile is something a broker reads in front
 * of a client, and an open form is a form somebody types into by accident.
 */
export default function AddSpace({ buildingId }: { buildingId: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SpaceDraft>(EMPTY_SPACE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildingId, ...spacePayload(draft) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setDraft(EMPTY_SPACE);
      setOpen(false);
      await useApp.getState().loadBuildings();
      // The profile reads its own copy of the building from the API, so the
      // page has to be told as well as the store.
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-hairline-strong bg-white px-3 py-1.5 text-xs font-medium text-body transition-colors hover:border-midnight hover:text-ink"
      >
        <Icon name="plus" size={14} />
        Add a space
      </button>
    );
  }

  return (
    <div className="w-full rounded-card border border-goldenrod bg-goldenrod-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Add a space to this building</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setDraft(EMPTY_SPACE);
            setError(null);
          }}
          className="text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <div className="mt-3">
        <SpaceFields draft={draft} set={setDraft} disabled={busy} />
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded bg-danger-surface px-3 py-2 text-sm font-medium text-danger">
          <Icon name="warning" size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy || !draft.floor.trim()}
        onClick={() => void save()}
        className="mt-4 rounded bg-midnight px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-midnight-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Add the space'}
      </button>
    </div>
  );
}
