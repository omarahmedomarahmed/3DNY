/**
 * Formatting primitives shared by every detail and compare surface.
 *
 * The rules here are not cosmetic. A withheld asking rent must never render as
 * "$0" — a broker reading "$0 /SF" in front of a client is a real problem — and
 * a missing number must read as an em dash rather than "null" or "NaN".
 */

const EM_DASH = '—';

export function formatRent(psf: number | null | undefined): string | null {
  if (psf === null || psf === undefined || !Number.isFinite(psf)) return null;
  return `$${psf.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} /SF`;
}

export function formatSf(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${Math.round(value).toLocaleString('en-US')} SF`;
}

export function formatNumber(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value).toLocaleString('en-US');
}

/** "$1.2M" style, for portfolio square footage and other large aggregates. */
export function formatCompactSf(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M SF`;
  if (value >= 10_000) return `${Math.round(value / 1000).toLocaleString('en-US')}K SF`;
  return formatSf(value);
}

/** ISO date (or anything Date can parse) → "Mar 2033". Null when unparseable. */
export function formatMonthYear(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = parseLoose(iso);
  if (!date) return null;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** ISO date → "Mar 14, 2033", for timestamps where the day matters. */
export function formatFullDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = parseLoose(iso);
  if (!date) return null;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Source sheets hand us bare "2033-03-01" as often as full timestamps. Date
 * parsing of a bare date is UTC in every engine we care about, so all the
 * formatters above render in UTC to stop a New York evening shifting a lease
 * expiration back a month.
 */
function parseLoose(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

export function annualRent(
  psf: number | null | undefined,
  sf: number | null | undefined,
  withheld?: boolean,
): number | null {
  if (withheld) return null;
  if (psf === null || psf === undefined || sf === null || sf === undefined) return null;
  if (!Number.isFinite(psf) || !Number.isFinite(sf)) return null;
  return psf * sf;
}

export function formatAnnualRent(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return `$${Math.round(value).toLocaleString('en-US')}/yr`;
}

/** Months from now until `iso`. Negative when already past. Null if unknown. */
export function monthsUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const date = parseLoose(iso);
  if (!date) return null;
  return (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.44);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export function Dash({ className }: { className?: string }) {
  return <span className={className ?? 'text-subtle'}>{EM_DASH}</span>;
}

export function Rent({
  psf,
  withheld,
  className,
}: {
  psf: number | null | undefined;
  withheld?: boolean;
  className?: string;
}) {
  if (withheld) {
    return (
      <span className={`text-muted italic ${className ?? ''}`.trim()} title="Asking rent withheld">
        Withheld
      </span>
    );
  }
  const text = formatRent(psf);
  if (text === null) return <Dash className={className ?? 'text-subtle'} />;
  return <span className={`tabular ${className ?? ''}`.trim()}>{text}</span>;
}

export function Sf({
  value,
  className,
}: {
  value: number | null | undefined;
  className?: string;
}) {
  const text = formatSf(value);
  if (text === null) return <Dash className={className ?? 'text-subtle'} />;
  return <span className={`tabular ${className ?? ''}`.trim()}>{text}</span>;
}

export function DateText({
  value,
  full,
  fallback,
  className,
}: {
  value: string | null | undefined;
  /** Include the day, e.g. "Mar 14, 2033". */
  full?: boolean;
  /** Raw source text ("Negotiable", "5 - 10 Years") shown when unparseable. */
  fallback?: string | null;
  className?: string;
}) {
  const text = full ? formatFullDate(value) : formatMonthYear(value);
  if (text === null) {
    if (fallback) return <span className={`text-muted ${className ?? ''}`.trim()}>{fallback}</span>;
    return <Dash className={className ?? 'text-subtle'} />;
  }
  return <span className={`tabular ${className ?? ''}`.trim()}>{text}</span>;
}

export function Num({
  value,
  suffix,
  className,
}: {
  value: number | null | undefined;
  suffix?: string;
  className?: string;
}) {
  const text = formatNumber(value);
  if (text === null) return <Dash className={className ?? 'text-subtle'} />;
  return (
    <span className={`tabular ${className ?? ''}`.trim()}>
      {text}
      {suffix ? ` ${suffix}` : ''}
    </span>
  );
}

/** "$52.00 – $88.00 /SF" across a building's spaces. */
export function RentRange({
  min,
  max,
  className,
}: {
  min: number | null | undefined;
  max: number | null | undefined;
  className?: string;
}) {
  if (min === null || min === undefined) return <Dash className={className ?? 'text-subtle'} />;
  if (max === null || max === undefined || max === min) {
    return <Rent psf={min} className={className} />;
  }
  return (
    <span className={`tabular ${className ?? ''}`.trim()}>
      {`$${min.toFixed(2)} – $${max.toFixed(2)} /SF`}
    </span>
  );
}
