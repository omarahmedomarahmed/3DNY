'use client';

import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { useApp } from '@/lib/store';
import { toLocal, type LocalFrame } from '@/lib/explore/frame';
import { cameraOffset } from '@/lib/explore/camera';
import {
  NO_FREE_INPUT,
  stepFree,
  wrapDeg,
  type FreeCam,
  type FreeInput,
} from '@/lib/explore/freecam';
import type { ExploreLayer } from './ExploreLayer';

/**
 * Free look: fly and turn without limit.
 *
 * The walk drives MapLibre's camera, deliberately, so that the basemap, the
 * name-plates and the city all move as one. This does the opposite and for a
 * reason that cannot be worked around: **MapLibre's camera cannot look above
 * the horizon.** Pitch is capped at 85 degrees and 90 degrees is level, so
 * there is no value of any MapLibre camera parameter that puts the sky, the sun
 * or the top of a tower in the middle of the frame. A model with a sky in it
 * that you are not allowed to look at is not a model.
 *
 * So for the duration, `ExploreLayer` projects from a camera of its own and
 * MapLibre's is left where it was.
 *
 * | What still works | What does not |
 * |---|---|
 * | The whole three.js city: ground, water, streets, massing, facades, roofs, **bands**, traffic, sky | deck.gl's name-plates, transit and radius — switched off, because they would be drawn at MapLibre's camera and land in the wrong place |
 * | Every atmosphere preset and every filter | Clicking a building: picking is deck.gl's, and deck.gl is not looking where you are |
 *
 * That trade is only acceptable because the bands are three.js geometry — the
 * one rule survives free look intact, which it would not have done before the
 * bands moved out of deck.gl.
 *
 * | Control | |
 * |---|---|
 * | Mouse | Look. Click the map once to capture the pointer |
 * | W A S D | Fly along the look direction, and strafe |
 * | Space / C | Straight up, straight down |
 * | Shift | Four times faster |
 * | Escape | Release the pointer, then leave free look |
 */

/** Degrees of turn per pixel of mouse movement. */
const SENSITIVITY = 0.16;

const HELD: Record<string, keyof FreeInput | 'fast'> = {
  KeyW: 'forward',
  KeyS: 'forward',
  KeyA: 'strafe',
  KeyD: 'strafe',
  ArrowUp: 'forward',
  ArrowDown: 'forward',
  ArrowLeft: 'strafe',
  ArrowRight: 'strafe',
  Space: 'rise',
  KeyC: 'rise',
  ShiftLeft: 'fast',
  ShiftRight: 'fast',
};

export interface FreeCamHandle {
  cam: FreeCam | null;
}

export function useFreeCam(
  map: maplibregl.Map | null,
  layer: ExploreLayer | null,
  active: boolean,
  frame: LocalFrame | null,
): FreeCamHandle {
  const handle = useRef<FreeCamHandle>({ cam: null });
  const held = useRef(new Set<string>());
  const look = useRef({ dYaw: 0, dPitch: 0 });

  useEffect(() => {
    if (!map || !layer || !active || !frame) {
      handle.current.cam = null;
      layer?.setFreeCamera(null);
      return;
    }

    /**
     * Free look starts exactly where the map camera already is.
     *
     * Anything else is a teleport, and a camera mode that begins by throwing
     * away the view the user spent thirty seconds framing is a camera mode
     * people press once. `cameraOffset` is the same inversion the layer uses
     * for its own shading, so the first free frame is pixel-for-pixel the last
     * MapLibre one — except that now it can keep going past 85 degrees.
     */
    const canvas = map.getCanvas();
    const centre = map.getCenter();
    const [cx, cy] = toLocal(frame, centre.lng, centre.lat);
    const offset = cameraOffset({
      center: [centre.lng, centre.lat],
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      height: canvas.clientHeight || 800,
    });

    let cam: FreeCam = {
      x: cx + offset.east,
      y: cy + offset.north,
      z: Math.max(2, offset.altitude),
      yaw: wrapDeg(map.getBearing()),
      // MapLibre pitch is measured from straight down; ours from the horizon.
      pitch: map.getPitch() - 90,
    };
    handle.current.cam = cam;
    layer.setFreeCamera(cam);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      const moving = held.current.size > 0;
      const turning = look.current.dYaw !== 0 || look.current.dPitch !== 0;
      if (moving || turning) {
        const input: FreeInput = moving
          ? {
              forward:
                (held.current.has('KeyW') || held.current.has('ArrowUp') ? 1 : 0) -
                (held.current.has('KeyS') || held.current.has('ArrowDown') ? 1 : 0),
              strafe:
                (held.current.has('KeyD') || held.current.has('ArrowRight') ? 1 : 0) -
                (held.current.has('KeyA') || held.current.has('ArrowLeft') ? 1 : 0),
              rise:
                (held.current.has('Space') ? 1 : 0) - (held.current.has('KeyC') ? 1 : 0),
              dYaw: look.current.dYaw,
              dPitch: look.current.dPitch,
              fast: held.current.has('ShiftLeft') || held.current.has('ShiftRight'),
            }
          : { ...NO_FREE_INPUT, dYaw: look.current.dYaw, dPitch: look.current.dPitch };

        look.current.dYaw = 0;
        look.current.dPitch = 0;
        cam = stepFree(cam, input, dt);
        handle.current.cam = cam;
        layer.setFreeCamera(cam);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onMove = (e: MouseEvent) => {
      // Only while the pointer is captured. Without the guard, moving the mouse
      // across the page to reach the sidebar would spin the city.
      if (document.pointerLockElement !== canvas) return;
      look.current.dYaw += e.movementX * SENSITIVITY;
      // Screen down is negative pitch, which is the convention every game uses
      // and the opposite of the sign of `movementY`.
      look.current.dPitch -= e.movementY * SENSITIVITY;
    };

    const onClick = () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        // The browser has already released the pointer by the time this fires;
        // the first Escape is therefore "give me my cursor back" and only a
        // second one leaves the mode. That is what every game does.
        if (document.pointerLockElement === canvas) return;
        useApp.getState().setFreeLook(false);
        return;
      }
      if (!(e.code in HELD)) return;
      // Space scrolls the page and the arrows move the scrollbar.
      e.preventDefault();
      held.current.add(e.code);
    };
    const onUp = (e: KeyboardEvent) => held.current.delete(e.code);
    const onBlur = () => {
      held.current.clear();
      look.current.dYaw = 0;
      look.current.dPitch = 0;
    };

    canvas.addEventListener('click', onClick);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);

    /**
     * MapLibre's own handlers are switched off for the duration.
     *
     * Otherwise a drag pans a basemap nobody can see while the visible city
     * stays put, which reads as the map having frozen. They are restored on the
     * way out, unconditionally, in the cleanup.
     */
    const handlers = [
      map.dragPan,
      map.dragRotate,
      map.scrollZoom,
      map.keyboard,
      map.doubleClickZoom,
      map.touchZoomRotate,
    ];
    for (const h of handlers) h?.disable();

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      held.current.clear();
      for (const h of handlers) h?.enable();
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      handle.current.cam = null;
      layer.setFreeCamera(null);
    };
  }, [map, layer, active, frame]);

  return handle.current;
}
