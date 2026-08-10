'use client';

/**
 * The buttons that put the two rails away and bring them back.
 *
 * Both rails start closed, so these are the only way back to them — which
 * makes them the wrong place to be subtle. Everything else that floats over
 * this map is a 36-pixel icon square, deliberately quiet so it never competes
 * with a Goldenrod band. These are not: they carry a word, they are twice the
 * height of a control button, and they sit in the two corners nothing else
 * uses. A control nobody can find is a feature nobody has.
 *
 * They stay short of Goldenrod all the same. The rule is that availability is
 * the loudest thing on screen, and a pair of gold buttons in the corners would
 * be the second loudest — which is close enough to break it. Midnight on
 * white, which reads as chrome at a glance and as a button on purpose.
 */

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {direction === 'left' ? (
        <polyline points="15,5 8,12 15,19" />
      ) : (
        <polyline points="9,5 16,12 9,19" />
      )}
    </svg>
  );
}

export function RailShowButton({
  side,
  label,
  badge,
  onClick,
}: {
  side: 'left' | 'right';
  label: string;
  /** Active filter count, or the number of results. Omitted when zero. */
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Show ${label.toLowerCase()}`}
      className={
        'pointer-events-auto absolute top-4 z-30 flex items-center gap-2 rounded-card border ' +
        'border-hairline-strong bg-white px-4 py-3 text-sm font-semibold text-midnight ' +
        'shadow-float transition-colors hover:border-midnight hover:bg-goldenrod-50 ' +
        (side === 'left' ? 'left-4' : 'right-4')
      }
    >
      {side === 'right' && <Chevron direction="left" />}
      {label}
      {badge ? (
        <span className="tabular rounded-full bg-goldenrod px-2 py-0.5 text-[11px] font-semibold text-midnight">
          {badge}
        </span>
      ) : null}
      {side === 'left' && <Chevron direction="right" />}
    </button>
  );
}

export function RailHideButton({
  side,
  label,
  onClick,
}: {
  side: 'left' | 'right';
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Hide ${label.toLowerCase()}`}
      className="flex items-center gap-1.5 rounded border border-hairline-strong bg-white px-3 py-2 text-[13px] font-semibold text-midnight transition-colors hover:border-midnight hover:bg-goldenrod-50"
    >
      {side === 'left' && <Chevron direction="left" />}
      Hide
      {side === 'right' && <Chevron direction="right" />}
    </button>
  );
}
