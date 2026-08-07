'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Health {
  ok: boolean;
  database: string;
  blob: boolean;
  buildingCount: number | null;
}

/**
 * A browser-clickable replacement for running migrations from a terminal.
 * SETUP.md points non-technical users here, so every outcome has to be
 * readable without knowing what a migration is.
 */
export default function SetupPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      setHealth(await res.json());
    } catch {
      setHealth(null);
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
        `Database tables are ready (${body.statements} statements run). ` +
          'You can click this again any time — it will not delete anything.',
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

  const dbReady = health?.database === 'connected';

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-accent hover:underline">
        ← Back to the map
      </Link>

      <h1 className="mt-6 text-2xl font-semibold">Setup</h1>
      <p className="mt-2 text-sm text-muted">
        Everything on this page is a button. There is nothing to install and no commands to
        run. Full instructions are in SETUP.md in the repository.
      </p>

      <section className="mt-8 rounded-lg border border-edge bg-panel p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Status</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <Row
            label="Database"
            ok={dbReady}
            value={
              health === null
                ? 'Checking…'
                : dbReady
                  ? 'Connected'
                  : health.database === 'not configured'
                    ? 'Not configured — add DATABASE_URL in Vercel (SETUP.md step 3)'
                    : `Error — ${health.database}`
            }
          />
          <Row
            label="Photo storage"
            ok={Boolean(health?.blob)}
            value={
              health?.blob
                ? 'Connected'
                : 'Not set up — optional. Add a Blob store in Vercel → Storage (SETUP.md step 4)'
            }
            optional
          />
          <Row
            label="Buildings loaded"
            ok={(health?.buildingCount ?? 0) > 0}
            value={
              health?.buildingCount === null || health?.buildingCount === undefined
                ? '—'
                : health.buildingCount === 0
                  ? 'None yet — import a sheet to get started'
                  : `${health.buildingCount}`
            }
            optional
          />
        </dl>
      </section>

      <section className="mt-6 rounded-lg border border-edge bg-panel p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Create database tables
        </h2>
        <p className="mt-2 text-sm text-muted">
          Run this once after connecting the database. It creates the tables the app needs.
          It is safe to click more than once — it never deletes existing data.
        </p>

        <button
          onClick={createTables}
          disabled={running || !dbReady}
          className="mt-4 rounded bg-accent px-4 py-2 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? 'Creating tables…' : 'Create database tables'}
        </button>

        {!dbReady && (
          <p className="mt-3 text-xs text-warn">
            Connect the database first — this button turns on once DATABASE_URL is set.
          </p>
        )}
        {result && <p className="mt-3 text-sm text-ok">{result}</p>}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      <section className="mt-6 rounded-lg border border-edge bg-panel p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Refresh building shapes
        </h2>
        <p className="mt-2 text-sm text-muted">
          Imports pull each building&apos;s real outline and height from NYC records
          automatically. Use this if a building is showing as a plain box — it retries the
          lookup for anything that is still missing.
        </p>
        <button
          onClick={enrich}
          disabled={enriching || !dbReady}
          className="mt-4 rounded border border-edge px-4 py-2 text-sm hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {enriching ? 'Looking up building shapes…' : 'Refresh building shapes'}
        </button>
        {enrichResult && <p className="mt-3 text-sm text-ok">{enrichResult}</p>}
      </section>

      <section className="mt-6 rounded-lg border border-edge bg-panel p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Next step</h2>
        <p className="mt-2 text-sm text-muted">
          Upload your weekly availability sheet and it will appear on the map.
        </p>
        <Link
          href="/import"
          className="mt-4 inline-block rounded border border-edge px-4 py-2 text-sm hover:border-accent hover:text-accent"
        >
          Go to Import
        </Link>
      </section>

      <p className="mt-8 text-xs text-muted">
        This prototype has no login. Anyone with the link can open it. Do not upload
        confidential landlord economics until a login is added.
      </p>
    </main>
  );
}

function Row({
  label,
  value,
  ok,
  optional,
}: {
  label: string;
  value: string;
  ok: boolean;
  optional?: boolean;
}) {
  const color = ok ? 'bg-ok' : optional ? 'bg-muted' : 'bg-warn';
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`} />
      <dt className="w-32 shrink-0 text-muted">{label}</dt>
      <dd className="flex-1">{value}</dd>
    </div>
  );
}
