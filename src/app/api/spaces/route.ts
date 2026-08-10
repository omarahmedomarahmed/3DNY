import { NextResponse } from 'next/server';
import { createBuildingFromAddress, createSpace } from '@/lib/manual-entry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Adds one available space, by address.
 *
 * The address is the key, exactly as it is on a sheet — asking someone to pick
 * the building from a list first is asking them to already know whether it is
 * in the list. Send `buildingId` instead when you are already on a building's
 * page and the answer is not in question.
 *
 * `createBuilding: true` lets one call do both, which is the common case when
 * a floor comes up in a tower nobody has recorded yet. Without it, an unknown
 * address is an error rather than a silent new building: creating a tower as a
 * side effect of adding a floor to it is how duplicates appear.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      buildingId?: string;
      address?: string;
      createBuilding?: boolean;
      floor?: string;
      [key: string]: unknown;
    };

    if (!body?.floor || !String(body.floor).trim()) {
      return NextResponse.json(
        { error: 'A floor is required — "14", "Partial 45th", "Entire 8".' },
        { status: 400 },
      );
    }

    let buildingId = body.buildingId ?? null;
    let buildingCreated = false;

    if (!buildingId) {
      if (!body.address || !body.address.trim()) {
        return NextResponse.json(
          { error: 'Either a buildingId or an address is required.' },
          { status: 400 },
        );
      }
      const resolved = await createBuildingFromAddress({ address: body.address.trim() });
      if (resolved.created && !body.createBuilding) {
        // Reachable only if the resolve step and this one disagree, which means
        // the address was genuinely new. Saying so beats quietly adding a tower.
        return NextResponse.json(
          {
            error: `No building at "${body.address.trim()}" yet.`,
            remedy: 'Add the building first, or send createBuilding: true to do both at once.',
          },
          { status: 404 },
        );
      }
      buildingId = resolved.building.id;
      buildingCreated = resolved.created;
    }

    const space = await createSpace({
      buildingId,
      floor: String(body.floor),
      sf: body.sf as string | number | null,
      askingRent: body.askingRent as string | number | null,
      spaceUse: body.spaceUse as string | null,
      leaseType: body.leaseType as 'direct' | 'sublet' | null,
      availableFrom: body.availableFrom as string | null,
      termExpires: body.termExpires as string | null,
      leasingCompany: body.leasingCompany as string | null,
      notes: body.notes as string | null,
    });

    return NextResponse.json({ space, buildingId, buildingCreated }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    if (message.includes('DATABASE_URL')) {
      return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
