'use client';

import { useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import Icon from '@/components/ui/Icon';

/**
 * Bringing in who is already in the buildings.
 *
 * Two sheets, one control, because they are the same operation and the only
 * difference is what a row without a Type column means: a market roster is
 * occupiers, a client sheet is clients. Making that a choice rather than two
 * upload boxes keeps the wrong file from being read as the wrong thing simply
 * because it was dropped on the wrong half of the page.
 *
 * The Salesforce sync sits alongside rather than above: it is the convenience,
 * and the export-and-upload path is the one that always works.
 */

type Kind = 'roster' | 'clients';

interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  buildingsCreated: number;
  rowsRead: number;
  fromSalesforce: boolean;
  unresolved: { address: string; company: string; reason: string }[];
  warnings: string[];
}

const KINDS: { id: Kind; label: string; blurb: string }[] = [
  {
    id: 'roster',
    label: 'Tenant roster',
    blurb:
      'Who is in the buildings. A Salesforce export works as-is — its Type column decides ' +
      'whether a row is an occupier, a prospect or a client.',
  },
  {
    id: 'clients',
    label: 'Cresa clients',
    blurb:
      'Our clients and the space they hold. Every row is drawn as a client unless it says ' +
      'otherwise.',
  },
];

export default function TenantImport() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [kind, setKind] = useState<Kind>('roster');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(ImportResult & { filename: string }) | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const csv = await file.text();
      const res = await fetch('/api/tenants/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, csv, kind }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<ImportResult> & {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `Import failed (${res.status})`);
      setResult({ ...(body as ImportResult), filename: file.name });
      // The map reads from the store, so it has to be told.
      await useApp.getState().loadBuildings();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function sync(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setSyncNote(null);
    try {
      const res = await fetch(`/api/salesforce/sync${dryRun ? '?dryRun=1' : ''}`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        // The remedy is the useful half of a CRM error and is always present.
        throw new Error(
          [body.error, body.remedy].filter(Boolean).join(' ') || `Sync failed (${res.status})`,
        );
      }
      if (dryRun) {
        setSyncNote(
          `Read ${body.recordsRead} records; ${body.wouldWrite} would be written, ` +
            `${(body.skipped as unknown[])?.length ?? 0} skipped. Nothing was changed.`,
        );
      } else {
        setSyncNote(
          `Synced: ${body.inserted} new, ${body.updated} updated, ${body.skipped} skipped.`,
        );
        await useApp.getState().loadBuildings();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-card border border-hairline bg-white p-6 shadow-card">
      <h2 className="text-lg font-semibold tracking-tight text-ink">Tenants and clients</h2>
      <p className="mt-1.5 max-w-prose text-sm leading-6 text-muted">
        Availability is what is on the market. This is everything else in the same buildings —
        who is in them, who we are chasing, and where our clients sit. All three appear as
        bands on the towers, switched on from the map legend.
      </p>

      <div
        role="group"
        aria-label="What kind of sheet"
        className="mt-5 flex overflow-hidden rounded border border-hairline-strong"
      >
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            aria-pressed={kind === k.id}
            className={
              'flex-1 border-r border-hairline px-3 py-2 text-sm font-semibold transition-colors last:border-r-0 ' +
              (kind === k.id
                ? 'bg-midnight text-white'
                : 'bg-white text-muted hover:bg-goldenrod-50 hover:text-ink')
            }
          >
            {k.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[13px] leading-5 text-muted">
        {KINDS.find((k) => k.id === kind)!.blurb}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          className="block text-sm text-body file:mr-3 file:rounded file:border file:border-hairline-strong file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink hover:file:border-midnight"
        />
        {busy && <span className="text-sm font-medium text-muted">Working…</span>}
      </div>

      <p className="mt-2 text-[13px] text-subtle">
        Templates:{' '}
        <code className="text-[12px]">data/samples/salesforce-tenants-template.csv</code> and{' '}
        <code className="text-[12px]">data/samples/cresa-clients-template.csv</code>.
      </p>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded bg-danger-surface px-3 py-2 text-sm font-medium leading-5 text-danger">
          <Icon name="warning" size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 rounded-card border border-hairline bg-surface-alt p-4">
          <p className="text-sm font-semibold text-ink">
            {result.filename} — {result.inserted} new, {result.updated} updated
            {result.buildingsCreated > 0
              ? `, ${result.buildingsCreated} new building${result.buildingsCreated === 1 ? '' : 's'}`
              : ''}
            {result.skipped > 0 ? `, ${result.skipped} skipped` : ''}
          </p>
          {result.fromSalesforce && (
            <p className="mt-1 text-[13px] text-muted">
              Salesforce record ids found — these are marked as coming from the CRM, and a
              re-import or a sync will update them in place.
            </p>
          )}
          {result.unresolved?.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] font-semibold text-warn">
                {result.unresolved.length} address
                {result.unresolved.length === 1 ? '' : 'es'} could not be placed
              </summary>
              <ul className="mt-1.5 space-y-1 text-[13px] leading-5 text-muted">
                {result.unresolved.slice(0, 25).map((u, i) => (
                  <li key={i}>
                    <span className="font-medium text-ink">{u.company}</span> — {u.address}:{' '}
                    {u.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.warnings?.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] font-semibold text-muted">
                {result.warnings.length} warning{result.warnings.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1.5 space-y-1 text-[13px] leading-5 text-muted">
                {result.warnings.slice(0, 25).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* The CRM, alongside the file rather than above it. */}
      <div className="mt-6 border-t border-hairline pt-4">
        <h3 className="text-sm font-semibold text-ink">Salesforce</h3>
        <p className="mt-1 max-w-prose text-[13px] leading-5 text-muted">
          Pulls the same records straight from the CRM, so nobody has to export. It needs
          three environment variables; until they are set, the export-and-upload above does
          exactly the same job. Run the check first — every org names its fields differently,
          and it is much better to find that out before three thousand tenancies land on the
          map.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void sync(true)}
            className="rounded border border-hairline-strong bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:border-midnight disabled:opacity-40"
          >
            Check without writing
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void sync(false)}
            className="rounded bg-midnight px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-midnight-700 disabled:opacity-40"
          >
            Sync now
          </button>
        </div>
        {syncNote && <p className="mt-2 text-sm font-medium text-body">{syncNote}</p>}
      </div>
    </section>
  );
}
