'use client';

interface RangeFilterProps {
  label: string;
  min: number | null;
  max: number | null;
  onChange: (next: { min: number | null; max: number | null }) => void;
  /** Rendered inside each input, e.g. "$" or "SF". */
  unit?: string;
  /** Where the unit sits relative to the number. */
  unitPosition?: 'prefix' | 'suffix';
  /** Actual spread in the data, used for placeholder hints. */
  hint?: [number, number] | null;
  step?: number;
}

/** Empty means "no bound" — never 0, which would silently exclude rows. */
function parse(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function hintText(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return String(Math.round(value));
}

export default function RangeFilter({
  label,
  min,
  max,
  onChange,
  unit,
  unitPosition = 'prefix',
  hint,
  step,
}: RangeFilterProps) {
  const lowHint = hintText(hint?.[0]);
  const highHint = hintText(hint?.[1]);

  const field = (
    which: 'min' | 'max',
    value: number | null,
    placeholder: string | undefined,
  ) => (
    <label className="flex flex-1 items-center gap-1 rounded border border-hairline-strong bg-white px-2 py-1.5 focus-within:border-midnight">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        {which === 'min' ? 'Min' : 'Max'}
      </span>
      {unit && unitPosition === 'prefix' ? (
        <span className="text-xs text-muted">{unit}</span>
      ) : null}
      <input
        type="number"
        inputMode="decimal"
        step={step}
        aria-label={`${label} ${which === 'min' ? 'minimum' : 'maximum'}`}
        value={value ?? ''}
        placeholder={placeholder ?? ''}
        onChange={(e) =>
          onChange(
            which === 'min'
              ? { min: parse(e.target.value), max }
              : { min, max: parse(e.target.value) },
          )
        }
        className="tabular w-full min-w-0 bg-transparent text-right text-xs font-medium text-ink outline-none placeholder:font-normal placeholder:text-muted [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {unit && unitPosition === 'suffix' ? (
        <span className="text-xs text-muted">{unit}</span>
      ) : null}
    </label>
  );

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-body">{label}</div>
      <div className="flex items-center gap-2">
        {field('min', min, lowHint)}
        <span className="text-xs text-subtle">–</span>
        {field('max', max, highHint)}
      </div>
    </div>
  );
}
