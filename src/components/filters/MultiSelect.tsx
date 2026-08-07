'use client';

import { useMemo, useState } from 'react';

interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Show the search box once the list is longer than this. */
  searchThreshold?: number;
  emptyHint?: string;
  /**
   * Hide the visible caption when the surrounding section heading already says
   * the same thing. The clear affordance stays put.
   */
  showLabel?: boolean;
}

export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchThreshold = 8,
  emptyHint = 'No values in the current data.',
  showLabel = true,
}: MultiSelectProps) {
  const [query, setQuery] = useState('');

  const safeOptions = useMemo(
    () => (Array.isArray(options) ? options.filter((o): o is string => !!o) : []),
    [options],
  );

  const showSearch = safeOptions.length > searchThreshold;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return safeOptions;
    return safeOptions.filter((o) => o.toLowerCase().includes(q));
  }, [safeOptions, query]);

  const toggle = (option: string) => {
    onChange(
      selected.includes(option)
        ? selected.filter((s) => s !== option)
        : [...selected, option],
    );
  };

  return (
    <div className="space-y-2">
      {showLabel || selected.length > 0 ? (
        <div className="flex items-baseline justify-between gap-2">
          {showLabel ? (
            <span className="text-sm font-medium text-body">{label}</span>
          ) : (
            <span />
          )}
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brightblue transition-colors hover:text-midnight"
            >
              {selected.length} selected · clear
            </button>
          ) : null}
        </div>
      ) : null}

      {showSearch ? (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}…`}
          aria-label={`Search ${label}`}
          className="w-full rounded-card border border-hairline-strong bg-white px-3 py-2 text-sm font-medium text-ink outline-none placeholder:font-normal placeholder:text-muted focus:border-midnight"
        />
      ) : null}

      {safeOptions.length === 0 ? (
        <p className="text-sm text-muted">{emptyHint}</p>
      ) : (
        <div className="max-h-52 space-y-0.5 overflow-y-auto pr-1">
          {visible.length === 0 ? (
            <p className="py-1 text-sm text-muted">No match for “{query}”.</p>
          ) : (
            visible.map((option) => {
              const checked = selected.includes(option);
              return (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-2.5 rounded px-1.5 py-1.5 text-sm transition-colors hover:bg-surface-alt ${
                    checked ? 'font-semibold text-ink' : 'font-medium text-body'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(option)}
                    className="h-4 w-4 shrink-0 accent-midnight"
                  />
                  <span className="truncate" title={option}>
                    {option}
                  </span>
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
