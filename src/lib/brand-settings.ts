import { isDatabaseConfigured, sql } from '@/lib/db';

/**
 * Brand settings — a single-row table holding the customer's uploaded logo and
 * the numbers that make it sit correctly in the nav bar and the footer.
 *
 * Every read and write in here degrades to defaults instead of throwing. A
 * logo is decoration; it must never be able to take down the application, so
 * a missing DATABASE_URL, a missing table, or a broken query all resolve to
 * the built-in mark.
 */

export interface BrandSettings {
  /** Uploaded logo URL, or null to use the built-in /brand/cresa-logo.svg. */
  logoUrl: string | null;
  /** Multiplier applied to the rendered mark, 0.4–2.5. */
  logoScale: number;
  /** Horizontal nudge in CSS pixels, −40–40. */
  logoOffsetX: number;
  /** Vertical nudge in CSS pixels, −20–20. */
  logoOffsetY: number;
  /** Base height in CSS pixels before scaling, 16–48. */
  logoHeight: number;
  /** Separate multiplier for the footer lockup, 0.4–2.5. */
  footerScale: number;
  updatedAt: string | null;
}

export const DEFAULT_BRAND_SETTINGS: BrandSettings = {
  logoUrl: null,
  logoScale: 1,
  logoOffsetX: 0,
  logoOffsetY: 0,
  logoHeight: 26,
  footerScale: 1,
  updatedAt: null,
};

/** Fallback artwork, shipped in public/. Used whenever no upload is set. */
export const DEFAULT_LOGO_SRC = '/brand/cresa-logo.svg';

export const BRAND_LIMITS = {
  logoScale: { min: 0.4, max: 2.5, step: 0.01 },
  logoOffsetX: { min: -40, max: 40, step: 1 },
  logoOffsetY: { min: -20, max: 20, step: 1 },
  logoHeight: { min: 16, max: 48, step: 1 },
  footerScale: { min: 0.4, max: 2.5, step: 0.01 },
} as const;

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS brand_settings (
    id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    logo_url      text,
    logo_scale    numeric(5,2) NOT NULL DEFAULT 1.0,
    logo_offset_x numeric(6,2) NOT NULL DEFAULT 0,
    logo_offset_y numeric(6,2) NOT NULL DEFAULT 0,
    logo_height   integer      NOT NULL DEFAULT 26,
    footer_scale  numeric(5,2) NOT NULL DEFAULT 1.0,
    updated_at    timestamptz  NOT NULL DEFAULT now()
  )
