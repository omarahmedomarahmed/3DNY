import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = true;

let cached: ReturnType<typeof neon> | null = null;

/**
 * Returns the Neon SQL tag. Throws with a plain-English message rather than a
 * driver stack trace when the connection string is missing, because that is
 * the single most common setup mistake.
 */
export function sql() {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add your Neon connection string in ' +
        'Vercel → Settings → Environment Variables, then redeploy. ' +
        'See SETUP.md step 2.',
    );
  }
  cached = neon(url);
  return cached;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Normalised form used as the buildings table's unique key. */
export function normalizeAddress(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/,/g, ' ')
    // `42ND` and `42` are the same street. The sheet writes one, NYC the other.
    .replace(/(\d)(ST|ND|RD|TH)\b/g, '$1')
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bPLACE\b/g, 'PL')
    .replace(/\bSQUARE\b/g, 'SQ')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bTERRACE\b/g, 'TER')
    .replace(/\bPLAZA\b/g, 'PLZ')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bWEST\b/g, 'W')
    .replace(/\bEAST\b/g, 'E')
    .replace(/\bNORTH\b/g, 'N')
    .replace(/\bSOUTH\b/g, 'S')
    .replace(/\s+/g, ' ')
    .trim();
}
