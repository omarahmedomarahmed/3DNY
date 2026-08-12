/**
 * How long is left on a lease.
 *
 * This is the fact a tenant-rep broker is actually looking for when they click
 * a company on the map. A date alone makes them do arithmetic in front of a
 * client; "18 months" is the answer to the question they were asking.
 *
 * The bands are the ones the business already works to: inside a year is a live
 * conversation, one to two years is the window to start one, and beyond that it
 * is background. Kept here rather than in a component so the same thresholds
 * drive the tenant card, the building page and anything added later.
 */

export type LeaseWindow = 'expired' | 'imminent' | 'active' | 'future' | 'unknown';

export interface LeaseStanding {
  window: LeaseWindow;
  /** Whole months from today to expiry. Negative once it has passed. */
  months: number | null;
  /** Ready to render — "in 18 months", "expired 3 months ago". */
  label: string | null;
}

/** Months between two ISO dates, rounded to whole months and signed. */
export function monthsBetween(fromIso: string, toIso: string): number | null {
  const from = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = new Date(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;

  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  // Part-months count only once the day of the month has passed, so a lease
  // ending on the 30th does not read as a month shorter all through the month.
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}

export function leaseStanding(
  expiration: string | null | undefined,
  today: string = new Date().toISOString().slice(0, 10),
): LeaseStanding {
  if (!expiration) return { window: 'unknown', months: null, label: null };

  const months = monthsBetween(today, expiration);
  if (months === null) return { window: 'unknown', months: null, label: null };

  if (months < 0) {
    const ago = Math.abs(months);
    return {
      window: 'expired',
      months,
      label: ago === 0 ? 'expired this month' : `expired ${plural(ago)} ago`,
    };
  }
  if (months === 0) return { window: 'imminent', months, label: 'this month' };

  return {
    window: months <= 12 ? 'imminent' : months <= 24 ? 'active' : 'future',
    months,
    label: `in ${plural(months)}`,
  };
}

function plural(months: number): string {
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.round((months / 12) * 10) / 10;
  return `${years} year${years === 1 ? '' : 's'}`;
}
