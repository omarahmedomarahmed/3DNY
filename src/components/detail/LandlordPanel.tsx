'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Building, Landlord } from '@/types';
import { useApp } from '@/lib/store';
import Badge from '@/components/ui/Badge';
import { Num, formatCompactSf, formatRent } from '@/components/ui/Money';
import Icon from '@/components/ui/Icon';
import SourceInfo from '@/components/ui/SourceInfo';
import { landlordSource, type SourceNote } from '@/lib/provenance';
import EditDrawer, { type EditTarget } from '@/components/edit/EditDrawer';

export async function fetchLandlords(): Promise<Landlord[]> {
  const res = await fetch('/api/landlords', { cache: 'no-store' });
  if (!res.ok) return [];
  const body = await res.json().catch(() => null);
  return Array.isArray(body) ? (body as Landlord[]) : [];
}

/**
 * `insights_md` is hand-written and only ever markdown-ish: paragraphs, and
 * lines that start with "- " meant as bullets. Rendering exactly that keeps a
 * markdown parser out of the bundle for a feature that never needed one.
 */
export function Markdownish({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  let paragraph: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="ml-4 list-disc space-y-1">
        {bullets.map((b, i) => (
          <li key={i}>{stripEmphasis(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={`p-${blocks.length}`}>{stripEmphasis(paragraph.join(' '))}</p>);
    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') {
      flushBullets();
      flushParagraph();
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      bullets.push(line.replace(/^[-*]\s+/, ''));
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      flushBullets();
      flushParagraph();
      blocks.push(
        <p key={`h-${blocks.length}`} className="font-semibold text-ink">
          {line.replace(/^#{1,6}\s+/, '')}
        </p>,
      );
      continue;
    }
    flushBullets();
    paragraph.push(line);
  }
  flushBullets();
  flushParagraph();

  if (blocks.length === 0) return null;
  return (
    <div className={className ?? 'max-w-[68ch] space-y-3 text-[15px] leading-7 text-ink'}>
      {blocks}
    </div>
  );
}

/** Strips the ** and _ markers that creep in without pulling in a parser. */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
}

function Stat({
  label,
  value,
  source,
}: {
  label: string;
  value: React.ReactNode;
  source?: SourceNote;
}) {
  return (
    <div className="min-w-[140px] flex-1 border-l-2 border-goldenrod pl-3">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
        {source ? <SourceInfo label={label.toLowerCase()} note={source} /> : null}
      </p>
      <p className="mt-0.5 text-xl font-semibold tabular leading-tight text-goldenrod-700">
        {value}
      </p>
    </div>
  );
}

const QUIET_BUTTON =
  'inline-flex items-center gap-1.5 rounded border border-hairline-strong bg-white px-2.5 py-1.5 ' +
  'text-sm font-medium text-body transition-colors hover:border-midnight hover:text-ink ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

export default function LandlordPanel({ building }: { building: Building }) {
  const [landlord, setLandlord] = useState<Landlord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<EditTarget | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await fetchLandlords();
      const match =
        (building.landlord_id ? all.find((l) => l.id === building.landlord_id) : undefined) ??
        (building.landlord_name
          ? all.find((l) => l.name === building.landlord_name)
          : undefined) ??
        null;
      setLandlord(match);
    } finally {
      setLoading(false);
    }
  }, [building.landlord_id, building.landlord_name]);

  useEffect(() => {
    void load();
  }, [load]);

  /** A landlord created from here has to be attached to the building too. */
  async function linkLandlord(created: unknown) {
    const next = created as Landlord | null;
    if (!next?.id) return;
    setLandlord(next);
    try {
      const res = await fetch(`/api/buildings/${building.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ landlord_id: next.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not link landlord (${res.status})`);
      }
      await useApp.getState().loadBuildings();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /**
   * Pulls owners straight from the city records for every unlinked building,
   * so the panel has something to correct instead of a blank form.
   */
  async function runBackfill() {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch('/api/landlords/backfill', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Backfill failed (${res.status})`);
      await useApp.getState().loadBuildings();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  }

  /** Confirming means: the seeded name is the one we would say out loud. */
  async function confirmLandlord() {
    if (!landlord) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/landlords/${landlord.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ needs_review: false }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? `Could not confirm (${res.status})`);
      }
      setLandlord((prev) => (prev ? { ...prev, ...(body as Partial<Landlord>) } : prev));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <p className="rounded-card border border-hairline bg-surface-alt px-4 py-6 text-sm font-medium text-muted">
        Loading landlord insights…
      </p>
    );
  }

  if (!landlord) {
    return (
      <>
        <div className="rounded-card border border-dashed border-hairline-strong bg-surface-alt px-4 py-10 text-center">
          <Icon name="building" size={26} className="mx-auto text-subtle" />
          <p className="mt-2 text-sm font-semibold text-ink">
            No landlord linked to this building.
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-sm font-medium leading-5 text-muted">
            Seed one from the city&apos;s ownership records — every building with a tax lot gets the
            owner of record, flagged for review, and you correct the name from there rather than
            typing one from scratch.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              disabled={working}
              onClick={() => void runBackfill()}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded bg-goldenrod px-4 py-2 text-sm font-semibold text-midnight',
                'transition-colors hover:bg-goldenrod-400 disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <Icon name="building" size={14} />
              {working ? 'Pulling owners from city records…' : 'Pull owners from city records'}
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() =>
                setDrawer({
                  kind: 'landlord',
                  id: null,
                  initial: { name: building.landlord_name ?? '' },
                })
              }
              className={QUIET_BUTTON}
            >
              <Icon name="plus" size={14} />
              Add by hand
            </button>
          </div>
          {error && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-sm font-medium text-danger">
              <Icon name="warning" size={14} />
              {error}
            </p>
          )}
        </div>
        <EditDrawer
          target={drawer}
          onClose={() => setDrawer(null)}
          onSaved={(saved) => void linkLandlord(saved)}
        />
      </>
    );
  }

  const ownerDiffers =
    Boolean(landlord.owner_of_record) &&
    landlord.owner_of_record!.trim().toLowerCase() !== landlord.name.trim().toLowerCase();

  const openEditor = () =>
    setDrawer({
      kind: 'landlord',
      id: landlord.id,
      initial: landlord as unknown as Record<string, unknown>,
    });

  return (
    <div className="space-y-6 rounded-card border border-hairline bg-white p-6 shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-xl font-semibold tracking-tight text-ink">
            {landlord.name}
            <SourceInfo label="this landlord name" note={landlordSource(landlord, 'name')} />
          </h3>
          {ownerDiffers && (
            <p className="mt-0.5 flex items-center gap-1 text-sm font-medium text-subtle">
              Owner of record: {landlord.owner_of_record}
              <SourceInfo
                label="this owner of record"
                note={landlordSource(landlord, 'owner_of_record')}
              />
            </p>
          )}
          {landlord.aliases.length > 0 && (
            <p className="mt-0.5 text-sm font-medium text-muted">
              a.k.a. {landlord.aliases.join(', ')}
            </p>
          )}
        </div>
        <button type="button" onClick={openEditor} className={QUIET_BUTTON}>
          <Icon name="edit" size={14} />
          Edit insights
        </button>
      </header>

      {landlord.needs_review && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-card border-l-4 border-goldenrod bg-goldenrod-50 px-4 py-3">
          <p className="flex min-w-0 items-start gap-2 text-sm font-medium leading-5 text-midnight">
            <Icon name="info" size={16} className="mt-0.5 text-goldenrod-700" />
            <span>
              Seeded from the city ownership record as{' '}
              <span className="font-semibold">{landlord.owner_of_record ?? landlord.name}</span>.
              Confirm or replace with the operating landlord name.
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={working}
              onClick={() => void confirmLandlord()}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded bg-midnight px-3 py-1.5 text-sm font-semibold text-white',
                'transition-colors hover:bg-midnight-700 disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              <Icon name="check" size={14} />
              {working ? 'Confirming…' : 'Confirm'}
            </button>
            <button type="button" disabled={working} onClick={openEditor} className={QUIET_BUTTON}>
              <Icon name="edit" size={14} />
              Edit
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="flex items-center gap-2 rounded bg-danger-surface px-3 py-2 text-sm font-medium text-danger">
          <Icon name="warning" size={15} />
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-x-8 gap-y-4 border-y border-hairline py-4">
        <Stat
          label="Portfolio SF"
          value={formatCompactSf(landlord.portfolio_sf) ?? '—'}
          source={landlordSource(landlord, 'portfolio_sf')}
        />
        <Stat
          label="Buildings owned"
          value={<Num value={landlord.buildings_owned} />}
          source={landlordSource(landlord, 'buildings_owned')}
        />
        <Stat
          label="Avg asking rent"
          value={formatRent(landlord.avg_asking_rent) ?? '—'}
          source={landlordSource(landlord, 'avg_asking_rent')}
        />
      </div>

      {landlord.insights_md ? (
        <div>
          <h4 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Insights
            <SourceInfo
              label="these insights"
              note={landlordSource(landlord, 'insights_md')}
            />
          </h4>
          <Markdownish text={landlord.insights_md} />
        </div>
      ) : (
        <p className="text-sm font-medium text-muted">No written insights yet.</p>
      )}

      {landlord.amenities.length > 0 && (
        <div>
          <h4 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Amenities
            <SourceInfo
              label="these amenities"
              note={landlordSource(landlord, 'amenities')}
            />
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {landlord.amenities.map((a) => (
              <Badge
                key={a}
                variant="neutral"
                className="rounded-full bg-midnight-50 text-midnight-700"
              >
                {a}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {landlord.notable_tenants.length > 0 && (
        <div>
          <h4 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Notable tenants
            <SourceInfo
              label="these notable tenants"
              note={landlordSource(landlord, 'notable_tenants')}
            />
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {landlord.notable_tenants.map((t) => (
              <Badge
                key={t}
                variant="neutral"
                className="rounded-full bg-midnight-50 text-midnight-700"
              >
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {(landlord.contact_name || landlord.contact_email || landlord.contact_phone) && (
        <div className="rounded-card border border-hairline bg-surface-alt p-4">
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Contact
          </h4>
          {landlord.contact_name && (
            <p className="text-sm font-semibold text-ink">{landlord.contact_name}</p>
          )}
          {landlord.contact_email && (
            <a
              href={`mailto:${landlord.contact_email}`}
              className="flex items-center gap-1.5 break-all text-sm font-medium text-info hover:underline"
            >
              <Icon name="mail" size={14} />
              {landlord.contact_email}
            </a>
          )}
          {landlord.contact_phone && (
            <a
              href={`tel:${landlord.contact_phone}`}
              className="flex items-center gap-1.5 text-sm font-medium tabular text-info hover:underline"
            >
              <Icon name="phone" size={14} />
              {landlord.contact_phone}
            </a>
          )}
        </div>
      )}

      <EditDrawer
        target={drawer}
        onClose={() => setDrawer(null)}
        onSaved={(saved) => {
          if (saved && typeof saved === 'object' && 'id' in (saved as object)) {
            setLandlord(saved as Landlord);
          } else {
            void load();
          }
        }}
      />
    </div>
  );
}
