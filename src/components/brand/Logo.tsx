'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  DEFAULT_BRAND_SETTINGS,
  DEFAULT_LOGO_SRC,
  logoTransform,
  type BrandSettings,
} from '@/lib/brand-settings';

/**
 * The Cresa mark. It renders the customer's uploaded logo when one has been
 * saved on /setup, and otherwise /brand/cresa-logo.svg — so dropping the
 * official artwork into public/brand/ still replaces it everywhere with no
 * code change.
 *
 * `product` appends the tool name beside the logo, divided by a hairline —
 * the pattern Cresa uses for sub-brands.
 *
 * Placement (scale and offset) is a presentation detail, applied as a CSS
 * transform so it can never change the space the header reserves for the mark.
 */

// ---------------------------------------------------------------------------
// Settings fetch. One request per page, shared by every Logo on it.
// ---------------------------------------------------------------------------

let settingsPromise: Promise<BrandSettings> | null = null;

function loadBrandSettings(): Promise<BrandSettings> {
  if (settingsPromise) return settingsPromise;
  // Guarded: on the server there is no fetch target, so resolve to defaults.
  if (typeof window === 'undefined') return Promise.resolve(DEFAULT_BRAND_SETTINGS);

  settingsPromise = fetch('/api/brand', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : DEFAULT_BRAND_SETTINGS))
    .then((body: unknown) =>
      body && typeof body === 'object'
        ? { ...DEFAULT_BRAND_SETTINGS, ...(body as Partial<BrandSettings>) }
        : DEFAULT_BRAND_SETTINGS,
    )
    // A logo must never be able to break a page. Any failure means "use the
    // built-in mark", and the failed promise is not cached.
    .catch(() => {
      settingsPromise = null;
      return DEFAULT_BRAND_SETTINGS;
    });

  return settingsPromise;
}

/** Called after a save so already-mounted pages pick up the new artwork. */
export function invalidateBrandSettings(next?: BrandSettings) {
  settingsPromise = next ? Promise.resolve(next) : null;
}

/**
 * Resolved brand settings. Returns the defaults during the first render, which
 * is also exactly what the server renders — no hydration mismatch.
 */
export function useBrandSettings(override?: BrandSettings): BrandSettings {
  const [fetched, setFetched] = useState<BrandSettings | null>(null);

  useEffect(() => {
    if (override) return;
    let live = true;
    void loadBrandSettings().then((s) => {
      if (live) setFetched(s);
    });
    return () => {
      live = false;
    };
  }, [override]);

  return override ?? fetched ?? DEFAULT_BRAND_SETTINGS;
}

// ---------------------------------------------------------------------------
// The mark
// ---------------------------------------------------------------------------

export default function Logo({
  href = '/',
  product,
  className = '',
  height,
  invert = false,
  settings,
  variant = 'nav',
}: {
  href?: string | null;
  product?: string;
  className?: string;
  /** Overrides the saved height. Callers that size the bar still win. */
  height?: number;
  invert?: boolean;
  /** Pre-resolved settings, e.g. from a live preview. Skips the fetch. */
  settings?: BrandSettings;
  /** `footer` applies the separate footer scale on top of the logo scale. */
  variant?: 'nav' | 'footer';
}) {
  const resolved = useBrandSettings(settings);
  const custom = Boolean(resolved.logoUrl);
  const src = resolved.logoUrl ?? DEFAULT_LOGO_SRC;

  // An explicit height prop keeps its meaning for existing callers; the saved
  // height only applies when nothing was passed.
  const boxHeight = height ?? resolved.logoHeight;
  const extra = variant === 'footer' ? resolved.footerScale : 1;

  // Placement only applies to an uploaded mark. The built-in SVG is already
  // aligned, and silently shifting it would be surprising.
  const transform = custom ? logoTransform(resolved, extra) : undefined;

  const mark = (
    <span className="flex items-center gap-3">
      <span
        className="flex shrink-0 items-center overflow-visible"
        style={{ height: boxHeight }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Cresa"
          height={boxHeight}
          style={{
            height: boxHeight,
            width: 'auto',
            maxWidth: 'none',
            transform,
            transformOrigin: 'left center',
          }}
          className={invert ? 'brightness-0 invert' : undefined}
          onError={(e) => {
            // A dead blob URL falls back to the shipped artwork rather than a
            // broken-image icon in the middle of the nav bar.
            const img = e.currentTarget;
            if (img.getAttribute('src') !== DEFAULT_LOGO_SRC) {
              img.style.transform = '';
              img.setAttribute('src', DEFAULT_LOGO_SRC);
            }
          }}
        />
      </span>
      {product && (
        <>
          <span
            aria-hidden
            className={`h-5 w-px ${invert ? 'bg-white/30' : 'bg-hairline-strong'}`}
          />
          <span
            className={`text-[13px] font-semibold uppercase tracking-[0.14em] ${
              invert ? 'text-white' : 'text-ink'
            }`}
          >
            {product}
          </span>
        </>
      )}
    </span>
  );

  if (!href) return <span className={className}>{mark}</span>;

  return (
    <Link href={href} className={`inline-flex items-center ${className}`} aria-label="Cresa home">
      {mark}
    </Link>
  );
}

/** The Goldenrod dot motif on its own, for accents and empty states. */
export function DotMotif({ className = '', size = 44 }: { className?: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/cresa-mark.svg"
      alt=""
      aria-hidden
      style={{ height: size, width: 'auto' }}
      className={className}
    />
  );
}
