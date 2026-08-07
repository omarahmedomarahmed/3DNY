import { NextResponse } from 'next/server';
import { saveAlias, upsertBuilding } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  if (message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

interface AliasBody {
  rawAddress?: string;
  buildingId?: string;
  addressDisplay?: string;
  buildingName?: string | null;
  bin?: string | null;
  bbl?: string | null;
  lon?: number | null;
  lat?: number | null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AliasBody;
    if (!body?.rawAddress) {
      return NextResponse.json({ error: 'rawAddress is required.' }, { status: 400 });
    }

    let buildingId = body.buildingId;

    if (!buildingId) {
      if (!body.addressDisplay) {
        return NextResponse.json(
          { error: 'Send either buildingId, or addressDisplay for a new building.' },
          { status: 400 },
        );
      }
      buildingId = await upsertBuilding({
        addressDisplay: body.addressDisplay,
        buildingName: body.buildingName ?? null,
        bin: body.bin ?? null,
        bbl: body.bbl ?? null,
        lon: body.lon ?? null,
        lat: body.lat ?? null,
        class: null,
        submarket: null,
        submarketCluster: null,
        matchConfidence: 'manual',
      });
    }

    await saveAlias(body.rawAddress, buildingId);
    return NextResponse.json({ buildingId });
  } catch (err) {
    return fail(err);
  }
}
