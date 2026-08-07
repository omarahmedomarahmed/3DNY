'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useApp } from '@/lib/store';
import type { MatchedRow } from '@/types';
import DropZone, { type ImportCounts, type ParseResponse } from '@/components/import/DropZone';
import ImportPreview from '@/components/import/ImportPreview';
import ImportSummary from '@/components/import/ImportSummary';
import ReviewQueue from '@/components/import/ReviewQueue';
import type { ResolvedMatch } from '@/components/import/MatchPicker';

type Stage = 'drop' | 'preview' | 'review' | 'committed';

interface CommitResult {
  importId: string;
  inserted: number;
  updated: number;
  skipped: number;
}

const STAGES: { key: Stage; label: string }[] = [
  { key: 'drop', label: '1 · Drop sheet' },
  { key: 'preview', label: '2 · Preview' },
  { key: 'review', label: '3 · Review' },
  { key: 'committed', label: '4 · Done' },
];

function StageBar({ stage }: { stage: Stage }) {
  const activeIndex = STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {STAGES.map((s, i) => (
        <li
          key={s.key}
          className={`rounded border px-2.5 py-1 ${
            i === activeIndex
              ? 'border-accent bg-accent/10 text-accent'
              : i < activeIndex
                ? 'border-edge bg-panel text-muted'
                : 'border-edge/60 text-edge'
          }`}
        >
          {s.label}
        </li>
      ))}
    </ol>
  );
}

