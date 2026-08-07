'use client';

export interface DatePreset {
  label: string;
  /** ISO YYYY-MM-DD, or null to clear. */
  value: string | null;
}

interface DateFilterProps {
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
  presets?: DatePreset[];
  min?: string;
  max?: string;
}

/** Guards against a browser handing back a partial value while typing. */
function normalise(raw: string): string | null {
  const trimmed = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export default function DateFilter({
  label,
  value,
  onChange,
  presets,
  min,
  max,
}: DateFilterProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-body">{label}</span>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brightblue transition-colors hover:text-midnight"
          >
            Clear
          </button>
        ) : null}
      </div>

      <input
        type="date"
        aria-label={label}
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(e) => onChange(normalise(e.target.value))}
        className="tabular w-full rounded-card border border-hairline-strong bg-white px-3 py-2 text-sm font-medium text-ink outline-none focus:border-midnight [color-scheme:light]"
      />

      {presets && presets.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => {
            const active = preset.value !== null && preset.value === value;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => onChange(active ? null : preset.value)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-goldenrod bg-goldenrod text-midnight'
                    : 'border-hairline-strong bg-white text-body hover:border-midnight hover:text-ink'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
