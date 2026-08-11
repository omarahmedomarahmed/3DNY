'use client';

import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { useApp } from '@/lib/store';
import {
  nearestEdge,
  pointInRing,
  toLngLat,
  toLocal,
  type LocalFrame,
} from '@/lib/explore/frame';
import { cameraOffset } from '@/lib/explore/camera';
import { holdInside, type Inside } from '@/lib/explore/walk';
import {
  NO_FREE_INPUT,
  stepFree,
  wrapDeg,
  type FreeCam,
  type FreeInput,
} from '@/lib/explore/freecam';
import type { ExploreLayer } from './ExploreLayer';

/**
 * Free look: fly and turn without limit, and still click on things.
 *
 * The walk drives MapLibre's camera, deliberately, so that the basemap, the
 * name-plates and the city all move as one. This does the opposite and for a
 * reason that cannot be worked around: **MapLibre's camera cannot look above
 * the horizon.** Pitch is capped at 85 degrees and 90 degrees is level, so
 * there is no value of any MapLibre camera parameter that puts the sky, the
 * sun or the top of a tower in the middle of the frame. A model with a sky in
 * it that you are not allowed to look at is not a model.
 *
 * So for the duration, `ExploreLayer` projects from a camera of its own and
 * MapLibre's is left where it was.
 *
 * ## The cursor stays
 *
 * The first version held the pointer captured the whole time, which is right
 * for a game and wrong for a tool: with no cursor there is nothing to point at
 * a building with, and Explore is a mode of a map whose entire purpose is
 * clicking on buildings. So the pointer is captured **only while the button is
 * down**, and a press that does not travel is a click rather than a look.
 *
 * | Control | |
 * |---|---|
 * | Move the mouse | The cursor changes over anything clickable |
 * | Click | Select it — a building, or the availability on the floor you hit |
 * | Drag | Look. The pointer is captured for the drag and given back on release |
 * | W A S D | Fly along the look direction, and strafe |
 * | Space / C | Straight up, straight down |
 * | Shift | Four times faster |
 * | Escape | Leave |
 *
 * ## What it costs
 *
 * deck.gl's layers are switched off for the duration, because they project
 * with MapLibre's camera and would be drawn in the wrong place. That takes
 * deck.gl's picking with it, which is why this hook does its own — see
 * `ExploreLayer.pickAt`. It is only acceptable because the availability bands
 * are three.js geometry: the one rule survives free look intact.
 */

/** Degrees of turn per pixel of mouse movement. */
const SENSITIVITY = 0.16;

/** Below this much travel, a press is a click and not a drag. */
const CLICK_SLOP_PX = 5;

/** How far the camera may fly before the map is asked to load around it. */
const REGION_STEP_M = 250;

const HELD = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'KeyC', 'ShiftLeft', 'ShiftRight',
]);

export interface FreeCamHandle {
  cam: FreeCam | null;
}

export interface FreeCamOptions {
  /**
   * A floor plate the camera may not leave.
   *
   * Set while exploring a space: the same ring the walk uses, so the two modes
   * cannot disagree about where the glass is.
   */
  confine?: Inside | null;
  /** Metres above the plate the eye sits when confined. */
  eyeHeightM?: number;
  /** Called when a click resolves to a building and an elevation. */
  onPick?: (buildingId: string, z: number) => void;
  /**
   * Called when the camera has flown far enough that the surrounding data
   * should be loaded around it rather than around MapLibre's viewport.
   */
  onRegion?: (lng: number, lat: number) => void;
}

