'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '@/lib/store';
import { activeFilterCount, filterOptions } from '@/lib/filters';
import type { BuildingClass, Filters, LeaseType } from '@/types';
import RangeFilter from './RangeFilter';
import MultiSelect from './MultiSelect';
import DateFilter from './DateFilter';
import QuickFilters from './QuickFilters';

// ---------------------------------------------------------------------------
// Date helpers — everything the rail emits is an ISO YYYY-MM-DD string.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Icons — inline SVG only.
// ---------------------------------------------------------------------------

function Chevron({ direction }: { direction: 'left' | 'right' | 'down' }) {
  const rotation =
    direction === 'left' ? 'rotate-180' : direction === 'down' ? 'rotate-90' : '';
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-4 w-4 transition-transform ${rotation}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2L14 14" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives. One heading weight, no boxes inside boxes.
// ---------------------------------------------------------------------------

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
      {children}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <Label>{label}</Label>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Toggle button group
// ---------------------------------------------------------------------------

interface ToggleGroupProps<T extends string> {
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}

function ToggleGroup<T extends string>({ options, selected, onChange }: ToggleGroupProps<T>) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(({ value, label }) => {
        const on = selected.includes(value);
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(on ? selected.filter((v) => v !== value) : [...selected, value])
            }
            className={`min-w-[3.25rem] rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              on
                ? 'border-goldenrod bg-goldenrod text-midnight'
                : 'border-hairline-strong bg-white text-body hover:border-midnight hover:text-ink'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Advanced filters live behind the disclosure; this is their own tally. */
function advancedCount(f: Filters): number {
  let n = 0;
  if (f.floorMin !== null || f.floorMax !== null) n++;
  if (f.expiresBefore || f.expiresAfter) n++;
  if (f.availableBefore) n++;
  if (f.addedAfter) n++;
  if (f.classes.length) n++;
  if (f.leaseTypes.length) n++;
  if (f.spaceUses.length) n++;
  if (f.submarketClusters.length) n++;
  if (f.leasingCompanies.length) n++;
  return n;
}

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

export default function FilterRail() {
  const buildings = useApp((s) => s.buildings);
  const filters = useApp((s) => s.filters);
  const setFilters = useApp((s) => s.setFilters);
  const resetFilters = useApp((s) => s.resetFilters);

  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const options = useMemo(() => filterOptions(buildings ?? []), [buildings]);
  const count = activeFilterCount(filters);
  const advanced = advancedCount(filters);

  const today = useMemo(() => new Date(), []);
  const todayIso = toIso(today);
  const nextYear = today.getFullYear() + 1;

  if (collapsed) {
    return (
      <div className="flex h-full w-12 shrink-0 flex-col items-center gap-3 border-r border-hairline bg-white py-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Show filters"
          aria-label="Show filters"
          className="rounded-full border border-hairline-strong bg-white p-1.5 text-muted transition-colors hover:border-midnight hover:text-ink"
        >
          <Chevron direction="right" />
        </button>
        {count > 0 ? (
          <span
            className="rounded-full bg-goldenrod px-2 py-0.5 text-[11px] font-semibold tabular text-midnight"
            title={`${count} active filters`}
          >
            {count}
          </span>
        ) : null}
        <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted [writing-mode:vertical-rl]">
          Filters
        </span>
      </div>
    );
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-hairline bg-white text-body">
      <header className="flex items-center justify-between gap-2 px-5 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-ink">Filters</h2>
          {count > 0 ? (
            <span className="rounded-full bg-goldenrod px-2 py-0.5 text-[11px] font-semibold tabular text-midnight">
              {count}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {count > 0 ? (
            <button
              type="button"
              onClick={resetFilters}
              className="text-sm font-medium text-brightblue transition-colors hover:text-midnight"
            >
              Clear all
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="Hide filters"
            aria-label="Hide filters"
            className="rounded-full p-1 text-muted transition-colors hover:bg-surface-alt hover:text-ink"
          >
            <Chevron direction="left" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 pb-8">
        {/* Tier 1 — search ------------------------------------------------ */}
        <div className="flex items-center gap-2 rounded-card border border-hairline-strong bg-white px-3 py-2 focus-within:border-midnight">
          <SearchIcon />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            placeholder="Address, building, landlord, broker…"
            aria-label="Search listings"
            className="w-full min-w-0 bg-transparent text-sm font-medium text-ink outline-none placeholder:font-normal placeholder:text-muted"
          />
        </div>

        {/* Tier 1 — presets ----------------------------------------------- */}
        <Group label="Quick filters">
          <QuickFilters filters={filters} onChange={setFilters} />
        </Group>

        {/* Tier 1 — asking rent ------------------------------------------- */}
        <Group label="Asking rent">
          <RangeFilter
            label="Asking rent / SF"
            showLabel={false}
            unit="$"
            unitPosition="prefix"
            hint={options.rentRange}
            min={filters.rentMin}
            max={filters.rentMax}
            onChange={({ min, max }) => setFilters({ rentMin: min, rentMax: max })}
          />
          <label className="flex cursor-pointer items-start gap-2.5 text-sm font-medium text-body">
            <input
              type="checkbox"
              checked={filters.includeWithheld}
              onChange={(e) => setFilters({ includeWithheld: e.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 accent-midnight"
            />
            <span>
              Include withheld rents
              <span className="mt-0.5 block text-sm font-normal leading-snug text-muted">
                Roughly half of listings withhold rent.
              </span>
            </span>
          </label>
        </Group>

        {/* Tier 1 — size --------------------------------------------------- */}
        <Group label="Size (SF)">
          <RangeFilter
            label="Square feet"
            showLabel={false}
            unit="SF"
            unitPosition="suffix"
            hint={options.sfRange}
            min={filters.sfMin}
            max={filters.sfMax}
            onChange={({ min, max }) => setFilters({ sfMin: min, sfMax: max })}
          />
        </Group>

        {/* Tier 2 — everything else --------------------------------------- */}
        <div className="border-t border-hairline pt-5">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-expanded={moreOpen}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-ink">
              More filters
              {advanced > 0 ? (
                <span className="rounded-full bg-goldenrod px-2 py-0.5 text-[11px] font-semibold tabular text-midnight">
                  {advanced}
                </span>
              ) : null}
            </span>
            <span className="text-muted">
              <Chevron direction={moreOpen ? 'down' : 'right'} />
            </span>
          </button>

          {moreOpen ? (
            <div className="mt-6 space-y-7">
              <Group label="Floor">
                <RangeFilter
                  label="Floor number"
                  showLabel={false}
                  min={filters.floorMin}
                  max={filters.floorMax}
                  onChange={({ min, max }) => setFilters({ floorMin: min, floorMax: max })}
                />
              </Group>

              <Group label="Lease expiration">
                <DateFilter
                  label="Expires before"
                  value={filters.expiresBefore}
                  onChange={(expiresBefore) => setFilters({ expiresBefore })}
                  presets={[
                    { label: 'Within 12 months', value: toIso(addMonths(today, 12)) },
                    { label: 'Within 24 months', value: toIso(addMonths(today, 24)) },
                  ]}
                />
                <DateFilter
                  label="Expires after"
                  value={filters.expiresAfter}
                  onChange={(expiresAfter) => setFilters({ expiresAfter })}
                  presets={[{ label: `${nextYear} or later`, value: `${nextYear}-01-01` }]}
                />
                <p className="text-sm leading-snug text-muted">
                  Spaces with a negotiable or open-ended term carry no expiration date and are
                  excluded while this filter is active.
                </p>
              </Group>

              <Group label="Availability">
                <DateFilter
                  label="Available by"
                  value={filters.availableBefore}
                  onChange={(availableBefore) => setFilters({ availableBefore })}
                  presets={[{ label: 'Vacant now', value: todayIso }]}
                />
              </Group>

              <Group label="Date added">
                <DateFilter
                  label="Added after"
                  value={filters.addedAfter}
                  onChange={(addedAfter) => setFilters({ addedAfter })}
                  presets={[
                    { label: 'This week', value: toIso(addDays(today, -7)) },
                    { label: 'Last 30 days', value: toIso(addDays(today, -30)) },
                  ]}
                />
              </Group>

              <Group label="Class">
                <ToggleGroup<'A' | 'B' | 'C'>
                  options={[
                    { value: 'A', label: 'A' },
                    { value: 'B', label: 'B' },
                    { value: 'C', label: 'C' },
                  ]}
                  selected={filters.classes.filter((c): c is 'A' | 'B' | 'C' => c !== null)}
                  onChange={(next) => setFilters({ classes: next as BuildingClass[] })}
                />
              </Group>

              <Group label="Type">
                <ToggleGroup<LeaseType>
                  options={[
                    { value: 'direct', label: 'Direct' },
                    { value: 'sublet', label: 'Sublet' },
                  ]}
                  selected={filters.leaseTypes}
                  onChange={(leaseTypes) => setFilters({ leaseTypes })}
                />
              </Group>

              <Group label="Space use">
                <MultiSelect
                  label="Space use"
                  showLabel={false}
                  options={options.spaceUses}
                  selected={filters.spaceUses}
                  onChange={(spaceUses) => setFilters({ spaceUses })}
                />
              </Group>

              <Group label="Submarket cluster">
                <MultiSelect
                  label="Submarket cluster"
                  showLabel={false}
                  options={options.submarketClusters}
                  selected={filters.submarketClusters}
                  onChange={(submarketClusters) => setFilters({ submarketClusters })}
                />
              </Group>

              <Group label="Leasing company">
                <MultiSelect
                  label="Leasing company"
                  showLabel={false}
                  options={options.leasingCompanies}
                  selected={filters.leasingCompanies}
                  onChange={(leasingCompanies) => setFilters({ leasingCompanies })}
                />
              </Group>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
