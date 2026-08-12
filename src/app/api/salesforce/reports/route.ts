import { NextResponse } from 'next/server';
import { SalesforceError, getAccessToken, salesforceConfig } from '@/lib/salesforce';
import { listReports } from '@/lib/salesforce-reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Every report the connected user can see, so one can be picked from a list. */
export async function GET() {
  const config = salesforceConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: 'Salesforce is not connected.',
        remedy: 'Add the SALESFORCE_ environment variables in Vercel, then redeploy.',
      },
      { status: 400 },
    );
  }

  try {
    const token = await getAccessToken(config);
    const reports = await listReports(config, token);
    return NextResponse.json({ reports, count: reports.length });
  } catch (err) {
    if (err instanceof SalesforceError) {
      return NextResponse.json(
        { error: err.message, remedy: err.remedy },
        { status: err.status && err.status < 500 ? 400 : 502 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error.' },
      { status: 500 },
    );
  }
}
