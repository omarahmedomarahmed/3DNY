'use client';

import type maplibregl from 'maplibre-gl';

/**
 * Branded replacement for MapLibre's NavigationControl.
 *
 * The stock control is a small gray box that reads as browser chrome; in a
 * client meeting the map should look like one product, so this is the same
 * white card / hairline / shadow-raised language as the legend and the radius
 * control. Icons are inline SVG — never emoji, which render differently on
 * every machine a broker might present from.
 */

/** The pitch the map opens at; "reset" means back to that, not flat. */
const HOME_PITCH = 50;

interface MapControlsProps {
  map: maplibregl.Map | null;
  /** Frames every loaded building. Disabled when there is nothing to frame. */
  onFitAll: () => void;
  canFitAll: boolean;
}

function ControlButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center border-b border-hairline text-midnight transition-colors last:border-b-0 hover:bg-goldenrod-50 focus:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:text-subtle disabled:hover:bg-white"
    >
      {children}
    </button>
  );
}

/** Shared SVG frame: 18px, currentColor stroke, 1.6 weight for projector legibility. */
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export default function MapControls({ map, onFitAll, canFitAll }: MapControlsProps) {
  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-20 flex flex-col overflow-hidden rounded-card border border-hairline bg-white shadow-raised">
      <ControlButton label="Zoom in" disabled={!map} onClick={() => map?.zoomIn()}>
        <Icon>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </Icon>
      </ControlButton>

      <ControlButton label="Zoom out" disabled={!map} onClick={() => map?.zoomOut()}>
        <Icon>
          <line x1="5" y1="12" x2="19" y2="12" />
        </Icon>
      </ControlButton>

      <ControlButton
        label="Reset north and tilt"
        disabled={!map}
        onClick={() => map?.easeTo({ bearing: 0, pitch: HOME_PITCH, duration: 600 })}
      >
        {/* A compass needle: unambiguous for "put north back at the top". */}
        <Icon>
          <circle cx="12" cy="12" r="8.5" />
          <polygon points="12,6.5 14.6,13.5 12,12 9.4,13.5" fill="currentColor" stroke="none" />
        </Icon>
      </ControlButton>

      <ControlButton
        label="Fit to all buildings"
        disabled={!map || !canFitAll}
        onClick={onFitAll}
      >
        {/* Four corner brackets — the standard "frame everything" mark. */}
        <Icon>
          <path d="M4 9V6.5A2.5 2.5 0 0 1 6.5 4H9" />
          <path d="M15 4h2.5A2.5 2.5 0 0 1 20 6.5V9" />
          <path d="M20 15v2.5a2.5 2.5 0 0 1-2.5 2.5H15" />
          <path d="M9 20H6.5A2.5 2.5 0 0 1 4 17.5V15" />
        </Icon>
      </ControlButton>
    </div>
  );
}
