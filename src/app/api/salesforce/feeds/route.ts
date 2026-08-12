import { NextResponse } from 'next/server';
import { getFeeds, saveFeed, deleteFeed, getRuns, FEED_KINDS } from '@/lib/salesforce-feeds';
import { fieldsFor, missingRequired, type FeedKind } from '@/lib/salesforce-mapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isKind = (v: unknown): v is FeedKind =>
  typeof v === 'string' && (FEED_KINDS as readonly string[]).includes(v);

function describe(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected error.';
  if (message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
  }
  // The table arrives with the rest of the schema, so a missing one means the
  // migration has not been run rather than anything being wrong here.
  if (/relation "salesforce_(feeds|runs)" does not exist/i.test(message)) {
    return NextResponse.json(
      {
        error: 'The Salesforce tables have not been created yet.',
        remedy: 'Use "Create database tables" at the top of this page, then reload.',
        needsMigration: true,
      },
      { status: 503 },
    );
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Every binding, its recent runs, and the fields each feed can map. */
export async function GET() {
  try {
    const [feeds, runs] = await Promise.all([getFeeds(), getRuns(undefined, 30)]);
    return NextResponse.json({
      feeds,
      runs,
      fields: Object.fromEntries(
        FEED_KINDS.map((kind) => [kind, fieldsFor(kind)]),
      ),
    });
  } catch (err) {
    return describe(err);
  }
}

/** Bind a feed to a report, or repoint one. */
export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as {
      kind?: unknown;
      reportId?: unknown;
      reportName?: unknown;
      reportFolder?: unknown;
      columnMap?: unknown;
      enabled?: unknown;
    };

    if (!isKind(body.kind)) {
      return NextResponse.json({ error: 'Unknown feed.' }, { status: 400 });
    }
    if (typeof body.reportId !== 'string' || !body.reportId.trim()) {
      return NextResponse.json({ error: 'Choose a report first.' }, { status: 400 });
    }

    const columnMap =
      body.columnMap && typeof body.columnMap === 'object' && !Array.isArray(body.columnMap)
        ? (body.columnMap as Record<string, string>)
        : {};

    // Refuse to save a mapping that cannot produce a row. Saving it would look
    // like it worked and then fail every night at 4am, which is the worst
    // possible place to find out.
    const missing = missingRequired(columnMap, body.kind);
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Still to map: ${missing.map((f) => f.label).join(', ')}.`,
          remedy: 'A row needs at least those to be placed on the map.',
          missing: missing.map((f) => f.key),
        },
        { status: 400 },
      );
    }

    const feed = await saveFeed({
      kind: body.kind,
      reportId: body.reportId.trim(),
      reportName:
        typeof body.reportName === 'string' && body.reportName.trim()
          ? body.reportName.trim()
          : body.reportId.trim(),
      reportFolder: typeof body.reportFolder === 'string' ? body.reportFolder : null,
      columnMap,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    });

    return NextResponse.json({ feed });
  } catch (err) {
    return describe(err);
  }
}

/** Unbind. Nothing already on the map is removed. */
export async function DELETE(req: Request) {
  try {
    const kind = new URL(req.url).searchParams.get('kind');
    if (!isKind(kind)) {
      return NextResponse.json({ error: 'Unknown feed.' }, { status: 400 });
    }
    await deleteFeed(kind);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return describe(err);
  }
}
