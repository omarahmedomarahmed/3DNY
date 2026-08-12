/**
 * Tile the whole city, not just the buildings we hold records for.
 *
 *   npx tsx scripts/build-3dtiles.ts
 *   npx tsx scripts/build-3dtiles.ts --bbox=-74.02,40.70,-73.93,40.79 --out=public/3dtiles
 *
 * ## What this replaces
 *
 * `fetch-lod2-massing.ts` slices the city's survey down to our own towers and
 * writes one flat JSON file. That is exactly right for seventy-three buildings
 * and does not survive contact with forty thousand: the browser would have to
 * download, parse and upload every building in Manhattan before drawing one,
 * including all the ones behind the camera.
 *
 * So the same source — NYC's 2014 CityGML, read over range requests without
 * downloading the 916 MB archive — comes out the other side as **3-D Tiles**: a
 * quadtree of `.glb` nodes with geometric errors, which the renderer walks each
 * frame, loading only what would otherwise be visibly wrong. It is the format
 * both Cesium's and Esri's New York demos use, and for the same reason.
 *
 * The output is a directory of small files that a CDN can cache individually
 * and forever, rather than one asset that has to be re-fetched whole whenever
 * any part of it changes.
 *
 * ## What is and is not invented
 *
 * Every vertex is the city's own survey. Buildings the 2014 capture predates
 * are simply absent from the tileset, exactly as they are absent from the flat
 * asset, and Explore falls back to extruding their footprint. Nothing is
 * guessed and no building is given a shape it does not have.
 *
 * ## Cost
 *
 * Manhattan is a handful of the archive's tiles. Expect several hundred
 * megabytes of transfer and a few minutes, once — and then a `public/3dtiles`
 * directory that is gitignored and regenerated the same way the flat asset is.
 */

import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvLocal } from './env-local';
import {
  binOf,
  envelopeOf,
  surfacesOf,
  toMassing,
  type Massing,
  type Tile,
} from '@/lib/citygml';
import {
  SOURCE_PAGE,
  SURVEY_YEAR,
  centralDirectory,
  dataStart,
  sniffEnvelope,
  streamTile,
  zipLength,
} from './citygml-zip';
import { makeFrame, toLocal } from '@/lib/explore/frame';
import { massingToArrays } from '@/lib/explore/lod2';
import { writeGlb } from '@/lib/explore/glb';
import {
  buildTree,
  flatten,
  mergeNode,
  toTilesetJson,
  type TiledBuilding,
} from '@/lib/explore/tiling';

/**
 * The anchor has to be the app's, not a default of our own.
 *
 * `NEXT_PUBLIC_MAP_CENTER` lives in `.env.local`, which a plain `tsx` run does
 * not read — so the first build of this tileset was anchored 250 m from where
 * the scene is and the runtime frame check refused it. That refusal is the
 * feature working; this is the fix, and it has two halves, because the first
 * one alone was not enough:
 *
 *  - load `.env.local` when there is one, so a configured centre wins;
 *  - and when there is not, fall back to the *same* literal `MapView` falls
 *    back to. That was the actual bug: this script carried its own idea of the
 *    default, 250 m from `MapView`'s, and with the variable unset the two
 *    disagreed every time.
 *
 * `--anchor=lon,lat` overrides both, for building a tileset for a scene this
 * checkout is not configured for.
 */
loadEnvLocal();

const args = process.argv.slice(2);
const value = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const OUT = value('out') ?? 'public/3dtiles';

/**
 * Manhattan, by default.
 *
 * The frame's origin has to match the one `ExploreLayer` builds at runtime or
 * every tile lands in the wrong place, so it is taken from the same
 * environment variable the map's centre comes from.
 */
const BBOX = (value('bbox') ?? '-74.025,40.700,-73.925,40.800')
  .split(',')
  .map(Number) as [number, number, number, number];

/**
 * Keep this in step with `DEFAULT_CENTER` in `src/components/map/MapView.tsx`.
 * A tileset built at a different anchor is refused at runtime, by design.
 */
const DEFAULT_CENTER: [number, number] = [-73.98, 40.75];

function parseCenter(raw: string | undefined): [number, number] | null {
  const parts = (raw ?? '').split(',').map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return [parts[0], parts[1]];
  }
  return null;
}

