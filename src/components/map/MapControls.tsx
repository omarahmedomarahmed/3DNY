'use client';

import type maplibregl from 'maplibre-gl';
import { useApp } from '@/lib/store';
import { ATMOSPHERE, DEFAULT_TIME, TIME_ORDER } from './atmosphere';
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

/**
 * MapLibre's own ceiling, and the map is created with it.
 *
 * 85° is the camera standing in the street looking up a facade. Past it the
 * horizon is behind the camera and there is nothing left to draw, which is why
 * no map offers more — so "keep tilting" wraps around to flat rather than
 * stopping dead at the top of the range with a button that no longer does
 * anything.
 */
const MAX_PITCH = 85;

/**
 * Every angle the tilt buttons stop at, flat to street level.
 *
 * A fixed ladder rather than "current ± 10", and the reason is animation.
 * Each press eases over 350ms, so a press that lands mid-ease reads a pitch
 * partway there — 73.8 rather than 70 — and stepping from that walks the angle
 * off the grid. On a fast machine the eases finish between presses and it
 * never shows; on a slow one, or a heavily loaded frame at high pitch, it
 * does, and the symptom is that the top of the range becomes unreachable.
 *
 * Quantising removes the failure mode rather than timing around it: whatever
 * mid-flight value comes back snaps to the nearest rung and the next press
 * goes to the one after. 85 is a rung of its own because it is MapLibre's
 * ceiling and the whole point of the range — the view from the pavement.
 */
const PITCH_LADDER = [0, 10, 20, 30, 40, 50, 60, 70, 80, MAX_PITCH];

/**
 * The next rung, wrapping at both ends.
 *
 * Wrapping means neither button is ever dead: keep pressing either one and the
 * camera runs the whole range and comes round again, which is a dial rather
 * than a slider jammed against its stop.
 */
function cyclePitch(current: number, step: number): number {
  let nearest = 0;
  for (let i = 1; i < PITCH_LADDER.length; i++) {
    if (Math.abs(PITCH_LADDER[i] - current) < Math.abs(PITCH_LADDER[nearest] - current)) {
      nearest = i;
    }
  }
  const next = nearest + (step > 0 ? 1 : -1);
  return PITCH_LADDER[(next + PITCH_LADDER.length) % PITCH_LADDER.length];
}

/** Modes offered as filters, in the order they matter to a tenant. */
const TRANSIT_FILTERS: { mode: string; label: string; color: string }[] = [
  { mode: 'subway', label: 'Subway', color: '#0056DA' },
  { mode: 'bus', label: 'Bus', color: '#7A879E' },
  { mode: 'rail', label: 'Rail', color: '#001E5A' },
  { mode: 'path', label: 'PATH', color: '#243E8C' },
  { mode: 'ferry', label: 'Ferry', color: '#0E7C86' },
];

interface MapControlsProps {
  map: maplibregl.Map | null;
  /** Frames every loaded building. Disabled when there is nothing to frame. */
  onFitAll: () => void;
  canFitAll: boolean;
  /** Captures the selected building as a shareable sheet. */
  onStackSnapshot: (withPhotoreal: boolean) => void;
  canSnapshot: boolean;
  snapshotBusy: boolean;
}

/**
 * One tool, with a sentence about what it does.
 *
 * A `title` attribute was the only explanation these had, which means it did
 * not exist: it takes a second of hovering, never appears on a touch screen,
 * and is invisible on a projector. Fifteen unlabelled icons in a column is a
 * puzzle, and the two that matter most in a meeting — isolate, and stack
 * snapshot — are the two nobody guesses.
 *
 * So the explainer is a pill that opens to the LEFT of the stack on hover or
 * keyboard focus. Left, because the stack is pinned to the right edge and a
 * tooltip on the right would be off screen. It carries the name in bold and a
 * sentence under it, and it is `pointer-events-none` so it can never sit
 * between the cursor and the button it describes.
 */
