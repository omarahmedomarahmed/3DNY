'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { isInsideSourcePopover } from '@/components/ui/SourceInfo';

/**
 * The shell every map card sits in: placed at the click, dragged anywhere,
 * pinned to stay.
 *
 * A card used to open at the pointer and close on the next click, which is
 * right for a glance and wrong for a comparison. Two floors in the same tower,
 * or the same floor in two towers, is the question this map exists to answer,
 * and answering it meant opening one card, remembering it, and opening the
 * other.
 *
 * So there are two states, and exactly one card is ever in the first:
 *
 *   unpinned  The card you are reading. It closes when you click the map,
 *             press Escape, or open another card. There is only one, because
 *             otherwise clicking around a tower quietly leaves a trail of
 *             cards nobody asked to keep.
 *   pinned    Kept until it is closed by hand. Opening another card no longer
 *             disturbs it, so the two sit side by side.
 *
 * Dragging is by the header, not the whole card — the body is full of links,
 * buttons and source markers, and a drag that starts on a button is a click
 * that did not happen. The header also gets `cursor-grab`, which is the only
 * hint anyone needs that the card moves.
 */

/** Gap between the pointer and the card, and the minimum viewport margin. */
const OFFSET = 14;
const MARGIN = 12;

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill={pinned ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 4h6l-1 5 3.2 2.6V14H6.8v-2.4L10 9z" />
      <path d="M12 14v6" />
    </svg>
  );
}

export default function DraggableCard({
  id,
  pinned,
  anchor,
  width,
  ariaLabel,
  title,
  onClose,
  children,
}: {
  /** Store id, so drags and pins address the right card. */
  id: string;
  pinned: boolean;
  /** Where the click landed, in viewport pixels. */
  anchor: { x: number; y: number };
  width: number;
  ariaLabel: string;
  /** Rendered in the drag handle, beside the pin and close buttons. */
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const togglePopupPinned = useApp((s) => s.togglePopupPinned);
  const movePopup = useApp((s) => s.movePopup);

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  /**
   * Placement runs once per anchor, not on every render.
   *
   * The card is measured after render and before paint so it never flashes at
   * an off-screen position on the way to the clamped one — but once it has
   * been dragged, the anchor is history and re-running this would snap the
   * card back under the cursor mid-read.
   */
  const placed = useRef<string>('');
  useLayoutEffect(() => {
    const key = `${anchor.x},${anchor.y}`;
    if (placed.current === key) return;
    const el = cardRef.current;
    if (!el) return;
    placed.current = key;

    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer down-right of the pointer; flip when that would run off the edge,
    // then hard-clamp so the card is always fully on screen.
    let left = anchor.x + OFFSET;
    if (left + w > vw - MARGIN) left = anchor.x - OFFSET - w;
    left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - w - MARGIN));

    let top = anchor.y + OFFSET;
    if (top + h > vh - MARGIN) top = anchor.y - OFFSET - h;
    top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - h - MARGIN));

    setPos({ left, top });
  }, [anchor.x, anchor.y]);

  // --- Dragging by the header.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Left button only, and never from a control inside the header.
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button, a, input, select')) return;

      const el = cardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;

      setDragging(true);
      // Pointer capture, so the card keeps following even when the cursor
      // outruns it — a fast drag otherwise "drops" the card the moment the
      // pointer leaves the header it is holding.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        // Clamped to the viewport: a card dragged off the edge is a card that
        // cannot be dragged back.
        const left = Math.min(Math.max(ev.clientX - dx, MARGIN), Math.max(MARGIN, vw - w - MARGIN));
        const top = Math.min(Math.max(ev.clientY - dy, MARGIN), Math.max(MARGIN, vh - h - MARGIN));
        setPos({ left, top });
      };

      const onUp = (ev: PointerEvent) => {
        setDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const el2 = cardRef.current;
        if (el2) {
          const r = el2.getBoundingClientRect();
          movePopup(id, r.left, r.top);
        }
        // A drag that ends over the map would otherwise be delivered as a
        // click on whatever is underneath, closing the card that was just
        // moved. This is the one place the two gestures are confusable.
        ev.stopPropagation();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { capture: false });
    },
    [id, movePopup],
  );

  /**
   * Dismissal, for the unpinned card only.
   *
   * Capture phase so it runs before deck.gl's own canvas handler: when the
   * click IS on another band, both fire inside one native event, React batches
   * them, and the reopen wins — so the card moves rather than blinking shut.
   */
  useEffect(() => {
    if (pinned) return;
    const onDocClick = (e: MouseEvent) => {
      const el = cardRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      // A source popover is portalled to the body, so it is technically
      // outside this card. Reading where a number came from must not close the
      // card the number is on.
      if (isInsideSourcePopover(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, pinned]);

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={ariaLabel}
      style={{
        position: 'fixed',
        left: pos?.left ?? anchor.x + OFFSET,
        top: pos?.top ?? anchor.y + OFFSET,
        width,
        maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className={
        'z-50 overflow-hidden rounded-card border bg-white shadow-float ' +
        // A pinned card says so at a glance, otherwise "why did that one not
        // close" is a mystery rather than a state.
        (pinned ? 'border-goldenrod' : 'border-hairline')
      }
    >
      <div
        onPointerDown={onPointerDown}
        className={
          'flex items-center gap-1.5 border-b border-hairline bg-surface-alt px-2.5 py-1.5 ' +
          'select-none ' +
          (dragging ? 'cursor-grabbing' : 'cursor-grab')
        }
      >
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
          {title}
        </span>

        <button
          type="button"
          onClick={() => togglePopupPinned(id)}
          aria-pressed={pinned}
          aria-label={pinned ? 'Unpin this card' : 'Pin this card so it stays open'}
          title={
            pinned
              ? 'Pinned — stays open while you click other buildings'
              : 'Pin this card, then open another to compare them side by side'
          }
          className={
            'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors ' +
            (pinned
              ? 'bg-goldenrod text-midnight hover:bg-goldenrod-400'
              : 'text-muted hover:bg-white hover:text-ink')
          }
        >
          <PinIcon pinned={pinned} />
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-white hover:text-ink"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>

      {children}
    </div>
  );
}
