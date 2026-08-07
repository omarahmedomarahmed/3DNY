import { NextResponse } from 'next/server';
import { isDatabaseConfigured, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Never throws — the UI uses this to decide whether to show a setup prompt. */
export async function GET() {
  let database: 'connected' | 'not configured' | 'error' = 'not configured';
  let buildingCount = 0;

  if (isDatabaseConfigured()) {
    try {
      const rows = (await sql()(
        `SELECT count(*)::int AS n FROM buildings`,
      )) as unknown as { n: number }[];
      buildingCount = rows[0]?.n ?? 0;
      database = 'connected';
    } catch {
      database = 'error';
    }
  }

  return NextResponse.json({
    ok: database === 'connected',
    database,
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    buildingCount,
  });
}
