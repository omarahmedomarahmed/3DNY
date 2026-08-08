'use client';

import { useEffect, useRef } from 'react';
import { useApp, useCompareDetails } from '@/lib/store';
import CompareView from './CompareView';

/**
 * Compare, on the map.
 *
 * It used to be a page takeover launched from a full-width bottom tray, which
 * meant the moment a broker compared anything, the map — the thing everyone in
 * the room is looking at — was gone. Now it is a floating panel: the towers it
 * describes stay on screen behind it, and dismissing it puts you straight back
 * on the map.
 *
 * The rule that matters most here is the one that is easy to get wrong:
 *
 *   **Closing the panel must never empty it.**
 *
 * Dismissing a popup and discarding its contents are different intentions, and
 * conflating them loses a comparison a broker spent a meeting assembling. So
 * closing only ever sets `compareOpen`; the compare set itself is untouched,
 * and reopening shows exactly the same spaces. The single deliberate way to
 * empty the comparison is "Clear all", which says so.
 */

/** A launcher chip, so the comparison is one click away without covering the map. */
function CompareChip({
  count,
  open,
  onOpen,
}: {
  count: number;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={open}
      // Deliberately NOT Goldenrod, even in its open state. This chip sits on
      // the map canvas, and on the map Goldenrod means one thing only:
      // available space. A Goldenrod pill down in the corner is a second
      // claim on the same attention the bands are supposed to own.
      className={
        'pointer-events-auto flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold shadow-float transition-colors ' +
        (open
          ? 'border-midnight bg-midnight text-white'
          : 'border-hairline-strong bg-white text-ink hover:border-midnight')
      }
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {/* Two panels side by side — the comparison itself. */}
        <rect x="3.5" y="5" width="7" height="14" rx="1.5" />
        <rect x="13.5" y="5" width="7" height="14" rx="1.5" />
      </svg>
      Compare
      <span
        className={
          'tabular rounded-full px-1.5 py-0.5 text-[11px] font-bold ' +
          (open ? 'bg-white/20 text-white' : 'bg-midnight text-white')
        }
      >
        {count}
      </span>
    </button>
  );
}

export default function ComparePanel() {
  const compare = useApp((s) => s.compare);
  const compareOpen = useApp((s) => s.compareOpen);
  const setCompareOpen = useApp((s) => s.setCompareOpen);
  const buildings = useApp((s) => s.buildings);
  const loadCompareFromUrl = useApp((s) => s.loadCompareFromUrl);
  const details = useCompareDetails();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hydratedFromUrl = useRef(false);

  // A shared ?compare=... link has to resolve once the buildings arrive.
  useEffect(() => {
    if (hydratedFromUrl.current || buildings.length === 0) return;
    hydratedFromUrl.current = true;
    const param = new URLSearchParams(window.location.search).get('compare');
    if (!param) return;
    const ids = param.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) loadCompareFromUrl(ids);
  }, [buildings, loadCompareFromUrl]);

  // Close on any click that did not land inside the panel — the same rule
  // every other popup on this map follows, so a broker never has to learn a
  // second dismissal gesture. Capture phase, exactly as SpacePopup does it, so
  // this runs before deck.gl's own canvas handler.
  //
  // This ONLY closes. It must never touch the compare set.
  useEffect(() => {
    if (!compareOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const el = cardRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      // The launcher chip toggles on its own; letting this handler see the
      // click too would close and reopen in the same gesture.
      if (e.target instanceof Element && e.target.closest('[data-compare-launcher]')) return;
      setCompareOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCompareOpen(false);
    };
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [compareOpen, setCompareOpen]);

  if (compare.length === 0) return null;

  return (
    <>
      {/* Minimised, Compare is a chip at the top left — the one corner of the
          map with no chrome in it. The control stack and the transit filters
          are top right, the legend is bottom left, the radius control bottom
          right. */}
      {!compareOpen && (
        <div
          data-compare-launcher
          className="pointer-events-none absolute left-4 top-4 z-[60] flex"
        >
          <CompareChip count={compare.length} open={false} onOpen={() => setCompareOpen(true)} />
        </div>
      )}

      {/* Expanded, it takes most of the map — a comparison is a table, and a
          table squeezed into a strip is unreadable across a conference table.

          Two deliberate gaps, both of which it needs:

          The right rail is left clear so zoom, rotate, pitch, theme and the
          rest stay reachable. This is a panel over the map, and the map has to
          keep working underneath it.

          The band along the top is left clear so there is still somewhere to
          click. "Click the map to dismiss" needs a piece of map; a panel that
          reaches every edge has nowhere to click and strands the user on the
          Minimise button.

          z-[60] puts it above the space popup (z-50) and the transit popup
          (z-40). Those used to render ON TOP of the comparison, which is what
          made the panel feel like the thing in the background. */}
      {compareOpen && (
        <div className="pointer-events-none absolute bottom-4 left-4 right-16 top-16 z-[60] flex">
          <CompareView variant="panel" panelRef={cardRef} onClose={() => setCompareOpen(false)} />
        </div>
      )}

      {/* Screen readers get the count without having to open the panel. */}
      <span className="sr-only" aria-live="polite">
        {details.length} {details.length === 1 ? 'space' : 'spaces'} in the comparison
      </span>
    </>
  );
}
