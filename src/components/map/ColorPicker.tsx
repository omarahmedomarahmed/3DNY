'use client';

import { useApp } from '@/lib/store';
import type { ColorOverrides } from './colors';

/**
 * One swatch that opens the operating system's colour picker.
 *
 * A native `<input type="color">` rather than a grid of choices, and that is
 * the whole point: the reason to change one of these is almost always that a
 * specific room, projector or pair of eyes cannot separate two of the
 * defaults, and a palette of eight tasteful alternatives does not help with
 * that. The reset link beside it matters as much as the swatch — the defaults
 * are considered, and getting back to them has to be one click, not a memory
 * test about which hex Goldenrod was.
 */
export default function ColorPicker({
  label,
  hint,
  which,
  fallback,
}: {
  label: string;
  /** What this colour is used for, when the label alone is not obvious. */
  hint?: string;
  which: keyof ColorOverrides;
  /** The default, shown in the swatch until the user picks something else. */
  fallback: string;
}) {
  const overrides = useApp((s) => s.colorOverrides);
  const setColorOverride = useApp((s) => s.setColorOverride);
  const current = overrides[which] ?? fallback;
  const changed = overrides[which] !== undefined;

  return (
    <li className="flex items-center gap-2">
      <label
        className="relative h-5 w-5 shrink-0 cursor-pointer overflow-hidden rounded-sm border border-hairline-strong"
        style={{ background: current }}
        title={`Change the colour for ${label.toLowerCase()}`}
      >
        <input
          type="color"
          value={current}
          onChange={(e) => setColorOverride(which, e.target.value)}
          aria-label={`Colour for ${label}`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-tight text-ink">{label}</span>
        {hint ? (
          <span className="block text-[11px] leading-snug text-subtle">{hint}</span>
        ) : null}
      </span>
      {changed ? (
        <button
          type="button"
          onClick={() => setColorOverride(which, null)}
          className="shrink-0 text-[11px] font-semibold text-brightblue transition-colors hover:text-midnight"
        >
          Reset
        </button>
      ) : null}
    </li>
  );
}
