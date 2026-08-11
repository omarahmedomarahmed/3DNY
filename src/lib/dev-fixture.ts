import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildingWithSpaces } from '@/types';

/**
 * The development stand-in for the database.
 *
 * This exists because the Explore mode work is judged on what it looks like,
 * and a development container has no Neon connection string — which would
 * otherwise mean an empty map, no screenshots, and none of the existing
 * browser harnesses runnable at all.
 *
 * It is off unless `SPACES_FIXTURE_DB=1` is in the environment. Production
 * sets `DATABASE_URL` and does not set this, so the live map cannot reach it
 * even if the flag were somehow present: the database is still tried first and
 * the fixture is only a fallback for the flag, never for a database failure.
 * A broker must never be shown invented availability because a query timed out.
 *
 * Geometry, BINs, heights, floor counts and years are real, from NYC Open
 * Data. The availability rows are invented development scaffolding and every
 * one of them says so in its own notes field — see
 * `scripts/make-dev-fixture.ts`.
 */

export function fixtureEnabled(): boolean {
  return process.env.SPACES_FIXTURE_DB === '1';
}

let cached: BuildingWithSpaces[] | null = null;

export async function fixtureBuildings(): Promise<BuildingWithSpaces[]> {
  if (cached) return cached;
  const raw = await readFile(join(process.cwd(), 'fixtures', 'dev-buildings.json'), 'utf8');
  const parsed = JSON.parse(raw) as { buildings: BuildingWithSpaces[] };
  cached = parsed.buildings;
  return cached;
}
