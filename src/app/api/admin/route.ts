import { NextResponse } from 'next/server';
import { ADMIN_TABLES, countRows } from '@/lib/admin-tables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The table list, with live row counts, for the editor's sidebar. */
export async function GET() {
  try {
    const tables = await Promise.all(
      ADMIN_TABLES.map(async (spec) => ({
        key: spec.key,
        label: spec.label,
        description: spec.description,
        cascades: spec.cascades ?? null,
        count: await countRows(spec),
      })),
    );
    return NextResponse.json({ tables });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json(
      { error: message, needsSetup: message.includes('DATABASE_URL') },
      { status: message.includes('DATABASE_URL') ? 503 : 500 },
    );
  }
}
