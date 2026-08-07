'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '@/lib/store';
import { activeFilterCount, filterOptions } from '@/lib/filters';
import type { BuildingClass, LeaseType } from '@/types';
import RangeFilter from './RangeFilter';
import MultiSelect from './MultiSelect';
import DateFilter from './DateFilter';

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
// Section shell
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string;
  active?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}

function Section({ title, active = false, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-hairline">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-alt"
      >
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          {title}
          {active ? (
            <span className="h-1.5 w-1.5 rounded-full bg-goldenrod" aria-hidden />
          ) : null}
        </span>
        <span className="text-[10px] text-subtle">{open ? '▾' : '▸'}</span>
      </button>
      {open ? <div className="space-y-3 px-4 pb-4">{children}</div> : null}
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
    <div className="flex flex-wrap gap-1">
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
            className={`min-w-[3rem] rounded border px-2.5 py-1.5 text-xs font-medium transition-colors ${
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

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

export default function FilterRail() {
  const buildings = useApp((s) => s.buildings);
  const filters = useApp((s) => s.filters);
  const setFilters = useApp((s) => s.setFilters);
  const resetFilters = useApp((s) => s.resetFilters);

  const [collapsed, setCollapsed] = useState(false);

  const options = useMemo(() => filterOptions(buildings ?? []), [buildings]);
  const count = activeFilterCount(filters);

  const today = useMemo(() => new Date(), []);
  const todayIso = toIso(today);
  const nextYear = today.getFullYear() + 1;

  if (collapsed) {
    return (
      <div className="flex h-full w-11 shrink-0 flex-col items-center gap-2 border-r border-hairline bg-white py-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Show filters"
          aria-label="Show filters"
          className="rounded border border-hairline-strong bg-white px-1.5 py-1 text-xs text-muted transition-colors hover:border-midnight hover:text-ink"
        >
          ▸
        </button>
        {count > 0 ? (
          <span
            className="rounded-full bg-goldenrod px-1.5 py-0.5 text-[10px] font-semibold tabular text-midnight"
            title={`${count} active filters`}
          >
            {count}
          </span>
        ) : null}
        <span className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted [writing-mode:vertical-rl]">
          Filters
        </span>
      </div>
    );
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-hairline bg-white text-body">
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Filters
          </h2>
          {count > 0 ? (
            <span className="rounded-full bg-goldenrod px-1.5 py-0.5 text-[10px] font-semibold tabular text-midnight">
              {count}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {count > 0 ? (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-medium text-brightblue transition-colors hover:text-midnight"
            >
              Clear all
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="Hide filters"
            aria-label="Hide filters"
            className="rounded border border-hairline-strong bg-white px-1.5 py-0.5 text-xs text-muted transition-colors hover:border-midnight hover:text-ink"
          >
            ◂
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Search ------------------------------------------------------- */}
        <Section title="Search" active={!!filters.search.trim()}>
          <input
            type="search"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            placeholder="Address, building, landlord, agent, notes…"
            aria-label="Search listings"
            className="w-full rounded border border-hairline-strong bg-white px-2.5 py-1.5 text-xs text-ink placeholder:text-muted focus:border-midnight"
          />
        </Section>

        {/* Asking rent -------------------------------------------------- */}
        <Section
          title="Asking rent"
          active={filters.rentMin !== null || filters.rentMax !== null || !filters.includeWithheld}
        >
          <RangeFilter
            label="Asking rent / SF"
            unit="$"
            unitPosition="prefix"
            hint={options.rentRange}
            min={filters.rentMin}
            max={filters.rentMax}
            onChange={({ min, max }) => setFilters({ rentMin: min, rentMax: max })}
          />
          <label className="flex cursor-pointer items-start gap-2 text-xs text-body">
            <input
              type="checkbox"
              checked={filters.includeWithheld}
              onChange={(e) => setFilters({ includeWithheld: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-midnight"
            />
            <span>
              Include withheld rents
              <span className="block text-xs leading-snug text-muted">
                Roughly half of listings withhold rent. Unchecking hides them entirely.
              </span>
            </span>
          </label>
        </Section>

        {/* Size --------------------------------------------------------- */}
        <Section title="Size (SF)" active={filters.sfMin !== null || filters.sfMax !== null}>
          <RangeFilter
            label="Square feet"
            unit="SF"
            unitPosition="suffix"
            hint={options.sfRange}
            min={filters.sfMin}
            max={filters.sfMax}
            onChange={({ min, max }) => setFilters({ sfMin: min, sfMax: max })}
          />
        </Section>

        {/* Floor -------------------------------------------------------- */}
        <Section
          title="Floor"
          active={filters.floorMin !== null || filters.floorMax !== null}
          defaultOpen={false}
        >
          <RangeFilter
            label="Floor number"
            min={filters.floorMin}
            max={filters.floorMax}
            onChange={({ min, max }) => setFilters({ floorMin: min, floorMax: max })}
          />
        </Section>

        {/* Lease expiration --------------------------------------------- */}
        <Section
          title="Lease expiration"
          active={!!filters.expiresBefore || !!filters.expiresAfter}
          defaultOpen={false}
        >
          <DateFilter
            label="Expires before"
            value={filters.expiresBefore}
            onChange={(expiresBefore) => setFilters({ expiresBefore })}
            presets={[
              { label: 'Expiring within 12 months', value: toIso(addMonths(today, 12)) },
              { label: 'Expiring within 24 months', value: toIso(addMonths(today, 24)) },
            ]}
          />
          <DateFilter
            label="Expires after"
            value={filters.expiresAfter}
            onChange={(expiresAfter) => setFilters({ expiresAfter })}
            presets={[{ label: `${nextYear} or later`, value: `${nextYear}-01-01` }]}
          />
          <p className="text-xs leading-snug text-muted">
            Spaces with a negotiable or open-ended term carry no expiration date and are
            excluded while this filter is active.
          </p>
        </Section>

        {/* Availability -------------------------------------------------- */}
        <Section title="Availability" active={!!filters.availableBefore} defaultOpen={false}>
          <DateFilter
            label="Available by"
            value={filters.availableBefore}
            onChange={(availableBefore) => setFilters({ availableBefore })}
            presets={[{ label: 'Vacant now', value: todayIso }]}
          />
        </Section>

        {/* Date added ---------------------------------------------------- */}
        <Section title="Date added" active={!!filters.addedAfter} defaultOpen={false}>
          <DateFilter
            label="Added after"
            value={filters.addedAfter}
            onChange={(addedAfter) => setFilters({ addedAfter })}
            presets={[
              { label: 'This week', value: toIso(addDays(today, -7)) },
              { label: 'Last 30 days', value: toIso(addDays(today, -30)) },
            ]}
          />
        </Section>

        {/* Class --------------------------------------------------------- */}
        <Section title="Class" active={filters.classes.length > 0}>
          <ToggleGroup<'A' | 'B' | 'C'>
            options={[
              { value: 'A', label: 'A' },
              { value: 'B', label: 'B' },
              { value: 'C', label: 'C' },
            ]}
            selected={filters.classes.filter((c): c is 'A' | 'B' | 'C' => c !== null)}
            onChange={(next) => setFilters({ classes: next as BuildingClass[] })}
          />
        </Section>

        {/* Type ---------------------------------------------------------- */}
        <Section title="Type" active={filters.leaseTypes.length > 0}>
          <ToggleGroup<LeaseType>
            options={[
              { value: 'direct', label: 'Direct' },
              { value: 'sublet', label: 'Sublet' },
            ]}
            selected={filters.leaseTypes}
            onChange={(leaseTypes) => setFilters({ leaseTypes })}
          />
        </Section>

        {/* Space use ----------------------------------------------------- */}
        <Section title="Space use" active={filters.spaceUses.length > 0} defaultOpen={false}>
          <MultiSelect
            label="Space use"
            options={options.spaceUses}
            selected={filters.spaceUses}
            onChange={(spaceUses) => setFilters({ spaceUses })}
          />
        </Section>

        {/* Submarket cluster --------------------------------------------- */}
        <Section
          title="Submarket cluster"
          active={filters.submarketClusters.length > 0}
          defaultOpen={false}
        >
          <MultiSelect
            label="Submarket cluster"
            options={options.submarketClusters}
            selected={filters.submarketClusters}
            onChange={(submarketClusters) => setFilters({ submarketClusters })}
          />
        </Section>

        {/* Leasing company ----------------------------------------------- */}
        <Section
          title="Leasing company"
          active={filters.leasingCompanies.length > 0}
          defaultOpen={false}
        >
          <MultiSelect
            label="Leasing company"
            options={options.leasingCompanies}
            selected={filters.leasingCompanies}
            onChange={(leasingCompanies) => setFilters({ leasingCompanies })}
          />
        </Section>
      </div>
    </aside>
  );
}
