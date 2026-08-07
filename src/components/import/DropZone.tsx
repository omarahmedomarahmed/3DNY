'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import type { MatchedRow } from '@/types';

/** Counts returned alongside the parsed rows by POST /api/import/parse. */
export interface ImportCounts {
  total: number;
  exact: number;
  fuzzy: number;
  manual: number;
  unmatched: number;
}

/** The shape of a successful POST /api/import/parse response. */
export interface ParseResponse {
  marketLabel: string | null;
  filename: string;
  duplicatesRemoved: number;
  rows: MatchedRow[];
  summary: ImportCounts;
}

interface DropZoneProps {
  onParsed: (result: ParseResponse) => void;
}

const SAMPLES = [
  { label: 'Midtown', path: '/samples/space-added-midtown.csv' },
  { label: 'Midtown South', path: '/samples/space-added-midtown-south.csv' },
];

/**
 * Rough count of data rows in the raw sheet, used only to make the busy state
 * honest ("Matching 24 addresses…") before the server has answered.
 */
function estimateAddressCount(text: string): number {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex(
    (l) => /(^|,)\s*"?address"?\s*(,|$)/i.test(l) && /floor/i.test(l),
  );
  const body = headerIndex >= 0 ? lines.slice(headerIndex + 1) : lines;
  return body.filter((l) => l.trim().length > 0 && l.replace(/,/g, '').trim().length > 0).length;
}

export default function DropZone({ onParsed }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyCount, setBusyCount] = useState<number | null>(null);
  const [loadingSample, setLoadingSample] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [needsSetup, setNeedsSetup] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(
    async (text: string, filename: string) => {
      setErrors([]);
      setNeedsSetup(false);
      setBusyCount(estimateAddressCount(text));
      setBusy(true);
      try {
        const res = await fetch('/api/import/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, filename }),
        });
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const b = (body ?? {}) as { error?: string; errors?: string[]; needsSetup?: boolean };
          if (b.needsSetup) {
            setNeedsSetup(true);
            return;
          }
          setErrors(
            b.errors?.length
              ? b.errors
              : [b.error ?? 'The import service could not read that sheet. Try again in a moment.'],
          );
          return;
        }
        onParsed(body as ParseResponse);
      } catch {
        setErrors(['Could not reach the import service. Check your connection and try again.']);
      } finally {
        setBusy(false);
        setBusyCount(null);
      }
    },
    [onParsed],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!/\.csv$/i.test(file.name)) {
        setErrors([`"${file.name}" is not a .csv file. Export the availability sheet as CSV.`]);
        return;
      }
      const text = await file.text();
      await submit(text, file.name);
    },
    [submit],
  );

  const loadSample = useCallback(
    async (path: string) => {
      setErrors([]);
      setNeedsSetup(false);
      setLoadingSample(path);
      try {
        const res = await fetch(path, { cache: 'no-store' });
        if (!res.ok) throw new Error('That sample sheet is not available right now.');
        const text = await res.text();
        await submit(text, path.split('/').pop() ?? 'sample.csv');
      } catch (err) {
        setErrors([(err as Error).message || 'That sample sheet could not be loaded.']);
      } finally {
        setLoadingSample(null);
      }
    },
    [submit],
  );

  if (busy) {
    return (
      <div className="rounded-card border border-hairline bg-white p-12 text-center shadow-card">
        <p className="text-base font-semibold text-ink">
          Matching {busyCount ?? 'the'} {busyCount === 1 ? 'address' : 'addresses'} against NYC
          building records…
        </p>

        {/* Indeterminate: the server gives no progress, so neither do we. */}
        <div
          role="progressbar"
          aria-label="Matching addresses"
          className="relative mx-auto mt-5 h-1.5 w-64 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div className="absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full bg-goldenrod" />
        </div>

        <p className="mx-auto mt-5 max-w-md text-xs leading-relaxed text-muted">
          Every address is looked up against the city&apos;s building file to find its BIN and
          footprint, one at a time. Expect 10–40 seconds. Leave this tab open.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        className={`cursor-pointer rounded-card border-2 border-dashed px-6 py-16 text-center transition-colors ${
          dragging
            ? 'border-goldenrod bg-goldenrod-50'
            : 'border-hairline-strong bg-white hover:border-goldenrod hover:bg-goldenrod-50'
        }`}
      >
        <p className="text-lg font-semibold text-ink">Drop the weekly availability sheet here</p>
        <p className="mt-2 text-sm text-muted">
          .csv only — or{' '}
          <span className="font-medium text-brightblue underline underline-offset-2">
            browse for a file
          </span>
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      <p className="text-center text-xs text-subtle">
        Export the sheet as it comes — no reformatting, renaming, or column shuffling needed.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs text-muted">No sheet at hand?</span>
        {SAMPLES.map((s) => (
          <button
            key={s.path}
            type="button"
            onClick={() => void loadSample(s.path)}
            disabled={loadingSample !== null}
            className="rounded border border-hairline-strong bg-white px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-goldenrod hover:bg-goldenrod-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingSample === s.path ? 'Loading…' : `Try the ${s.label} sample`}
          </button>
        ))}
      </div>

      {needsSetup && (
        <div className="rounded-card border border-warn/30 bg-warn-surface p-4">
          <p className="text-sm font-semibold text-ink">The import service is not configured yet.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            The database or geocoder credentials are missing, so addresses cannot be matched.
          </p>
          <Link
            href="/setup"
            className="mt-3 inline-block rounded bg-midnight px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-midnight-700"
          >
            Finish setup
          </Link>
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-card border border-danger/30 bg-danger-surface p-4">
          <p className="text-sm font-semibold text-danger">
            {errors.length === 1 ? 'That sheet could not be read.' : 'That sheet had problems:'}
          </p>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs leading-relaxed text-body">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
