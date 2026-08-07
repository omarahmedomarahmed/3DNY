import { NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db';
import {
  DEFAULT_BRAND_SETTINGS,
  getBrandSettings,
  saveBrandSettings,
  type BrandSettingsPatch,
} from '@/lib/brand-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_DATABASE =
  'The database is not connected yet. Add DATABASE_URL in Vercel → Settings → ' +
  'Environment Variables and redeploy. See SETUP.md step 3.';

/**
 * GET never fails. Logo settings are read on every page render, so a database
 * problem returns the defaults rather than an error — the built-in mark shows
 * and the app keeps working.
 */
export async function GET() {
  try {
    const settings = await getBrandSettings();
    return NextResponse.json(settings, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(DEFAULT_BRAND_SETTINGS, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

/** PATCH saves. This one does report failure — the user pressed Save. */
export async function PATCH(req: Request) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ error: NO_DATABASE, needsSetup: true }, { status: 503 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Expected a JSON object.' }, { status: 400 });
    }

    const raw = body as Record<string, unknown>;
    const patch: BrandSettingsPatch = {};

    if ('logoUrl' in raw) {
      const v = raw.logoUrl;
      if (v === null || v === '') patch.logoUrl = null;
      else if (typeof v === 'string') patch.logoUrl = v;
      else return NextResponse.json({ error: 'logoUrl must be a string or null.' }, { status: 400 });
    }

    for (const key of [
      'logoScale',
      'logoOffsetX',
      'logoOffsetY',
      'logoHeight',
      'footerScale',
    ] as const) {
      if (!(key in raw)) continue;
      const n = Number(raw[key]);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: `${key} must be a number.` }, { status: 400 });
      }
      patch[key] = n;
    }

    const settings = await saveBrandSettings(patch);
    return NextResponse.json(settings, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not save the brand settings.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
