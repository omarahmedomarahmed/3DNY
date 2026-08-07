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
}

export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchThreshold = 8,
  emptyHint = 'No values in the current data.',
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
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-body">{label}</span>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brightblue transition-colors hover:text-midnight"
          >
            {selected.length} selected · clear
          </button>
        ) : null}
      </div>

      {showSearch ? (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}…`}
          aria-label={`Search ${label}`}
          className="w-full rounded border border-hairline-strong bg-white px-2.5 py-1.5 text-xs text-ink placeholder:text-muted focus:border-midnight"
        />
      ) : null}

      {safeOptions.length === 0 ? (
        <p className="text-xs text-muted">{emptyHint}</p>
      ) : (
        <div className="max-h-44 space-y-0.5 overflow-y-auto rounded border border-hairline-strong bg-surface-alt p-1">
          {visible.length === 0 ? (
            <p className="px-1 py-1 text-xs text-muted">No match for “{query}”.</p>
          ) : (
            visible.map((option) => {
              const checked = selected.includes(option);
              return (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors hover:bg-white ${
                    checked ? 'font-medium text-ink' : 'text-body'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(option)}
                    className="h-3.5 w-3.5 shrink-0 accent-midnight"
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
