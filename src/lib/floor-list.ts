/**
 * Turns the way people write floors into the numbers a tower can be drawn with.
 *
 * The availability sheet writes one floor per row and a parser already exists
 * for it (`parseFloor`). A tenancy is different: one company holds a block, and
 * whoever typed it wrote what they say out loud —
 *
 *   "14"            "12-14"          "2, 5, 9"
 *   "Ground"        "PH"             "Entire building"
 *   "Fl 3-5, 12"    "Lower Level"    "Suite 402"
 *
 * Three rules, all of them about not inventing floors:
 *
 * 1. **A range is inclusive and bounded.** "12-14" is three floors. A range
 *    that runs the wrong way is read the other way round rather than dropped,
 *    because "14-12" is a typo with an obvious meaning. A range longer than
 *    the tallest building in New York is a parse failure, not a tenancy on a
 *    hundred and twenty floors.
 *
 * 2. **A word that is not a floor number returns nothing.** "Ground", "PH",
 *    "Concourse" and "Lower Level" are real answers, and none of them is a
 *    number. Guessing that "Ground" means 1 would put a band on the first
 *    floor of a tower on the strength of a guess; the row still exists, still
 *    shows in the building's tenant table, and simply is not drawn.
 *
 * 3. **A suite number is not a floor.** "Suite 402" is written on doors all
 *    over Manhattan and reads as floor 402 to anything looking for digits.
 *    Where the convention is legible — a three or four digit suite whose
 *    leading digits are a plausible floor — the floor is taken from it; where
 *    it is not, nothing is.
 */

/** Nothing in New York is taller than this, so nothing above it is a floor. */
const MAX_FLOOR = 110;

/** Words that name a level without numbering it. */
const NAMED_LEVELS = /\b(ground|grd|lobby|concourse|cellar|basement|lower\s*level|ll|mezzanine|mezz|penthouse|ph|roof|retail|garage)\b/i;

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
  seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
};

/** Noise that surrounds the numbers without changing them. */
const NOISE = /\b(fl|flr|floor|floors|fls|level|levels|entire|partial|part|of|the|and|&)\b/gi;

function plausible(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_FLOOR;
}

/**
 * A suite number's floor, when the convention is legible.
 *
 * 402 → 4, 1203 → 12. A two-digit suite is not a floor with a room on it, it
 * is just a room, so it yields nothing.
 */
export function floorFromSuite(raw: string): number | null {
  const m = /\b(?:suite|ste|unit|rm|room)\s*#?\s*(\d{3,4})\b/i.exec(raw);
  if (!m) return null;
  const digits = m[1];
  const floor = Number.parseInt(digits.slice(0, digits.length - 2), 10);
  return plausible(floor) ? floor : null;
}

/**
 * Every floor a tenancy occupies, ascending and deduplicated.
 *
 * Returns an empty array whenever the text does not name a floor by number.
 * That is a normal outcome, not a failure — see rule 2 above.
 */
export function parseFloorList(raw: string | null | undefined): number[] {
  const text = (raw ?? '').trim();
  if (!text) return [];

  const floors = new Set<number>();

  // "Entire building" is a real tenancy and an unknowable set of floors. It is
  // recorded, and it is not drawn as a guess about how many floors that is.
  if (/\bentire\s+building\b/i.test(text)) return [];

  const cleaned = text
    .replace(NOISE, ' ')
    // An ordinal suffix is decoration: 14th and 14 are the same floor.
    .replace(/(\d+)\s*(?:st|nd|rd|th)\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  // Ranges first, so their numbers are consumed before the singles pass.
  const consumed: string[] = [];
  const rangePattern = /\b(\d{1,3})\s*(?:-|–|—|to|thru|through)\s*(\d{1,3})\b/gi;
  for (const m of cleaned.matchAll(rangePattern)) {
    const a = Number.parseInt(m[1], 10);
    const b = Number.parseInt(m[2], 10);
    // A backwards range is a typo with one obvious reading.
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (!plausible(lo) || !plausible(hi)) continue;
    // A "range" spanning most of a skyline is a mis-parse — a phone number, a
    // year pair, a square footage that lost its comma.
    if (hi - lo > 60) continue;
    for (let f = lo; f <= hi; f++) floors.add(f);
    consumed.push(m[0]);
  }

  let rest = cleaned;
  for (const piece of consumed) rest = rest.replace(piece, ' ');

  // Anchored, and this matters: unanchored, \d{1,3} chops "1203" into "120"
  // and "3" and quietly reports floor 3. A four-digit number is not a floor,
  // and the only honest thing to do with it is not match it at all.
  for (const m of rest.matchAll(/\b\d{1,3}\b/g)) {
    const n = Number.parseInt(m[0], 10);
    if (plausible(n)) floors.add(n);
  }

  for (const [word, value] of Object.entries(ORDINAL_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(rest)) floors.add(value);
  }

  // Only fall back to a suite number when nothing else named a floor —
  // "Suite 402" alone tells us the fourth floor; "3, Suite 402" does not mean
  // floors 3 and 4.
  if (floors.size === 0) {
    const fromSuite = floorFromSuite(text);
    if (fromSuite !== null) return [fromSuite];
  }

  // A named level with no number is recorded but never drawn.
  if (floors.size === 0 && NAMED_LEVELS.test(text)) return [];

  return [...floors].sort((a, b) => a - b);
}

/**
 * A short human summary of a floor set — "12–14", "2, 5, 9", "14".
 *
 * Used where the original text is too long for the space it is in, such as a
 * band's tooltip or a map popup. Consecutive runs collapse, because "12, 13,
 * 14" and "12–14" are the same fact and one of them is shorter.
 */
export function formatFloorList(floors: number[]): string {
  if (floors.length === 0) return '';
  const sorted = [...new Set(floors)].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return runs.join(', ');
}
