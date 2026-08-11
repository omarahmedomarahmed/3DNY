/**
 * Slice NYC's 3-D Building Model down to the buildings we hold records for.
 *
 *   npx tsx scripts/fetch-lod2-massing.ts [--dry-run] [--out=path] [--bin=…]
 *                                         [--from=fixtures/dev-buildings.json]
 *
 * The citywide CityGML zip is 916 MB and inflates to about 13 GB. None of that
 * is downloaded. The zip's central directory is read over HTTP range requests,
 * each tile's `<gml:Envelope>` is sniffed from its first few kilobytes, and only
 * the tiles that could contain one of our buildings are streamed and inflated.
 * For the current 73 buildings that is four tiles and roughly 230 MB of
 * transfer, producing an asset of about 200 KB.
 *
 * Nothing here is invented: every vertex comes from the city's own survey, and
 * a building the survey predates is simply reported as missing so the renderer
 * can fall back to extruding its footprint.
 */

import { createInflateRaw } from 'node:zlib';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadEnvLocal } from './env-local';
import { sql } from '@/lib/db';
import {
  binOf, surfacesOf, toMassing, envelopeOf, pickTiles, splitMembers,
  type Massing, type Tile,
} from '@/lib/citygml';

// `sql()` reads DATABASE_URL when it is first called, not when it is imported,
// so loading the file here is early enough.
loadEnvLocal();

const ZIP_URL = 'https://s-media.nyc.gov/agencies/oti/DA_WISE_GML.zip';
const SOURCE_PAGE = 'https://catalog.data.gov/dataset/3-d-building-model';
const SURVEY_YEAR = 2014;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const DRY_RUN = flag('dry-run');
const OUT = value('out') ?? 'public/lod2/massing.json';
const ONLY_BINS = value('bin')?.split(',').map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// HTTP range reads against the published zip
// ---------------------------------------------------------------------------

async function range(from: number, to: number): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(ZIP_URL, { headers: { Range: `bytes=${from}-${to}` } });
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

async function zipLength(): Promise<number> {
  const res = await fetch(ZIP_URL, { method: 'HEAD' });
  const len = Number(res.headers.get('content-length'));
  if (!Number.isFinite(len) || len <= 0) throw new Error('the zip did not report a length');
  return len;
}

interface Entry { name: string; headerOffset: number; compressedSize: number }

