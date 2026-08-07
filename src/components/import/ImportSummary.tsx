'use client';

import type { ReactNode } from 'react';
import type { ImportCounts } from './DropZone';

interface ImportSummaryProps {
  summary: ImportCounts;
  duplicatesRemoved: number;
  /** Rows the broker has explicitly chosen not to import. */
  skipped?: number;
}

function Figure({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className={`font-semibold tabular-nums ${tone}`}>{value.toLocaleString()}</span>{' '}
      <span className="text-muted">{label}</span>
    </span>
  );
}

/** Headline banner: what the sheet contained and how much of it landed cleanly. */
export default function ImportSummary({
  summary,
  duplicatesRemoved,
  skipped = 0,
}: ImportSummaryProps) {
  const parts: ReactNode[] = [
    <Figure key="total" value={summary.total} label="rows read" tone="text-neutral-100" />,
    <Figure key="exact" value={summary.exact} label="matched exactly" tone="text-ok" />,
  ];

  if (summary.manual > 0) {
    parts.push(
      <Figure key="manual" value={summary.manual} label="matched manually" tone="text-accent" />,
    );
  }
  parts.push(<Figure key="fuzzy" value={summary.fuzzy} label="need review" tone="text-warn" />);
  parts.push(
    <Figure key="unmatched" value={summary.unmatched} label="unmatched" tone="text-danger" />,
  );
  if (duplicatesRemoved > 0) {
    parts.push(
      <Figure
        key="dupes"
        value={duplicatesRemoved}
        label={duplicatesRemoved === 1 ? 'duplicate removed' : 'duplicates removed'}
        tone="text-muted"
      />,
    );
  }
  if (skipped > 0) {
    parts.push(<Figure key="skipped" value={skipped} label="skipped" tone="text-muted" />);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-edge bg-panel px-4 py-3 text-sm">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-edge">·</span>}
          {p}
        </span>
      ))}
    </div>
  );
}