export function useFreeCam(
  map: maplibregl.Map | null,
  layer: ExploreLayer | null,
  active: boolean,
  frame: LocalFrame | null,
  options: FreeCamOptions = {},
): FreeCamHandle {
  const handle = useRef<FreeCamHandle>({ cam: null });
  const held = useRef(new Set<string>());
  const look = useRef({ dYaw: 0, dPitch: 0 });
  // Read through a ref so a new callback identity — which React gives on
  // every render — does not tear the camera down and put it back at the start.
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    if (!map || !layer || !active || !frame) {
      handle.current.cam = null;
      layer?.setFreeCamera(null);
      return;
    }

    const canvas = map.getCanvas();

    /**
     * Free look starts exactly where the map camera already is.
     *
     * Anything else is a teleport, and a camera mode that begins by throwing
     * away the view the user spent thirty seconds framing is a camera mode
     * people press once. `cameraOffset` is the same inversion the layer uses
     * for its own shading, so the first free frame is pixel-for-pixel the last
     * MapLibre one — except that now it can keep going past 85 degrees.
     */
    const centre = map.getCenter();
    const [cx, cy] = toLocal(frame, centre.lng, centre.lat);
    const offset = cameraOffset({
      center: [centre.lng, centre.lat],
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      height: canvas.clientHeight || 800,
    });

    const confined = opts.current.confine ?? null;
    const eyeH = opts.current.eyeHeightM ?? 1.68;

    let cam: FreeCam = confined
      ? {
          // Inside a space you are seated part of the way toward the glass,
          // facing it. The walk starts in the middle of a plate on purpose —
          // arriving with your nose against a window is disorienting — but
          // this mode exists to answer "what does it look like out of here",
          // and from the dead centre of a floor plate the slab hides the
          // street entirely. Two-thirds of the way out is close enough to see
          // down and far enough back to see the room.
          ...seatFacing(confined.ring, map.getBearing()),
          z: confined.floorM + eyeH,
          yaw: wrapDeg(map.getBearing()),
          pitch: 0,
        }
      : {
          x: cx + offset.east,
          y: cy + offset.north,
          z: Math.max(2, offset.altitude),
          yaw: wrapDeg(map.getBearing()),
          // MapLibre pitch is measured from straight down; ours from the
          // horizon.
          pitch: map.getPitch() - 90,
        };

    handle.current.cam = cam;
    layer.setFreeCamera(cam);

    let lastRegion: [number, number] = [cam.x, cam.y];
    const reportRegion = () => {
      if (!opts.current.onRegion) return;
      if (Math.hypot(cam.x - lastRegion[0], cam.y - lastRegion[1]) < REGION_STEP_M) return;
      lastRegion = [cam.x, cam.y];
      const [lng, lat] = toLngLat(frame, cam.x, cam.y);
      opts.current.onRegion(lng, lat);
    };
    reportRegion();

    /**
     * Confinement, applied after the step rather than inside it.
     *
     * `holdInside` is the walk's own containment — the same ring, the same
     * radius — so a space explored with the free camera and a space walked
     * through cannot disagree about where the glass is.
     */
    const contain = (next: FreeCam): FreeCam => {
      const inside = opts.current.confine;
      if (!inside) return next;
      const [x, y] = holdInside(inside.ring, [cam.x, cam.y], [next.x, next.y]);
      const floor = inside.floorM;
      const storey = (inside as Inside & { floorHeightM?: number }).floorHeightM ?? 3.8;
      return {
        ...next,
        x,
        y,
        // Crouch a little, stand on tiptoe a little, never leave the storey.
        z: Math.max(floor + 0.9, Math.min(floor + storey * 0.82, next.z)),
      };
    };

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      const moving = held.current.size > 0;
      const turning = look.current.dYaw !== 0 || look.current.dPitch !== 0;
      if (moving || turning) {
        const on = (code: string) => (held.current.has(code) ? 1 : 0);
        const input: FreeInput = {
          ...NO_FREE_INPUT,
          forward: on('KeyW') + on('ArrowUp') - on('KeyS') - on('ArrowDown'),
          strafe: on('KeyD') + on('ArrowRight') - on('KeyA') - on('ArrowLeft'),
          rise: on('Space') - on('KeyC'),
          dYaw: look.current.dYaw,
          dPitch: look.current.dPitch,
          fast: held.current.has('ShiftLeft') || held.current.has('ShiftRight'),
        };

        look.current.dYaw = 0;
        look.current.dPitch = 0;
        // Inside a space, "fast" would put you through the glass in one frame
        // and there is nowhere to go anyway.
        cam = contain(stepFree(cam, opts.current.confine ? { ...input, fast: false } : input, dt));
        handle.current.cam = cam;
        layer.setFreeCamera(cam);
        reportRegion();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // --- Mouse: drag to look, click to select, move to see what is clickable.
    let dragging = false;
    let travelled = 0;
    let hoverAt = 0;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      travelled = 0;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (dragging) {
        travelled += Math.abs(e.movementX) + Math.abs(e.movementY);
        // The pointer is captured only once the press has become a drag, so a
        // plain click never loses the cursor.
        if (travelled > CLICK_SLOP_PX && document.pointerLockElement !== canvas) {
          canvas.requestPointerLock?.();
        }
        look.current.dYaw += e.movementX * SENSITIVITY;
        // Screen down is negative pitch, which is the convention every game
        // uses and the opposite of the sign of `movementY`.
        look.current.dPitch -= e.movementY * SENSITIVITY;
        return;
      }

      // Hover feedback, rate limited: a raycast per mouse event is a raycast
      // several hundred times a second for a cursor shape.
      const now = performance.now();
      if (now - hoverAt < 90) return;
      hoverAt = now;
      const rect = canvas.getBoundingClientRect();
      const hit = layer.pickAt(e.clientX - rect.left, e.clientY - rect.top);
      canvas.style.cursor = hit ? 'pointer' : '';
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const wasDragging = dragging;
      dragging = false;
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      if (!wasDragging || travelled > CLICK_SLOP_PX) return;

      const rect = canvas.getBoundingClientRect();
      const hit = layer.pickAt(e.clientX - rect.left, e.clientY - rect.top);
      if (hit && opts.current.onPick) opts.current.onPick(hit.buildingId, hit.z);
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        if (document.pointerLockElement === canvas) {
          document.exitPointerLock?.();
          return;
        }
        const state = useApp.getState();
        // Inside a space, Escape steps back out to the city rather than all
        // the way to the flat map: one step at a time is what the key means
        // everywhere else in this app.
        if (state.spaceExplore) state.leaveSpace();
        else state.setFreeLook(false);
        return;
      }
      if (!HELD.has(e.code)) return;
      // Space scrolls the page and the arrows move the scrollbar.
      e.preventDefault();
      held.current.add(e.code);
    };
    const onUp = (e: KeyboardEvent) => held.current.delete(e.code);
    const onBlur = () => {
      held.current.clear();
      dragging = false;
      look.current.dYaw = 0;
      look.current.dPitch = 0;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
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
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      held.current.clear();
      canvas.style.cursor = '';
      for (const h of handlers) h?.enable();
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      handle.current.cam = null;
      layer.setFreeCamera(null);
    };
    // `options` is deliberately absent and read through a ref: it carries
    // callbacks that are new objects on every render, and depending on them
    // would restart the camera sixty times a second.
    //
    // `confine` IS a dependency in effect, through `confineKey` below: entering
    // a different space has to re-seat the camera on the new plate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, layer, active, frame, confineKey(options.confine)]);

  return handle.current;
}