/** Read the zip's central directory without downloading the archive. */
async function centralDirectory(size: number): Promise<Entry[]> {
  const tail = await range(Math.max(0, size - 70_000), size - 1);
  const eocd = tail.lastIndexOf('PK\x05\x06', tail.length, 'binary');
  if (eocd < 0) throw new Error('no end-of-central-directory record; is the URL still a zip?');

  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  const cd = await range(cdOffset, cdOffset + cdSize - 1);

  const entries: Entry[] = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const compressedSize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    entries.push({
      name: cd.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
      headerOffset: cd.readUInt32LE(p + 42),
      compressedSize,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Where an entry's deflate stream actually starts, past its local header. */
async function dataStart(entry: Entry): Promise<number> {
  const head = await range(entry.headerOffset, entry.headerOffset + 29);
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`bad local header for ${entry.name}`);
  return entry.headerOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
}

/**
 * Inflate the head of a tile far enough to read the envelope it opens with.
 * The CityGML preamble is a single line of thirty namespace declarations, so
 * the envelope can sit several kilobytes in; read generously and stop on the
 * closing tag rather than on a byte count, or a tile gets silently skipped.
 */
async function sniffEnvelope(entry: Entry, start: number) {
  const head = await range(start, start + Math.min(entry.compressedSize, 65_536) - 1);
  return new Promise<string>((resolve, reject) => {
    let text = '';
    let settled = false;
    const inflate = createInflateRaw();
    const finish = () => { if (!settled) { settled = true; resolve(text); } };
    inflate.setEncoding('utf8');
    inflate.on('data', (chunk: string) => {
      text += chunk;
      if (text.includes('</gml:Envelope>') || text.length > 131_072) inflate.destroy();
    });
    inflate.on('end', finish);
    inflate.on('close', finish);
    // A truncated deflate stream always ends in an error; that is expected here,
    // and whatever inflated before it is exactly what we came for.
    inflate.on('error', (e) => (text ? finish() : reject(e)));
    inflate.end(head);
  });
}

/** Stream one tile, handing every `<bldg:Building>` block to `onMember`. */
async function streamTile(
  entry: Entry,
  start: number,
  onMember: (member: string) => void,
): Promise<number> {
  const res = await fetch(ZIP_URL, {
    headers: { Range: `bytes=${start}-${start + entry.compressedSize - 1}` },
  });
  if (!res.body) throw new Error(`no body for ${entry.name}`);

  const inflate = createInflateRaw();
  let buffer = '';
  let count = 0;
  inflate.setEncoding('utf8');
  inflate.on('data', (chunk: string) => {
    buffer += chunk;
    const { members, rest } = splitMembers(buffer);
    buffer = rest;
    for (const m of members) { onMember(m); count++; }
  });

  const done = new Promise<void>((resolve, reject) => {
    inflate.on('end', resolve);
    inflate.on('error', reject);
  });

  const reader = res.body.getReader();
  for (;;) {
    const { done: finished, value: chunk } = await reader.read();
    if (finished) break;
    if (!inflate.write(Buffer.from(chunk))) {
      await new Promise((r) => inflate.once('drain', r));
    }
  }
  inflate.end();
  await done;
  return count;
}

// ---------------------------------------------------------------------------

/**
 * Where the list of buildings to look for comes from.
 *
 * Normally the database. `--from=<file>` reads the same three fields out of a
 * JSON array instead, which is what lets this run on a machine with no
 * connection string — a development container, or anyone reproducing the asset
 * from the checked-in fixture. Nothing about the fetch or the parsing changes;
 * only where the BINs come from.
 */
async function wantedRows(): Promise<
  { bin: string; address_display: string; lon: number; lat: number }[]
> {
  const from = value('from');
  if (from) {
    const raw = await readFile(from, 'utf8');
    const parsed = JSON.parse(raw) as { buildings?: unknown[] } | unknown[];
    const list = (Array.isArray(parsed) ? parsed : parsed.buildings ?? []) as {
      bin?: string | null; address_display?: string; lon?: number | null; lat?: number | null;
    }[];
    return list
      .filter((b) => b.bin && b.lon !== null && b.lat !== null)
      .map((b) => ({
        bin: b.bin as string,
        address_display: b.address_display ?? b.bin as string,
        lon: b.lon as number,
        lat: b.lat as number,
      }));
  }

  return (await sql()`
    SELECT bin, address_display,
           ST_X(centroid::geometry) AS lon, ST_Y(centroid::geometry) AS lat
    FROM buildings
    WHERE bin IS NOT NULL AND centroid IS NOT NULL
    ORDER BY address_display`) as {
      bin: string; address_display: string; lon: number; lat: number;
    }[];
}

async function main() {
  const rows = await wantedRows();

  const wanted = ONLY_BINS ? rows.filter((r) => ONLY_BINS.includes(r.bin)) : rows;
  if (wanted.length === 0) {
    console.error('No buildings with a BIN and a centroid. Nothing to fetch.');
    process.exit(1);
  }
  console.log(`${wanted.length} buildings to look for.`);

  const size = await zipLength();
  const entries = (await centralDirectory(size)).filter((e) => e.name.endsWith('.gml'));
  console.log(`${entries.length} tiles in the published archive (${(size / 1e6).toFixed(0)} MB).`);

  const starts = new Map<string, number>();
  const tiles: Tile[] = [];
  for (const entry of entries) {
    const start = await dataStart(entry);
    starts.set(entry.name, start);
    const bbox = envelopeOf(await sniffEnvelope(entry, start));
    if (!bbox) { console.warn(`  ${entry.name}: no envelope, skipping`); continue; }
    tiles.push({ name: entry.name.replace(/^.*\/|_.*$/g, ''), entry: entry.name, bbox });
  }

  const needed = pickTiles(tiles, wanted.map((r) => [r.lon, r.lat] as [number, number]));
  const bytes = needed.reduce(
    (n, t) => n + (entries.find((e) => e.name === t.entry)?.compressedSize ?? 0), 0);
  console.log(
    `${needed.length} tiles cover them: ${needed.map((t) => t.name).join(', ')} ` +
    `(${(bytes / 1e6).toFixed(0)} MB to download).`);

  if (DRY_RUN) { console.log('\n--dry-run: stopping before the download.'); return; }

  const want = new Map(wanted.map((r) => [r.bin, r]));
  const found = new Map<string, Massing>();
  let scanned = 0;

  for (const tile of needed) {
    const entry = entries.find((e) => e.name === tile.entry)!;
    const before = found.size;
    const n = await streamTile(entry, starts.get(entry.name)!, (member) => {
      const bin = binOf(member);
      if (!bin || !want.has(bin) || found.has(bin)) return;
      const massing = toMassing(surfacesOf(member));
      if (massing) found.set(bin, massing);
    });
    scanned += n;
    console.log(
      `  ${tile.name}: ${n.toLocaleString()} buildings scanned, ` +
      `+${found.size - before} of ours (${found.size}/${want.size})`);
  }

  const missing = [...want.values()].filter((r) => !found.has(r.bin));
  const surfaces = [...found.values()].reduce((n, m) => n + m.surfaces.length, 0);

  const asset = {
    version: 1,
    source: 'NYC 3-D Building Model',
    sourceUrl: SOURCE_PAGE,
    surveyYear: SURVEY_YEAR,
    note:
      'Massing only — no windows, no textures. A one-time capture, so buildings ' +
      'completed after the survey are absent and must fall back to an extruded footprint.',
    buildings: Object.fromEntries(found),
    missing: missing.map((r) => ({ bin: r.bin, address: r.address_display })),
  };

  const json = JSON.stringify(asset);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, json);

  console.log(
    `\n${scanned.toLocaleString()} buildings scanned across ${needed.length} tiles.\n` +
    `Matched ${found.size} of ${want.size}. ${surfaces.toLocaleString()} surfaces.\n` +
    `Wrote ${OUT} — ${(json.length / 1e6).toFixed(2)} MB.`);

  if (missing.length > 0) {
    console.log(
      `\n${missing.length} not in the model, almost certainly built after ${SURVEY_YEAR}:`);
    for (const r of missing) console.log(`  ${r.address_display}  (BIN ${r.bin})`);
    console.log('These fall back to the extruded footprint. That is expected, not a failure.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
