'use client';

import { useMemo } from 'react';
import { EMPTY_FILTERS } from '@/types';
import type { Filters } from '@/types';

/**
 * One-tap presets covering the questions brokers actually ask in a meeting.
 * Each chip owns a small patch of the filter state: tapping it applies that
 * patch, tapping it again restores exactly those keys to their empty values.
 * Nothing else in the rail is disturbed, so a chip composes with whatever the
 * user has already set by hand.
 */

interface Preset {
  id: string;
  label: string;
  /** The filter values this chip stands for. */
  patch: Partial<Filters>;
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addMonths(d: Date, months: number): Date {
  const next = new Date(d.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/** Arrays are compared order-insensitively; everything else by identity. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const left = [...a].map(String).sort();
    const right = [...b].map(String).sort();
    return left.every((v, i) => v === right[i]);
  }
  return a === b;
}

function isActive(filters: Filters, preset: Preset): boolean {
  return (Object.keys(preset.patch) as (keyof Filters)[]).every((key) =>
    sameValue(filters[key], preset.patch[key]),
  );
}

/** The empty counterpart of a preset's patch — used to switch it back off. */
function clearPatch(preset: Preset): Partial<Filters> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(preset.patch) as (keyof Filters)[]) {
    out[key] = EMPTY_FILTERS[key];
  }
  return out as Partial<Filters>;
}

export function buildPresets(now: Date): Preset[] {
  return [
    {
      id: 'vacant-now',
      label: 'Vacant now',
      patch: { availableBefore: toIso(now) },
    },
    {
      id: 'under-60',
      label: 'Under $60',
      // Withheld rents carry no number, so they cannot be shown to be under
      // $60 — the preset hides them for the duration.
      patch: { rentMax: 60, includeWithheld: false },
    },
    {
      id: 'over-10k',
      label: 'Over 10,000 SF',
      patch: { sfMin: 10000 },
    },
    {
      id: 'direct-only',
      label: 'Direct only',
      patch: { leaseTypes: ['direct'] },
    },
    {
      id: 'sublets',
      label: 'Sublets',
      patch: { leaseTypes: ['sublet'] },
    },
    {
      id: 'expiring-12',
      label: 'Expiring in 12 months',
      patch: { expiresBefore: toIso(addMonths(now, 12)) },
    },
    {
      id: 'added-week',
      label: 'Added this week',
      patch: { addedAfter: toIso(addDays(now, -7)) },
    },
  ];
}

interface QuickFiltersProps {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
}

export default function QuickFilters({ filters, onChange }: QuickFiltersProps) {
  const presets = useMemo(() => buildPresets(new Date()), []);

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
      {presets.map((preset) => {
        const on = isActive(filters, preset);
        return (
          <button
            key={preset.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? clearPatch(preset) : preset.patch)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              on
                ? 'border-goldenrod bg-goldenrod text-midnight'
                : 'border-hairline-strong bg-white text-body hover:border-midnight hover:text-ink'
            }`}
          >
            {on ? (
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3.5 8.5l3 3 6-7" />
              </svg>
            ) : null}
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
