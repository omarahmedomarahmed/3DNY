import { NextResponse } from 'next/server';
import { geocodeAddress } from '@/lib/address-matcher';
import { parseAvailabilityCsv } from '@/lib/csv-parser';
import { findAlias } from '@/lib/queries';
import type { MatchedRow, ParsedRow } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Geocoding runs sequentially against NYC Geosearch; a full sheet takes a while.
export const maxDuration = 60;

type Match = MatchedRow['match'];

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  if (message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

async function readInput(req: Request): Promise<{ text: string; filename: string }> {
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new Error('No file was uploaded. Attach the sheet as the "file" field.');
    }
    return { text: await file.text(), filename: file.name || 'upload.csv' };
  }

  const body = (await req.json()) as { text?: string; filename?: string };
  if (!body?.text) {
    throw new Error('Send either a multipart "file" field or JSON { text, filename }.');
  }
  return { text: body.text, filename: body.filename || 'pasted.csv' };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One match per distinct address. A hand-made alias always wins over the
 * geocoder — that is the whole point of recording it.
 */
async function matchAddresses(rows: ParsedRow[]): Promise<Map<string, Match>> {
  const representative = new Map<string, string>();
  for (const row of rows) {
    if (!representative.has(row.addressDisplay)) {
      representative.set(row.addressDisplay, row.addressRaw);
    }
  }

  const matches = new Map<string, Match>();
  let first = true;

  for (const [display, raw] of representative) {
    const aliasId =
      (await findAlias(raw)) ?? (raw === display ? null : await findAlias(display));

    if (aliasId) {
      matches.set(display, {
        confidence: 'manual',
        bin: null,
        bbl: null,
        lon: null,
        lat: null,
        resolvedAddress: display,
        buildingId: aliasId,
        explanation: 'Previously matched by hand.',
      });
      continue;
    }

    if (!first) await sleep(120);
    first = false;

    const geo = await geocodeAddress(display);
    matches.set(display, { ...geo, buildingId: null });
  }

  return matches;
}

export async function POST(req: Request) {
  try {
    const { text, filename } = await readInput(req);
    const result = parseAvailabilityCsv(text);

    if (result.errors.length > 0) {
      return NextResponse.json(
        { error: result.errors.join(' '), errors: result.errors },
        { status: 400 },
      );
    }

    const matches = await matchAddresses(result.rows);
    const rows: MatchedRow[] = result.rows.map((row) => ({
      ...row,
      match: matches.get(row.addressDisplay)!,
    }));

    const count = (c: string) => rows.filter((r) => r.match.confidence === c).length;

    return NextResponse.json({
      marketLabel: result.marketLabel,
      filename,
      duplicatesRemoved: result.duplicatesRemoved,
      rows,
      summary: {
        total: rows.length,
        exact: count('exact'),
        fuzzy: count('fuzzy'),
        manual: count('manual'),
        unmatched: count('unmatched'),
      },
    });
  } catch (err) {
    return fail(err);
  }
}
