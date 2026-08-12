import { NextResponse } from 'next/server';
import { SalesforceError } from '@/lib/salesforce';
import { syncFeed, FeedNotReady } from '@/lib/salesforce-sync';
import { FEED_KINDS, FEED_LABELS } from '@/lib/salesforce-feeds';
import type { FeedKind } from '@/lib/salesforce-mapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Sync one feed now.
 *
 * The button behind this is the whole promise of the integration: update the
 * report in Salesforce, press this, the map matches. Everything it did comes
 * back in the response and is also written to the run history, so closing the
 * tab does not lose the record of what changed.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (!(FEED_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `Unknown feed "${kind}".` }, { status: 404 });
  }

  try {
    const result = await syncFeed(kind as FeedKind, { trigger: 'manual' });
    return NextResponse.json({
      ok: true,
      ...result,
      label: FEED_LABELS[kind as FeedKind],
    });
  } catch (err) {
    if (err instanceof FeedNotReady) {
      return NextResponse.json({ error: err.message, remedy: err.remedy }, { status: 400 });
    }
    if (err instanceof SalesforceError) {
      return NextResponse.json(
        { error: err.message, remedy: err.remedy },
        { status: err.status && err.status < 500 ? 400 : 502 },
      );
    }
    const message = err instanceof Error ? err.message : 'Unexpected error.';
    if (message.includes('DATABASE_URL')) {
      return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
