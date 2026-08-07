import { NextResponse } from 'next/server';
import { isDatabaseConfigured, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type DatabaseState = 'not configured' | 'connected' | 'error';

/**
 * Never throws — the UI uses this to decide what to show.
 *
 * Connectivity and schema are reported separately on purpose. Testing the
 * connection by querying an application table conflates "cannot reach the
 * database" with "the tables have not been created yet", and the second is
 * the normal state on a fresh project.
 */
export async function GET() {
  let database: DatabaseState = 'not configured';
  let databaseError: string | null = null;
  let schemaReady = false;
  let buildingCount: number | null = null;

  if (isDatabaseConfigured()) {
    try {
      // Connectivity only. Nothing application-specific.
      await sql()(`SELECT 1 AS ok`);
      database = 'connected';
    } catch (err) {
      database = 'error';
      databaseError = (err as Error).message;
    }
  }

  if (database === 'connected') {
    try {
      const rows = (await sql()(
        `SELECT to_regclass('public.buildings') IS NOT NULL AS ready`,
      )) as unknown as { ready: boolean }[];
      schemaReady = Boolean(rows[0]?.ready);
    } catch {
      schemaReady = false;
    }
  }

  if (schemaReady) {
    try {
      const rows = (await sql()(
        `SELECT count(*)::int AS n FROM buildings`,
      )) as unknown as { n: number }[];
      buildingCount = rows[0]?.n ?? 0;
    } catch {
      buildingCount = null;
    }
  }

  return NextResponse.json({
    ok: database === 'connected' && schemaReady,
    database,
    databaseError,
    schemaReady,
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    buildingCount,
  });
}
