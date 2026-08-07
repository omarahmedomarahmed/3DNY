'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppHeader from '@/components/shell/AppHeader';
import { DotMotif } from '@/components/brand/Logo';
import type { Landlord } from '@/types';

/**
 * Landlord intelligence is the part of this tool no data vendor can supply —
 * it is what the team knows. This page is the place to write it down.
 */
export default function LandlordsPage() {
  const [landlords, setLandlords] = useState<Landlord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Landlord | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/landlords', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setLandlords(Array.isArray(body) ? body : []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return landlords;
    return landlords.filter((l) =>
      [l.name, l.insights_md, ...(l.aliases ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [landlords, query]);

  return (
    <div className="min-h-screen bg-surface-alt">
      <AppHeader />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Intelligence
            </p>
            <h1 className="rule-gold mt-2 text-2xl font-semibold tracking-tight text-ink">
              Landlord profiles
            </h1>
            <p className="mt-6 max-w-2xl text-sm leading-relaxed text-muted">
              What your team knows about how a landlord actually behaves — deal posture,
              building operations, who else is in the portfolio. It appears on every building
              profile and in every side-by-side comparison.
            </p>
          </div>

          <button
            onClick={() => setCreating(true)}
            className="rounded bg-goldenrod px-5 py-2.5 text-sm font-semibold text-midnight transition-transform hover:-translate-y-0.5"
          >
            Add a landlord
          </button>
        </div>

        {landlords.length > 4 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search landlords"
            className="mt-8 w-full max-w-sm rounded border border-hairline-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-subtle"
          />
        )}

        {error && (
          <div className="mt-8 rounded-card border border-danger/20 bg-danger-surface p-4 text-sm text-danger">
            {error}
          </div>
        )}

        {loading ? (
          <p className="mt-10 text-sm text-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <EmptyState onAdd={() => setCreating(true)} searching={query.trim().length > 0} />
        ) : (
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {filtered.map((l) => (
              <LandlordCard key={l.id} landlord={l} onEdit={() => setEditing(l)} />
            ))}
          </div>
        )}
      </main>

      {(editing || creating) && (
        <LandlordEditor
          landlord={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ onAdd, searching }: { onAdd: () => void; searching: boolean }) {
  if (searching) {
    return <p className="mt-10 text-sm text-muted">No landlord matches that search.</p>;
  }
  return (
    <div className="mt-10 rounded-card border border-dashed border-hairline-strong bg-white p-12 text-center">
      <DotMotif size={30} className="mx-auto" />
      <h2 className="mt-5 text-lg font-semibold text-ink">No landlord profiles yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
        This is the section a client cannot get anywhere else. Start with the ten landlords
        most likely to come up in your next meeting — a few sentences each is enough.
      </p>
      <button
        onClick={onAdd}
        className="mt-6 rounded bg-goldenrod px-5 py-2.5 text-sm font-semibold text-midnight"
      >
        Add the first one
      </button>
      <p className="mt-4 text-xs text-subtle">
        Prefer a spreadsheet? Use <code>data/samples/landlords-template.csv</code> as a
        starting point.
      </p>
    </div>
  );
}

function LandlordCard({ landlord, onEdit }: { landlord: Landlord; onEdit: () => void }) {
  const stats = [
    landlord.buildings_owned !== null && {
      label: 'Buildings',
      value: landlord.buildings_owned.toLocaleString(),
    },
    landlord.portfolio_sf !== null && {
      label: 'Portfolio',
      value: `${Math.round(landlord.portfolio_sf / 1000).toLocaleString()}K SF`,
    },
    landlord.avg_asking_rent !== null && {
      label: 'Avg asking',
      value: `$${Number(landlord.avg_asking_rent).toFixed(0)}`,
    },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <article className="flex flex-col rounded-card border border-hairline bg-white p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold leading-snug text-ink">{landlord.name}</h2>
        <button onClick={onEdit} className="shrink-0 text-xs text-info hover:underline">
          Edit
        </button>
      </div>

      {stats.length > 0 && (
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="text-[10px] uppercase tracking-[0.12em] text-subtle">
                {s.label}
              </dt>
              <dd className="tabular text-sm font-semibold text-ink">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {landlord.insights_md ? (
        <p className="mt-4 line-clamp-4 text-sm leading-relaxed text-muted">
          {landlord.insights_md}
        </p>
      ) : (
        <p className="mt-4 text-sm italic text-subtle">
          No insights written yet — this is the part clients value most.
        </p>
      )}

      {(landlord.amenities?.length ?? 0) > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {landlord.amenities.slice(0, 6).map((a) => (
            <span
              key={a}
              className="rounded-full bg-midnight-50 px-2.5 py-0.5 text-[11px] text-midnight-700"
            >
              {a}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

const LIST_FIELDS = ['amenities', 'notable_tenants', 'aliases'] as const;

function LandlordEditor({
  landlord,
  onClose,
  onSaved,
}: {
  landlord: Landlord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: landlord?.name ?? '',
    insights_md: landlord?.insights_md ?? '',
    amenities: (landlord?.amenities ?? []).join(', '),
    notable_tenants: (landlord?.notable_tenants ?? []).join(', '),
    aliases: (landlord?.aliases ?? []).join(', '),
    buildings_owned: landlord?.buildings_owned?.toString() ?? '',
    portfolio_sf: landlord?.portfolio_sf?.toString() ?? '',
    avg_asking_rent: landlord?.avg_asking_rent?.toString() ?? '',
    contact_name: landlord?.contact_name ?? '',
    contact_email: landlord?.contact_email ?? '',
    contact_phone: landlord?.contact_phone ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name.trim()) {
      setError('A landlord name is required.');
      return;
    }
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      insights_md: form.insights_md.trim() || null,
      contact_name: form.contact_name.trim() || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
    };
    for (const key of LIST_FIELDS) {
      payload[key] = form[key]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    for (const key of ['buildings_owned', 'portfolio_sf', 'avg_asking_rent'] as const) {
      const raw = form[key].replace(/[^0-9.]/g, '');
      payload[key] = raw ? Number(raw) : null;
    }

    try {
      const res = await fetch(
        landlord ? `/api/landlords/${landlord.id}` : '/api/landlords',
        {
          method: landlord ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <button
        aria-label="Close"
        onClick={onClose}
        className="flex-1 bg-midnight/25 backdrop-blur-[1px]"
      />
      <div className="flex w-full max-w-lg animate-slide-in flex-col bg-white shadow-float">
        <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2 className="text-base font-semibold text-ink">
            {landlord ? 'Edit landlord' : 'Add a landlord'}
          </h2>
          <button onClick={onClose} className="text-sm text-muted hover:text-ink">
            Close
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          <Input label="Name" value={form.name} onChange={(v) => set('name', v)} required />
          <Textarea
            label="Insights"
            hint="How they negotiate, how the buildings run, anything a client would not find in a listing."
            value={form.insights_md}
            onChange={(v) => set('insights_md', v)}
          />
          <Input
            label="Amenities"
            hint="Comma separated"
            value={form.amenities}
            onChange={(v) => set('amenities', v)}
          />
          <Input
            label="Notable tenants"
            hint="Comma separated"
            value={form.notable_tenants}
            onChange={(v) => set('notable_tenants', v)}
          />
          <Input
            label="Also known as"
            hint="Comma separated. Add the truncated forms that appear in the weekly sheet, e.g. “Sage Realty Corpo”."
            value={form.aliases}
            onChange={(v) => set('aliases', v)}
          />

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Buildings"
              value={form.buildings_owned}
              onChange={(v) => set('buildings_owned', v)}
            />
            <Input
              label="Portfolio SF"
              value={form.portfolio_sf}
              onChange={(v) => set('portfolio_sf', v)}
            />
            <Input
              label="Avg asking"
              value={form.avg_asking_rent}
              onChange={(v) => set('avg_asking_rent', v)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Contact"
              value={form.contact_name}
              onChange={(v) => set('contact_name', v)}
            />
            <Input
              label="Email"
              value={form.contact_email}
              onChange={(v) => set('contact_email', v)}
            />
          </div>
          <Input
            label="Phone"
            value={form.contact_phone}
            onChange={(v) => set('contact_phone', v)}
          />

          {error && (
            <p className="rounded bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-hairline px-6 py-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-ink">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded bg-midnight px-5 py-2.5 text-sm font-medium text-white hover:bg-midnight-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  hint,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
        {required && <span className="ml-1 text-warn">*</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded border border-hairline-strong bg-white px-3 py-2 text-sm text-ink"
      />
      {hint && <span className="mt-1 block text-xs leading-relaxed text-subtle">{hint}</span>}
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={7}
        className="mt-1.5 w-full rounded border border-hairline-strong bg-white px-3 py-2 text-sm leading-relaxed text-ink"
      />
      {hint && <span className="mt-1 block text-xs leading-relaxed text-subtle">{hint}</span>}
    </label>
  );
}
