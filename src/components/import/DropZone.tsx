'use client';

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
  { label: 'Midtown sample sheet', path: '/samples/space-added-midtown.csv' },
  { label: 'Midtown South sample sheet', path: '/samples/space-added-midtown-south.csv' },
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
          if (res.status === 503 && b.needsSetup) {
            setNeedsSetup(true);
            return;
          }
          setErrors(
            b.errors?.length ? b.errors : [b.error ?? `Import failed (HTTP ${res.status}).`],
          );
          return;
        }
        onParsed(body as ParseResponse);
      } catch (err) {
        setErrors([(err as Error).message || 'Could not reach the import service.']);
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
      try {
        const res = await fetch(path, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Sample sheet not found at ${path}`);
        const text = await res.text();
        await submit(text, path.split('/').pop() ?? 'sample.csv');
      } catch (err) {
        setErrors([(err as Error).message]);
      }
    },
    [submit],
  );

  if (busy) {
    return (
      <div className="rounded-lg border border-edge bg-panel p-10 text-center">
        <div className="mx-auto mb-4 h-1 w-48 overflow-hidden rounded bg-edge">
          <div className="h-full w-1/3 animate-pulse rounded bg-accent" />
        </div>
        <p className="text-sm text-neutral-200">
          Matching {busyCount ?? 'the'} {busyCount === 1 ? 'address' : 'addresses'} to NYC building
          records…
        </p>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted">
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
        className={`cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
          dragging ? 'border-accent bg-accent/5' : 'border-edge bg-panel hover:border-accent/60'
        }`}
      >
        <p className="text-sm font-medium text-neutral-100">
          Drop the weekly availability sheet here
        </p>
        <p className="mt-1 text-xs text-muted">
          .csv only — or <span className="text-accent underline">browse for a file</span>
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

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">No sheet at hand?</span>
        {SAMPLES.map((s) => (
          <button
            key={s.path}
            type="button"
            onClick={() => void loadSample(s.path)}
            className="rounded border border-edge bg-panel px-3 py-1.5 text-xs text-neutral-200 hover:border-accent hover:text-accent"
          >
            Load {s.label}
          </button>
        ))}
      </div>

      {needsSetup && (
        <div className="rounded border border-warn/50 bg-warn/10 p-4 text-sm text-warn">
          <p className="font-medium">The import service is not configured yet.</p>
          <p className="mt-1 text-xs leading-relaxed text-warn/90">
            The database or geocoder credentials are missing. Follow the steps in{' '}
            <code className="rounded bg-ink px-1 py-0.5">SETUP.md</code> at the repository root,
            then reload this page and try again.
          </p>
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded border border-danger/50 bg-danger/10 p-4 text-sm text-danger">
          <p className="font-medium">
            {errors.length === 1 ? 'That sheet could not be read.' : 'That sheet had problems:'}
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-danger/90">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
