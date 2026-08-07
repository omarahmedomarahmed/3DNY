'use client';

import type { MatchConfidence, MatchedRow } from '@/types';

interface ImportPreviewProps {
  rows: MatchedRow[];
  /** Row numbers the broker has chosen to leave out of the commit. */
  skipped?: Set<number>;
}

const BADGE_STYLES: Record<MatchConfidence, string> = {
  exact: 'border-ok/40 bg-ok/10 text-ok',
  manual: 'border-accent/40 bg-accent/10 text-accent',
  fuzzy: 'border-warn/40 bg-warn/10 text-warn',
  unmatched: 'border-danger/40 bg-danger/10 text-danger',
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
      className={`inline-block cursor-help rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${BADGE_STYLES[confidence]}`}
    >
      {confidence}
    </span>
  );
}

export function formatRent(row: MatchedRow) {
  if (row.askingRentWithheld || row.askingRentPsf == null) {
    return <span className="text-muted">Withheld</span>;
  }
  return (
    <span className="tabular-nums">
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
  if (!row.agentName && !row.agentEmail) return <span className="text-muted">—</span>;
  return (
    <div className="leading-tight">
      <div className="text-neutral-200">{row.agentName ?? '—'}</div>
      {row.agentEmail && (
        <div
          title={
            row.agentEmailSuspect
              ? 'Looks truncated in the source sheet — verify before sending.'
              : undefined
          }
          className={
            row.agentEmailSuspect
              ? 'cursor-help text-[11px] text-warn line-through decoration-warn'
              : 'text-[11px] text-muted'
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
      className="ml-1 cursor-help select-none text-warn"
    >
      ⚠
    </span>
  );
}

const TH =
  'sticky top-0 z-10 whitespace-nowrap border-b border-edge bg-panel px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted';
const TD = 'border-b border-edge/60 px-3 py-2 align-top text-neutral-200';

/** Every parsed row, exactly as it will be committed. */
export default function ImportPreview({ rows, skipped }: ImportPreviewProps) {
  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-edge bg-panel">
      <table className="w-full min-w-[1100px] border-collapse text-xs">
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
        <tbody>
          {rows.map((row) => {
            const isSkipped = skipped?.has(row.rowNumber) ?? false;
            return (
              <tr
                key={row.rowNumber}
                className={`hover:bg-ink/40 ${isSkipped ? 'opacity-40 line-through' : ''}`}
              >
                <td className={`${TD} max-w-[280px]`}>
                  <div className="flex items-start">
                    <div>
                      <div className="text-neutral-100">{row.addressDisplay || row.addressRaw}</div>
                      {row.buildingName && (
                        <div className="text-[11px] text-muted">{row.buildingName}</div>
                      )}
                    </div>
                    <WarningIcon warnings={row.warnings} />
                  </div>
                </td>
                <td className={`${TD} whitespace-nowrap`}>{row.floorLabel || '—'}</td>
                <td className={`${TD} text-right tabular-nums`}>
                  {row.sf != null ? row.sf.toLocaleString() : '—'}
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
              <td className="px-3 py-6 text-center text-muted" colSpan={10}>
                No rows in this sheet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
