'use client';

import type { ImportCounts } from './DropZone';

interface ImportSummaryProps {
  summary: ImportCounts;
  duplicatesRemoved: number;
  /** Rows the broker has explicitly chosen not to import. */
  skipped?: number;
}

/**
 * One stat tile. `tone` carries the meaning: green is clean, Goldenrod wants
 * attention, red blocks the commit, neutral is bookkeeping.
 */
function Tile({
  value,
  label,
  tone = 'neutral',
  size = 'md',
}: {
  value: number;
  label: string;
  tone?: 'total' | 'ok' | 'gold' | 'danger' | 'neutral';
  size?: 'md' | 'lg';
}) {
  const shell =
    tone === 'total'
      ? 'border-midnight bg-midnight'
      : tone === 'ok'
        ? 'border-ok/25 bg-ok-surface'
        : tone === 'gold'
          ? 'border-goldenrod/40 bg-goldenrod-50'
          : tone === 'danger'
            ? 'border-danger/25 bg-danger-surface'
            : 'border-hairline bg-surface-alt';

  const figure =
    tone === 'total'
      ? 'text-white'
      : tone === 'ok'
        ? 'text-ok'
        : tone === 'gold'
          ? 'text-goldenrod-700'
          : tone === 'danger'
            ? 'text-danger'
            : 'text-ink';

  const caption = tone === 'total' ? 'text-white/70' : 'text-muted';

  return (
    <div
      className={`min-w-[7.5rem] flex-1 rounded-card border px-4 py-3 ${shell} ${
        size === 'lg' ? 'sm:min-w-[9.5rem]' : ''
      }`}
    >
      <div
        className={`tabular font-semibold leading-none ${figure} ${
          size === 'lg' ? 'text-3xl' : 'text-2xl'
        }`}
      >
        {value.toLocaleString()}
      </div>
      <div
        className={`mt-2 text-[10px] font-semibold uppercase leading-tight tracking-[0.09em] ${caption}`}
      >
        {label}
      </div>
    </div>
  );
}

/** Headline stats: what the sheet contained and how much of it landed cleanly. */
export default function ImportSummary({
  summary,
  duplicatesRemoved,
  skipped = 0,
}: ImportSummaryProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <Tile value={summary.total} label="Rows read" tone="total" size="lg" />
      <Tile value={summary.exact} label="Matched exactly" tone="ok" />
      {summary.manual > 0 && (
        <Tile value={summary.manual} label="Matched by hand" tone="ok" />
      )}
      <Tile value={summary.fuzzy} label="Need confirmation" tone="gold" />
      <Tile value={summary.unmatched} label="Unmatched" tone="danger" />
      {duplicatesRemoved > 0 && (
        <Tile
          value={duplicatesRemoved}
          label={duplicatesRemoved === 1 ? 'Duplicate removed' : 'Duplicates removed'}
        />
      )}
      {skipped > 0 && <Tile value={skipped} label="Skipped" />}
    </div>
  );
}
