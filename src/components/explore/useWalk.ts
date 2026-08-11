'use client';

import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { useApp } from '@/lib/store';
import { toLngLat, type LocalFrame } from '@/lib/explore/frame';
import { viewForEye } from '@/lib/explore/camera';
import {
  EYE_HEIGHT_M,
  groundEntry,
  stepWalk,
  NO_INPUT,
  type Obstacle,
  type WalkInput,
  type WalkState,
} from '@/lib/explore/walk';

/**
 * First person, at street level.
 *
 * The walk drives **MapLibre's own camera** rather than a camera of its own,
 * and that is the whole design. MapLibre's camera is what deck.gl's overlay
 * and the three.js scene both derive their projections from, so a single
 * `jumpTo` moves the basemap, the availability bands, the name-plates, the
 * transit lines and the city together. A separate walk camera would mean
 * keeping three of them in step every frame, and the first frame they drifted
 * a Goldenrod band would part company with the window it is on.
 *
 * `viewForEye` is the inversion that makes it possible: given an eye position,
 * a bearing and a pitch, it solves for the centre and zoom that put MapLibre's
 * camera exactly there.
 *
 * | Key | |
 * |---|---|
 * | W A S D / arrows | Walk and strafe |
 * | Q E | Turn |
 * | R F | Look up and down |
 * | Shift | Move faster |
 * | Escape | Back to the drone camera |
 */

const KEY_MAP: Record<string, keyof WalkInput | 'run'> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'forward',
  ArrowDown: 'forward',
  KeyA: 'strafe',
  KeyD: 'strafe',
  KeyQ: 'turn',
  KeyE: 'turn',
  ArrowLeft: 'turn',
  ArrowRight: 'turn',
  KeyR: 'look',
  KeyF: 'look',
  ShiftLeft: 'run',
  ShiftRight: 'run',
};

/** Degrees per second. Fast enough to turn a corner, slow enough to read. */
const TURN_RATE = 95;
const LOOK_RATE = 60;

function readInput(held: Set<string>): WalkInput {
  const on = (code: string) => (held.has(code) ? 1 : 0);
  return {
    forward: on('KeyW') + on('ArrowUp') - on('KeyS') - on('ArrowDown'),
    strafe: on('KeyD') - on('KeyA'),
    turn: (on('KeyE') + on('ArrowRight') - on('KeyQ') - on('ArrowLeft')) * TURN_RATE,
    look: (on('KeyR') - on('KeyF')) * LOOK_RATE,
    running: held.has('ShiftLeft') || held.has('ShiftRight'),
  };
}

export interface WalkHandle {
  /** Where the walker is, for the harness and for the on-screen readout. */
  state: WalkState | null;
}

export function useWalk(
  map: maplibregl.Map | null,
  active: boolean,
  frame: LocalFrame | null,
  obstacles: Obstacle[],
): WalkHandle {
  const handle = useRef<WalkHandle>({ state: null });
  const held = useRef(new Set<string>());
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;

  useEffect(() => {
    if (!map || !active || !frame) {
      handle.current.state = null;
      return;
    }

    /**
     * Where the walk starts: under the camera, on the pavement.
     *
     * The point below the middle of the screen is where the user was looking,
     * which is what they meant by "here". It is then pushed out of any
     * building it landed in — dropping into a tower and being stuck there is
     * the first thing that would happen otherwise, because the camera is
     * usually pointed at a building.
     */
    const centre = map.getCenter();
    const [cx, cy] = [
      (centre.lng - frame.lon0) * frame.mPerLon,
      (centre.lat - frame.lat0) * 110_574,
    ];
    const [x, y] = groundEntry([cx, cy], obstaclesRef.current);

    let state: WalkState = {
      x,
      y,
      z: EYE_HEIGHT_M,
      bearing: map.getBearing(),
      // Level with the horizon, near enough. This is the view the whole mode
      // exists for: standing in the street looking up a facade.
      pitch: 84,
    };
    handle.current.state = state;

    const apply = () => {
      const canvas = map.getCanvas();
      const { centerOffset, zoom } = viewForEye({
        eye: [state.x, state.y, state.z],
        bearing: state.bearing,
        pitch: state.pitch,
        height: canvas.clientHeight || 800,
        lat: frame.lat0,
      });
      map.jumpTo({
        center: toLngLat(frame, centerOffset[0], centerOffset[1]),
        zoom,
        bearing: state.bearing,
        pitch: Math.min(85, state.pitch),
      });
    };

    apply();

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const input = held.current.size > 0 ? readInput(held.current) : NO_INPUT;
      // Nothing held means nothing to recompute. A walk that re-solves the
      // camera sixty times a second while standing still is a laptop fan.
      if (input !== NO_INPUT) {
        state = stepWalk(state, input, dt, obstaclesRef.current);
        handle.current.state = state;
        apply();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        useApp.getState().setWalking(false);
        return;
      }
      if (!(e.code in KEY_MAP)) return;
      // Arrow keys scroll the page and space would too; a walk that moves the
      // scrollbar instead of the camera is worse than no walk.
      e.preventDefault();
      held.current.add(e.code);
    };
    const onUp = (e: KeyboardEvent) => held.current.delete(e.code);
    // A window that loses focus mid-stride would otherwise keep walking.
    const onBlur = () => held.current.clear();

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      held.current.clear();
      handle.current.state = null;
    };
    // `obstacles` is deliberately absent: it changes as buildings load, and it
    // is read through a ref so a new list does not restart the walk and put
    // the walker back where they came in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, active, frame]);

  return handle.current;
}
