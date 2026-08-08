'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

import type { SourceNote } from '@/lib/provenance';

/**
 * The circled "i" that lets any value on the screen name its own source.
 *
 * The hard part of this component is not the popover. It is staying quiet.
 *
 * There are five of these in a building header, six in a space detail, one per
 * row in compare — forty on a busy screen. The rule this whole map is built
 * around is that a Goldenrod band on the 14th floor is the loudest thing in
 * the room, and forty small marks all competing for a glance would break that
 * faster than any colour change. So:
 *
 * - It is drawn in the muted text colour at roughly half opacity, and only
 *   reaches full contrast on hover or keyboard focus. At a glance it is
 *   punctuation; when looked for, it is a control.
 * - It is never Goldenrod, and never coloured by state. An "i" beside a
 *   corrected value looks exactly like an "i" beside an imported one — the
 *   difference is in what it says, not in how loudly it says it.
 * - It sits after the value, at 12px, and never changes the value's line
 *   height. A row with sources must lay out identically to one without.
 *
 * Behaviour, all of it deliberate:
 *
 * - Click, not hover. Hover tooltips are unreachable on a touch screen and
 *   fire by accident while a broker is dragging the map.
 * - One open at a time, across the whole page, via a document event. Two
 *   overlapping source cards is a bug, not a feature.
 * - Rendered into a portal, because most of the surfaces it lives on
 *   (`SpacePopup`, compare rows, table cells) clip their overflow — an inline
 *   popover would be sliced in half by its own container.
 * - Because it IS in a portal, it is outside the popup that spawned it, and
 *   the map's dismiss-on-outside-click handlers would treat a click on it as a
 *   click on the map. Hence `data-source-popover` and `isInsideSourcePopover`,
 *   which those handlers consult.
 */

/** Fired when any source popover opens, so the others can close themselves. */
const OPEN_EVENT = 'sourceinfo:open';

/**
 * True when an event landed inside an open source popover.
 *
 * Every dismiss-on-outside-click handler on the map has to call this. Without
 * it, reading where a number came from closes the card the number was on.
 */
export function isInsideSourcePopover(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-source-popover]') !== null;
}

const CARD_W = 288;
const GAP = 8;
const MARGIN = 10;

export interface SourceInfoProps {
  note: SourceNote;
  /**
   * What the value is — "Year built", "Asking rent". Used in the button's
   * accessible name and as the popover's eyebrow, so a screen-reader user
   * hears which of the forty icons they landed on.
   */
  label: string;
  /** For dark surfaces. Inherits `currentColor` at reduced opacity instead. */
  tone?: 'quiet' | 'inverse';
  className?: string;
}

export default function SourceInfo({ note, label, tone = 'quiet', className }: SourceInfoProps) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  // One open at a time. Each popover announces itself; everyone else stands
  // down. Cheaper than a context provider and works across portals, tables and
  // the map's own overlays without any of them knowing this exists.
  useEffect(() => {
    if (!open) return;
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) close();
    };
    document.addEventListener(OPEN_EVENT, onOther);
    return () => document.removeEventListener(OPEN_EVENT, onOther);
  }, [open, id, close]);

  // Dismissal: anywhere outside, or Escape. Capture phase, matching every other
  // dismissible surface here, so it runs before deck.gl's canvas handler.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const card = cardRef.current;
      const button = buttonRef.current;
      if (e.target instanceof Node && (card?.contains(e.target) || button?.contains(e.target))) {
        return;
      }
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Stop the same keypress closing the card underneath as well: reading a
      // source and dismissing the space popup are two different intentions.
      e.stopPropagation();
      close();
      buttonRef.current?.focus();
    };
    const onScroll = () => close();
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onScroll);
    // Capture, so a scroll inside any container counts — the popover is
    // positioned against a rect that a scroll invalidates.
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close]);

  // Measure after render, before paint, so the card never flashes at 0,0.
  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const card = cardRef.current;
    if (!button || !card) return;

    const rect = button.getBoundingClientRect();
    const h = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Anchor the card's left edge to the icon, then pull it back on screen.
    let left = rect.left;
    if (left + CARD_W > vw - MARGIN) left = rect.right - CARD_W;
    left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - CARD_W - MARGIN));

    // Below by default; above when below would run off the bottom.
    let top = rect.bottom + GAP;
    if (top + h > vh - MARGIN) top = rect.top - GAP - h;
    top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - h - MARGIN));

    setPos({ left, top });
    card.focus({ preventScroll: true });
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    // The icon usually sits inside something else clickable — a card that
    // selects a space, a row that opens a building. Asking where a number came
    // from is not asking to navigate.
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      close();
      return;
    }
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    setOpen(true);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        onMouseDown={(e) => e.stopPropagation()}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Where ${label} came from`}
        title={`Where ${label} came from`}
        className={clsx(
          'inline-flex h-[15px] w-[15px] shrink-0 translate-y-[1px] items-center justify-center',
          'rounded-full align-baseline transition-opacity',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
          tone === 'inverse'
            ? 'text-white/70 opacity-70 hover:opacity-100 focus-visible:outline-white/60'
            : 'text-muted opacity-55 hover:opacity-100 focus-visible:outline-midnight',
          open && 'opacity-100',
          className,
        )}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 11v5.2" />
          <path d="M12 7.6h.01" />
        </svg>
      </button>

      {mounted && open
        ? createPortal(
            <div
              ref={cardRef}
              data-source-popover=""
              role="dialog"
              aria-label={`Source for ${label}`}
              tabIndex={-1}
              style={{
                position: 'fixed',
                left: pos?.left ?? -9999,
                top: pos?.top ?? -9999,
                width: CARD_W,
                maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
                visibility: pos ? 'visible' : 'hidden',
              }}
              className="z-[90] rounded-card border border-hairline bg-white p-3.5 shadow-float outline-none"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-subtle">
                {label}
              </p>
              <p className="mt-1 text-[13px] font-semibold leading-snug text-ink">{note.label}</p>
              <p className="mt-1.5 text-[12px] font-medium leading-5 text-body">{note.detail}</p>

              {note.approximate ? (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded bg-warn-surface px-2 py-1 text-[11px] font-semibold text-warn">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M10.3 3.9 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                    <path d="M12 9.2v4.4" />
                    <path d="M12 17.2h.01" />
                  </svg>
                  Estimate, not a recorded figure
                </p>
              ) : null}

              {note.href ? (
                <a
                  href={note.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-semibold text-brightblue hover:underline"
                >
                  Open the source
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M14 3.5h6.5V10" />
                    <path d="M20.5 3.5 11 13" />
                    <path d="M19 14.2V19a1.8 1.8 0 0 1-1.8 1.8H5A1.8 1.8 0 0 1 3.2 19V6.8A1.8 1.8 0 0 1 5 5h4.8" />
                  </svg>
                </a>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
