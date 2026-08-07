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
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-200">{label}</span>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[10px] uppercase tracking-wide text-accent hover:underline"
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
        className="w-full rounded border border-edge bg-ink px-2 py-1 text-xs tabular-nums text-slate-100 outline-none focus:border-accent [color-scheme:dark]"
      />

      {presets && presets.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {presets.map((preset) => {
            const active = preset.value !== null && preset.value === value;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => onChange(preset.value)}
                aria-pressed={active}
                className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
                  active
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-edge text-muted hover:border-accent/60 hover:text-slate-100'
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
