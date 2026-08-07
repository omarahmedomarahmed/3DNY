'use client';

import type { MatchConfidence, MatchedRow } from '@/types';

interface ImportPreviewProps {
  rows: MatchedRow[];
  /** Row numbers the broker has chosen to leave out of the commit. */
  skipped?: Set<number>;
}

const BADGE_STYLES: Record<MatchConfidence, string> = {
  exact: 'border-ok/30 bg-ok-surface text-ok',
  manual: 'border-info/30 bg-info-surface text-info',
  fuzzy: 'border-goldenrod/50 bg-goldenrod-50 text-goldenrod-700',
  unmatched: 'border-danger/30 bg-danger-surface text-danger',
};

export function MatchBadge({
  confidence,
  explanation,
}: {
  confidence: MatchConfidence;
  explanation?: string;
}) {
  return (
    <span
      title={explanation || undefined}
      className={`inline-block cursor-help rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${BADGE_STYLES[confidence]}`}
    >
      {confidence}
    </span>
  );
}

export function formatRent(row: MatchedRow) {
  // Withheld is not zero, and must never be able to be read as a number.
  if (row.askingRentWithheld || row.askingRentPsf == null) {
    return <span className="italic text-muted">Withheld</span>;
  }
  return (
    <span className="tabular font-medium text-ink">
      ${row.askingRentPsf.toLocaleString(undefined, { maximumFractionDigits: 2 })}
    </span>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(value);
  if (!iso) return value;
  const d = new Date(`${iso[0]}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', day: 'numeric' });
}

function AgentCell({ row }: { row: MatchedRow }) {
  if (!row.agentName && !row.agentEmail) return <span className="text-subtle">—</span>;
  return (
    <div className="leading-tight">
      <div className="text-body">{row.agentName ?? '—'}</div>
      {row.agentEmail && (
        <div
          title={
            row.agentEmailSuspect
              ? 'Looks truncated in the source sheet — verify before sending.'
              : undefined
          }
          className={
            row.agentEmailSuspect
              ? 'cursor-help text-xs font-medium text-warmorange line-through decoration-warmorange'
              : 'text-xs text-muted'
          }
        >
          {row.agentEmail}
        </div>
      )}
    </div>
  );
}

function WarningIcon({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <span
      title={warnings.join('\n')}
      aria-label={`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
      className="ml-1 cursor-help select-none text-warmorange"
    >
      ⚠
    </span>
  );
}

const TH =
  'sticky top-0 z-10 whitespace-nowrap border-b border-hairline bg-white px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.09em] text-muted';
const TD = 'px-3 py-2.5 align-top text-body';

/** Every parsed row, exactly as it will be committed. */
export default function ImportPreview({ rows, skipped }: ImportPreviewProps) {
  return (
    <div className="max-h-[60vh] overflow-auto rounded-card border border-hairline bg-white shadow-card">
      <table className="w-full min-w-[1100px] border-collapse text-sm">
        <thead>
          <tr>
            <th className={TH}>Address</th>
            <th className={TH}>Floor</th>
            <th className={`${TH} text-right`}>SF</th>
            <th className={`${TH} text-right`}>Asking Rent</th>
            <th className={TH}>Type</th>
            <th className={TH}>Available</th>
            <th className={TH}>Expires</th>
            <th className={TH}>Class</th>
            <th className={TH}>Agent</th>
            <th className={TH}>Match</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((row) => {
            const isSkipped = skipped?.has(row.rowNumber) ?? false;
            return (
              <tr
                key={row.rowNumber}
                className={`transition-colors hover:bg-goldenrod-50 ${
                  isSkipped ? 'opacity-50 line-through' : ''
                }`}
              >
                <td className={`${TD} max-w-[280px]`}>
                  <div className="flex items-start">
                    <div>
                      <div className="font-medium text-ink">
                        {row.addressDisplay || row.addressRaw}
                      </div>
                      {row.buildingName && (
                        <div className="text-xs text-muted">{row.buildingName}</div>
                      )}
                    </div>
                    <WarningIcon warnings={row.warnings} />
                  </div>
                </td>
                <td className={`${TD} whitespace-nowrap`}>{row.floorLabel || '—'}</td>
                <td className={`${TD} tabular text-right font-medium text-ink`}>
                  {row.sf != null ? row.sf.toLocaleString() : <span className="text-subtle">—</span>}
                </td>
                <td className={`${TD} text-right`}>{formatRent(row)}</td>
                <td className={`${TD} capitalize`}>{row.leaseType ?? '—'}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  {row.availableFrom ? formatDate(row.availableFrom) : (row.occupancyRaw ?? '—')}
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  {row.termExpires ? formatDate(row.termExpires) : (row.termRaw ?? '—')}
                </td>
                <td className={TD}>{row.buildingClass ?? '—'}</td>
                <td className={TD}>
                  <AgentCell row={row} />
                </td>
                <td className={TD}>
                  <MatchBadge
                    confidence={row.match.confidence}
                    explanation={row.match.explanation}
                  />
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td className="px-3 py-10 text-center text-sm text-muted" colSpan={10}>
                No rows in this sheet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