function ControlButton({
  label,
  hint,
  onClick,
  disabled,
  active = false,
  children,
}: {
  label: string;
  /** One sentence: what pressing this does, and when you would want it. */
  hint?: string;
  onClick: (event?: React.MouseEvent) => void;
  disabled?: boolean;
  /** Renders the pressed state, for buttons that toggle rather than act. */
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={(event) => onClick(event)}
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
      <span
        role="tooltip"
        className="pointer-events-none absolute right-full top-1/2 z-30 mr-2 hidden w-60 -translate-y-1/2 rounded-card border border-hairline-strong bg-white p-2.5 text-left shadow-float group-hover:block group-focus-within:block"
      >
        <span className="block text-[12px] font-semibold leading-snug text-ink">{label}</span>
        {hint ? (
          <span className="mt-0.5 block text-[11px] leading-snug text-muted">{hint}</span>
        ) : null}
      </span>
    </div>
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

export default function MapControls({
  map,
  onFitAll,
  canFitAll,
  onStackSnapshot,
  canSnapshot,
  snapshotBusy,
}: MapControlsProps) {
  const photoreal = useApp((s) => s.photoreal);
  const mapMode = useApp((s) => s.mapMode);
  const setMapMode = useApp((s) => s.setMapMode);
  const walking = useApp((s) => s.walking);
  const setWalking = useApp((s) => s.setWalking);
  const setPhotoreal = useApp((s) => s.setPhotoreal);
  const showContext = useApp((s) => s.showContext);
  const setShowContext = useApp((s) => s.setShowContext);
  const mapTheme = useApp((s) => s.mapTheme);
  const setMapTheme = useApp((s) => s.setMapTheme);
  const timeOfDay = useApp((s) => s.timeOfDay);
  const setTimeOfDay = useApp((s) => s.setTimeOfDay);
  // Null means "follow the theme", which is the state the map opens in.
  const activeTime = timeOfDay ?? DEFAULT_TIME[mapTheme];
  const showTransit = useApp((s) => s.showTransit);
  const setShowTransit = useApp((s) => s.setShowTransit);
  const transitModes = useApp((s) => s.transitModes);
  const toggleTransitMode = useApp((s) => s.toggleTransitMode);
  const isolateSelection = useApp((s) => s.isolateSelection);
  const setIsolateSelection = useApp((s) => s.setIsolateSelection);
  const controlsOpen = useApp((s) => s.controlsOpen);
  const setControlsOpen = useApp((s) => s.setControlsOpen);

  /** One rung up or down the ladder, from wherever the camera is now. */
  const tilt = (step: number) => {
    if (!map) return;
    map.easeTo({ pitch: cyclePitch(map.getPitch() ?? 0, step), duration: 350 });
  };

  /**
   * Closed, the stack is one button.
   *
   * Fifteen icons stacked down the right edge is a column of chrome about a
   * third of the window tall, and in a meeting almost all of it is untouched —
   * the camera gets moved, and the rest is set once. So it folds away to a
   * single square and the map keeps the edge, which is the same bargain the
   * two rails make.
   */
  if (!controlsOpen) {
    return (
      <div className="pointer-events-auto absolute right-4 top-20 z-20">
        <ControlButton
          label="Map tools"
          hint="Zoom, rotate, tilt, transit, time of day, theme and the stack snapshot."
          onClick={() => setControlsOpen(true)}
        >
          {/* Sliders: the standard mark for "the controls are in here". */}
          <Icon>
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2.2" />
            <circle cx="10" cy="17" r="2.2" />
          </Icon>
        </ControlButton>
      </div>
    );
  }

  return (
    <>
      {showTransit && (
        <div className="pointer-events-auto absolute right-16 top-20 z-20 flex flex-col gap-1 rounded-card border border-hairline bg-white p-1.5 shadow-raised">
          {TRANSIT_FILTERS.map((f) => {
            // No selection means everything is shown, so every chip reads as on.
            const on = transitModes.length === 0 || transitModes.includes(f.mode);
            return (
              <button
                key={f.mode}
                type="button"
                onClick={() => toggleTransitMode(f.mode)}
                aria-pressed={on}
                className={
                  'flex items-center gap-2 rounded px-2 py-1 text-xs font-semibold transition-colors ' +
                  (on ? 'bg-midnight text-white' : 'text-muted hover:bg-surface-alt')
                }
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: f.color }}
                />
                {f.label}
              </button>
            );
          })}
        </div>
      )}

    <div className="pointer-events-auto absolute right-4 top-20 z-20 flex flex-col overflow-hidden rounded-card border border-hairline bg-white shadow-raised">
      <ControlButton
        label="Close the tools"
        hint="Folds this column away so the map has the whole window. The tools button brings it back."
        onClick={() => setControlsOpen(false)}
      >
        <Icon>
          <polyline points="9,5 16,12 9,19" />
        </Icon>
      </ControlButton>

      <ControlButton
        label="Zoom in"
        hint="Closer. Floor bands appear at about zoom 14.5 and name-plates just above that."
        disabled={!map}
        onClick={() => map?.zoomIn()}
      >
        <Icon>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </Icon>
      </ControlButton>

      <ControlButton
        label="Zoom out"
        hint="Further out. Past the band threshold the towers stay, the stripes do not."
        disabled={!map}
        onClick={() => map?.zoomOut()}
      >
        <Icon>
          <line x1="5" y1="12" x2="19" y2="12" />
        </Icon>
      </ControlButton>

      {/* Rotate. The map has always supported right-drag and ctrl-drag to
          swing the camera, but neither is discoverable, and a broker turning a
          building to face the room should not have to know a shortcut. */}
      <ControlButton
        label="Rotate left"
        hint="Swings the camera thirty degrees anticlockwise, so a tower can be turned to face the room."
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
        hint="Swings the camera thirty degrees clockwise. Right-drag on the map does the same thing."
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
        hint="Tips toward street level in ten-degree steps, all the way to 85° — standing in the road looking up a facade. Keeps going past the top and comes round to flat."
        disabled={!map}
        onClick={() => tilt(PITCH_STEP)}
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
        hint="Tips back toward straight down, where the street grid reads. Past flat it comes round to street level again."
        disabled={!map}
        onClick={() => tilt(-PITCH_STEP)}
      >
        <Icon>
          <path d="M3 9.5 12 6l9 3.5-9 3.5z" />
          <path d="M12 15.5V21" />
          <polyline points="9.4,18.8 12,21.4 14.6,18.8" />
        </Icon>
      </ControlButton>

      <ControlButton
        label="Reset north and tilt"
        hint="Puts north back at the top and the camera back to its opening angle."
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
        hint="Frames every loaded building at once, however far apart they are."
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

      {/* Transit. Every subway, bus, ferry and rail stop in view; with a
          building selected, dashed walk lines and minutes to the nearest few. */}
      <ControlButton
        label={showTransit ? 'Hide transit stops' : 'Show transit stops and walk times'}
        hint="Every subway, bus, ferry and rail stop in view. With a building selected, dashed walk lines and the minutes to the nearest few."
        active={showTransit}
        disabled={!map}
        onClick={() => setShowTransit(!showTransit)}
      >
        {/* A train car on rails. */}
        <Icon>
          <rect x="6" y="3.5" width="12" height="12.5" rx="3" />
          <path d="M6.5 11.5h11" />
          <path d="M9.5 19.5 8 16.5M14.5 19.5 16 16.5M4.5 20h15" />
          <circle cx="9.4" cy="13.8" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="14.6" cy="13.8" r="0.9" fill="currentColor" stroke="none" />
        </Icon>
      </ControlButton>

      {/* Isolate. With a radius drawn it keeps only what is inside it;
          otherwise only the selected building. The sidebar still lists
          everything — this is about what a client is looking at. */}
      <ControlButton
        label={
          isolateSelection
            ? 'Show all buildings again'
            : 'Show only the selection, or what is inside the radius'
        }
        hint="Hides everything except the selected building, or everything outside the radius. For showing one option without the rest of the market around it."
        active={isolateSelection}
        disabled={!map}
        onClick={() => setIsolateSelection(!isolateSelection)}
      >
        {/* A single block picked out of a row. */}
        <Icon>
          <path d="M3.5 20h17" />
          <path d="M4.5 20v-5h3v5" opacity="0.45" />
          <path d="M9.8 20V7h4.4v13" />
          <path d="M16.5 20v-6h3v6" opacity="0.45" />
        </Icon>
      </ControlButton>

      {/* Stack Snapshot. Acts on the selected building: frames it, captures the
          stack, and writes a PNG with every available floor and the landlord
          beside it. Holding Shift borrows Google's imagery for the capture
          alone, so a photoreal sheet costs one building rather than a session. */}
      <ControlButton
        label={
          canSnapshot
            ? 'Stack snapshot of the selected building (hold Shift for photorealistic)'
            : 'Select a building first, then take a stack snapshot'
        }
        hint="Writes a PNG of the selected building with every available floor and the landlord beside it. Hold Shift for photorealistic imagery."
        disabled={!map || !canSnapshot}
        active={snapshotBusy}
        onClick={(event) => onStackSnapshot(Boolean(event?.shiftKey))}
      >
        {/* A framed stack: a picture with layers in it. */}
        <Icon>
          <rect x="3.2" y="4.5" width="17.6" height="15" rx="2" />
          <path d="M7 9.5h10M7 13h10M7 16.2h6" />
        </Icon>
      </ControlButton>

      {/* Time of day. Moves the real sun — `_SunLight` takes its direction
          from the viewport's own latitude and longitude at this timestamp —
          along with the sky and the distance haze. Cycles rather than opening
          a menu: it is a thing you flick through while talking. */}
      <ControlButton
        label={`Time of day: ${ATMOSPHERE[activeTime].label}. Click for the next hour`}
        hint="Moves the real sun, the sky and the distance haze. Cycles through the hours — something to flick through while talking."
        disabled={!map}
        onClick={() => {
          const i = TIME_ORDER.indexOf(activeTime);
          setTimeOfDay(TIME_ORDER[(i + 1) % TIME_ORDER.length]);
        }}
      >
        {/* A sun low over a horizon line — the hour, not the theme. */}
        <Icon>
          <path d="M3 18h18" />
          <circle cx="12" cy="12.5" r="3.6" />
          <path d="M12 4.5v2M4.9 7.4l1.4 1.4M19.1 7.4l-1.4 1.4M3 12.5h2M19 12.5h2" />
        </Icon>
      </ControlButton>

      {/* Theme. Dark is the default because these maps are shown in dim rooms
          on projectors, where a white basemap washes the buildings out. */}
      <ControlButton
        label={mapTheme === 'dark' ? 'Switch to the light map' : 'Switch to the dark map'}
        hint="Light is the default. Dark reads better in a dim room on a projector, where a white basemap washes the towers out."
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
        hint="Brings back every building with nothing available, in grey, for orientation. Off by default — the clean map is the one that gets shown to a client."
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

      {/* Explore mode: the same city, as something you move through rather
          than look down at. It is a second mode reached by a button, never the
          default — the flat map is the working tool and stays untouched
          behind this. */}
      <ControlButton
        label={
          mapMode === 'explore'
            ? 'Back to the flat map'
            : 'Explore this city in 3D'
        }
        hint="Turns the map into a real-time 3D Manhattan you can move through: real facades, real glass, and every available floor still lit. The flat map is one click away."
        active={mapMode === 'explore'}
        disabled={!map}
        onClick={() => setMapMode(mapMode === 'explore' ? 'flat' : 'explore')}
      >
        {/* A tower seen in perspective, rather than the flat elevation the
            "surrounding city" button uses. The difference between the two
            buttons IS the difference between the two modes. */}
        <Icon>
          <path d="M4 9.2 12 5l8 4.2v8.4L12 22l-8-4.4z" />
          <path d="M12 5v17" />
          <path d="M4 9.2 12 13.5l8-4.3" />
        </Icon>
      </ControlButton>

      {/* Street level, first person. Only offered inside Explore mode — the
          flat map has no city to walk through, and a button that silently
          switched modes would be a surprise rather than a shortcut. */}
      {mapMode === 'explore' && (
        <ControlButton
          label={walking ? 'Stop walking' : 'Walk at street level'}
          hint="Drops you on the pavement in first person. W A S D to walk, Q E to turn, R F to look up and down, Shift to move faster, Escape to come back up."
          active={walking}
          disabled={!map}
          onClick={() => setWalking(!walking)}
        >
          {/* A figure walking, rather than a foot or a pin: the button is
              about being IN the street, not about marking a place on it. */}
          <Icon>
            <circle cx="12.6" cy="4.4" r="1.9" />
            <path d="M11 8.4 8.6 12l2.6 2.1.9 5.6" />
            <path d="M11.2 14.1 8 20" />
            <path d="M13.4 9.2 17 11.4l1.4 3.2" />
            <path d="M10.4 9.6 6.4 9" />
          </Icon>
        </ControlButton>
      )}

      {/* Only offered when a Google key is configured. Without one the button
          would be a dead end, and the free grey city is the honest default. */}
      {photorealAvailable() && (
        <ControlButton
          label={photoreal ? 'Switch to plain massing' : 'Switch to photorealistic buildings'}
          hint="Swaps the grey massing for Google's photography. Only over Manhattan and only close in."
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
    </>
  );
}
