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
        <span className="text-xs font-medium text-slate-200">{label}</span>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[10px] uppercase tracking-wide text-accent hover:underline"
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
          className="w-full rounded border border-edge bg-ink px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-muted/60 focus:border-accent"
        />
      ) : null}

      {safeOptions.length === 0 ? (
        <p className="text-xs text-muted">{emptyHint}</p>
      ) : (
        <div className="max-h-44 space-y-0.5 overflow-y-auto rounded border border-edge bg-ink/60 p-1">
          {visible.length === 0 ? (
            <p className="px-1 py-1 text-xs text-muted">No match for “{query}”.</p>
          ) : (
            visible.map((option) => {
              const checked = selected.includes(option);
              return (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-panel ${
                    checked ? 'text-slate-100' : 'text-muted'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(option)}
                    className="h-3 w-3 shrink-0 accent-[#4c9aff]"
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
