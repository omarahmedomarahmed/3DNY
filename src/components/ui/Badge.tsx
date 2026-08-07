import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { BuildingClass, LeaseType, MatchConfidence } from '@/types';

export type BadgeVariant = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

/**
 * Cresa light theme: tinted surface, saturated text, no border noise. The
 * neutral variant is the workhorse — it must never compete with Goldenrod.
 */
const VARIANTS: Record<BadgeVariant, string> = {
  ok: 'bg-ok-surface text-ok',
  warn: 'bg-warn-surface text-warn',
  danger: 'bg-danger-surface text-danger',
  info: 'bg-info-surface text-info',
  neutral: 'bg-midnight-50 text-midnight-700',
};

export default function Badge({
  variant = 'neutral',
  children,
  title,
  className,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5',
        'text-[11px] font-semibold leading-4 tracking-wide',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ClassBadge({ value }: { value: BuildingClass }) {
  if (!value) return <Badge variant="neutral">Unrated</Badge>;
  const variant: BadgeVariant = value === 'A' ? 'info' : value === 'B' ? 'neutral' : 'warn';
  return <Badge variant={variant}>Class {value}</Badge>;
}

export function LeaseTypeBadge({ value }: { value: LeaseType | null }) {
  if (!value) return <Badge variant="neutral">Unknown</Badge>;
  // Direct reads as Midnight (the default, structural case); sublet as Stadium
  // Blue so the two are separable at a glance across a compare table.
  return value === 'direct' ? (
    <Badge variant="neutral" className="bg-midnight-50 text-midnight">
      Direct
    </Badge>
  ) : (
    <Badge variant="neutral" className="bg-midnight-100 text-stadium">
      Sublet
    </Badge>
  );
}

export function MatchBadge({ value }: { value: MatchConfidence }) {
  switch (value) {
    case 'exact':
      return <Badge variant="ok" title="Matched to an NYC Building Identification Number">Exact match</Badge>;
    case 'manual':
      return <Badge variant="info" title="Pinned to this building by a person">Manual match</Badge>;
    case 'fuzzy':
      return <Badge variant="warn" title="Matched approximately by address similarity">Fuzzy match</Badge>;
    case 'unmatched':
      return <Badge variant="danger" title="No building was resolved for this address">Unmatched</Badge>;
  }
}

export function VacantBadge() {
  return (
    <Badge variant="neutral" className="bg-goldenrod-100 text-goldenrod-700">
      Vacant
    </Badge>
  );
}
