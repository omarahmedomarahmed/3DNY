/**
 * Loads Manhattan office availability from the pages the landlords publish.
 *
 *   npx tsx scripts/load-landlord-availability.ts --dry-run
 *   npx tsx scripts/load-landlord-availability.ts --replace
 *
 * Without `--replace` this merges: a floor already on the map is updated, a
 * new one is added, and anything the feeds no longer carry is left alone.
 * With `--replace` the run IS the inventory — every imported space the run did
 * not carry is taken off the market (retired, never deleted), which is what
 * you want when the point is to clear out stale listings. Spaces somebody
 * typed in by hand are never touched either way.
 *
 * Flags:
 *   --dry-run          fetch and parse, print what would happen, write nothing
 *   --replace          retire imported spaces this run did not carry
 *   --only=slgreen,esrt   restrict to some feeds
 *   --no-geocode       skip address matching (dry-run inspection only)
 *
 * On being a good citizen: every request identifies itself, and each feed
 * waits the crawl delay its own robots.txt asks for — ten seconds for SL
 * Green, which is why a full run takes a couple of minutes rather than a
 * couple of seconds. None of these sites disallows the pages being read; they
 * are published to be read.
 */
import { loadEnvLocal } from './env-local';
import { geocodeAddress, geocodeAll, resetGeosearchHealth } from '@/lib/address-matcher';
import {
  LANDLORD_FEEDS,
  listingKey,
  toParsedRows,
  type FeedListing,
  type FeedSource,
} from '@/lib/landlord-feeds';
import { commitImport, retireSpacesOutside } from '@/lib/queries';
import type { MatchedRow, ParsedRow } from '@/types';

loadEnvLocal();

const USER_AGENT =
  'CresaSpaces/1.0 (commercial availability map; contact via cresa.com)';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const value = (name: string): string | null => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const DRY_RUN = has('--dry-run');
const REPLACE = has('--replace');
const SKIP_GEOCODE = has('--no-geocode');
const ONLY = (value('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const n = (v: number) => v.toLocaleString('en-US');

/**
 * One page, with a few goes at it.
 *
 * These are marketing sites, not APIs; a 503 in the middle of a run is a
 * Tuesday, not a fault. Backing off and asking again costs seconds and saves
 * the whole run.
 */
async function fetchPage(url: string, attempts = 3): Promise<string> {
  let last: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(2000 * 2 ** (i - 1));
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      last = err as Error;
    }
  }
  throw new Error(`${last?.message ?? 'fetch failed'} for ${url}`);
}

/**
 * Every listing a feed publishes, page by page.
 *
 * Stops on the first page that parses to nothing, or at the page count the
 * site prints, or at the feed's own ceiling — whichever comes first. A feed
 * whose FIRST page parses to nothing throws, because that is what a template
 * change looks like from here, and a silent zero would read on the map as
 * "this landlord has no space available" rather than "this parser broke".
 */
async function collect(source: FeedSource): Promise<FeedListing[]> {
  const all: FeedListing[] = [];
  const seen = new Set<string>();
  let pages = source.maxPages;

  for (let page = 0; page < pages; page++) {
    const url = source.pageUrl(page);
    const html = await fetchPage(url);

    if (page === 0 && source.totalPages) {
      pages = Math.min(source.totalPages(html), source.maxPages);
    }

    const listings = source.parse(html);
    if (listings.length === 0) {
      if (page === 0) {
        throw new Error(
          `${source.key}: parsed 0 listings from ${url}. The page's markup has ` +
            'probably changed — fix the parser rather than loading an empty market.',
        );
      }
      break;
    }

    // A feed that ignores its own page parameter would otherwise repeat page
    // one until the ceiling. De-duplicating on the listing itself catches that
    // whatever the cause.
    let fresh = 0;
    for (const listing of listings) {
      const key = listingKey(listing);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(listing);
      fresh++;
    }

    process.stdout.write(
      `  ${source.key} page ${page + 1}/${pages}: ${listings.length} listings, ${fresh} new\n`,
    );
    if (fresh === 0) break;
    if (page < pages - 1) await sleep(source.crawlDelayS * 1000);
  }

  return all;
}

