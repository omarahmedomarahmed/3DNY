'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useApp } from '@/lib/store';
import type { MatchedRow } from '@/types';
import AppHeader from '@/components/shell/AppHeader';
import { DotMotif } from '@/components/brand/Logo';
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
  { key: 'drop', label: 'Drop sheet' },
  { key: 'preview', label: 'Preview' },
  { key: 'review', label: 'Review' },
  { key: 'committed', label: 'Done' },
];

/**
 * Progress, not tabs. Completed steps carry a Goldenrod check, the current step
 * is Midnight, and everything ahead is a quiet outline — so a glance answers
 * "how far along am I" without reading a word.
 */
function StageBar({ stage }: { stage: Stage }) {
  const activeIndex = STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="flex items-center gap-0" aria-label="Import progress">
      {STAGES.map((s, i) => {
        const done = i < activeIndex;
        const current = i === activeIndex;
        return (
          <li key={s.key} className="flex min-w-0 flex-1 items-center last:flex-none">
            <div
              aria-current={current ? 'step' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                done
                  ? 'bg-goldenrod text-midnight'
                  : current
                    ? 'bg-midnight text-white'
                    : 'border border-hairline-strong bg-white text-muted'
              }`}
            >
              <span
                className={`tabular flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  done
                    ? 'bg-midnight/15 text-midnight'
                    : current
                      ? 'bg-white/20 text-white'
                      : 'bg-surface-sunken text-muted'
                }`}
                aria-hidden
              >
                {done ? '✓' : i + 1}
              </span>
              <span className="whitespace-nowrap">{s.label}</span>
            </div>
            {i < STAGES.length - 1 && (
              <span
                aria-hidden
                className={`mx-2 h-px min-w-[1rem] flex-1 ${
                  done ? 'bg-goldenrod' : 'bg-hairline'
                }`}
              />
            )}
          </li>
        );
      })}
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
    setRows((prev) => {
      // A building with six available floors arrives as six rows sharing one
      // address. Resolving that address once has to settle all of them —
      // otherwise the review queue asks the same question six times.
      const target = prev.find((r) => r.rowNumber === rowNumber);
      if (!target) return prev;

      const resolvedRowNumbers = new Set<number>();
      const next = prev.map((r) => {
        if (r.addressDisplay !== target.addressDisplay) return r;
        resolvedRowNumbers.add(r.rowNumber);
        return {
          ...r,
          match: {
            ...r.match,
            confidence: 'manual' as const,
            buildingId: match.buildingId,
            bin: match.bin,
            bbl: match.bbl,
            lon: match.lon,
            lat: match.lat,
            resolvedAddress: match.resolvedAddress,
            explanation: `Matched by hand to ${match.resolvedAddress}. Saved as a permanent alias.`,
          },
        };
      });

      setSkipped((prevSkipped) => {
        if (![...resolvedRowNumbers].some((n) => prevSkipped.has(n))) return prevSkipped;
        const updated = new Set(prevSkipped);
        for (const n of resolvedRowNumbers) updated.delete(n);
        return updated;
      });

      return next;
    });
  }, []);

  /**
   * Review decisions are made per address, not per row, so every listing that
   * shares the clicked row's address moves together.
   */
  const toggleAddress = (
    set: Set<number>,
    rowNumber: number,
    on: boolean,
    allRows: MatchedRow[],
  ) => {
    const target = allRows.find((r) => r.rowNumber === rowNumber);
    const next = new Set(set);
    for (const r of allRows) {
      if (target && r.addressDisplay !== target.addressDisplay) continue;
      if (!target && r.rowNumber !== rowNumber) continue;
      if (on) next.add(r.rowNumber);
      else next.delete(r.rowNumber);
    }
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

  /**
   * Why the commit button is off, in words a broker can act on. Null means the
   * button is live.
   */
  const blockedReason =
    blocking > 0
      ? `${blocking} unmatched ${blocking === 1 ? 'address has' : 'addresses have'} no building yet — resolve or skip ${blocking === 1 ? 'it' : 'them'} in review to unlock this.`
      : rowsToCommit.length === 0
        ? 'Every row in this sheet is skipped, so there is nothing left to import.'
        : null;

  const commitDisabled = blockedReason !== null || committing;

  const commitButtonClass =
    'rounded bg-midnight px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-midnight-700 disabled:cursor-not-allowed disabled:bg-midnight-200 disabled:text-white';

  return (
    <main className="flex min-h-screen flex-col bg-surface-alt">
      <AppHeader />

      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              Import availability sheet
            </h1>
            {parsed ? (
              <p className="mt-2 text-sm text-muted">
                <span className="font-medium text-body">{parsed.filename}</span>
                {parsed.marketLabel && (
                  <>
                    {' · '}
                    <span className="font-medium text-info">{parsed.marketLabel}</span>
                  </>
                )}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">
                CSV in, buildings on the map out. Addresses you resolve are remembered.
              </p>
            )}
          </div>
          <Link
            href="/map"
            className="text-sm font-medium text-info hover:underline underline-offset-4"
          >
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
            <div className="rounded-card border border-hairline bg-white p-4 shadow-card">
              <div className="flex flex-wrap items-center gap-3">
                {queueIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setStage('review')}
                    className="rounded bg-goldenrod px-4 py-2 text-sm font-semibold text-midnight transition-colors hover:bg-goldenrod-400"
                  >
                    Review {queueIds.size} flagged {queueIds.size === 1 ? 'address' : 'addresses'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void commit()}
                  disabled={commitDisabled}
                  title={blockedReason ?? undefined}
                  className={commitButtonClass}
                >
                  {committing
                    ? 'Committing…'
                    : `Commit ${rowsToCommit.length.toLocaleString()} ${rowsToCommit.length === 1 ? 'row' : 'rows'}`}
                </button>
                <button
                  type="button"
                  onClick={startOver}
                  className="text-sm text-muted transition-colors hover:text-ink"
                >
                  Use a different sheet
                </button>
              </div>
              {blockedReason && (
                <p className="mt-3 border-t border-hairline pt-3 text-sm text-danger">
                  <span className="font-semibold">Commit is off: </span>
                  {blockedReason}
                </p>
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
              onAccept={(n) => setAccepted((prev) => toggleAddress(prev, n, true, rows))}
              onSkip={(n) => setSkipped((prev) => toggleAddress(prev, n, true, rows))}
              onUnskip={(n) => setSkipped((prev) => toggleAddress(prev, n, false, rows))}
              onResolved={handleResolved}
            />
            <div className="rounded-card border border-hairline bg-white p-4 shadow-card">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setStage('preview')}
                  className="rounded border border-hairline-strong bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-goldenrod hover:bg-goldenrod-50"
                >
                  ← Back to preview
                </button>
                <button
                  type="button"
                  onClick={() => void commit()}
                  disabled={commitDisabled}
                  title={blockedReason ?? undefined}
                  className={commitButtonClass}
                >
                  {committing
                    ? 'Committing…'
                    : `Commit ${rowsToCommit.length.toLocaleString()} ${rowsToCommit.length === 1 ? 'row' : 'rows'}`}
                </button>
              </div>
              {blockedReason && (
                <p className="mt-3 border-t border-hairline pt-3 text-sm text-danger">
                  <span className="font-semibold">Commit is off: </span>
                  {blockedReason}
                </p>
              )}
            </div>
          </>
        )}

        {commitError && (
          <div className="rounded-card border border-danger/30 bg-danger-surface p-4 text-sm text-danger">
            {commitError}
          </div>
        )}

        {stage === 'committed' && result && parsed && (
          <div className="animate-fade-up rounded-card border border-hairline bg-white p-8 shadow-raised">
            <DotMotif className="mb-5" size={40} />

            <h2 className="text-xl font-semibold tracking-tight text-ink">
              {parsed.filename} imported
              {parsed.marketLabel ? ` · ${parsed.marketLabel}` : ''}
            </h2>
            <p className="mt-2 text-sm text-muted">
              The map is already refreshed with these listings.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <div className="min-w-[7.5rem] flex-1 rounded-card border border-ok/25 bg-ok-surface px-4 py-3">
                <div className="tabular text-3xl font-semibold leading-none text-ok">
                  {result.inserted.toLocaleString()}
                </div>
                <div className="mt-2 text-[10px] font-semibold uppercase leading-tight tracking-[0.09em] text-muted">
                  New spaces
                </div>
              </div>
              <div className="min-w-[7.5rem] flex-1 rounded-card border border-info/25 bg-info-surface px-4 py-3">
                <div className="tabular text-3xl font-semibold leading-none text-info">
                  {result.updated.toLocaleString()}
                </div>
                <div className="mt-2 text-[10px] font-semibold uppercase leading-tight tracking-[0.09em] text-muted">
                  Updated
                </div>
              </div>
              <div className="min-w-[7.5rem] flex-1 rounded-card border border-hairline bg-surface-alt px-4 py-3">
                <div className="tabular text-3xl font-semibold leading-none text-ink">
                  {result.skipped.toLocaleString()}
                </div>
                <div className="mt-2 text-[10px] font-semibold uppercase leading-tight tracking-[0.09em] text-muted">
                  Skipped
                </div>
              </div>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-5">
              <Link
                href="/map"
                className="rounded bg-goldenrod px-6 py-3 text-base font-semibold text-midnight shadow-card transition-colors hover:bg-goldenrod-400"
              >
                View on the map →
              </Link>
              <button
                type="button"
                onClick={startOver}
                className="text-sm text-muted transition-colors hover:text-ink"
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
