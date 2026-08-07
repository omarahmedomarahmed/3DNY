'use client';

import type { MatchedRow } from '@/types';
import { MatchBadge } from './ImportPreview';
import MatchPicker, { type ResolvedMatch } from './MatchPicker';

interface ReviewQueueProps {
  /** Every parsed row; the queue picks out the ones needing a human. */
  rows: MatchedRow[];
  /** Row numbers flagged when the sheet was parsed. Stable across resolutions. */
  queueIds: Set<number>;
  accepted: Set<number>;
  skipped: Set<number>;
  onAccept: (rowNumber: number) => void;
  onSkip: (rowNumber: number) => void;
  onUnskip: (rowNumber: number) => void;
  onResolved: (rowNumber: number, match: ResolvedMatch) => void;
}

const PERMANENCE_NOTE =
  'Your choice is saved permanently — this address will match automatically from now on.';

function RowHeader({ row, listings }: { row: MatchedRow; listings: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-base font-semibold text-ink">{row.addressRaw}</div>
        <div className="mt-0.5 text-sm text-muted">
          {listings} in this sheet
          {row.leasingCompany && ` · ${row.leasingCompany}`}
        </div>
      </div>
      <MatchBadge confidence={row.match.confidence} explanation={row.match.explanation} />
    </div>
  );
}

export default function ReviewQueue({
  rows,
  queueIds,
  accepted,
  skipped,
  onAccept,
  onSkip,
  onUnskip,
  onResolved,
}: ReviewQueueProps) {
  // One card per address, not per row. A building with six available floors
  // arrives as six rows with the same address and the same match problem;
  // asking about it six times makes a 4-address queue look like a 14-row chore.
  const flagged = rows.filter((r) => queueIds.has(r.rowNumber));
  const listingCounts = new Map<string, number>();
  for (const r of flagged) {
    listingCounts.set(r.addressDisplay, (listingCounts.get(r.addressDisplay) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const queue = flagged.filter((r) => {
    if (seen.has(r.addressDisplay)) return false;
    seen.add(r.addressDisplay);
    return true;
  });

  if (queue.length === 0) {
    return (
      <div className="rounded-card border border-ok/25 bg-ok-surface p-5">
        <p className="text-base font-semibold text-ok">Nothing to review.</p>
        <p className="mt-1 text-sm text-body">
          Every address in this sheet matched a building on its own.
        </p>
      </div>
    );
  }

  const outstanding = queue.filter(
    (r) =>
      r.match.confidence === 'unmatched' &&
      !skipped.has(r.rowNumber) &&
      !accepted.has(r.rowNumber),
  ).length;

  const decided = queue.filter(
    (r) =>
      skipped.has(r.rowNumber) ||
      r.match.confidence === 'manual' ||
      accepted.has(r.rowNumber),
  ).length;

  const listingLabel = (address: string) => {
    const n = listingCounts.get(address) ?? 1;
    return n === 1 ? '1 listing' : `${n} listings`;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-hairline bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-base font-semibold text-ink">
            <span className="tabular">{decided}</span> of{' '}
            <span className="tabular">{queue.length}</span>{' '}
            {queue.length === 1 ? 'address' : 'addresses'} decided
          </p>
          {outstanding > 0 && (
            <p className="text-sm font-medium text-danger">
              <span className="tabular">{outstanding}</span> unmatched still blocking the commit
            </p>
          )}
        </div>

        <div
          role="progressbar"
          aria-label="Addresses decided"
          aria-valuenow={decided}
          aria-valuemin={0}
          aria-valuemax={queue.length}
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
        >
          <div
            className="h-full rounded-full bg-goldenrod transition-all duration-300"
            style={{ width: `${queue.length === 0 ? 0 : (decided / queue.length) * 100}%` }}
          />
        </div>

        <div className="mt-4 rounded border border-info/20 bg-info-surface px-3 py-2.5">
          <p className="text-sm leading-relaxed text-body">
            <span className="font-semibold text-info">Decide once. </span>
            {PERMANENCE_NOTE}
          </p>
        </div>
      </div>

      {queue.map((row) => {
        const isSkipped = skipped.has(row.rowNumber);
        const isResolved = row.match.confidence === 'manual' || accepted.has(row.rowNumber);
        const state = isSkipped ? 'skipped' : isResolved ? 'resolved' : 'open';

        return (
          <div
            key={row.rowNumber}
            className={`rounded-card border border-l-4 bg-white p-5 shadow-card ${
              state === 'resolved'
                ? 'border-hairline border-l-ok'
                : state === 'skipped'
                  ? 'border-hairline border-l-hairline-strong opacity-70'
                  : row.match.confidence === 'unmatched'
                    ? 'border-hairline border-l-danger'
                    : 'border-hairline border-l-goldenrod'
            }`}
          >
            <RowHeader row={row} listings={listingLabel(row.addressDisplay)} />

            <div className="mt-4 rounded border border-hairline bg-surface-alt px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
                What the geocoder found
              </div>
              <div className="mt-1 text-sm text-ink">
                {row.match.resolvedAddress ?? 'Nothing it was willing to stand behind.'}
                {row.match.bin && (
                  <span className="tabular ml-2 text-muted">BIN {row.match.bin}</span>
                )}
              </div>
              <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
                Why it is not trusted
              </div>
              <div className="mt-1 text-sm leading-relaxed text-body">{row.match.explanation}</div>
            </div>

            {state === 'resolved' && (
              <p className="mt-4 text-sm font-medium text-ok">
                Resolved
                {row.match.resolvedAddress ? ` to ${row.match.resolvedAddress}` : ''} —{' '}
                {listingLabel(row.addressDisplay)} will be imported.
              </p>
            )}

            {state === 'skipped' && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted">
                  Skipped — {listingLabel(row.addressDisplay)} will not be imported.
                </p>
                <button
                  type="button"
                  onClick={() => onUnskip(row.rowNumber)}
                  className="text-sm font-medium text-info hover:underline underline-offset-4"
                >
                  Undo
                </button>
              </div>
            )}

            {state === 'open' && (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {row.match.confidence === 'fuzzy' && (
                    <button
                      type="button"
                      onClick={() => onAccept(row.rowNumber)}
                      className="rounded bg-midnight px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-midnight-700"
                    >
                      Looks right — accept this match
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSkip(row.rowNumber)}
                    className="rounded border border-hairline-strong bg-white px-4 py-2 text-sm text-muted transition-colors hover:border-danger hover:text-danger"
                  >
                    Skip this address
                  </button>
                </div>

                <div className="mt-4 border-t border-hairline pt-4">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-sm font-semibold text-ink">
                      Pick the right building
                    </span>
                    <span className="text-xs text-muted">{PERMANENCE_NOTE}</span>
                  </div>
                  <MatchPicker row={row} onResolved={onResolved} />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