/**
 * Address matching, as the importer's review step does it — then again.
 *
 * The second pass is the point. Geosearch is the authoritative source and it
 * is sometimes slow rather than down; the first timeout trips a breaker that
 * routes the rest of the batch to AddressPoint, which does not carry every
 * address. On the first run of this loader that cost four real buildings —
 * 110 Greene Street, 15 Laight Street, 130 Mercer Street — every one of which
 * Geosearch resolves perfectly when asked again.
 *
 * That breaker is right for an import somebody is waiting on: a broker with a
 * client does not want to watch a slow service time out forty times. A batch
 * job has no one waiting, so it clears the breaker and retries the failures
 * one at a time, slowly, which is also what keeps it from tripping again.
 */
/** Nobody is waiting on this run, so the authoritative source gets its time. */
const BATCH_GEOCODE_TIMEOUT_MS = 20_000;

async function match(rows: ParsedRow[]): Promise<MatchedRow[]> {
  const results = await geocodeAll(rows.map((r) => r.addressDisplay), undefined, {
    timeoutMs: BATCH_GEOCODE_TIMEOUT_MS,
  });

  const failed = [...results.entries()]
    .filter(([, hit]) => hit.confidence === 'unmatched')
    .map(([address]) => address);

  if (failed.length > 0) {
    process.stdout.write(`retrying ${failed.length} unresolved… `);
    for (const address of failed) {
      // Per address, not once for the batch. `geocodeAddress` trips the
      // breaker on its own first failure, so resetting only at the top means
      // address one gets Geosearch and every address after it silently falls
      // back to AddressPoint again — which is exactly what the retry exists
      // to escape.
      resetGeosearchHealth();
      try {
        const second = await geocodeAddress(address, {
          timeoutMs: BATCH_GEOCODE_TIMEOUT_MS,
        });
        if (second.confidence !== 'unmatched') results.set(address, second);
      } catch {
        // Keep the first pass's answer and its explanation.
      }
      await sleep(400);
    }
  }

  return rows.map((row) => {
    const hit = results.get(row.addressDisplay);
    return {
      ...row,
      match: {
        confidence: hit?.confidence ?? 'unmatched',
        bin: hit?.bin ?? null,
        bbl: hit?.bbl ?? null,
        lon: hit?.lon ?? null,
        lat: hit?.lat ?? null,
        resolvedAddress: hit?.resolvedAddress ?? null,
        buildingId: null,
        explanation: hit?.explanation ?? 'No match.',
      },
    };
  });
}

