'use client';

import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/Icon';

/**
 * Choosing which Salesforce report feeds a part of the map.
 *
 * A firm with a mature org has hundreds of reports, most of them nothing to do
 * with leasing, so this is a filtered list rather than a dropdown: type three
 * letters of the name and it is there. Folders are shown because that is how
 * people actually remember where a report lives — "it's in Leasing, not in my
 * personal folder" — and a report the run-as user cannot see simply will not
 * appear here, which is itself the answer to why it is missing.
 */

export interface ReportSummary {
  id: string;
  name: string;
  developerName: string | null;
  folder: string | null;
  format: string | null;
  lastRunAt: string | null;
}

export default function ReportPicker({
  open,
  currentId,
  onPick,
  onClose,
}: {
  open: boolean;
  currentId?: string | null;
  onPick: (report: ReportSummary) => void;
  onClose: () => void;
}) {
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState<{ error: string; remedy?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || reports || loading) return;
    setLoading(true);
    setError(null);
    fetch('/api/salesforce/reports', { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw body;
        setReports(body.reports as ReportSummary[]);
      })
      .catch((body) =>
        setError(
          body && typeof body === 'object' && 'error' in body
            ? (body as { error: string; remedy?: string })
            : { error: 'Could not load the report list.' },
        ),
      )
      .finally(() => setLoading(false));
  }, [open, reports, loading]);

  const filtered = useMemo(() => {
    if (!reports) return [];
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) =>
      `${r.name} ${r.folder ?? ''} ${r.developerName ?? ''}`.toLowerCase().includes(q),
    );
  }, [reports, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-midnight/40 p-4 pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a Salesforce report"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-card border border-hairline bg-white shadow-lg">
        <header className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <Icon name="search" size={15} className="shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports by name or folder…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-subtle"
          />
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <p className="px-4 py-6 text-sm text-muted">Reading the report list from Salesforce…</p>
          )}

          {error && (
            <div className="px-4 py-6">
              <p className="text-sm font-medium text-danger">{error.error}</p>
              {error.remedy && <p className="mt-1 text-sm text-muted">{error.remedy}</p>}
            </div>
          )}

          {reports && filtered.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted">
              {reports.length === 0
                ? 'This Salesforce user cannot see any reports. Share the report folder with the ' +
                  'connected app’s run-as user, then re-check.'
                : `Nothing matches “${query}”.`}
            </p>
          )}

          <ul className="divide-y divide-hairline">
            {filtered.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => onPick(r)}
                  className={
                    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-alt ' +
                    (r.id === currentId ? 'bg-midnight-50' : '')
                  }
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{r.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {r.folder ?? 'No folder'}
                      {r.format ? ` · ${r.format.toLowerCase()}` : ''}
                    </span>
                  </span>
                  {r.id === currentId && (
                    <span className="mt-0.5 shrink-0 rounded bg-midnight px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white">
                      In use
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {reports && (
          <footer className="border-t border-hairline bg-surface-alt px-4 py-2 text-xs text-muted">
            {filtered.length} of {reports.length} report{reports.length === 1 ? '' : 's'} visible to
            the connected user
          </footer>
        )}
      </div>
    </div>
  );
}
