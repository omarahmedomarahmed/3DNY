'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, useCompareDetails } from '@/lib/store';
import { isInsideSourcePopover } from '@/components/ui/SourceInfo';
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
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

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
      // Source popovers are portalled to the body, so they sit outside this
      // panel. Reading where a figure came from must not close the comparison
      // it was being read against.
      if (isInsideSourcePopover(e.target)) return;
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

  /**
   * How big the comparison is, once someone has said.
   *
   * Null means "the default", which is most of the map — right for four
   * spaces with every row showing, and far more than is wanted for two. The
   * size is deliberately not persisted anywhere: it is a per-meeting
   * adjustment, like the camera angle, not a preference.
   */
  const onResizeStart = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const panel = (e.currentTarget as HTMLElement).parentElement;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: PointerEvent) => {
      // Grows rightward and upward, because the panel is anchored to its
      // bottom-left corner — moving the grip up has to make it taller, not
      // move it. Floors are what stop it collapsing to something unreadable
      // and the viewport is what stops it growing off screen.
      const w = Math.max(360, Math.min(rect.width + (ev.clientX - startX), window.innerWidth - 32));
      const h = Math.max(240, Math.min(rect.height - (ev.clientY - startY), window.innerHeight - 96));
      setSize({ w, h });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  if (compare.length === 0) return null;

  return (
    <>
      {/* Minimised, Compare is a chip below the Filters button on the left.
          The very top corners belong to the two rail buttons — they are the
          only way back to a hidden rail, so nothing else may sit on them. */}
      {!compareOpen && (
        <div
          data-compare-launcher
          className="pointer-events-none absolute left-4 top-20 z-[60] flex"
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
        <div
          className="pointer-events-none absolute bottom-4 left-4 z-[60] flex"
          style={{
            width: size?.w ?? 'calc(100% - 5rem)',
            height: size?.h ?? 'calc(100% - 5rem)',
          }}
        >
          <CompareView variant="panel" panelRef={cardRef} onClose={() => setCompareOpen(false)} />

          {/* Resize, from the corner opposite the anchor.
              The panel is pinned bottom-left, so the top-right corner is the
              only one that can move both dimensions — and dragging up-and-right
              to grow is the direction that matches what you see happen. */}
          <button
            type="button"
            onPointerDown={onResizeStart}
            aria-label="Resize the comparison"
            title="Drag to resize"
            className="pointer-events-auto absolute -top-1 -right-1 z-10 flex h-6 w-6 cursor-nesw-resize items-center justify-center rounded-full border border-hairline-strong bg-white text-muted shadow-card transition-colors hover:border-midnight hover:text-ink"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="14,4 20,4 20,10" />
              <polyline points="10,20 4,20 4,14" />
              <line x1="20" y1="4" x2="4" y2="20" />
            </svg>
          </button>
        </div>
      )}

      {/* Screen readers get the count without having to open the panel. */}
      <span className="sr-only" aria-live="polite">
        {details.length} {details.length === 1 ? 'space' : 'spaces'} in the comparison
      </span>
    </>
  );
}
