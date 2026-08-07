import { NextResponse } from 'next/server';
import { commitImport } from '@/lib/queries';
import type { MatchedRow } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  if (message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      filename?: string;
      marketLabel?: string | null;
      rows?: MatchedRow[];
    };

    if (!body?.filename) {
      return NextResponse.json({ error: 'filename is required.' }, { status: 400 });
    }
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json({ error: 'No rows to commit.' }, { status: 400 });
    }

    return NextResponse.json(
      await commitImport(body.filename, body.marketLabel ?? null, body.rows),
    );
  } catch (err) {
    return fail(err);
  }
}
