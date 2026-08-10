'use client';

import { useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';

/**
 * One big button that puts the camera back.
 *
 * The tilt controls now run the full range, and 85° is genuinely disorienting
 * on purpose — you are standing in the road looking up a facade, the horizon
 * is a sliver, and none of the usual landmarks are where you expect them.
 * That view is worth having and it is very easy to get lost in. Rotation
 * compounds it: a map that is no longer north-up takes a moment to re-read
 * even for someone who knows the grid.
 *
 * There is already a "reset north and tilt" icon in the tool stack. It is
 * 36 pixels square, one of seventeen, and nobody hunting for the way back
 * finds it — that is exactly the moment when scanning a column of icons is
 * the last thing anyone wants to do. So this is a wide, worded button in the
 * middle of the map.
 *
 * Two things keep it from becoming clutter:
 *
 * It only appears once the camera has actually moved, so the opening view
 * never carries a button offering to restore the view you are already in.
 *
 * It sits at the bottom edge rather than the dead centre. Centred horizontally
 * — which is what makes it findable without looking — but out of the band
 * where the towers and their bands are, because a button parked on top of the
 * buildings would block both the view and the clicks.
 */

/** How far the camera has to stray before the way back is worth offering. */
const MOVED = {
  pitch: 6,
  bearing: 8,
  zoom: 0.6,
};

export default function ResetView({
  map,
  home,
  onReset,
}: {
  map: maplibregl.Map | null;
  /** The camera the map opens with. */
  home: { pitch: number; bearing: number };
  onReset: () => void;
}) {
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    if (!map) return;

    // Compared against the opening pitch and bearing, plus whether the zoom
    // has changed much — which between them cover every way the camera gets
    // away from someone: tilting, spinning, and flying to a building.
    const startZoom = map.getZoom();
    const check = () => {
      const bearing = Math.abs(((map.getBearing() - home.bearing + 540) % 360) - 180);
      setMoved(
        Math.abs(map.getPitch() - home.pitch) > MOVED.pitch ||
          bearing > MOVED.bearing ||
          Math.abs(map.getZoom() - startZoom) > MOVED.zoom,
      );
    };

    check();
    map.on('moveend', check);
    map.on('rotate', check);
    map.on('pitch', check);
    return () => {
      map.off('moveend', check);
      map.off('rotate', check);
      map.off('pitch', check);
    };
  }, [map, home.pitch, home.bearing]);

  if (!map || !moved) return null;

  return (
    <button
      type="button"
      onClick={onReset}
      className="pointer-events-auto absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-hairline-strong bg-white px-6 py-3.5 text-base font-semibold text-midnight shadow-float transition-colors hover:border-midnight hover:bg-goldenrod-50"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {/* A compass needle over a curved arrow: north, and going back. */}
        <circle cx="12" cy="12" r="8.5" />
        <polygon points="12,6.5 14.6,13.5 12,12 9.4,13.5" fill="currentColor" stroke="none" />
      </svg>
      Reset the view
    </button>
  );
}
