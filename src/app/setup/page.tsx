'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppHeader from '@/components/shell/AppHeader';
import LogoUploader from '@/components/brand/LogoUploader';
import { SkylineBand, GridPattern } from '@/components/brand/Skyline';
import Icon from '@/components/ui/Icon';
import { photorealAvailable } from '@/components/map/photoreal';
import { clearTileCache } from '@/lib/tile-cache';

interface Health {
  ok: boolean;
  database: 'not configured' | 'connected' | 'error';
  databaseError: string | null;
  schemaReady: boolean;
  blob: boolean;
  buildingCount: number | null;
}

/**
 * The browser-clickable replacement for running migrations from a terminal.
 * SETUP.md points non-technical users here, so every state has to be readable
 * without knowing what a migration is.
 */
export default function SetupPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<string | null>(null);
  const [cacheCleared, setCacheCleared] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      setHealth(await res.json());
    } catch {
      setHealth(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createTables() {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/migrate', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setResult(
        `Tables are ready — ${body.statements} statements ran. You can click this again ` +
          'at any time; it never deletes anything.',
      );
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function enrich() {
    setEnriching(true);
    setEnrichResult(null);
    setError(null);
    try {
      const res = await fetch('/api/enrich', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setEnrichResult(
        body.attempted === 0
          ? 'Every building already has its real outline.'
          : `Looked up ${body.attempted} building${body.attempted === 1 ? '' : 's'}, ` +
            `${body.succeeded} updated.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnriching(false);
    }
  }

  // Reachability and schema are separate questions. The migrate button has to
  // work when the database is reachable but empty — that is exactly the state
  // it exists to fix.
  const reachable = health?.database === 'connected';
  const schemaReady = Boolean(health?.schemaReady);

  return (
    <div className="min-h-screen bg-surface-alt">
      <AppHeader />

      {/* A thin skyline keeps the utility pages inside the same world as the
          map, without competing with the status list underneath. */}
      <div className="relative overflow-hidden bg-midnight">
        <GridPattern
          className="pointer-events-none absolute inset-0 text-white"
          opacity={0.12}
        />
        <SkylineBand className="relative block h-20 w-full opacity-60" fill="#243E8C" />
      </div>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Setup</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Everything on this page is a button. Nothing to install, no commands to run. The
          full walkthrough is in SETUP.md.
        </p>

        {/* Status ---------------------------------------------------------- */}
        <section className="mt-10 overflow-hidden rounded-card border border-hairline bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Status
            </h2>
            <button
              onClick={refresh}
              disabled={checking}
              className="text-xs text-info hover:underline disabled:opacity-50"
            >
              {checking ? 'Checking…' : 'Re-check'}
            </button>
          </div>

          <dl className="divide-y divide-hairline">
            <Row
              label="Database connection"
              state={
                checking && !health
                  ? 'pending'
                  : reachable
                    ? 'ok'
                    : health?.database === 'not configured'
                      ? 'todo'
                      : 'bad'
              }
              value={
                checking && !health
                  ? 'Checking…'
                  : reachable
                    ? 'Connected'
                    : health?.database === 'not configured'
                      ? 'DATABASE_URL is not set — add it in Vercel, then redeploy (SETUP.md step 3)'
                      : (health?.databaseError ?? 'Could not connect')
              }
            />
            <Row
              label="Database tables"
              state={checking && !health ? 'pending' : schemaReady ? 'ok' : 'todo'}
              value={
                checking && !health
                  ? 'Checking…'
                  : schemaReady
                    ? 'Created'
                    : reachable
                      ? 'Not created yet — use the button below'
                      : 'Waiting on the database connection'
              }
            />
            <Row
              label="Photo storage"
              state={health?.blob ? 'ok' : 'optional'}
              value={
                health?.blob
                  ? 'Connected'
                  : 'Not set up. Optional — add a Blob store in Vercel → Storage (SETUP.md step 4)'
              }
            />
            <Row
              label="Buildings loaded"
              state={(health?.buildingCount ?? 0) > 0 ? 'ok' : 'optional'}
              value={
                health?.buildingCount === null || health?.buildingCount === undefined
                  ? '—'
                  : health.buildingCount === 0
                    ? 'None yet — upload a sheet to get started'
                    : `${health.buildingCount}`
              }
            />
          </dl>
        </section>

        {/* Create tables ---------------------------------------------------- */}
        <section className="mt-6 rounded-card border border-hairline bg-white p-6 shadow-card">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            <Icon name="check" size={14} />
            Create database tables
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Run this once after connecting the database. Safe to click more than once — it
            never deletes existing data.
          </p>

          <button
            onClick={createTables}
            disabled={running || !reachable}
            className="mt-5 rounded bg-goldenrod px-5 py-2.5 text-sm font-semibold text-midnight transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          >
            {running
              ? 'Creating tables…'
              : schemaReady
                ? 'Re-run table setup'
                : 'Create database tables'}
          </button>

          {!reachable && (
            <p className="mt-3 text-xs text-warn">
              Connect the database first — this button turns on once the app can reach it.
            </p>
          )}
          {result && <p className="mt-3 text-sm text-ok">{result}</p>}
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </section>

        {/* Refresh geometry -------------------------------------------------- */}
        <section className="mt-6 rounded-card border border-hairline bg-white p-6 shadow-card">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            <Icon name="building" size={14} />
            Refresh building shapes
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Imports pull each building&apos;s real outline and height from NYC records
            automatically. Use this if a building is showing as a plain box — it retries the
            lookup for anything still missing.
          </p>
          <button
            onClick={enrich}
            disabled={enriching || !schemaReady}
            className="mt-5 rounded border border-hairline-strong px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-midnight hover:bg-midnight-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enriching ? 'Looking up building shapes…' : 'Refresh building shapes'}
          </button>
          {enrichResult && <p className="mt-3 text-sm text-ok">{enrichResult}</p>}
        </section>

        {/* Photorealistic imagery ---------------------------------------------- */}
        {photorealAvailable() && (
          <section className="mt-6 rounded-card border border-hairline bg-white p-6 shadow-card">
            <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              <Icon name="camera" size={14} />
              Photorealistic imagery
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The camera button on the map switches the grey city for real
              photography. Imagery is kept on this computer after the first view, so
              coming back to a block is instant and is not charged again. Clearing it
              only means the next visit downloads afresh — nothing is lost.
            </p>
            <button
              onClick={async () => {
                await clearTileCache();
                setCacheCleared(true);
              }}
              className="mt-5 rounded border border-hairline-strong px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-midnight hover:bg-midnight-50"
            >
              Clear saved imagery on this computer
            </button>
            {cacheCleared && (
              <p className="mt-3 text-sm text-ok">
                Cleared. The next photorealistic view downloads fresh imagery.
              </p>
            )}
          </section>
        )}

        {/* Branding ------------------------------------------------------------ */}
        <section className="mt-6 rounded-card border border-hairline bg-white p-6 shadow-card">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            <Icon name="image" size={14} />
            Company logo
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Upload the Cresa mark from the company website and nudge it until it sits right
            in the navigation bar and the footer. Both previews below are the real thing.
          </p>
          <LogoUploader className="mt-6" />
        </section>

        {/* Next --------------------------------------------------------------- */}
        <section className="mt-6 rounded-card border border-hairline bg-midnight p-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
            Next step
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/75">
            Upload your weekly availability sheet and it appears on the map.
          </p>
          <Link
            href="/import"
            className="mt-5 inline-block rounded bg-goldenrod px-5 py-2.5 text-sm font-semibold text-midnight transition-transform hover:-translate-y-0.5"
          >
            Upload a sheet
          </Link>
        </section>

        <p className="mt-10 text-xs leading-relaxed text-subtle">
          This prototype has no sign-in — anyone with the link can open it. Keep confidential
          landlord economics out of it until a sign-in is added.
        </p>
      </main>
    </div>
  );
}

type State = 'ok' | 'todo' | 'bad' | 'optional' | 'pending';

const DOT: Record<State, string> = {
  ok: 'bg-ok',
  todo: 'bg-goldenrod',
  bad: 'bg-danger',
  optional: 'bg-hairline-strong',
  pending: 'bg-hairline-strong animate-pulse',
};

function Row({ label, value, state }: { label: string; value: string; state: State }) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[state]}`} />
      <dt className="w-40 shrink-0 text-sm text-muted">{label}</dt>
      <dd className={`flex-1 text-sm ${state === 'bad' ? 'text-danger' : 'text-ink'}`}>
        {value}
      </dd>
    </div>
  );
}
