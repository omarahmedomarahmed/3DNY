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
  FREE_SPEED_MS,
  INSIDE_SPEED_MS,
  NO_FREE_INPUT,
  stepFree,
  wrapDeg,
  type FreeCam,
  type FreeInput,
} from '@/lib/explore/freecam';
import {
  advanceOrbit,
  blendCamera,
  orbitCamera,
  startOrbit,
  transitionSeconds,
  type OrbitState,
  type OrbitSubject,
} from '@/lib/explore/orbit';
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
 * ## Mouse look is a mode, not a button you hold
 *
 * This has now been all three ways and the middle one was the worst. Captured
 * the whole time is right for a game and wrong for a map — with no cursor
 * there is nothing to point at a building with. Drag-to-look kept the cursor
 * and made you hold a button down for as long as you wanted to steer, which
 * nobody will do while flying across Midtown.
 *
 * So: **one click hands the camera to the mouse**, and from then on the
 * crosshair in the middle of the screen is the cursor. A click while captured
 * selects whatever the crosshair is on. Escape hands the cursor back, and a
 * second Escape leaves.
 *
 * | Control | |
 * |---|---|
 * | Click the map | Take the camera. The mouse now steers, hands free |
 * | Move the mouse | Look |
 * | Click again | Select what the crosshair is on |
 * | W A S D | Fly along the look direction, and strafe |
 * | Space / C | Straight up, straight down |
 * | Shift | Much faster |
 * | Escape | Give the cursor back, then leave |
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

/**
 * How far the camera may fly before the map is asked to load around it.
 *
 * And how often, which matters more. Distance alone was the whole rule and it
 * is not enough: with Shift held the camera covers 250 m in a third of a
 * second, so a sprint across Midtown queued a new streetscape fetch three
 * times a second and each reply is a full rebuild of streets, water and
 * planting. The interval is what turns a sprint into one request at the end of
 * it instead of thirty along the way.
 */
const REGION_STEP_M = 350;
const REGION_INTERVAL_MS = 2500;

const HELD = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'KeyC', 'ShiftLeft', 'ShiftRight',
]);

export interface FreeCamHandle {
  cam: FreeCam | null;
  /**
   * Pull back and level off, without leaving where you are.
   *
   * What "reset the view" means to somebody who has flown down an avenue and
   * lost their bearings among the towers. Flying them home would answer a
   * question they did not ask — they want to see where they got to.
   */
  pullBack: () => void;
}

export interface FreeCamOptions {
  /**
   * A floor plate the camera may not leave.
   *
   * Set while exploring a space: the same ring the walk uses, so the two modes
   * cannot disagree about where the glass is.
   */
  confine?: Inside | null;
  /**
   * Step outside the space without leaving its floor.
   *
   * With `confine` set and this true the plate stops being a wall and becomes
   * an altitude: you may fly anywhere in the city, but only at this
   * availability's own height, and you can fly straight back in through the
   * glass. It answers the question a floor plan cannot — what is on this side
   * of the building at *this* level, what does the tower opposite look like
   * from here, is the view about to be built out.
   */
  outside?: boolean;
  /** Metres above the plate the eye sits when confined. */
  eyeHeightM?: number;
  /** Called when a click resolves to a building and an elevation. */
  onPick?: (buildingId: string, z: number) => void;
  /**
   * Called when the camera has flown far enough that the surrounding data
   * should be loaded around it rather than around MapLibre's viewport.
   */
  onRegion?: (lng: number, lat: number) => void;
  /**
   * A building to lock onto and circle.
   *
   * While this is set the keyboard does not move the camera at all — see the
   * note in the frame loop. Clearing it hands the camera straight back to free
   * look from wherever the orbit had reached, with no transition, because the
   * camera is already there.
   */
  orbit?: OrbitSubject | null;
}

