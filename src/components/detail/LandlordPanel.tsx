'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Building, Landlord } from '@/types';
import { useApp } from '@/lib/store';
import Badge from '@/components/ui/Badge';
import { Num, formatCompactSf, formatRent } from '@/components/ui/Money';
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
        <p key={`h-${blocks.length}`} className="font-semibold text-white">
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
  return <div className={className ?? 'space-y-2 text-sm leading-6 text-white/90'}>{blocks}</div>;
}

/** Strips the ** and _ markers that creep in without pulling in a parser. */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-edge bg-ink/40 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm font-medium tabular-nums text-white">{value}</p>
    </div>
  );
}

export default function LandlordPanel({ building }: { building: Building }) {
  const [landlord, setLandlord] = useState<Landlord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<EditTarget | null>(null);

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

  if (loading) {
    return (
      <p className="rounded border border-edge bg-panel px-4 py-6 text-sm text-muted">
        Loading landlord insights…
      </p>
    );
  }

  if (!landlord) {
    return (
      <>
        <div className="rounded border border-dashed border-edge bg-panel px-4 py-8 text-center">
          <p className="text-sm text-white">No landlord linked to this building.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted">
            Ownership insights, amenities and notable tenants are hand-written — add them once and
            every building in the portfolio picks them up.
          </p>
          <button
            type="button"
            onClick={() =>
              setDrawer({
                kind: 'landlord',
                id: null,
                initial: { name: building.landlord_name ?? '' },
              })
            }
            className="mt-3 rounded bg-accent px-3 py-1.5 text-xs font-medium text-ink hover:brightness-110"
          >
            Add landlord insights
          </button>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>
        <EditDrawer
          target={drawer}
          onClose={() => setDrawer(null)}
          onSaved={(saved) => void linkLandlord(saved)}
        />
      </>
    );
  }

  return (
    <div className="space-y-4 rounded border border-edge bg-panel p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">{landlord.name}</h3>
          {landlord.aliases.length > 0 && (
            <p className="text-[11px] text-muted">a.k.a. {landlord.aliases.join(', ')}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() =>
            setDrawer({
              kind: 'landlord',
              id: landlord.id,
              initial: landlord as unknown as Record<string, unknown>,
            })
          }
          className="rounded border border-edge px-2.5 py-1.5 text-xs text-muted hover:text-white"
        >
          Edit insights
        </button>
      </header>

      {error && (
        <p className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Portfolio SF" value={formatCompactSf(landlord.portfolio_sf) ?? '—'} />
        <Stat label="Buildings owned" value={<Num value={landlord.buildings_owned} />} />
        <Stat label="Avg asking rent" value={formatRent(landlord.avg_asking_rent) ?? '—'} />
      </div>

      {landlord.insights_md ? (
        <Markdownish text={landlord.insights_md} />
      ) : (
        <p className="text-sm text-muted">No written insights yet.</p>
      )}

      {landlord.amenities.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Amenities
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {landlord.amenities.map((a) => (
              <Badge key={a} variant="neutral">
                {a}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {landlord.notable_tenants.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Notable tenants
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {landlord.notable_tenants.map((t) => (
              <Badge key={t} variant="info">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {(landlord.contact_name || landlord.contact_email || landlord.contact_phone) && (
        <div className="rounded border border-edge bg-ink/40 p-3">
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Contact
          </h4>
          {landlord.contact_name && <p className="text-sm text-white">{landlord.contact_name}</p>}
          {landlord.contact_email && (
            <a
              href={`mailto:${landlord.contact_email}`}
              className="block break-all text-xs text-accent hover:underline"
            >
              {landlord.contact_email}
            </a>
          )}
          {landlord.contact_phone && (
            <a href={`tel:${landlord.contact_phone}`} className="text-xs text-accent hover:underline">
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