async function main() {
  const feeds = LANDLORD_FEEDS.filter((f) => ONLY.length === 0 || ONLY.includes(f.key));
  if (feeds.length === 0) throw new Error(`No feed matched --only=${ONLY.join(',')}`);

  console.log(
    `Reading ${feeds.length} landlord ${feeds.length === 1 ? 'feed' : 'feeds'}: ` +
      `${feeds.map((f) => f.key).join(', ')}\n`,
  );

  const parsed: { source: FeedSource; rows: ParsedRow[] }[] = [];
  const failures: { source: FeedSource; reason: string }[] = [];

  for (const source of feeds) {
    console.log(`${source.landlord} — ${source.listingUrl}`);

    let listings;
    try {
      listings = await collect(source);
    } catch (err) {
      // One landlord's site being down is not a reason to abandon the other
      // three — but it IS a reason not to replace the market. See below.
      failures.push({ source, reason: (err as Error).message });
      console.log(`  → could not read: ${(err as Error).message}\n`);
      continue;
    }

    const rows = toParsedRows(source, listings);
    parsed.push({ source, rows });

    const buildings = new Set(rows.map((r) => r.addressDisplay));
    const withRent = rows.filter((r) => r.askingRentPsf !== null).length;
    const withFloor = rows.filter((r) => r.floorNumber !== null).length;
    const sf = rows.reduce((sum, r) => sum + (r.sf ?? 0), 0);
    console.log(
      `  → ${n(rows.length)} listings, ${buildings.size} buildings, ${n(sf)} SF, ` +
        `${withFloor} with a floor number, ${withRent} with an asking rent\n`,
    );
  }

  if (parsed.length === 0) {
    throw new Error('No feed could be read. Nothing was written.');
  }

  const total = parsed.reduce((sum, p) => sum + p.rows.length, 0);
  const allBuildings = new Set(parsed.flatMap((p) => p.rows.map((r) => r.addressDisplay)));
  const totalSf = parsed.reduce(
    (sum, p) => sum + p.rows.reduce((s, r) => s + (r.sf ?? 0), 0),
    0,
  );
  console.log(
    `Total: ${n(total)} listings across ${allBuildings.size} buildings, ${n(totalSf)} SF.\n`,
  );

  if (DRY_RUN || SKIP_GEOCODE) {
    for (const { source, rows } of parsed) {
      console.log(`${source.key}:`);
      for (const row of rows.slice(0, 5)) {
        console.log(
          `  ${row.addressDisplay} — ${row.floorLabel} — ` +
            `${row.sf ? n(row.sf) + ' SF' : 'size not published'} — ` +
            `${row.askingRentPsf ? '$' + row.askingRentPsf : 'rent on request'}`,
        );
      }
      if (rows.length > 5) console.log(`  … and ${n(rows.length - 5)} more`);
    }
    console.log('\nDry run — nothing written.');
    return;
  }

  const importIds: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const { source, rows } of parsed) {
    process.stdout.write(`Matching ${source.key} addresses… `);
    const matched = await match(rows);
    const unmatched = matched.filter((r) => r.match.confidence === 'unmatched');
    console.log(
      `${matched.length - unmatched.length}/${matched.length} matched` +
        (unmatched.length
          ? `, skipping ${unmatched.length}: ` +
            [...new Set(unmatched.map((r) => r.addressDisplay))].join(', ')
          : ''),
    );

    const result = await commitImport(
      `${source.landlord} availabilities, ${today}`,
      'Manhattan',
      matched,
      { sourceKind: 'landlord', sourceUrl: source.listingUrl },
    );
    importIds.push(result.importId);
    console.log(
      `  committed: ${result.inserted} new, ${result.updated} updated, ${result.skipped} skipped\n`,
    );
  }

  /**
   * Replace only when the whole picture came back.
   *
   * `--replace` means "this run is the inventory", and that is only true if
   * every feed answered. Rudin's site returned 503 partway through a run while
   * this was being built; replacing on the strength of the other three would
   * have taken all fifty-six of Rudin's availabilities off the map, silently,
   * because their web server had a bad minute. The map would have looked fine.
   */
  if (REPLACE && failures.length > 0) {
    console.log(
      `\nNot replacing: ${failures.map((f) => f.source.landlord).join(', ')} could not be ` +
        'read this run, and replacing would take their space off the map. The feeds that ' +
        'did answer have been merged in. Re-run when they are back.',
    );
  } else if (REPLACE) {
    const { retired, keptByHand } = await retireSpacesOutside(importIds);
    console.log(
      `Taken off the market: ${n(retired)} imported spaces this run did not carry.` +
        (keptByHand ? ` ${keptByHand} hand-entered ${keptByHand === 1 ? 'space' : 'spaces'} left alone.` : ''),
    );
  } else {
    console.log('Merged. Run with --replace to retire what the feeds no longer carry.');
  }

  if (failures.length > 0) {
    console.log('\nCould not be read this run:');
    for (const f of failures) console.log(`  ${f.source.landlord}: ${f.reason}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\n${(err as Error).message}`);
  process.exit(1);
});
