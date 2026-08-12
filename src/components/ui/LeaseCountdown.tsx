import { leaseStanding, type LeaseWindow } from '@/lib/lease';

/**
 * "in 18 months", beside a lease expiry date.
 *
 * Colour carries one thing only: whether this is a lease worth calling about
 * now. It stays deliberately quiet — a tenancy is context on this map, and the
 * loudest thing on screen is always an available floor. A red pill next to
 * every occupier would compete with the goldenrod, which is the one thing this
 * product does not allow.
 */

const TONE: Record<LeaseWindow, string> = {
  // Inside a year: the only one that gets any warmth at all.
  imminent: 'text-warn',
  active: 'text-muted',
  future: 'text-subtle',
  expired: 'text-subtle',
  unknown: 'text-subtle',
};

export default function LeaseCountdown({
  expiration,
  className = '',
}: {
  expiration: string | null | undefined;
  className?: string;
}) {
  const standing = leaseStanding(expiration);
  if (!standing.label) return null;
  return (
    <span className={`text-xs font-medium ${TONE[standing.window]} ${className}`}>
      {standing.label}
    </span>
  );
}
