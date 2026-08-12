'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Icon from '@/components/ui/Icon';
import ReportPicker, { type ReportSummary } from './ReportPicker';
import FieldMapper, { type FieldDef } from './FieldMapper';

/**
 * The Salesforce panel on the setup page.
 *
 * What it has to make true, in order:
 *
 *   1. Is the connection working? Said plainly, with what to fix if not.
 *   2. Which report feeds each part of the map, chosen once from a list.
 *   3. Do its columns line up with ours? Confirmed against real rows.
 *   4. Sync now — and then every morning, without anyone here.
 *   5. What did the last sync change? Not counts. The actual floors.
 *
 * The fifth is the one that is easy to leave out and expensive to. A sync that
 * quietly retires forty spaces looks identical to one that worked, right up
 * until a broker opens a building in front of a client and the floor is gone.
 */

const FEEDS = [
  {
    kind: 'spaces' as const,
    label: 'Available spaces',
    blurb:
      'The report that drives the goldenrod bands. A floor it stops carrying comes off ' +
      'the map; a floor it adds appears.',
  },
  {
    kind: 'occupiers' as const,
    label: 'Occupiers',
    blurb: 'Who is in each building today, and when their lease rolls.',
  },
  {
    kind: 'clients' as const,
    label: 'Cresa clients',
    blurb: 'Our own clients, drawn in teal so they read differently to the rest of the market.',
  },
];

type FeedKind = (typeof FEEDS)[number]['kind'];

interface Status {
  configured: boolean;
  connected: boolean;
  present: Record<string, boolean>;
  instanceUrl?: string;
  sandbox?: boolean;
  organizationId?: string | null;
  runAsUser?: string | null;
  error?: string;
  remedy?: string;
}

interface Feed {
  kind: FeedKind;
  report_id: string;
  report_name: string;
  report_folder: string | null;
  column_map: Record<string, string>;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
}

interface Run {
  id: string;
  kind: FeedKind;
  report_name: string | null;
  started_at: string;
  status: 'ok' | 'failed' | 'partial';
  trigger: 'manual' | 'daily';
  rows_read: number;
  added: number;
  updated: number;
  retired: number;
  skipped: number;
  detail: {
    retiredSpaces?: { address: string; floor: string }[];
    unresolved?: { address: string; company?: string; reason: string }[];
    truncated?: boolean;
    note?: string;
  };
  error: string | null;
}

const when = (iso: string | null) => {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
};

