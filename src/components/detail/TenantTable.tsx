'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Tenant } from '@/types';
import Badge from '@/components/ui/Badge';
import { DateText, Sf, monthsUntil } from '@/components/ui/Money';
import EditDrawer, { type EditTarget } from '@/components/edit/EditDrawer';

const TH =
  'px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted whitespace-nowrap';
const TD = 'px-3 py-2.5 align-middle text-ink';
const CELL_INPUT =
  'w-full rounded border border-hairline-strong bg-white px-2 py-1 text-sm text-ink ' +
  'placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60';

interface Draft {
  company_name: string;
  floors: string;
  sf: string;
  lease_expiration: string;
  industry: string;
}

const EMPTY_DRAFT: Draft = {
  company_name: '',
  floors: '',
  sf: '',
  lease_expiration: '',
  industry: '',
};

function toDraft(t: Tenant): Draft {
  return {
    company_name: t.company_name ?? '',
    floors: t.floors ?? '',
    sf: t.sf === null ? '' : String(t.sf),
    lease_expiration: t.lease_expiration ? t.lease_expiration.slice(0, 10) : '',
    industry: t.industry ?? '',
  };
}

function draftToPayload(d: Draft) {
  const sf = d.sf.trim() === '' ? null : Number(d.sf);
  return {
    company_name: d.company_name.trim(),
    floors: d.floors.trim() || null,
    sf: sf !== null && Number.isFinite(sf) ? sf : null,
    lease_expiration: d.lease_expiration || null,
    industry: d.industry.trim() || null,
  };
}

/** The whole reason tenants are tracked: leases rolling inside a year. */
function expiryVariant(iso: string | null): 'warn' | 'danger' | null {
  const months = monthsUntil(iso);
  if (months === null) return null;
  if (months < 0) return 'danger';
  if (months <= 12) return 'warn';
  return null;
}