export default function ImportPage() {
  const [stage, setStage] = useState<Stage>('drop');
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [rows, setRows] = useState<MatchedRow[]>([]);
  const [queueIds, setQueueIds] = useState<Set<number>>(new Set());
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  const handleParsed = useCallback((res: ParseResponse) => {
    setParsed(res);
    setRows(res.rows);
    setQueueIds(
      new Set(
        res.rows
          .filter((r) => r.match.confidence === 'fuzzy' || r.match.confidence === 'unmatched')
          .map((r) => r.rowNumber),
      ),
    );
    setAccepted(new Set());
    setSkipped(new Set());
    setCommitError(null);
    setResult(null);
    setStage('preview');
  }, []);

  const handleResolved = useCallback((rowNumber: number, match: ResolvedMatch) => {
    setRows((prev) =>
      prev.map((r) =>
        r.rowNumber === rowNumber
          ? {
              ...r,
              match: {
                ...r.match,
                confidence: 'manual',
                buildingId: match.buildingId,
                bin: match.bin,
                bbl: match.bbl,
                lon: match.lon,
                lat: match.lat,
                resolvedAddress: match.resolvedAddress,
                explanation: `Matched by hand to ${match.resolvedAddress}. Saved as a permanent alias.`,
              },
            }
          : r,
      ),
    );
    setSkipped((prev) => {
      if (!prev.has(rowNumber)) return prev;
      const next = new Set(prev);
      next.delete(rowNumber);
      return next;
    });
  }, []);

  const toggleIn = (set: Set<number>, rowNumber: number, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(rowNumber);
    else next.delete(rowNumber);
    return next;
  };

  const summary: ImportCounts = useMemo(() => {
    const live = { total: rows.length, exact: 0, fuzzy: 0, manual: 0, unmatched: 0 };
    for (const r of rows) {
      if (skipped.has(r.rowNumber)) continue;
      live[r.match.confidence] += 1;
    }
    return live;
  }, [rows, skipped]);

  const blocking = useMemo(
    () =>
      rows.filter((r) => r.match.confidence === 'unmatched' && !skipped.has(r.rowNumber)).length,
    [rows, skipped],
  );

  const rowsToCommit = useMemo(
    () => rows.filter((r) => !skipped.has(r.rowNumber)),
    [rows, skipped],
  );

  const commit = useCallback(async () => {
    if (!parsed || blocking > 0) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const res = await fetch('/api/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: parsed.filename,
          marketLabel: parsed.marketLabel,
          rows: rowsToCommit,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<CommitResult> & {
        error?: string;
        errors?: string[];
      };
      if (!res.ok) {
        throw new Error(body.errors?.join(' ') ?? body.error ?? `Commit failed (HTTP ${res.status}).`);
      }
      setResult({
        importId: body.importId ?? '',
        inserted: body.inserted ?? 0,
        updated: body.updated ?? 0,
        skipped: body.skipped ?? 0,
      });
      setStage('committed');
      void useApp.getState().loadBuildings();
    } catch (err) {
      setCommitError((err as Error).message);
    } finally {
      setCommitting(false);
    }
  }, [parsed, blocking, rowsToCommit]);

  const startOver = useCallback(() => {
    setParsed(null);
    setRows([]);
    setQueueIds(new Set());
    setAccepted(new Set());
    setSkipped(new Set());
    setResult(null);
    setCommitError(null);
    setStage('drop');
  }, []);

  return (
    <main className="min-h-screen bg-ink text-neutral-200">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-100">Import availability sheet</h1>
            {parsed ? (
              <p className="mt-1 text-xs text-muted">
                <span className="text-neutral-300">{parsed.filename}</span>
                {parsed.marketLabel && (
                  <>
                    {' · '}
                    <span className="text-accent">{parsed.marketLabel}</span>
                  </>
                )}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted">
                CSV in, buildings on the map out. Addresses you resolve are remembered.
              </p>
            )}
          </div>
          <Link href="/" className="text-xs text-accent hover:underline">
            ← Back to the map
          </Link>
        </header>

        <StageBar stage={stage} />

        {stage === 'drop' && <DropZone onParsed={handleParsed} />}

        {parsed && stage !== 'drop' && stage !== 'committed' && (
          <ImportSummary
            summary={summary}
            duplicatesRemoved={parsed.duplicatesRemoved}
            skipped={skipped.size}
          />
        )}

        {stage === 'preview' && (
          <>
            <ImportPreview rows={rows} skipped={skipped} />
            <div className="flex flex-wrap items-center gap-3">
              {queueIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setStage('review')}
                  className="rounded border border-warn/60 bg-warn/10 px-4 py-2 text-sm font-medium text-warn hover:bg-warn/20"
                >
                  Review {queueIds.size} flagged {queueIds.size === 1 ? 'address' : 'addresses'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void commit()}
                disabled={blocking > 0 || committing}
                title={
                  blocking > 0
                    ? `${blocking} unmatched ${blocking === 1 ? 'row needs' : 'rows need'} a decision first`
                    : undefined
                }
                className="rounded border border-accent bg-accent/15 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {committing ? 'Committing…' : `Commit ${rowsToCommit.length} rows`}
              </button>
              <button
                type="button"
                onClick={startOver}
                className="text-xs text-muted hover:text-neutral-200"
              >
                Use a different sheet
              </button>
              {blocking > 0 && (
                <span className="text-xs text-danger">
                  {blocking} unmatched {blocking === 1 ? 'row blocks' : 'rows block'} the commit —
                  resolve or skip {blocking === 1 ? 'it' : 'them'} in review.
                </span>
              )}
            </div>
          </>
        )}

        {stage === 'review' && (
          <>
            <ReviewQueue
              rows={rows}
              queueIds={queueIds}
              accepted={accepted}
              skipped={skipped}
              onAccept={(n) => setAccepted((prev) => toggleIn(prev, n, true))}
              onSkip={(n) => setSkipped((prev) => toggleIn(prev, n, true))}
              onUnskip={(n) => setSkipped((prev) => toggleIn(prev, n, false))}
              onResolved={handleResolved}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setStage('preview')}
                className="rounded border border-edge bg-panel px-3 py-2 text-xs text-neutral-200 hover:border-accent hover:text-accent"
              >
                ← Back to preview
              </button>
              <button
                type="button"
                onClick={() => void commit()}
                disabled={blocking > 0 || committing}
                title={
                  blocking > 0
                    ? `${blocking} unmatched ${blocking === 1 ? 'row needs' : 'rows need'} a decision first`
                    : undefined
                }
                className="rounded border border-accent bg-accent/15 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {committing ? 'Committing…' : `Commit ${rowsToCommit.length} rows`}
              </button>
              {blocking > 0 && (
                <span className="text-xs text-danger">
                  Resolve or skip {blocking} unmatched{' '}
                  {blocking === 1 ? 'address' : 'addresses'} to unlock the commit.
                </span>
              )}
            </div>
          </>
        )}

        {commitError && (
          <div className="rounded border border-danger/50 bg-danger/10 p-4 text-sm text-danger">
            {commitError}
          </div>
        )}

        {stage === 'committed' && result && parsed && (
          <div className="space-y-4 rounded-lg border border-ok/40 bg-ok/5 p-6">
            <h2 className="text-base font-semibold text-ok">
              {parsed.filename} imported{parsed.marketLabel ? ` · ${parsed.marketLabel}` : ''}
            </h2>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span>
                <span className="font-semibold tabular-nums text-ok">{result.inserted}</span>{' '}
                <span className="text-muted">new spaces</span>
              </span>
              <span>
                <span className="font-semibold tabular-nums text-accent">{result.updated}</span>{' '}
                <span className="text-muted">updated</span>
              </span>
              <span>
                <span className="font-semibold tabular-nums text-muted">{result.skipped}</span>{' '}
                <span className="text-muted">skipped</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/"
                className="rounded border border-accent bg-accent/15 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/25"
              >
                View on map →
              </Link>
              <button
                type="button"
                onClick={startOver}
                className="text-xs text-muted hover:text-neutral-200"
              >
                Import another sheet
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