export default function SalesforceSetup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(true);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [fields, setFields] = useState<Record<string, FieldDef[]>>({});
  const [feedsError, setFeedsError] = useState<{ error: string; remedy?: string } | null>(null);

  const [picking, setPicking] = useState<FeedKind | null>(null);
  const [editing, setEditing] = useState<{ kind: FeedKind; report: ReportSummary } | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<FeedKind | null>(null);
  const [message, setMessage] = useState<{ kind: FeedKind; text: string; bad?: boolean } | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/salesforce/status', { cache: 'no-store' });
      setStatus(await res.json());
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }, []);

  const loadFeeds = useCallback(async () => {
    try {
      const res = await fetch('/api/salesforce/feeds', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) {
        setFeedsError(body);
        return;
      }
      setFeedsError(null);
      setFeeds(body.feeds ?? []);
      setRuns(body.runs ?? []);
      setFields(body.fields ?? {});
    } catch (err) {
      setFeedsError({ error: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadFeeds();
  }, [loadStatus, loadFeeds]);

  async function saveMapping(kind: FeedKind, mapping: Record<string, string>, reportName: string) {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch('/api/salesforce/feeds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          reportId: editing.report.id,
          reportName: reportName || editing.report.name,
          reportFolder: editing.report.folder,
          columnMap: mapping,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not save.');
      setEditing(null);
      setMessage({ kind, text: 'Mapping saved. Use “Sync now” to bring it onto the map.' });
      await loadFeeds();
    } catch (err) {
      setMessage({ kind, text: (err as Error).message, bad: true });
    } finally {
      setSaving(false);
    }
  }

  async function sync(kind: FeedKind) {
    setSyncing(kind);
    setMessage(null);
    try {
      const res = await fetch(`/api/salesforce/feeds/${kind}/sync`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setMessage({
          kind,
          text: [body.error, body.remedy].filter(Boolean).join(' '),
          bad: true,
        });
      } else {
        const bits = [
          `${body.rowsRead} row${body.rowsRead === 1 ? '' : 's'} read`,
          `${body.added} added`,
          `${body.updated} updated`,
        ];
        if (kind === 'spaces') bits.push(`${body.retired} taken off the market`);
        if (body.skipped) bits.push(`${body.skipped} skipped`);
        setMessage({
          kind,
          text: bits.join(', ') + '.',
          bad: body.status === 'partial',
        });
      }
      await loadFeeds();
    } catch (err) {
      setMessage({ kind, text: (err as Error).message, bad: true });
    } finally {
      setSyncing(null);
    }
  }

  async function togglePaused(feed: Feed) {
    await fetch('/api/salesforce/feeds', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: feed.kind,
        reportId: feed.report_id,
        reportName: feed.report_name,
        reportFolder: feed.report_folder,
        columnMap: feed.column_map,
        enabled: !feed.enabled,
      }),
    });
    await loadFeeds();
  }

  async function unbind(kind: FeedKind) {
    await fetch(`/api/salesforce/feeds?kind=${kind}`, { method: 'DELETE' });
    setMessage({
      kind,
      text: 'Unbound. Nothing already on the map was removed.',
    });
    await loadFeeds();
  }

  const connected = Boolean(status?.connected);

  return (
    <section className="mt-6 rounded-card border border-hairline bg-white p-6 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          <Icon name="external" size={14} />
          Salesforce
        </h2>
        <button
          onClick={loadStatus}
          disabled={checking}
          className="text-xs text-info hover:underline disabled:opacity-50"
        >
          {checking ? 'Checking…' : 'Re-check the connection'}
        </button>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-muted">
        Point each part of the map at a report you already keep in Salesforce. Update the report
        there, and the map follows — every morning, and whenever you press Sync now. The CSV
        import stays where it is as a fallback.
      </p>

      {/* Connection ---------------------------------------------------------- */}
      <div className="mt-5 rounded border border-hairline">
        <div className="flex items-start gap-3 px-4 py-3">
          <span
            className={
              'mt-1.5 h-2 w-2 shrink-0 rounded-full ' +
              (checking && !status
                ? 'animate-pulse bg-hairline-strong'
                : connected
                  ? 'bg-ok'
                  : status?.configured
                    ? 'bg-danger'
                    : 'bg-hairline-strong')
            }
          />
          <div className="min-w-0 flex-1">
            {checking && !status && <p className="text-sm text-muted">Checking…</p>}

            {status && connected && (
              <>
                <p className="text-sm font-medium text-ink">
                  Connected{status.runAsUser ? ` as ${status.runAsUser}` : ''}
                </p>
                <p className="mt-0.5 break-all text-xs text-muted">
                  {status.instanceUrl}
                  {status.organizationId ? ` · org ${status.organizationId}` : ''}
                </p>
                {status.sandbox && (
                  <p className="mt-1 text-xs text-warn">
                    This looks like a sandbox. Reports and data here are not production.
                  </p>
                )}
              </>
            )}

            {status && !connected && (
              <>
                <p className="text-sm font-medium text-danger">
                  {status.error ?? 'Not connected.'}
                </p>
                {status.remedy && (
                  <p className="mt-1 text-sm leading-relaxed text-muted">{status.remedy}</p>
                )}
                <ul className="mt-2 space-y-0.5">
                  {Object.entries(status.present ?? {}).map(([name, ok]) => (
                    <li key={name} className="flex items-center gap-1.5 font-mono text-xs">
                      <span className={ok ? 'text-ok' : 'text-danger'}>{ok ? '✓' : '✕'}</span>
                      <span className="text-muted">{name}</span>
                      {!ok && <span className="text-subtle">not set</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      {feedsError && (
        <div className="mt-4 rounded border border-danger/30 bg-danger/5 px-4 py-3">
          <p className="text-sm font-medium text-danger">{feedsError.error}</p>
          {feedsError.remedy && <p className="mt-1 text-sm text-muted">{feedsError.remedy}</p>}
        </div>
      )}

      {/* Feeds ---------------------------------------------------------------- */}
      <div className="mt-6 space-y-4">
        {FEEDS.map((def) => {
          const feed = feeds.find((f) => f.kind === def.kind) ?? null;
          const isEditing = editing?.kind === def.kind;
          const msg = message?.kind === def.kind ? message : null;

          return (
            <div
              key={def.kind}
              data-feed={def.kind}
              className="rounded border border-hairline"
            >
              <div className="flex flex-wrap items-start gap-3 border-b border-hairline px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink">{def.label}</h3>
                    {feed && !feed.enabled && (
                      <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                        Paused
                      </span>
                    )}
                    {feed?.last_status === 'failed' && (
                      <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-danger">
                        Last run failed
                      </span>
                    )}
                    {feed?.last_status === 'partial' && (
                      <span className="rounded bg-goldenrod/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink">
                        Partial
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{def.blurb}</p>

                  {feed ? (
                    <p className="mt-2 text-[13px] text-ink">
                      <span className="font-medium">{feed.report_name}</span>
                      {feed.report_folder && (
                        <span className="text-muted"> · {feed.report_folder}</span>
                      )}
                      <span className="text-muted"> · last synced {when(feed.last_run_at)}</span>
                    </p>
                  ) : (
                    <p className="mt-2 text-[13px] text-muted">No report chosen yet.</p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    onClick={() => setPicking(def.kind)}
                    disabled={!connected}
                    className="rounded border border-hairline-strong bg-white px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-midnight disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {feed ? 'Change report' : 'Choose a report'}
                  </button>
                  {feed && (
                    <button
                      onClick={() => sync(def.kind)}
                      disabled={syncing !== null || !connected || !feed.enabled}
                      className="rounded bg-goldenrod px-3 py-1.5 text-sm font-semibold text-midnight transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                    >
                      {syncing === def.kind ? 'Syncing…' : 'Sync now'}
                    </button>
                  )}
                </div>
              </div>

              {msg && (
                <p
                  className={
                    'border-b border-hairline px-4 py-2 text-[13px] leading-relaxed ' +
                    (msg.bad ? 'bg-danger/5 text-danger' : 'bg-ok/5 text-ok')
                  }
                >
                  {msg.text}
                </p>
              )}

              {isEditing && (
                <div className="px-4 py-4">
                  <FieldMapper
                    kind={def.kind}
                    reportId={editing.report.id}
                    fields={fields[def.kind] ?? []}
                    saving={saving}
                    onCancel={() => setEditing(null)}
                    onSave={(mapping, name) => saveMapping(def.kind, mapping, name)}
                  />
                </div>
              )}

              {feed && !isEditing && (
                <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs">
                  <button
                    onClick={() =>
                      setEditing({
                        kind: def.kind,
                        report: {
                          id: feed.report_id,
                          name: feed.report_name,
                          folder: feed.report_folder,
                          developerName: null,
                          format: null,
                          lastRunAt: null,
                        },
                      })
                    }
                    className="text-info hover:underline"
                  >
                    Check the mapping
                  </button>
                  <button onClick={() => togglePaused(feed)} className="text-info hover:underline">
                    {feed.enabled ? 'Pause the daily sync' : 'Resume the daily sync'}
                  </button>
                  <button
                    onClick={() => unbind(def.kind)}
                    className="text-muted hover:text-danger hover:underline"
                  >
                    Unbind
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* History -------------------------------------------------------------- */}
      {runs.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Recent syncs
          </h3>
          <div className="mt-2 overflow-hidden rounded border border-hairline">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline bg-surface-alt text-left">
                  {['When', 'Feed', 'Read', 'Added', 'Updated', 'Off market', ''].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {runs.slice(0, 12).map((run) => (
                  <Fragment key={run.id}>
                    <tr className={run.status === 'failed' ? 'bg-danger/5' : ''}>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">
                        {when(run.started_at)}
                        <span className="ml-1 text-subtle">
                          {run.trigger === 'daily' ? 'auto' : 'manual'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink">
                        {FEEDS.find((f) => f.kind === run.kind)?.label ?? run.kind}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-body">{run.rows_read}</td>
                      <td className="px-3 py-2 tabular-nums text-body">{run.added}</td>
                      <td className="px-3 py-2 tabular-nums text-body">{run.updated}</td>
                      <td className="px-3 py-2 tabular-nums text-body">{run.retired}</td>
                      <td className="px-3 py-2 text-right">
                        {(run.retired > 0 || run.error || run.detail?.note) && (
                          <button
                            onClick={() => setOpenRun(openRun === run.id ? null : run.id)}
                            className="text-xs text-info hover:underline"
                          >
                            {openRun === run.id ? 'Hide' : 'What changed'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {openRun === run.id && (
                      <tr>
                        <td colSpan={7} className="bg-surface-alt px-3 py-3">
                          {run.error && (
                            <p className="text-[13px] leading-relaxed text-danger">{run.error}</p>
                          )}
                          {run.detail?.note && (
                            <p className="text-[13px] leading-relaxed text-ink">{run.detail.note}</p>
                          )}
                          {run.detail?.retiredSpaces?.length ? (
                            <>
                              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                                Taken off the market
                              </p>
                              <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                                {run.detail.retiredSpaces.map((s, i) => (
                                  <li key={i} className="text-[13px] text-body">
                                    {s.address} — floor {s.floor}
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : null}
                          {run.detail?.unresolved?.length ? (
                            <>
                              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                                Addresses that could not be placed
                              </p>
                              <ul className="mt-1 space-y-0.5">
                                {run.detail.unresolved.slice(0, 20).map((u, i) => (
                                  <li key={i} className="text-[13px] text-body">
                                    {u.address}
                                    {u.company ? ` (${u.company})` : ''} — {u.reason}
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-subtle">
            The daily run happens at 9am UTC — about 4am in New York — so the map is current
            before anyone opens it.
          </p>
        </div>
      )}

      <ReportPicker
        open={picking !== null}
        currentId={picking ? (feeds.find((f) => f.kind === picking)?.report_id ?? null) : null}
        onClose={() => setPicking(null)}
        onPick={(report) => {
          if (picking) setEditing({ kind: picking, report });
          setPicking(null);
        }}
      />
    </section>
  );
}
