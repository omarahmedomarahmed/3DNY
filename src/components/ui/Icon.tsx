import clsx from 'clsx';

/**
 * The project's whole icon vocabulary, inline and dependency-free.
 *
 * Every glyph is drawn on a 24x24 grid with a 1.5 stroke in `currentColor`, so
 * an icon inherits the colour of the text it sits next to and never needs a
 * palette of its own. This file is the only place icons come from — emoji are
 * never used anywhere in this project, because they render differently on every
 * machine and read as decoration in front of a client.
 */

export type IconName =
  | 'plus'
  | 'trash'
  | 'edit'
  | 'close'
  | 'check'
  | 'upload'
  | 'image'
  | 'camera'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'star'
  | 'building'
  | 'ruler'
  | 'calendar'
  | 'dollar'
  | 'mail'
  | 'phone'
  | 'warning'
  | 'info'
  | 'drag'
  | 'external'
  | 'search'
  | 'filter'
  | 'compare'
  | 'map-pin'
  | 'floor'
  | 'expand';

/**
 * Paths are stroked, never filled — the two exceptions (`drag`'s dots) carry
 * their own fill so they stay legible at 14px on a projector.
 */
const PATHS: Record<IconName, React.ReactNode> = {
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),

  trash: (
    <>
      <path d="M3.5 6h17" />
      <path d="M8.5 6V4.2A1.2 1.2 0 0 1 9.7 3h4.6a1.2 1.2 0 0 1 1.2 1.2V6" />
      <path d="M18.6 6l-.9 13.1A2 2 0 0 1 15.7 21H8.3a2 2 0 0 1-2-1.9L5.4 6" />
      <path d="M10.2 10.5v6" />
      <path d="M13.8 10.5v6" />
    </>
  ),

  edit: (
    <>
      <path d="M4 20h4l10.6-10.6a2.1 2.1 0 0 0 0-3L17.6 5.4a2.1 2.1 0 0 0-3 0L4 16z" />
      <path d="M13.8 6.2l4 4" />
      <path d="M4 16v4h4" />
    </>
  ),

  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),

  check: <path d="M20 6.5 9.4 17.5 4 12.1" />,

  upload: (
    <>
      <path d="M12 16.5V3.5" />
      <path d="m7.5 8 4.5-4.5L16.5 8" />
      <path d="M3.5 15.5V18a2.5 2.5 0 0 0 2.5 2.5h12a2.5 2.5 0 0 0 2.5-2.5v-2.5" />
    </>
  ),

  image: (
    <>
      <rect x="3" y="3.5" width="18" height="17" rx="2.2" />
      <circle cx="8.6" cy="9.2" r="1.7" />
      <path d="m3.4 17.6 4.8-4.8a2 2 0 0 1 2.8 0l6.9 6.9" />
      <path d="m14.6 15.1 2-2a2 2 0 0 1 2.8 0l1.5 1.5" />
    </>
  ),

  camera: (
    <>
      <path d="M4 20.5a2.2 2.2 0 0 1-2.2-2.2V9.2A2.2 2.2 0 0 1 4 7h2.7l1.6-2.6A1.4 1.4 0 0 1 9.5 3.7h5a1.4 1.4 0 0 1 1.2.7L17.3 7H20a2.2 2.2 0 0 1 2.2 2.2v9.1a2.2 2.2 0 0 1-2.2 2.2z" />
      <circle cx="12" cy="13.4" r="3.6" />
    </>
  ),

  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  'chevron-right': <path d="m9.5 6 6 6-6 6" />,
  'chevron-left': <path d="m14.5 6-6 6 6 6" />,

  star: (
    <path d="m12 3.2 2.72 5.62 6.13.89-4.44 4.36 1.05 6.14L12 17.32l-5.46 2.89 1.05-6.14L3.15 9.71l6.13-.89z" />
  ),

  building: (
    <>
      <path d="M3.5 21h17" />
      <path d="M5.5 21V4.8A1.8 1.8 0 0 1 7.3 3h6.4a1.8 1.8 0 0 1 1.8 1.8V21" />
      <path d="M15.5 9.5h3.2a1.8 1.8 0 0 1 1.8 1.8V21" />
      <path d="M8.8 7h3.4" />
      <path d="M8.8 11h3.4" />
      <path d="M8.8 15h3.4" />
      <path d="M17.3 13.5h.8" />
      <path d="M17.3 17h.8" />
    </>
  ),

  ruler: (
    <>
      <path d="M14.6 2.6 21.4 9.4a1.4 1.4 0 0 1 0 2L11.4 21.4a1.4 1.4 0 0 1-2 0L2.6 14.6a1.4 1.4 0 0 1 0-2L12.6 2.6a1.4 1.4 0 0 1 2 0Z" />
      <path d="m6.4 11 2.1 2.1" />
      <path d="m9.4 8 2.1 2.1" />
      <path d="m12.4 5 2.1 2.1" />
      <path d="m10.9 14.5 2.1 2.1" />
    </>
  ),

  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.2" />
      <path d="M3 10h18" />
      <path d="M8 2.8v4" />
      <path d="M16 2.8v4" />
      <path d="M7.5 14h2" />
      <path d="M14.5 14h2" />
      <path d="M7.5 17.5h2" />
      <path d="M14.5 17.5h2" />
    </>
  ),

  dollar: (
    <>
      <path d="M12 2.5v19" />
      <path d="M16.8 6H10a3.4 3.4 0 0 0 0 6.8h4a3.4 3.4 0 0 1 0 6.8H6.6" />
    </>
  ),

  mail: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.2" />
      <path d="m3.2 6.6 7.7 5.6a2 2 0 0 0 2.2 0l7.7-5.6" />
    </>
  ),

  phone: (
    <path d="M6.6 2.9a1.5 1.5 0 0 1 2 .6l1.6 2.8a1.5 1.5 0 0 1-.3 1.8L8.4 9.5a12.6 12.6 0 0 0 6.1 6.1l1.4-1.5a1.5 1.5 0 0 1 1.8-.3l2.8 1.6a1.5 1.5 0 0 1 .6 2l-.8 2a2 2 0 0 1-2.2 1.2C11.4 19.5 4.5 12.6 3.3 5.5a2 2 0 0 1 1.2-2.2z" />
  ),

  warning: (
    <>
      <path d="M10.3 3.9 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.2v4.4" />
      <path d="M12 17.2h.01" />
    </>
  ),

  info: (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 11.2v5.4" />
      <path d="M12 7.7h.01" />
    </>
  ),

  drag: (
    <>
      <circle cx="9" cy="5.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="5.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18.5" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),

  external: (
    <>
      <path d="M14 3.5h6.5V10" />
      <path d="M20.5 3.5 11 13" />
      <path d="M19 14.2V19a1.8 1.8 0 0 1-1.8 1.8H5A1.8 1.8 0 0 1 3.2 19V6.8A1.8 1.8 0 0 1 5 5h4.8" />
    </>
  ),

  search: (
    <>
      <circle cx="10.8" cy="10.8" r="7.1" />
      <path d="m16 16 4.6 4.6" />
    </>
  ),

  filter: <path d="M3.4 4.6h17.2l-6.9 8.1V19l-3.4 1.9v-8.2z" />,

  compare: (
    <>
      <rect x="2.8" y="4" width="7.6" height="16" rx="1.6" />
      <rect x="13.6" y="4" width="7.6" height="16" rx="1.6" />
      <path d="M10.4 12h3.2" />
    </>
  ),

  'map-pin': (
    <>
      <path d="M19.5 10.4c0 5.4-7.5 11-7.5 11s-7.5-5.6-7.5-11a7.5 7.5 0 0 1 15 0Z" />
      <circle cx="12" cy="10.2" r="2.8" />
    </>
  ),

  floor: (
    <>
      <path d="m12 2.8 9 4.6-9 4.6-9-4.6z" />
      <path d="m3 12 9 4.6 9-4.6" />
      <path d="m3 16.6 9 4.6 9-4.6" />
    </>
  ),

  expand: (
    <>
      <path d="M8.5 3.2H5A1.8 1.8 0 0 0 3.2 5v3.5" />
      <path d="M15.5 3.2H19A1.8 1.8 0 0 1 20.8 5v3.5" />
      <path d="M20.8 15.5V19A1.8 1.8 0 0 1 19 20.8h-3.5" />
      <path d="M8.5 20.8H5A1.8 1.8 0 0 1 3.2 19v-3.5" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Edge length in px. 16 is the inline default; 14 is the smallest we allow. */
  size?: number;
  className?: string;
  /** Only set this when the icon is the control's entire label. */
  title?: string;
  strokeWidth?: number;
}

export default function Icon({ name, size = 16, className, title, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      className={clsx('shrink-0', className)}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}
