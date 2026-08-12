/**
 * Reading NYC's citywide CityGML archive without downloading it.
 *
 * The published zip is 916 MB and inflates to about 13 GB. None of that is
 * downloaded: the zip's central directory is read over HTTP range requests,
 * each tile's `<gml:Envelope>` is sniffed from its first few kilobytes, and
 * only the tiles that could contain a building of interest are streamed and
 * inflated.
 *
 * This was inline in `fetch-lod2-massing.ts` until the 3-D Tiles build step
 * needed exactly the same reader — one for our own towers, one for the whole
 * island. Two copies of a range-request zip parser is how the two quietly
 * disagree about a byte offset.
 */

import { createInflateRaw } from 'node:zlib';
import { envelopeOf, splitMembers, type Tile } from '@/lib/citygml';

export const ZIP_URL = 'https://s-media.nyc.gov/agencies/oti/DA_WISE_GML.zip';
export const SOURCE_PAGE = 'https://catalog.data.gov/dataset/3-d-building-model';
export const SURVEY_YEAR = 2014;

// ---------------------------------------------------------------------------
// HTTP range reads against the published zip
// ---------------------------------------------------------------------------

export async function range(from: number, to: number): Promise<Buffer> {
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

export async function zipLength(): Promise<number> {
  const res = await fetch(ZIP_URL, { method: 'HEAD' });
  const len = Number(res.headers.get('content-length'));
  if (!Number.isFinite(len) || len <= 0) throw new Error('the zip did not report a length');
  return len;
}

export interface Entry { name: string; headerOffset: number; compressedSize: number }

/** Read the zip's central directory without downloading the archive. */
export async function centralDirectory(size: number): Promise<Entry[]> {
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
export async function dataStart(entry: Entry): Promise<number> {
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
export async function sniffEnvelope(entry: Entry, start: number) {
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
export async function streamTile(
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
