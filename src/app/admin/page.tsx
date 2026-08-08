'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppHeader from '@/components/shell/AppHeader';
import Icon from '@/components/ui/Icon';
import type { AdminColumn } from '@/lib/admin-tables';

/**
 * The data editor. Everything that was imported, in a grid you can edit.
 *
 * Deliberately plain: a table, a row drawer, and two destructive buttons that
 * are hard to press by accident. It exists because a weekly sheet is never
 * quite right — a floor is wrong, a landlord name is a holding company, an
 * address matched the building next door — and every one of those is a
 * thirty-second fix if you can reach the row.
 */

interface TableSummary {
  key: string;
  label: string;
  description: string;
  cascades: string | null;
  count: number;
}

interface TableData {
  key: string;
  label: string;
  description: string;
  cascades: string | null;
  columns: AdminColumn[];
  primaryKey: string;
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
  wipePhrase: string;
}

const PAGE = 50;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  const s = String(value);
  // Timestamps are the only thing long enough to wreck the grid.
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s;
}

export default function AdminPage() {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [active, setActive] = useState<string>('spaces');
  const [data, setData] = useState<TableData | null>(null);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState('');
  const [wiping, setWiping] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const loadTables = useCallback(async () => {
    try {
      const res = await fetch('/api/admin', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not load tables.');
      setTables(body.tables);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (search.trim()) params.set('q', search.trim());
      const res = await fetch(`/api/admin/${active}?${params}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not load rows.');
      setData(body);
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [active, offset, search]);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const gridColumns = useMemo(
    () => data?.columns.filter((c) => c.inGrid) ?? [],
    [data],
  );

  function openRow(row: Record<string, unknown>) {
    setEditing(row);
    setDraft({ ...row });
  }

  async function saveRow() {
    if (!editing || !data) return;
    setSaving(true);
    setError(null);
    try {
      const id = String(editing[data.primaryKey]);
      // Only what actually changed, so a field nobody touched is never written.
      const patch: Record<string, unknown> = {};
      for (const column of data.columns) {
        if (column.kind === 'readonly') continue;
        if (draft[column.name] !== editing[column.name]) {
          patch[column.name] = draft[column.name];
        }
      }
      if (Object.keys(patch).length === 0) {
        setEditing(null);
        return;
      }
      const res = await fetch(`/api/admin/${data.key}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Save failed.');
      setEditing(null);
      setNotice('Saved.');
      await loadRows();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(row: Record<string, unknown>) {
    if (!data) return;
    const id = String(row[data.primaryKey]);
    setError(null);
    try {
      const res = await fetch(`/api/admin/${data.key}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Delete failed.');
      setNotice('Row deleted.');
      await Promise.all([loadRows(), loadTables()]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function wipeTable() {
    if (!data) return;
    setWiping(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/${data.key}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: confirmWipe }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Delete failed.');
      setNotice(`Deleted ${body.deleted} row${body.deleted === 1 ? '' : 's'}.`);
      setConfirmWipe('');
      await Promise.all([loadRows(), loadTables()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWiping(false);
    }
  }

  async function regenerateLandlords() {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/landlords/backfill', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not rebuild landlords.');
      setNotice(
        `Landlords rebuilt — ${body.created ?? 0} created, ${body.linked ?? 0} linked.`,
      );
      await Promise.all([loadRows(), loadTables()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-alt">
      <AppHeader dense />

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Data editor</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Every table behind the map. Click a row to edit it, or delete rows you do
              not want. Changes are live the moment they save.
            </p>
          </div>
          <Link
            href="/setup"
            className="flex items-center gap-1.5 rounded border border-hairline-strong bg-white px-3 py-2 text-sm font-medium text-body transition-colors hover:border-midnight hover:text-ink"
          >
            <Icon name="chevron-left" size={14} />
            Setup
          </Link>
        </div>

        {(error || notice) && (
          <div
            className={
              'mt-5 flex items-start gap-2 rounded-card border px-4 py-3 text-sm font-medium ' +
              (error
                ? 'border-danger/30 bg-danger-surface text-danger'
                : 'border-ok/30 bg-ok-surface text-ok')
            }
          >
            <Icon name={error ? 'warning' : 'check'} size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error ?? notice}</span>
            <button
              onClick={() => {
                setError(null);
                setNotice(null);
              }}
              className="text-xs underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
          {/* Tables ------------------------------------------------------- */}
          <aside className="space-y-1">
            {tables.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setActive(t.key);
                  setOffset(0);
                  setSearch('');
                  setConfirmWipe('');
                }}
                className={
                  'flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm transition-colors ' +
                  (active === t.key
                    ? 'bg-midnight font-semibold text-white'
                    : 'text-body hover:bg-white')
                }
              >
                <span>{t.label}</span>
                <span
                  className={
                    'tabular text-xs ' + (active === t.key ? 'text-white/70' : 'text-subtle')
                  }
                >
                  {t.count}
                </span>
              </button>
            ))}

            <div className="!mt-6 rounded-card border border-hairline bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Rebuild
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Recreates a landlord for every building that has none, from the city&apos;s
                owner of record. Existing landlords are left alone.
              </p>
              <button
                onClick={regenerateLandlords}
                disabled={regenerating}
                className="mt-3 w-full rounded border border-hairline-strong px-3 py-2 text-xs font-semibold text-ink transition-colors hover:border-midnight hover:bg-midnight-50 disabled:opacity-50"
              >
                {regenerating ? 'Rebuilding…' : 'Regenerate landlords'}
              </button>
            </div>
          </aside>

          {/* Rows --------------------------------------------------------- */}
          <section className="min-w-0">
            {data && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-ink">
                      {data.label}{' '}
                      <span className="tabular font-normal text-muted">({data.total})</span>
                    </h2>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">
                      {data.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setOffset(0);
                      }}
                      placeholder="Search…"
                      className="w-48 rounded border border-hairline-strong px-3 py-1.5 text-sm"
                    />
                    <button
                      onClick={() => void loadRows()}
                      className="rounded border border-hairline-strong px-3 py-1.5 text-sm font-medium text-body hover:border-midnight hover:text-ink"
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto rounded-card border border-hairline bg-white shadow-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline bg-surface-alt">
                        {gridColumns.map((c) => (
                          <th
                            key={c.name}
                            className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
                          >
                            {c.label}
                          </th>
                        ))}
                        <th className="w-24 px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {data.rows.map((row) => (
                        <tr
                          key={String(row[data.primaryKey])}
                          className="group transition-colors hover:bg-goldenrod-50"
                        >
                          {gridColumns.map((c) => (
                            <td
                              key={c.name}
                              className="max-w-[240px] truncate px-3 py-2.5 text-body"
                              title={cellText(row[c.name])}
                            >
                              {cellText(row[c.name])}
                            </td>
                          ))}
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                onClick={() => openRow(row)}
                                aria-label="Edit row"
                                className="rounded p-1.5 text-muted hover:bg-white hover:text-ink"
                              >
                                <Icon name="edit" size={15} />
                              </button>
                              <button
                                onClick={() => void removeRow(row)}
                                aria-label="Delete row"
                                className="rounded p-1.5 text-muted hover:bg-white hover:text-danger"
                              >
                                <Icon name="trash" size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {data.rows.length === 0 && !loading && (
                        <tr>
                          <td
                            colSpan={gridColumns.length + 1}
                            className="px-3 py-10 text-center text-sm text-muted"
                          >
                            Nothing here.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {data.total > PAGE && (
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="tabular text-muted">
                      {offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}
                    </span>
                    <div className="flex gap-2">
                      <button
                        disabled={offset === 0}
                        onClick={() => setOffset(Math.max(0, offset - PAGE))}
                        className="rounded border border-hairline-strong px-3 py-1.5 font-medium text-body disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <button
                        disabled={offset + PAGE >= data.total}
                        onClick={() => setOffset(offset + PAGE)}
                        className="rounded border border-hairline-strong px-3 py-1.5 font-medium text-body disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}

                {/* Destructive ---------------------------------------------- */}
                <div className="mt-8 rounded-card border border-danger/30 bg-danger-surface/40 p-5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-danger">
                    <Icon name="warning" size={15} />
                    Empty this table
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-body">
                    Deletes every row in <strong>{data.label}</strong>. There is no undo, and
                    this app has no sign-in — so it asks you to type the phrase rather than
                    click once.
                    {data.cascades && <> {data.cascades}</>}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <code className="rounded bg-white px-2 py-1 text-xs font-semibold text-ink">
                      {data.wipePhrase}
                    </code>
                    <input
                      value={confirmWipe}
                      onChange={(e) => setConfirmWipe(e.target.value)}
                      placeholder="Type the phrase to confirm"
                      className="w-64 rounded border border-hairline-strong px-3 py-1.5 text-sm"
                    />
                    <button
                      onClick={wipeTable}
                      disabled={wiping || confirmWipe !== data.wipePhrase}
                      className="rounded bg-danger px-4 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {wiping ? 'Deleting…' : 'Delete all'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </main>

      {/* Row editor --------------------------------------------------------- */}
      {editing && data && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-midnight/30"
          onClick={() => setEditing(null)}
        >
          <div
            className="flex h-full w-full max-w-xl flex-col bg-white shadow-float"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  {data.label}
                </p>
                <h2 className="truncate text-base font-semibold text-ink">
                  {cellText(editing[data.columns.find((c) => c.inGrid)?.name ?? 'id'])}
                </h2>
              </div>
              <button
                onClick={() => setEditing(null)}
                aria-label="Close"
                className="rounded-full p-2 text-muted hover:bg-surface-alt hover:text-ink"
              >
                <Icon name="close" size={16} />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {data.columns.map((column) => {
                const value = draft[column.name];
                const readonly = column.kind === 'readonly';
                return (
                  <label key={column.name} className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                      {column.label}
                    </span>
                    {column.kind === 'boolean' ? (
                      <div className="mt-1.5">
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(e) =>
                            setDraft({ ...draft, [column.name]: e.target.checked })
                          }
                          className="h-4 w-4"
                        />
                      </div>
                    ) : (
                      <input
                        value={
                          value === null || value === undefined
                            ? ''
                            : Array.isArray(value)
                              ? value.join(', ')
                              : String(value)
                        }
                        readOnly={readonly}
                        onChange={(e) => setDraft({ ...draft, [column.name]: e.target.value })}
                        className={
                          'mt-1.5 w-full rounded border px-3 py-2 text-sm ' +
                          (readonly
                            ? 'border-hairline bg-surface-alt text-subtle'
                            : 'border-hairline-strong text-ink')
                        }
                      />
                    )}
                    {column.kind === 'json' && !readonly && (
                      <span className="mt-1 block text-[11px] text-subtle">
                        Separate entries with commas.
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-4">
              <button
                onClick={() => setEditing(null)}
                className="rounded px-4 py-2 text-sm font-medium text-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={saveRow}
                disabled={saving}
                className="rounded bg-goldenrod px-5 py-2 text-sm font-semibold text-midnight disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
