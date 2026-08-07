import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { BuildingClass, LeaseType, MatchConfidence } from '@/types';

export type BadgeVariant = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

const VARIANTS: Record<BadgeVariant, string> = {
  ok: 'border-ok/40 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-accent/40 bg-accent/10 text-accent',
  neutral: 'border-edge bg-edge/40 text-muted',
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
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5',
        'text-[11px] font-medium leading-4 tracking-wide',
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
  return (
    <Badge variant={value === 'direct' ? 'ok' : 'info'}>
      {value === 'direct' ? 'Direct' : 'Sublet'}
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
  return <Badge variant="ok">Vacant</Badge>;
}