export default function TenantTable({
  buildingId,
  initialTenants,
}: {
  buildingId: string;
  initialTenants?: Tenant[];
}) {
  const [tenants, setTenants] = useState<Tenant[]>(initialTenants ?? []);
  const [loading, setLoading] = useState(!initialTenants);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [drawer, setDrawer] = useState<EditTarget | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants?buildingId=${encodeURIComponent(buildingId)}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not load tenants (${res.status})`);
      }
      const body = await res.json();
      setTenants(Array.isArray(body) ? (body as Tenant[]) : []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [buildingId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function saveRow(id: string) {
    const payload = draftToPayload(draft);
    if (!payload.company_name) {
      setError('Company name is required.');
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `Save failed (${res.status})`);
      setTenants((prev) => prev.map((t) => (t.id === id ? { ...t, ...(body as Tenant) } : t)));
      setEditingId(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function createRow() {
    const payload = draftToPayload(newDraft);
    if (!payload.company_name) {
      setError('Company name is required.');
      return;
    }
    setBusyId('new');
    setError(null);
    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, building_id: buildingId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `Save failed (${res.status})`);
      setTenants((prev) => [...prev, body as Tenant]);
      setNewDraft(EMPTY_DRAFT);
      setAdding(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteRow(t: Tenant) {
    if (!window.confirm(`Remove ${t.company_name} from this building?`)) return;
    setBusyId(t.id);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${t.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      setTenants((prev) => prev.filter((x) => x.id !== t.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const editableCells = (d: Draft, set: (next: Draft) => void, disabled: boolean) => (
    <>
      <td className={TD}>
        <input
          className={CELL_INPUT}
          placeholder="Company"
          value={d.company_name}
          disabled={disabled}
          onChange={(e) => set({ ...d, company_name: e.target.value })}
        />
      </td>
      <td className={TD}>
        <input
          className={CELL_INPUT}
          placeholder="12-14"
          value={d.floors}
          disabled={disabled}
          onChange={(e) => set({ ...d, floors: e.target.value })}
        />
      </td>
      <td className={TD}>
        <input
          className={clsx(CELL_INPUT, 'text-right tabular')}
          placeholder="SF"
          inputMode="numeric"
          value={d.sf}
          disabled={disabled}
          onChange={(e) => set({ ...d, sf: e.target.value })}
        />
      </td>
      <td className={TD}>
        <input
          className={CELL_INPUT}
          type="date"
          value={d.lease_expiration}
          disabled={disabled}
          onChange={(e) => set({ ...d, lease_expiration: e.target.value })}
        />
      </td>
      <td className={TD}>
        <input
          className={CELL_INPUT}
          placeholder="Industry"
          value={d.industry}
          disabled={disabled}
          onChange={(e) => set({ ...d, industry: e.target.value })}
        />
      </td>
    </>
  );

  return (
    <div className="space-y-2">
      {error && (
        <p className="rounded bg-danger-surface px-3 py-2 text-xs font-medium text-danger">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-card border border-hairline bg-white">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="border-b border-hairline bg-surface-alt">
            <tr className="text-left">
              <th className={TH}>Company</th>
              <th className={TH}>Floors</th>
              <th className={clsx(TH, 'text-right')}>SF</th>
              <th className={TH}>Lease Expiration</th>
              <th className={TH}>Industry</th>
              <th className={clsx(TH, 'text-right')}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {loading && tenants.length === 0 && (
              <tr>
                <td className={clsx(TD, 'text-muted')} colSpan={6}>
                  Loading tenants…
                </td>
              </tr>
            )}

            {!loading && tenants.length === 0 && !adding && (
              <tr>
                <td className={clsx(TD, 'text-center text-muted')} colSpan={6}>
                  No tenants recorded yet.
                </td>
              </tr>
            )}

            {tenants.map((t) => {
              const isEditing = editingId === t.id;
              const busy = busyId === t.id;
              const variant = expiryVariant(t.lease_expiration);
              if (isEditing) {
                return (
                  <tr key={t.id} className="bg-goldenrod-50">
                    {editableCells(draft, setDraft, busy)}
                    <td className={clsx(TD, 'text-right')}>
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void saveRow(t.id)}
                          className="rounded bg-midnight px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                        >
                          {busy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setEditingId(null)}
                          className="rounded px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={t.id} className="transition-colors hover:bg-goldenrod-50">
                  <td className={clsx(TD, 'font-semibold text-ink')}>{t.company_name}</td>
                  <td className={clsx(TD, 'text-body')}>{t.floors ?? '—'}</td>
                  <td className={clsx(TD, 'text-right tabular font-medium')}>
                    <Sf value={t.sf} />
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <span className="tabular text-body">
                        <DateText value={t.lease_expiration} />
                      </span>
                      {variant === 'warn' && <Badge variant="warn">Rolls within 12 mo</Badge>}
                      {variant === 'danger' && <Badge variant="danger">Expired</Badge>}
                    </div>
                  </td>
                  <td className={clsx(TD, 'text-body')}>{t.industry ?? '—'}</td>
                  <td className={clsx(TD, 'text-right')}>
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(toDraft(t));
                          setEditingId(t.id);
                        }}
                        className="rounded border border-hairline-strong bg-white px-2 py-1 text-[11px] font-medium text-body transition-colors hover:border-midnight hover:text-ink"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDrawer({
                            kind: 'tenant',
                            id: t.id,
                            initial: t as unknown as Record<string, unknown>,
                          })
                        }
                        className="rounded border border-hairline-strong bg-white px-2 py-1 text-[11px] font-medium text-body transition-colors hover:border-midnight hover:text-ink"
                      >
                        Details
                      </button>
                      <button
                        type="button"
                        disabled={busyId === t.id}
                        onClick={() => void deleteRow(t)}
                        className="rounded border border-hairline-strong bg-white px-2 py-1 text-[11px] font-medium text-body transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {adding ? (
              <tr className="bg-goldenrod-50">
                {editableCells(newDraft, setNewDraft, busyId === 'new')}
                <td className={clsx(TD, 'text-right')}>
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={busyId === 'new'}
                      onClick={() => void createRow()}
                      className="rounded bg-midnight px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                    >
                      {busyId === 'new' ? 'Adding…' : 'Add'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdding(false);
                        setNewDraft(EMPTY_DRAFT);
                      }}
                      className="rounded px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr className="bg-surface-alt">
                <td className={TD} colSpan={6}>
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="rounded border border-dashed border-hairline-strong px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-midnight hover:text-ink"
                  >
                    + Add tenant
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <EditDrawer
        target={drawer}
        onClose={() => setDrawer(null)}
        onSaved={() => void reload()}
      />
    </div>
  );
}
