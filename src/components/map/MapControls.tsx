'use client';

import type maplibregl from 'maplibre-gl';
import { useApp } from '@/lib/store';
import { photorealAvailable } from './photoreal';

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

/** Degrees per click of the angle controls. */
const PITCH_STEP = 10;

/** MapLibre's own ceiling. Past this the horizon fills the frame. */
const MAX_PITCH = 85;

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
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Renders the pressed state, for buttons that toggle rather than act. */
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      className={
        'flex h-9 w-9 items-center justify-center border-b border-hairline transition-colors last:border-b-0 focus:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:text-subtle disabled:hover:bg-white ' +
        (active
          ? 'bg-midnight text-goldenrod hover:bg-midnight-700'
          : 'text-midnight hover:bg-goldenrod-50')
      }
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
  const photoreal = useApp((s) => s.photoreal);
  const setPhotoreal = useApp((s) => s.setPhotoreal);
  const showContext = useApp((s) => s.showContext);
  const setShowContext = useApp((s) => s.setShowContext);
  const mapTheme = useApp((s) => s.mapTheme);
  const setMapTheme = useApp((s) => s.setMapTheme);

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

      {/* Rotate. The map has always supported right-drag and ctrl-drag to
          swing the camera, but neither is discoverable, and a broker turning a
          building to face the room should not have to know a shortcut. */}
      <ControlButton
        label="Rotate left"
        disabled={!map}
        onClick={() => map?.easeTo({ bearing: (map.getBearing() ?? 0) - 30, duration: 400 })}
      >
        <Icon>
          <path d="M4 12a8 8 0 1 1 2.6 5.9" />
          <polyline points="3.2,7.6 4.2,12.4 9,11.4" />
        </Icon>
      </ControlButton>

      <ControlButton
        label="Rotate right"
        disabled={!map}
        onClick={() => map?.easeTo({ bearing: (map.getBearing() ?? 0) + 30, duration: 400 })}
      >
        <Icon>
          <path d="M20 12a8 8 0 1 0-2.6 5.9" />
          <polyline points="20.8,7.6 19.8,12.4 15,11.4" />
        </Icon>
      </ControlButton>

      {/* Pitch, in steps, exactly like rotation — so the camera can be set
          anywhere between straight down and street level rather than jumping
          between two fixed positions. MapLibre caps pitch at 85. */}
      <ControlButton
        label="Raise the view angle"
        disabled={!map}
        onClick={() =>
          map?.easeTo({
            pitch: Math.min(MAX_PITCH, (map.getPitch() ?? 0) + PITCH_STEP),
            duration: 350,
          })
        }
      >
        {/* A plane tipping away from the viewer. */}
        <Icon>
          <path d="M3 15.5 12 19l9-3.5-9-3.5z" />
          <path d="M12 9.5V4" />
          <polyline points="9.4,6.2 12,3.6 14.6,6.2" />
        </Icon>
      </ControlButton>

      <ControlButton
        label="Lower the view angle"
        disabled={!map}
        onClick={() =>
          map?.easeTo({
            pitch: Math.max(0, (map.getPitch() ?? 0) - PITCH_STEP),
            duration: 350,
          })
        }
      >
        <Icon>
          <path d="M3 9.5 12 6l9 3.5-9 3.5z" />
          <path d="M12 15.5V21" />
          <polyline points="9.4,18.8 12,21.4 14.6,18.8" />
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

      {/* Theme. Dark is the default because these maps are shown in dim rooms
          on projectors, where a white basemap washes the buildings out. */}
      <ControlButton
        label={mapTheme === 'dark' ? 'Switch to the light map' : 'Switch to the dark map'}
        disabled={!map}
        onClick={() => setMapTheme(mapTheme === 'dark' ? 'light' : 'dark')}
      >
        {mapTheme === 'dark' ? (
          // A sun, offering the light map.
          <Icon>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
          </Icon>
        ) : (
          // A crescent, offering the dark map.
          <Icon>
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
          </Icon>
        )}
      </ControlButton>

      {/* The clean map is the default: only buildings that actually have space
          in them. This brings the rest of the city back for orientation. */}
      <ControlButton
        label={
          showContext
            ? 'Hide buildings with nothing available'
            : 'Show the surrounding city'
        }
        active={showContext}
        disabled={!map}
        onClick={() => setShowContext(!showContext)}
      >
        {/* A skyline of three blocks. */}
        <Icon>
          <path d="M3 20h18" />
          <path d="M5 20V12h4v8" />
          <path d="M10.5 20V6h4v14" />
          <path d="M16 20v-6h3v6" />
        </Icon>
      </ControlButton>

      {/* Only offered when a Google key is configured. Without one the button
          would be a dead end, and the free grey city is the honest default. */}
      {photorealAvailable() && (
        <ControlButton
          label={photoreal ? 'Switch to plain massing' : 'Switch to photorealistic buildings'}
          active={photoreal}
          disabled={!map}
          onClick={() => setPhotoreal(!photoreal)}
        >
          {/* A camera: this swaps the city for photography, not for another
              colour scheme. */}
          <Icon>
            <path d="M4 8.5h3l1.6-2.2h6.8L17 8.5h3v10H4z" />
            <circle cx="12" cy="13" r="3.2" />
          </Icon>
        </ControlButton>
      )}
    </div>
  );
}
