import { NextResponse } from 'next/server';
import { syncAllFeeds } from '@/lib/salesforce-sync';
import { salesforceConfig } from '@/lib/salesforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

/**
 * The daily run. Wired to `vercel.json`, so nobody has to remember it.
 *
 * This is the part that makes the integration worth having. The team updates
 * its reports in Salesforce the way it already does, and by the time anyone
 * opens the map the next morning it already matches: floors that came off the
 * market are gone, new ones are on, rents are current.
 *
 * Vercel signs its cron requests with `CRON_SECRET` when that variable is set.
 * We require it in production rather than trusting the header alone, because
 * this endpoint writes to the map and an unauthenticated URL that can retire
 * spaces is not something to leave lying around. In development it runs
 * without, so it can be tested with curl.
 */
function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== 'production';
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

async function run(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json(
      {
        error: 'Not authorised.',
        remedy:
          'Vercel Cron sends CRON_SECRET as a bearer token. Set that variable in the ' +
          'project so scheduled runs are authenticated.',
      },
      { status: 401 },
    );
  }

  // Nothing configured is a normal state, not a failure — most deployments of
  // this app never connect a CRM at all. Reporting it as an error would put a
  // red cron in the dashboard every morning for no reason.
  if (!salesforceConfig()) {
    return NextResponse.json({ skipped: 'Salesforce is not connected.' });
  }

  try {
    const { results, failures } = await syncAllFeeds('daily');
    return NextResponse.json({
      ran: results.length,
      results: results.map((r) => ({
        kind: r.kind,
        status: r.status,
        rowsRead: r.rowsRead,
        added: r.added,
        updated: r.updated,
        retired: r.retired,
        skipped: r.skipped,
      })),
      failures,
    }, {
      // A failed feed is reported with a 207 rather than a 200, so the cron
      // dashboard shows something happened without failing runs where one of
      // three feeds is misconfigured and the other two worked.
      status: failures.length > 0 && results.length > 0 ? 207 : failures.length > 0 ? 502 : 200,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error.' },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