`;

let ensured = false;

/**
 * Creates the table on first use. Idempotent, and cached per process so the
 * common path is a single SELECT.
 */
async function ensureTable(): Promise<void> {
  if (ensured) return;
  await sql()(CREATE_TABLE);
  ensured = true;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Postgres `numeric` comes back as a string over the wire. */
function num(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

interface Row {
  logo_url: string | null;
  logo_scale: string | number;
  logo_offset_x: string | number;
  logo_offset_y: string | number;
  logo_height: string | number;
  footer_scale: string | number;
  updated_at: string | Date | null;
}

function toSettings(row: Row | undefined): BrandSettings {
  if (!row) return { ...DEFAULT_BRAND_SETTINGS };
  const L = BRAND_LIMITS;
  const url = typeof row.logo_url === 'string' ? row.logo_url.trim() : '';
  return {
    logoUrl: url.length ? url : null,
    logoScale: clamp(num(row.logo_scale, 1), L.logoScale.min, L.logoScale.max),
    logoOffsetX: clamp(num(row.logo_offset_x, 0), L.logoOffsetX.min, L.logoOffsetX.max),
    logoOffsetY: clamp(num(row.logo_offset_y, 0), L.logoOffsetY.min, L.logoOffsetY.max),
    logoHeight: Math.round(clamp(num(row.logo_height, 26), L.logoHeight.min, L.logoHeight.max)),
    footerScale: clamp(num(row.footer_scale, 1), L.footerScale.min, L.footerScale.max),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : (row.updated_at ?? null),
  };
}

/**
 * The saved settings, or the defaults. Never throws — callers render a logo
 * either way.
 */
export async function getBrandSettings(): Promise<BrandSettings> {
  if (!isDatabaseConfigured()) return { ...DEFAULT_BRAND_SETTINGS };
  try {
    await ensureTable();
    const rows = (await sql()(
      `SELECT logo_url, logo_scale, logo_offset_x, logo_offset_y,
              logo_height, footer_scale, updated_at
         FROM brand_settings WHERE id = 1`,
    )) as unknown as Row[];
    return toSettings(rows[0]);
  } catch {
    return { ...DEFAULT_BRAND_SETTINGS };
  }
}

export type BrandSettingsPatch = Partial<Omit<BrandSettings, 'updatedAt'>>;

/**
 * Upserts the single row and returns the stored result. On any failure the
 * caller still gets a coherent object back, so the UI can show what it would
 * have saved rather than an exception.
 */
export async function saveBrandSettings(patch: BrandSettingsPatch): Promise<BrandSettings> {
  const current = await getBrandSettings();
  const L = BRAND_LIMITS;

  const next: BrandSettings = {
    ...current,
    ...(patch.logoUrl !== undefined
      ? { logoUrl: patch.logoUrl && patch.logoUrl.trim().length ? patch.logoUrl.trim() : null }
      : null),
    ...(patch.logoScale !== undefined
      ? { logoScale: clamp(Number(patch.logoScale), L.logoScale.min, L.logoScale.max) }
      : null),
    ...(patch.logoOffsetX !== undefined
      ? { logoOffsetX: clamp(Number(patch.logoOffsetX), L.logoOffsetX.min, L.logoOffsetX.max) }
      : null),
    ...(patch.logoOffsetY !== undefined
      ? { logoOffsetY: clamp(Number(patch.logoOffsetY), L.logoOffsetY.min, L.logoOffsetY.max) }
      : null),
    ...(patch.logoHeight !== undefined
      ? {
          logoHeight: Math.round(
            clamp(Number(patch.logoHeight), L.logoHeight.min, L.logoHeight.max),
          ),
        }
      : null),
    ...(patch.footerScale !== undefined
      ? { footerScale: clamp(Number(patch.footerScale), L.footerScale.min, L.footerScale.max) }
      : null),
  };

  if (!isDatabaseConfigured()) return next;

  try {
    await ensureTable();
    const rows = (await sql()(
      `INSERT INTO brand_settings
         (id, logo_url, logo_scale, logo_offset_x, logo_offset_y, logo_height, footer_scale, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         logo_url      = EXCLUDED.logo_url,
         logo_scale    = EXCLUDED.logo_scale,
         logo_offset_x = EXCLUDED.logo_offset_x,
         logo_offset_y = EXCLUDED.logo_offset_y,
         logo_height   = EXCLUDED.logo_height,
         footer_scale  = EXCLUDED.footer_scale,
         updated_at    = now()
       RETURNING logo_url, logo_scale, logo_offset_x, logo_offset_y,
                 logo_height, footer_scale, updated_at`,
      [
        next.logoUrl,
        next.logoScale,
        next.logoOffsetX,
        next.logoOffsetY,
        next.logoHeight,
        next.footerScale,
      ],
    )) as unknown as Row[];
    return rows[0] ? toSettings(rows[0]) : next;
  } catch {
    return next;
  }
}

/**
 * The CSS transform that positions a mark. Shared by Logo and the uploader's
 * previews so what you adjust is exactly what ships.
 */
export function logoTransform(settings: BrandSettings, extraScale = 1): string {
  const scale = settings.logoScale * extraScale;
  return `translate(${settings.logoOffsetX}px, ${settings.logoOffsetY}px) scale(${scale})`;
}
