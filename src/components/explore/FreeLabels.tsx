'use client';

import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { useApp } from '@/lib/store';
import { toLocal } from '@/lib/explore/frame';
import { buildingHeightFt, buildingRing, FT_TO_M } from '@/lib/floor-bands';
import type { BuildingWithSpaces } from '@/types';
import type { ExploreLayer } from './ExploreLayer';

/**
 * Name-plates, in free look.
 *
 * deck.gl draws the pills everywhere else and cannot here: it projects with
 * MapLibre's camera and free look is not drawn from it, so every label would
 * be several blocks from its tower. It is switched off for the duration, and
 * this draws them instead — as DOM, projected through `ExploreLayer`'s own
 * matrix, which is the one the frame was actually rendered with.
 *
 * Doing it in the DOM rather than in the scene buys three things that were all
 * asked for and none of which deck.gl's `TextLayer` gives you:
 *
 * | | |
 * |---|---|
 * | They stop overlapping | Placed nearest-first; a pill that would collide with one already placed is dropped rather than drawn on top of it |
 * | They can be clicked | A label is a target, so a name you can read is a building you can open |
 * | One can be brought forward | Click a pill that is behind another and it wins the collision from then on |
 *
 * ## Why nearest-first, and why dropping rather than nudging
 *
 * Nudging labels apart is the obvious fix and it is worse. A pill that has
 * been pushed forty pixels sideways to make room is a pill pointing at the
 * wrong tower — and in a city of towers that is not a cosmetic error, it is a
 * wrong answer. Dropping is honest: the near building keeps its name, the one
 * behind it does not have one until you move.
 *
 * Nearest-first because that is the order the eye works in, and because it
 * makes flying toward a block reveal its names one at a time, which is what
 * "labels arrive as you get closer" actually looks like.
 */

/** Beyond this the pill is unreadable anyway, and the frame is a mess. */
const MAX_DISTANCE_M = 900;

/** How many can be on screen at once. Past this it is wallpaper, not labels. */
const MAX_LABELS = 22;

/** Half-extents used for the collision test, in pixels. */
const PILL_H = 26;
const PILL_CHAR_W = 6.4;
const PILL_PAD = 16;

interface Placed {
  id: string;
  text: string;
  sub: string | null;
  x: number;
  y: number;
  w: number;
  distance: number;
}

interface Anchor {
  id: string;
  text: string;
  sub: string | null;
  /** Scene metres: the roof's middle. */
  x: number;
  y: number;
  z: number;
}

function labelText(b: BuildingWithSpaces): string {
  return b.address_display || b.building_name || 'Building';
}

function availabilityNote(b: BuildingWithSpaces): string | null {
  const n = b.spaces.filter((s) => s.is_active).length;
  if (n === 0) return null;
  return `${n} space${n === 1 ? '' : 's'}`;
}

export default function FreeLabels({
  map,
  layer,
  buildings,
  active,
}: {
  map: maplibregl.Map | null;
  layer: ExploreLayer | null;
  buildings: BuildingWithSpaces[];
  active: boolean;
}) {
  const [placed, setPlaced] = useState<Placed[]>([]);
  /**
   * The one the user asked for by clicking it.
   *
   * Held in a ref and applied as an ordering bias rather than as state the
   * layout reads, so bringing a label forward does not re-run the effect that
   * builds the anchors.
   */
  const front = useRef<string | null>(null);
  const anchors = useRef<Anchor[]>([]);

  // --- Anchors: one per building, in scene metres. Rebuilt only when the
  // buildings change, never per frame.
  useEffect(() => {
    if (!layer || !active) {
      anchors.current = [];
      return;
    }
    const frame = layer.localFrame;
    const out: Anchor[] = [];
    for (const b of buildings) {
      const ring = buildingRing(b);
      if (!ring || ring.length === 0) continue;
      let sx = 0;
      let sy = 0;
      for (const [lon, lat] of ring) {
        const [x, y] = toLocal(frame, lon, lat);
        sx += x;
        sy += y;
      }
      out.push({
        id: b.id,
        text: labelText(b),
        sub: availabilityNote(b),
        x: sx / ring.length,
        y: sy / ring.length,
        // Above the parapet, so the pill reads as a callout rather than as
        // something painted on the roof.
        z: buildingHeightFt(b) * FT_TO_M + 14,
      });
    }
    anchors.current = out;
  }, [layer, buildings, active]);

  // --- Layout, ten times a second rather than sixty. A name-plate that
  // settles a sixteenth of a second late is imperceptible; a React render per
  // frame for twenty pills is not.
  useEffect(() => {
    if (!layer || !active || !map) {
      setPlaced([]);
      return;
    }

    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 100) return;
      last = now;

      const eye = layer.eye;
      const candidates: Placed[] = [];

      for (const a of anchors.current) {
        const distance = Math.hypot(a.x - eye.x, a.y - eye.y, a.z - eye.z);
        if (distance > MAX_DISTANCE_M) continue;
        const p = layer.projectToScreen(a.x, a.y, a.z);
        // `projectToScreen` returns null for anything behind the camera, which
        // is the whole reason it exists — see the `w <= 0` note there.
        if (!p) continue;
        candidates.push({
          id: a.id,
          text: a.text,
          sub: a.sub,
          x: p.x,
          y: p.y,
          w: a.text.length * PILL_CHAR_W + PILL_PAD,
          distance,
        });
      }

      // Nearest first, with anything the user brought forward jumping the
      // queue. That is the whole of "click it to bring it to the front".
      candidates.sort((p, q) => {
        if (front.current === p.id) return -1;
        if (front.current === q.id) return 1;
        return p.distance - q.distance;
      });

      const kept: Placed[] = [];
      for (const c of candidates) {
        if (kept.length >= MAX_LABELS) break;
        const clash = kept.some(
          (k) =>
            Math.abs(k.x - c.x) < (k.w + c.w) / 2 && Math.abs(k.y - c.y) < PILL_H,
        );
        if (clash) continue;
        kept.push(c);
      }

      setPlaced(kept);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layer, active, map]);

  if (!active || placed.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {placed.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            /**
             * Two jobs on one click, and both are what someone means.
             *
             * The pill wins every future collision, so a name half hidden
             * behind a nearer one can be pulled out; and the building is
             * selected, which is what clicking its name means everywhere else
             * in this product.
             */
            front.current = front.current === p.id ? null : p.id;
            useApp.getState().selectBuilding(p.id);
          }}
          style={{ left: p.x, top: p.y }}
          className={
            'pointer-events-auto absolute -translate-x-1/2 -translate-y-full ' +
            'whitespace-nowrap rounded border bg-white/95 px-2 py-1 text-[11px] ' +
            'font-semibold leading-tight text-ink shadow-card transition-colors ' +
            (front.current === p.id
              ? 'border-goldenrod'
              : 'border-hairline-strong hover:border-midnight')
          }
        >
          {p.text}
          {p.sub ? <span className="ml-1.5 font-medium text-muted">{p.sub}</span> : null}
        </button>
      ))}
    </div>
  );
}
