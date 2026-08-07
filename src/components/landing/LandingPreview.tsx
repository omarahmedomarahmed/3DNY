/**
 * A drawn illustration of the product, not a screenshot — it renders instantly,
 * needs no data, and cannot go stale. Shows the thing the tool is actually for:
 * a tower with its available floors banded, and a space card beside it.
 */
export default function LandingPreview() {
  const floors = [
    { y: 96, available: false },
    { y: 122, available: true, label: 'Entire 33rd' },
    { y: 148, available: false },
    { y: 174, available: true, label: 'Entire 15th', partial: false },
    { y: 200, available: false },
    { y: 226, available: true, label: 'Partial 11th', partial: true },
    { y: 252, available: false },
    { y: 278, available: false },
  ];

  return (
    <div className="relative animate-fade-up [animation-delay:120ms]">
      <div className="overflow-hidden rounded-card border border-white/15 bg-white shadow-float">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-hairline bg-surface-alt px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-hairline-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-hairline-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-hairline-strong" />
          <span className="ml-3 text-[11px] text-subtle">540 Madison Avenue</span>
        </div>

        <div className="grid grid-cols-[1.25fr_1fr]">
          {/* Tower with banded floors */}
          <div className="relative bg-surface-sunken">
            <svg viewBox="0 0 220 340" className="h-full w-full" role="img" aria-label="Building with available floors highlighted">
              {/* neighbours */}
              <rect x="6" y="210" width="42" height="130" fill="#E4E8EF" />
              <rect x="172" y="186" width="44" height="154" fill="#E4E8EF" />
              <rect x="54" y="240" width="26" height="100" fill="#EDF0F5" />

              {/* subject tower */}
              <rect x="84" y="70" width="84" height="270" fill="#001E5A" />
              <polygon points="84,70 126,52 168,70" fill="#12306E" />

              {/* floor lines */}
              {floors.map((f) => (
                <rect key={f.y} x="84" y={f.y} width="84" height="1" fill="#FFFFFF" opacity="0.12" />
              ))}

              {/* available floor bands */}
              {floors
                .filter((f) => f.available)
                .map((f) => (
                  <g key={`band-${f.y}`}>
                    <rect
                      x="80"
                      y={f.y - 14}
                      width="92"
                      height="18"
                      fill="#FFB600"
                      opacity={f.partial ? 0.62 : 1}
                    />
                    <line
                      x1="172"
                      y1={f.y - 5}
                      x2="196"
                      y2={f.y - 5}
                      stroke="#FFB600"
                      strokeWidth="1.5"
                    />
                    <circle cx="198" cy={f.y - 5} r="2.5" fill="#FFB600" />
                  </g>
                ))}

              {/* ground */}
              <rect x="0" y="338" width="220" height="2" fill="#D2D6DD" />
            </svg>

            <span className="absolute bottom-3 left-4 text-[10px] uppercase tracking-[0.12em] text-subtle">
              3 floors available
            </span>
          </div>

          {/* Space card */}
          <div className="border-l border-hairline p-5">
            <span className="inline-block rounded bg-midnight-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-midnight-700">
              Class A · Direct
            </span>
            <h3 className="mt-3 text-sm font-semibold leading-snug text-ink">
              540 Madison Avenue
            </h3>
            <p className="text-xs text-subtle">Plaza District</p>

            <dl className="mt-5 space-y-3">
              {[
                ['Floor', 'Entire 33rd'],
                ['Size', '6,950 SF'],
                ['Asking', '$92.00 /SF'],
                ['Available', 'Vacant'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <dt className="text-[11px] uppercase tracking-wider text-subtle">{k}</dt>
                  <dd className="tabular text-sm font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 space-y-2">
              <div className="rounded bg-goldenrod px-3 py-2 text-center text-xs font-semibold text-midnight">
                Add to compare
              </div>
              <div className="rounded border border-hairline-strong px-3 py-2 text-center text-xs text-muted">
                Comps within ¼ mile
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Compare tray peeking from the bottom */}
      <div className="absolute -bottom-5 left-8 right-8 rounded border border-white/15 bg-midnight-700 px-4 py-3 shadow-float">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-goldenrod">
            Compare · 3
          </span>
          <div className="flex flex-1 gap-2 overflow-hidden">
            {['540 Madison · 33', '500 Fifth · 26', '900 Third · 5'].map((chip) => (
              <span
                key={chip}
                className="truncate rounded bg-white/10 px-2 py-1 text-[10px] text-white/80"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