async function main() {
  const anchor =
    parseCenter(value('anchor')) ??
    parseCenter(process.env.NEXT_PUBLIC_MAP_CENTER) ??
    DEFAULT_CENTER;
  const frame = makeFrame(anchor[0], anchor[1]);
  console.log(`Frame anchored at ${anchor[0]}, ${anchor[1]}.`);

  const size = await zipLength();
  const entries = (await centralDirectory(size)).filter((e) => e.name.endsWith('.gml'));
  console.log(`${entries.length} tiles in the published archive (${(size / 1e6).toFixed(0)} MB).`);

  // Which archive tiles overlap the bbox. `pickTiles` takes points, so the
  // bbox's four corners plus a grid across it is the cheapest way to be sure
  // nothing in the middle is missed on a bbox larger than a tile.
  const probes: [number, number][] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      probes.push([
        BBOX[0] + ((BBOX[2] - BBOX[0]) * i) / steps,
        BBOX[1] + ((BBOX[3] - BBOX[1]) * j) / steps,
      ]);
    }
  }

  const starts = new Map<string, number>();
  const tiles: Tile[] = [];
  for (const entry of entries) {
    const start = await dataStart(entry);
    starts.set(entry.name, start);
    const bbox = envelopeOf(await sniffEnvelope(entry, start));
    if (!bbox) continue;
    tiles.push({ name: entry.name.replace(/^.*\/|_.*$/g, ''), entry: entry.name, bbox });
  }

  const { pickTiles } = await import('@/lib/citygml');
  const needed = pickTiles(tiles, probes);
  const bytes = needed.reduce(
    (n, t) => n + (entries.find((e) => e.name === t.entry)?.compressedSize ?? 0),
    0,
  );
  console.log(
    `${needed.length} tiles overlap the bbox — about ${(bytes / 1e6).toFixed(0)} MB to stream.`,
  );

  // --- Stream, parse, project.
  const buildings: TiledBuilding[] = [];
  let seen = 0;
  let usable = 0;

  for (const tile of needed) {
    const entry = entries.find((e) => e.name === tile.entry);
    if (!entry) continue;
    const start = starts.get(entry.name);
    if (start === undefined) continue;

    console.log(`  ${tile.name}…`);
    await streamTile(entry, start, (member) => {
      seen++;
      const bin = binOf(member);
      if (!bin) return;
      const massing: Massing | null = toMassing(surfacesOf(member));
      if (!massing) return;

      const arrays = massingToArrays(frame, massing);
      if (arrays.triangles === 0) return;

      // Outside the bbox is another borough's building that happened to share
      // an archive tile.
      const [ax, ay] = toLocal(frame, massing.anchor[0], massing.anchor[1]);
      const [w, s, e, n] = BBOX;
      if (
        massing.anchor[0] < w ||
        massing.anchor[0] > e ||
        massing.anchor[1] < s ||
        massing.anchor[1] > n
      ) {
        return;
      }

      usable++;
      buildings.push({
        position: arrays.position,
        normal: arrays.normal,
        index: arrays.index,
        cx: ax,
        cy: ay,
        height: massing.topM,
      });
    });
    console.log(`    ${usable} usable of ${seen} seen so far`);
  }

  if (buildings.length === 0) {
    throw new Error('No buildings survived. Refusing to write an empty tileset.');
  }

  // --- The tree.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of buildings) {
    minX = Math.min(minX, b.cx);
    maxX = Math.max(maxX, b.cx);
    minY = Math.min(minY, b.cy);
    maxY = Math.max(maxY, b.cy);
  }
  // Square and padded, so the quadtree's halving stays square all the way down.
  const span = Math.max(maxX - minX, maxY - minY) * 1.02;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rootBounds: [number, number, number, number] = [
    cx - span / 2,
    cy - span / 2,
    cx + span / 2,
    cy + span / 2,
  ];

  const root = buildTree(buildings, rootBounds);
  const nodes = flatten(root).filter((n) => n.buildings.length > 0);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  let totalBytes = 0;
  let totalTriangles = 0;
  for (const node of nodes) {
    const merged = mergeNode(node);
    const glb = writeGlb(merged);
    await writeFile(join(OUT, `${node.key}.glb`), glb);
    totalBytes += glb.byteLength;
    totalTriangles += merged.index.length / 3;
  }

  await writeFile(
    join(OUT, 'tileset.json'),
    JSON.stringify(toTilesetJson(root), null, 1),
  );

  /**
   * The frame the tileset was built in, written beside it.
   *
   * Every vertex is metres from a specific lon/lat, and a tileset placed at a
   * different anchor is a city several hundred metres from where it should be.
   * The renderer reads this and refuses to draw if it disagrees, which is far
   * better than drawing Manhattan in the Hudson.
   */
  await writeFile(
    join(OUT, 'frame.json'),
    JSON.stringify(
      {
        anchor,
        bbox: BBOX,
        buildings: buildings.length,
        source: SOURCE_PAGE,
        surveyYear: SURVEY_YEAR,
        generatedAt: new Date().toISOString(),
      },
      null,
      1,
    ),
  );

  console.log(
    `\nWrote ${nodes.length} tiles to ${OUT} — ${buildings.length} buildings, ` +
      `${totalTriangles.toLocaleString()} triangles, ${(totalBytes / 1e6).toFixed(1)} MB.`,
  );
  console.log(
    'The largest single tile is what a first paint costs; everything else ' +
      'arrives as the camera asks for it.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