/** A stable string for a plate, so re-entering the same one is not a change. */
function confineKey(inside: Inside | null | undefined): string {
  return inside ? `${inside.buildingId}@${inside.floorM.toFixed(2)}` : '';
}

function centroidOf(ring: [number, number][]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return { x: sx / ring.length, y: sy / ring.length };
}

/**
 * A standing position two-thirds of the way from the middle of the plate
 * toward the glass you are facing.
 *
 * Marched rather than solved: stepping outward along the view direction and
 * stopping when the next step would leave the plate handles a plate of any
 * shape, including the L-shaped and notched ones the surveyed model is full
 * of, without a ray-versus-polygon intersection that has to be right about
 * every degenerate case.
 */
function seatFacing(ring: [number, number][], bearingDeg: number): { x: number; y: number } {
  const c = centroidOf(ring);
  const yaw = (bearingDeg * Math.PI) / 180;
  const dx = Math.sin(yaw);
  const dy = Math.cos(yaw);

  let out = { x: c.x, y: c.y };
  for (let step = 1; step <= 40; step++) {
    const next = { x: c.x + dx * step, y: c.y + dy * step };
    // A walker's width plus a little, so the seat is never inside the glass.
    if (!pointInRing(ring, next.x, next.y)) break;
    if (nearestEdge(ring, next.x, next.y).distance < 1.2) break;
    out = next;
  }
  return { x: c.x + (out.x - c.x) * 0.9, y: c.y + (out.y - c.y) * 0.9 };
}
