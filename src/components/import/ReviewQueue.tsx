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
        <div className="text-sm font-medium text-neutral-100">{row.addressRaw}</div>
        <div className="text-xs text-muted">
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
      <div className="rounded-lg border border-ok/40 bg-ok/10 p-4 text-sm text-ok">
        Every address in this sheet matched a building on its own. Nothing to review.
      </div>
    );
  }

  const outstanding = queue.filter(
    (r) =>
      r.match.confidence === 'unmatched' &&
      !skipped.has(r.rowNumber) &&
      !accepted.has(r.rowNumber),
  ).length;

  const listingLabel = (address: string) => {
    const n = listingCounts.get(address) ?? 1;
    return n === 1 ? '1 listing' : `${n} listings`;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-edge bg-panel px-4 py-3">
        <p className="text-sm text-neutral-100">
          {queue.length} {queue.length === 1 ? 'address needs' : 'addresses need'} a decision
          {outstanding > 0 && (
            <span className="text-danger">
              {' '}
              — {outstanding} unmatched still blocking the commit
            </span>
          )}
        </p>
        <p className="mt-1 text-xs text-muted">{PERMANENCE_NOTE}</p>
      </div>

      {queue.map((row) => {
        const isSkipped = skipped.has(row.rowNumber);
        const isResolved = row.match.confidence === 'manual' || accepted.has(row.rowNumber);
        const state = isSkipped ? 'skipped' : isResolved ? 'resolved' : 'open';

        return (
          <div
            key={row.rowNumber}
            className={`rounded-lg border bg-panel p-4 ${
              state === 'resolved'
                ? 'border-ok/40'
                : state === 'skipped'
                  ? 'border-edge opacity-60'
                  : row.match.confidence === 'unmatched'
                    ? 'border-danger/40'
                    : 'border-warn/40'
            }`}
          >
            <RowHeader row={row} listings={listingLabel(row.addressDisplay)} />

            <div className="mt-3 rounded border border-edge bg-ink px-3 py-2 text-xs">
              <div className="text-muted">Geocoder found</div>
              <div className="mt-0.5 text-neutral-200">
                {row.match.resolvedAddress ?? 'Nothing it was willing to stand behind.'}
                {row.match.bin && <span className="ml-2 text-muted">BIN {row.match.bin}</span>}
              </div>
              <div className="mt-1.5 text-muted">Why it is not trusted</div>
              <div className="mt-0.5 text-neutral-300">{row.match.explanation}</div>
            </div>

            {state === 'resolved' && (
              <p className="mt-3 text-xs text-ok">
                Resolved
                {row.match.resolvedAddress ? ` to ${row.match.resolvedAddress}` : ''} —{' '}
                {listingLabel(row.addressDisplay)} will be imported.
              </p>
            )}

            {state === 'skipped' && (
              <div className="mt-3 flex items-center gap-3">
                <p className="text-xs text-muted">
                  Skipped — {listingLabel(row.addressDisplay)} will not be imported.
                </p>
                <button
                  type="button"
                  onClick={() => onUnskip(row.rowNumber)}
                  className="text-xs text-accent hover:underline"
                >
                  Undo
                </button>
              </div>
            )}

            {state === 'open' && (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {row.match.confidence === 'fuzzy' && (
                    <button
                      type="button"
                      onClick={() => onAccept(row.rowNumber)}
                      className="rounded border border-ok/60 bg-ok/10 px-3 py-1.5 text-xs font-medium text-ok hover:bg-ok/20"
                    >
                      Looks right — accept this match
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSkip(row.rowNumber)}
                    className="rounded border border-edge px-3 py-1.5 text-xs text-muted hover:border-danger hover:text-danger"
                  >
                    Skip this address
                  </button>
                </div>

                <div className="mt-3 border-t border-edge pt-3">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="text-xs font-medium text-neutral-200">
                      Pick the right building
                    </span>
                    <span className="text-[11px] text-muted">{PERMANENCE_NOTE}</span>
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