export function useFreeCam(
  map: maplibregl.Map | null,
  layer: ExploreLayer | null,
  active: boolean,
  frame: LocalFrame | null,
  options: FreeCamOptions = {},
): FreeCamHandle {
  const handle = useRef<FreeCamHandle>({ cam: null, pullBack: () => {} });
  const held = useRef(new Set<string>());
  /**
   * The running orbit: which subject it is for, the solved framing, and how
   * far through the move into the lock it is.
   *
   * Held in a ref rather than in state because it advances every frame and
   * rendering React sixty times a second to spin a camera would cost more than
   * the camera does.
   */
  const lock = useRef<{
    subject: OrbitSubject;
    state: OrbitState;
    from: FreeCam;
    elapsed: number;
    duration: number;
    /** Wall-clock stamp of the last frame this orbit advanced on. */
    lastAt: number;
  } | null>(null);
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
    const outside = Boolean(opts.current.outside);
    const eyeH = opts.current.eyeHeightM ?? 1.68;

    let cam: FreeCam = confined && outside
      ? {
          /**
           * Stepped out through the glass you were facing.
           *
           * Placed a short way beyond the plate along the current view
           * direction, at the same eye height, still looking the same way — so
           * the transition reads as walking through the window rather than as
           * a cut to somewhere else.
           */
          ...outsideOf(confined.ring, handle.current.cam?.yaw ?? map.getBearing()),
          z: confined.floorM + eyeH,
          yaw: wrapDeg(handle.current.cam?.yaw ?? map.getBearing()),
          pitch: handle.current.cam?.pitch ?? 0,
        }
      : confined
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

    handle.current.pullBack = () => {
      // High enough to clear the tallest thing in the market by a comfortable
      // margin, pitched down far enough to see the grid, and pointing the same
      // way — turning them round as well would be a second disorientation.
      cam = { ...cam, z: Math.max(cam.z, 520), pitch: -38 };
      handle.current.cam = cam;
      layer.setFreeCamera(cam);
      reportRegion();
    };

    let unlockedAt = 0;
    const justUnlocked = () => performance.now() - unlockedAt < 250;

    let lastRegion: [number, number] = [cam.x, cam.y];
    let lastRegionAt = 0;
    const reportRegion = () => {
      if (!opts.current.onRegion) return;
      if (Math.hypot(cam.x - lastRegion[0], cam.y - lastRegion[1]) < REGION_STEP_M) return;
      const now = performance.now();
      if (now - lastRegionAt < REGION_INTERVAL_MS) return;
      lastRegionAt = now;
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
      const floor = inside.floorM;
      const storey = (inside as Inside & { floorHeightM?: number }).floorHeightM ?? 3.8;
      const heldZ = Math.max(floor + 0.9, Math.min(floor + storey * 0.82, next.z));

      // Outside on this floor: the altitude is the constraint and the plan is
      // free. Flying back in through the glass is allowed and is the point.
      if (opts.current.outside) return { ...next, z: heldZ };

      const [x, y] = holdInside(inside.ring, [cam.x, cam.y], [next.x, next.y]);
      return { ...next, x, y, z: heldZ };
    };

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      /**
       * The locked orbit takes the camera away from the keyboard entirely.
       *
       * Held ahead of the input block rather than blended with it: an orbit
       * you can nudge with W is not a locked shot, it is a camera with a drift,
       * and the whole value of the mode is that the framing does not wander.
       * The keys are read and discarded so that letting go of one does not
       * fire a movement the moment the orbit stops.
       *
       * Stopping is a hand-off, not a transition. `cam` is already where the
       * orbit left it, so free look resumes from exactly that point — which is
       * what "return me to free look from where it is standing" has to mean.
       */
      const orbit = opts.current.orbit ?? null;
      if (orbit) {
        if (!lock.current || lock.current.subject !== orbit) {
          // A new subject: solve the framing and begin the move into it.
          const started = startOrbit(
            orbit,
            cam,
            layer.fieldOfViewDeg,
            (canvas.clientWidth || 1200) / (canvas.clientHeight || 800),
          );
          lock.current = {
            subject: orbit,
            state: started,
            from: cam,
            elapsed: 0,
            duration: transitionSeconds(cam, orbitCamera(started)),
            lastAt: now,
          };
        }

        // Not `held` — that is the key set, and shadowing it here would be a
        // very quiet bug.
        const run = lock.current;
        /**
         * The orbit turns on wall-clock time, not on the frame loop's `dt`.
         *
         * `dt` is clamped to a tenth of a second so that a backgrounded tab
         * does not resume by teleporting the camera across Midtown. That is
         * right for movement and wrong here: on a machine drawing a frame a
         * second the clamp throws away nine tenths of every interval, so a
         * revolution promised in forty-five seconds takes minutes, and takes a
         * different number of minutes on every machine. The browser harness
         * caught it as an orbit covering 149 m in one six-second window and 69
         * in the next.
         *
         * A cinematic camera has to keep the time it advertises, so the clock
         * it runs on is the wall's.
         */
        const wall = Math.min(1, (now - run.lastAt) / 1000);
        run.lastAt = now;
        run.elapsed += wall;
        if (run.elapsed < run.duration) {
          // Still dollying in or out. The orbit does not begin turning until
          // the camera has arrived, so the move reads as one gesture.
          cam = blendCamera(run.from, orbitCamera(run.state), run.elapsed / run.duration);
        } else {
          run.state = advanceOrbit(run.state, wall);
          cam = orbitCamera(run.state);
        }

        handle.current.cam = cam;
        layer.setFreeCamera(cam);
        reportRegion();
        raf = requestAnimationFrame(tick);
        return;
      }
      lock.current = null;

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
        // Indoors: a jog, with Shift at a fraction of the outdoor multiplier —
        // see `INSIDE_FAST_MULTIPLIER`.
        const indoors = Boolean(opts.current.confine);
        cam = contain(
          stepFree(cam, input, dt, indoors ? INSIDE_SPEED_MS : FREE_SPEED_MS),
        );
        handle.current.cam = cam;
        layer.setFreeCamera(cam);
        reportRegion();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    /**
     * Mouse look is a mode you enter, not a button you hold.
     *
     * The drag-to-look version was wrong in the way that matters most: flying
     * and steering at the same time meant holding a button down for as long as
     * you were moving, which is not something anyone wants to do for more than
     * about ten seconds. One click captures the pointer and after that the
     * mouse *is* the view; the crosshair in the middle is the cursor, and a
     * click while captured selects whatever it is on.
     *
     * Escape gives the pointer back — the browser does that itself, and the
     * key handler below is careful not to also leave the mode on the same
     * press.
     */
    let hoverAt = 0;
    const locked = () => document.pointerLockElement === canvas;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!locked()) {
        // The first click is "give me the camera", and nothing else. Picking
        // on the same press would select whatever happened to be under a
        // cursor the user was only using to reach the map.
        canvas.requestPointerLock?.();
        return;
      }
      // Captured: the crosshair is the cursor, so the pick is dead centre.
      const hit = layer.pickAt(canvas.clientWidth / 2, canvas.clientHeight / 2);
      if (hit && opts.current.onPick) opts.current.onPick(hit.buildingId, hit.z);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (locked()) {
        look.current.dYaw += e.movementX * SENSITIVITY;
        // Screen down is negative pitch, which is the convention every game
        // uses and the opposite of the sign of `movementY`.
        look.current.dPitch -= e.movementY * SENSITIVITY;
        return;
      }

      // Not captured: an ordinary cursor, which changes shape over anything
      // that can be clicked. Rate limited — a raycast per mouse event is a
      // raycast several hundred times a second for a cursor shape.
      const now = performance.now();
      if (now - hoverAt < 90) return;
      hoverAt = now;
      const rect = canvas.getBoundingClientRect();
      const hit = layer.pickAt(e.clientX - rect.left, e.clientY - rect.top);
      canvas.style.cursor = hit ? 'pointer' : '';
    };

    /**
     * The crosshair follows the capture, and the store carries it.
     *
     * `MapView` draws the dot; it has to know when the pointer is captured,
     * and `pointerlockchange` is the only event that says so — including when
     * the browser releases it on its own, which Escape and losing focus both
     * do.
     */
    const onLockChange = () => {
      const on = locked();
      useApp.getState().setPointerLocked(on);
      if (!on) {
        unlockedAt = performance.now();
        canvas.style.cursor = '';
        // A key held when the pointer was released would otherwise stay held
        // for ever: the keyup goes to whatever has focus now.
        held.current.clear();
      }
    };
    document.addEventListener('pointerlockchange', onLockChange);

    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        // The browser has already released the pointer by the time this fires,
        // so the first Escape is "give me my cursor back" and only a second
        // one leaves the mode. `justUnlocked` is what tells them apart.
        if (justUnlocked()) return;
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
      look.current.dYaw = 0;
      look.current.dPitch = 0;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
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
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      held.current.clear();
      canvas.style.cursor = '';
      useApp.getState().setPointerLocked(false);
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
  }, [map, layer, active, frame, confineKey(options.confine), Boolean(options.outside)]);

  return handle.current;
}

/** A stable string for a plate, so re-entering the same one is not a change. */
function confineKey(inside: Inside | null | undefined): string {
  return inside ? `${inside.buildingId}@${inside.floorM.toFixed(2)}` : '';
}

/**
 * A point a few metres beyond the plate, in the direction being faced.
 *
 * Marched outward from the centroid the same way `seatFacing` marches, and
 * then a little further — far enough clear of the glass that the camera is
 * unambiguously outside it and the facade does not clip through the near
 * plane.
 */
function outsideOf(ring: [number, number][], bearingDeg: number): { x: number; y: number } {
  const c = centroidOf(ring);
  const yaw = (bearingDeg * Math.PI) / 180;
  const dx = Math.sin(yaw);
  const dy = Math.cos(yaw);

  let steps = 0;
  for (let step = 1; step <= 200; step++) {
    if (!pointInRing(ring, c.x + dx * step, c.y + dy * step)) break;
    steps = step;
  }
  const clear = steps + 7;
  return { x: c.x + dx * clear, y: c.y + dy * clear };
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
