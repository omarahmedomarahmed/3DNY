import { NextResponse } from 'next/server';
import { SalesforceError, getAccessToken, salesforceConfig } from '@/lib/salesforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Does the Salesforce connection actually work?
 *
 * Not "are the environment variables set" — that is the easy half and the half
 * that is usually fine. This exchanges the credentials for a token and asks the
 * org who it thinks we are, because the failures that waste an afternoon all
 * live past that point: a connected app without the Client Credentials Flow
 * enabled, a run-as user nobody assigned, a sandbox URL in a production
 * variable, an expired secret.
 *
 * Every failure comes back with a remedy. Somebody reading this on the setup
 * page has admin access to Salesforce and no reason to know what a client
 * credentials grant is.
 */

interface Identity {
  organization_id?: string;
  username?: string;
  display_name?: string;
  urls?: { profile?: string };
}

export async function GET() {
  const config = salesforceConfig();

  const present = {
    SALESFORCE_INSTANCE_URL: Boolean(process.env.SALESFORCE_INSTANCE_URL?.trim()),
    SALESFORCE_CLIENT_ID: Boolean(process.env.SALESFORCE_CLIENT_ID?.trim()),
    SALESFORCE_CLIENT_SECRET: Boolean(process.env.SALESFORCE_CLIENT_SECRET?.trim()),
  };

  if (!config) {
    return NextResponse.json({
      configured: false,
      connected: false,
      present,
      error: 'Salesforce is not connected yet.',
      remedy:
        'Add the three SALESFORCE_ variables in Vercel → Settings → Environment Variables, ' +
        'then redeploy. Until then the CSV import does the same job by hand.',
    });
  }

  try {
    const token = await getAccessToken(config);

    // Who did we just connect as? The single most useful line on the page:
    // it catches "the credentials work, but they are for the sandbox" and
    // "the run-as user is not the one whose reports we need".
    let identity: Identity = {};
    try {
      const res = await fetch(`${config.instanceUrl}/services/oauth2/userinfo`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) identity = (await res.json()) as Identity;
    } catch {
      // Identity is a nicety. A working token is the answer to the question
      // that was asked, and failing the whole check over the follow-up would
      // report a working connection as broken.
    }

    return NextResponse.json({
      configured: true,
      connected: true,
      present,
      instanceUrl: config.instanceUrl,
      sandbox: /sandbox|--\w+\.sandbox|\.cs\d+\./i.test(config.instanceUrl),
      organizationId: identity.organization_id ?? null,
      runAsUser: identity.username ?? identity.display_name ?? null,
    });
  } catch (err) {
    if (err instanceof SalesforceError) {
      return NextResponse.json({
        configured: true,
        connected: false,
        present,
        instanceUrl: config.instanceUrl,
        error: err.message,
        remedy: err.remedy,
      });
    }
    return NextResponse.json({
      configured: true,
      connected: false,
      present,
      error: err instanceof Error ? err.message : 'Unexpected error.',
      remedy: 'Retry. If it persists, check the connected app in Salesforce Setup.',
    });
  }
}
