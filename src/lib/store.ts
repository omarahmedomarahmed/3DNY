'use client';

import { create } from 'zustand';
import { EMPTY_FILTERS } from '@/types';
import type { TimeOfDay } from '@/components/map/atmosphere';
import type { ColorOverrides } from '@/components/map/colors';
import type {
  BuildingWithSpaces,
  ColorMode,
  Filters,
  OccupancyKind,
  Space,
} from '@/types';

/** One entry in the compare tray: a space plus the building it sits in. */
export interface CompareEntry {
  spaceId: string;
  buildingId: string;
}

interface RadiusSelection {
  lon: number;
  lat: number;
  /** Radius in miles. Brokers think in quarter-miles, not metres. */
  miles: number;
  originBuildingId: string | null;
}

// The shape lives beside the defaults it overrides, in `colors.ts`, so the two
// cannot drift apart.
export type { ColorOverrides };

/** One popup on the map: which card, where it sits, and whether it is pinned. */
export interface PopupWindow {
  id: string;
  kind: 'space' | 'tenant' | 'station';
  /** Empty for a station, which belongs to no building. */
  buildingId: string;
  /** Space id, tenant id, or transit stop id, by kind. */
  recordId: string | null;
  /** Viewport pixels. Updated as the card is dragged. */
  x: number;
  y: number;
  /**
   * A pinned card survives the next click on the map, so a second card can be
   * opened beside it. Exactly one card is unpinned at a time — the one you are
   * still reading — and it is the one that closes when you click away.
   */
  pinned: boolean;
}

/**
 * Which map you are looking at.
 *
 * `flat` is the map that exists today and it is the default and the fallback:
 * every existing behaviour, harness and habit belongs to it. `explore` is the
 * second mode — a real-time 3-D Manhattan you move through — reached by a
 * button and never entered by accident.
 */
export type MapMode = 'flat' | 'explore';

interface AppState {
  buildings: BuildingWithSpaces[];
  loading: boolean;
  error: string | null;

  filters: Filters;
  colorMode: ColorMode;
  /** Google photorealistic tiles instead of the free grey city massing. */
  photoreal: boolean;
  /** Flat map, or the 3-D city you can walk through. Flat is the default. */
  mapMode: MapMode;
  /** First person at street level, rather than the free drone camera. */
  walking: boolean;
  /**
   * The unconstrained camera: three.js's own, not MapLibre's.
   *
   * MapLibre's camera cannot pitch past 85 degrees, and 90 is the horizon — so
   * on the flat map, and in every other Explore view, it is *impossible* to
   * look above eye level. That is fine for a map and wrong for a model with a
   * sky, a sun and eight-hundred-foot towers in it: the one thing anyone does
   * standing at the foot of a skyscraper is look up.
   *
   * With this on, `ExploreLayer` computes its own projection and the camera
   * flies and turns without limit. The cost is stated where it is paid: the
   * basemap and deck.gl's overlay still follow MapLibre's camera, so deck.gl's
   * layers are switched off for the duration and picking with them. It is a
   * look-around mode, and leaving it restores everything.
   */
  freeLook: boolean;
  /**
   * The availability being explored from the inside.
   *
   * Building explore puts you in the city looking at the towers. Space explore
   * puts you *in the space*, on its own floor, at its own height, free to walk
   * to the glass and look out at the city from exactly where a tenant would.
   * They are two different questions a broker asks — "where is this in the
   * market" and "what is it like to be in it" — and conflating them is what
   * makes a 3-D map a toy.
   *
   * Selecting another availability while this is set moves you into that one,
   * so a shortlist can be walked end to end without going back outside.
   */
  spaceExplore: {
    buildingId: string;
    spaceId: string | null;
    floorNumber: number;
  } | null;
  /**
   * Whether free look currently owns the mouse.
   *
   * Drawn as a crosshair, and it has to live here rather than in the hook
   * because the dot is chrome — `MapView` renders it, and the browser can take
   * the capture away at any moment without asking anybody.
   */
  pointerLocked: boolean;
  /**
   * Whether space exploration has stepped out through the glass.
   *
   * Still the same availability and still its floor — the altitude is locked
   * to it — but the plate is no longer a wall, so you can fly round the
   * outside of the building at that level and back in. It answers what a floor
   * plan cannot: what is on this side of the tower at *this* height.
   */
  spaceOutside: boolean;
  /**
   * The floor a broker has stepped onto, entered from its band.
   *
   * `null` means the pavement. This is the one place Explore mode goes
   * *inside* a building, and it is reached deliberately — from an
   * availability's own card — rather than by walking through a door that does
   * not exist.
   */
  standingOn: { buildingId: string; floorNumber: number } | null;
  /**
   * Whether buildings with nothing available are drawn at all — the grey city
   * and the filtered-out massing. Off by default: the clean map is the one
   * that gets shown to a client.
   */
  showContext: boolean;
  /** Basemap and recessive-colour theme. Dark reads better in a dim room. */
  mapTheme: 'dark' | 'light';
  /**
   * Hour of the day the city is lit at: sun position, sky, and how far
   * distance fades into haze. Null follows the theme, which is what almost
   * everyone wants — a dark room gets night, a bright one gets morning.
   */
  timeOfDay: TimeOfDay | null;
  /** Draw subway, bus, ferry and rail stops, with walk lines from the selection. */
  showTransit: boolean;
  /** Which transit modes are drawn. Empty means all of them. */
  transitModes: string[];
  /** Hide every building except the selection, or those inside the radius. */
  isolateSelection: boolean;
  /**
   * Which kinds of floor band are drawn: what is available, whose space our
   * clients are in, and who occupies the rest.
   *
   * Availability alone is the default and stays the default even once tenant
   * data exists. This map's subject is space on the market; the other two are
   * answers to "and what about the rest of the building", which is a question
   * you ask second. Someone who wants them switches them on and the choice
   * persists — but nobody opening the map for the first time is shown a tower
   * covered in bands before they have asked for any.
   */
  occupancyKinds: OccupancyKind[];

  selectedBuildingId: string | null;
  selectedSpaceId: string | null;
  hoveredBuildingId: string | null;

  compare: CompareEntry[];
  compareOpen: boolean;

  radius: RadiusSelection | null;

  /** Building ids currently inside the map viewport, driving the sidebar. */
  visibleBuildingIds: string[];

  /**
   * Whether the two rails are on screen. Both start closed.
   *
   * The map is the product. Opening on filters down one side and a results
   * list down the other leaves about half the window for the thing everyone
   * in the room is actually looking at, and in a meeting the first thing a
   * broker did was collapse them both by hand. So that is the starting state,
   * and each comes back with one large button.
   */
  leftRailOpen: boolean;
  rightRailOpen: boolean;
  /**
   * Whether the tool stack is unfolded. It is, from the start.
   *
   * The rails hide because they take a third of the window each. The tools are
   * one 36px column against an edge, and folding them cost more than it saved:
   * every camera move — zoom, rotate, tilt — went from one click to two, and
   * those are the controls someone reaches for constantly while talking.
   */
  controlsOpen: boolean;
  /** The legend, and the band section within it, can each be put away. */
  legendOpen: boolean;
  bandsSectionOpen: boolean;

  /** Colours the user has changed. Empty means every default applies. */
  colorOverrides: ColorOverrides;

  /** Every card open on the map, in the order they were opened. */
  popups: PopupWindow[];

  loadBuildings: () => Promise<void>;
  replaceBuilding: (b: BuildingWithSpaces) => void;
  updateSpace: (spaceId: string, patch: Partial<Space>) => void;

  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  setColorMode: (m: ColorMode) => void;
  setPhotoreal: (on: boolean) => void;
  setMapMode: (m: MapMode) => void;
  setWalking: (on: boolean) => void;
  setFreeLook: (on: boolean) => void;
  setPointerLocked: (on: boolean) => void;
  setSpaceOutside: (on: boolean) => void;
  enterSpace: (buildingId: string, spaceId: string | null, floorNumber: number) => void;
  leaveSpace: () => void;
  standOnFloor: (buildingId: string, floorNumber: number) => void;
  leaveFloor: () => void;
  setShowContext: (on: boolean) => void;
  setMapTheme: (t: 'dark' | 'light') => void;
  setTimeOfDay: (t: TimeOfDay | null) => void;
  setShowTransit: (on: boolean) => void;
  toggleTransitMode: (mode: string) => void;
  toggleOccupancyKind: (kind: OccupancyKind) => void;
  setIsolateSelection: (on: boolean) => void;

  selectBuilding: (id: string | null) => void;
  selectSpace: (id: string | null) => void;
  setHovered: (id: string | null) => void;

  addToCompare: (spaceId: string, buildingId: string) => void;
  removeFromCompare: (spaceId: string) => void;
  clearCompare: () => void;
  setCompareOpen: (open: boolean) => void;
  loadCompareFromUrl: (ids: string[]) => void;

  setRadius: (r: RadiusSelection | null) => void;
  setVisibleBuildingIds: (ids: string[]) => void;

  setLeftRailOpen: (open: boolean) => void;
  setRightRailOpen: (open: boolean) => void;
  setControlsOpen: (open: boolean) => void;
  setLegendOpen: (open: boolean) => void;
  setBandsSectionOpen: (open: boolean) => void;

  setColorOverride: (key: keyof ColorOverrides, value: string | null) => void;
  resetColorOverrides: () => void;

  /** Opens a card, replacing whichever card is not pinned. */
  openPopup: (p: Omit<PopupWindow, 'id' | 'pinned'>) => void;
  movePopup: (id: string, x: number, y: number) => void;
  togglePopupPinned: (id: string) => void;
  closePopup: (id: string) => void;
  /** What a click on empty map does: closes everything still unpinned. */
  closeUnpinnedPopups: () => void;
  setPopupRecord: (id: string, recordId: string | null) => void;
}

export const useApp = create<AppState>((set, get) => ({
  buildings: [],
  loading: false,
  error: null,

  filters: EMPTY_FILTERS,
  colorMode: 'rent',
  photoreal: false,
  mapMode: 'flat',
  walking: false,
  freeLook: false,
  spaceExplore: null,
  pointerLocked: false,
  spaceOutside: false,
  standingOn: null,
  showContext: false,
  // Light. Dark was the default on the argument that these maps are shown in
  // dim rooms on projectors — true of some meetings and not of the laptop
  // screen where most of the work happens, and a first-time viewer opening a
  // black map does not read it as a deliberate choice.
  mapTheme: 'light',
  timeOfDay: null,
  showTransit: false,
  transitModes: [],
  occupancyKinds: ['available'],
  isolateSelection: false,

  selectedBuildingId: null,
  selectedSpaceId: null,
  hoveredBuildingId: null,

  compare: [],
  compareOpen: false,

  radius: null,
  visibleBuildingIds: [],

  leftRailOpen: false,
  rightRailOpen: false,
  controlsOpen: true,
  legendOpen: true,
  bandsSectionOpen: true,

  colorOverrides: {},
  popups: [],

  async loadBuildings() {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/buildings', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const buildings = (await res.json()) as BuildingWithSpaces[];
      set({ buildings, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  replaceBuilding(b) {
    set({
      buildings: get().buildings.map((existing) => (existing.id === b.id ? b : existing)),
    });
  },

  updateSpace(spaceId, patch) {
    set({
      buildings: get().buildings.map((b) => ({
        ...b,
        spaces: b.spaces.map((s) => (s.id === spaceId ? { ...s, ...patch } : s)),
      })),
    });
  },

  setFilters(patch) {
    set({ filters: { ...get().filters, ...patch } });
  },

  resetFilters() {
    set({ filters: EMPTY_FILTERS });
  },

  setColorMode(colorMode) {
    set({ colorMode });
  },

  setPhotoreal(photoreal) {
    set({ photoreal });
  },

  setMapMode(mapMode) {
    // Explore mode draws the city itself, so Google's photorealistic mesh and
    // it are two answers to the same question. Leaving both on gives a scene
    // with two of every building in it, half a metre apart.
    set(
      mapMode === 'explore'
        ? { mapMode, photoreal: false }
        : {
            mapMode,
            walking: false,
            freeLook: false,
            spaceExplore: null,
            spaceOutside: false,
            standingOn: null,
          },
    );
  },

  setWalking(walking) {
    // Walking is a thing you do inside Explore mode. Asking for it from the
    // flat map is a reasonable thing to want and means switching modes.
    // Walking and free look are two answers to the same question, so turning
    // one on turns the other off rather than leaving two camera drivers
    // fighting over `jumpTo` sixty times a second.
    set(
      walking
        ? {
            walking,
            mapMode: 'explore' as MapMode,
            freeLook: false,
            spaceExplore: null,
            spaceOutside: false,
          }
        : { walking, standingOn: null },
    );
  },

  setSpaceOutside(spaceOutside) {
    // Only meaningful inside a space; setting it anywhere else would leave a
    // flag on that nothing clears.
    if (get().spaceExplore) set({ spaceOutside });
  },

  setPointerLocked(pointerLocked) {
    // Cheap guard: this fires on every capture change and a no-op set would
    // re-render the whole map chrome for nothing.
    if (get().pointerLocked !== pointerLocked) set({ pointerLocked });
  },

  setFreeLook(freeLook) {
    set(
      freeLook
        ? { freeLook, mapMode: 'explore' as MapMode, walking: false, standingOn: null }
        // Leaving free look leaves the space with it: a space is explored
        // *with* the free camera, and there is no other camera that can stand
        // inside a floor plate and look out of it.
        : { freeLook, spaceExplore: null, spaceOutside: false },
    );
  },

  enterSpace(buildingId, spaceId, floorNumber) {
    // Entering a space IS free look, in Explore mode, on that floor. Setting
    // all of it in one update rather than expecting three callers to remember
    // the other two.
    set({
      spaceExplore: { buildingId, spaceId, floorNumber },
      spaceOutside: false,
      mapMode: 'explore' as MapMode,
      freeLook: true,
      walking: false,
      standingOn: null,
      selectedBuildingId: buildingId,
      ...(spaceId ? { selectedSpaceId: spaceId } : {}),
    });
  },

  leaveSpace() {
    // Back outside, still in free look — you came in from the city and that is
    // where stepping out of a room puts you.
    set({ spaceExplore: null, spaceOutside: false });
  },

  standOnFloor(buildingId, floorNumber) {
    // Stepping onto a floor IS walking, in Explore mode. Anything else would
    // mean a broker clicking "stand here" and watching the drone camera not
    // move.
    set({
      standingOn: { buildingId, floorNumber },
      walking: true,
      freeLook: false,
      mapMode: 'explore',
    });
  },

  leaveFloor() {
    set({ standingOn: null });
  },

  setShowContext(showContext) {
    set({ showContext });
  },

  setMapTheme(mapTheme) {
    // Switching theme re-follows the theme's own hour. Someone who has picked
    // an hour deliberately gets it back by picking again; someone who has not
    // gets the sensible default for the map they just switched to, rather
    // than a night sky over a white basemap.
    set({ mapTheme, timeOfDay: null });
  },

  setTimeOfDay(timeOfDay) {
    set({ timeOfDay });
  },

  setShowTransit(showTransit) {
    set({ showTransit });
  },

  toggleTransitMode(mode) {
    // Empty means "all modes", which is the state the map starts in. Clicking
    // a chip from there has to mean "turn this one OFF" — the chips all read
    // as on, so anything else is the opposite of what was pressed. So the
    // implicit set is expanded to an explicit one on the first click.
    const ALL = ['subway', 'bus', 'rail', 'path', 'ferry', 'tram'];
    const current = get().transitModes.length === 0 ? ALL : get().transitModes;
    const next = current.includes(mode)
      ? current.filter((m) => m !== mode)
      : [...current, mode];
    // Back to the implicit "all" when everything is on, so the map does not
    // sit on a filter that filters nothing.
    set({ transitModes: next.length === ALL.length ? [] : next });
  },

  toggleOccupancyKind(kind) {
    // Availability is never switched off. It is the subject of the map, and a
    // map of Manhattan showing only who is already in the buildings is a
    // different product that nobody asked for.
    if (kind === 'available') return;
    const current = get().occupancyKinds;
    set({
      occupancyKinds: current.includes(kind)
        ? current.filter((k) => k !== kind)
        : [...current, kind],
    });
  },

  setIsolateSelection(isolateSelection) {
    set({ isolateSelection });
  },

  selectBuilding(selectedBuildingId) {
    set({ selectedBuildingId, selectedSpaceId: null });
  },

  selectSpace(selectedSpaceId) {
    set({ selectedSpaceId });
  },

  setHovered(hoveredBuildingId) {
    set({ hoveredBuildingId });
  },

  addToCompare(spaceId, buildingId) {
    const compare = get().compare;
    if (compare.some((c) => c.spaceId === spaceId)) return;
    set({ compare: [...compare, { spaceId, buildingId }], compareOpen: true });
  },

  removeFromCompare(spaceId) {
    const compare = get().compare.filter((c) => c.spaceId !== spaceId);
    set({ compare, compareOpen: compare.length > 0 ? get().compareOpen : false });
  },

  clearCompare() {
    set({ compare: [], compareOpen: false });
  },

  setCompareOpen(compareOpen) {
    set({ compareOpen });
  },

  loadCompareFromUrl(ids) {
    const byId = new Map<string, string>();
    for (const b of get().buildings) {
      for (const s of b.spaces) byId.set(s.id, b.id);
    }
    const compare = ids
      .filter((id) => byId.has(id))
      .map((spaceId) => ({ spaceId, buildingId: byId.get(spaceId)! }));
    set({ compare, compareOpen: compare.length > 0 });
  },

  setRadius(radius) {
    set({ radius });
  },

  setVisibleBuildingIds(visibleBuildingIds) {
    set({ visibleBuildingIds });
  },

  setLeftRailOpen(leftRailOpen) {
    set({ leftRailOpen });
  },

  setRightRailOpen(rightRailOpen) {
    set({ rightRailOpen });
  },

  setControlsOpen(controlsOpen) {
    set({ controlsOpen });
  },

  setLegendOpen(legendOpen) {
    set({ legendOpen });
  },

  setBandsSectionOpen(bandsSectionOpen) {
    set({ bandsSectionOpen });
  },

  setColorOverride(key, value) {
    const next = { ...get().colorOverrides };
    if (value === null) delete next[key];
    else next[key] = value;
    set({ colorOverrides: next });
  },

  resetColorOverrides() {
    set({ colorOverrides: {} });
  },

  openPopup(p) {
    // One unpinned card at a time. Opening a second while the first is still
    // unpinned replaces it — otherwise clicking around the map silently
    // accumulates cards nobody asked to keep. Pinning is the deliberate act
    // that says "keep this one while I go and find another".
    const kept = get().popups.filter((w) => w.pinned);

    // The same record clicked twice is the card already on screen, not a
    // second copy of it.
    const already = kept.find(
      (w) => w.kind === p.kind && w.buildingId === p.buildingId && w.recordId === p.recordId,
    );
    if (already) {
      set({ popups: kept });
      return;
    }

    set({
      popups: [
        ...kept,
        { ...p, id: `${p.kind}:${p.buildingId}:${p.recordId ?? ''}:${kept.length}`, pinned: false },
      ],
    });
  },

  movePopup(id, x, y) {
    set({ popups: get().popups.map((w) => (w.id === id ? { ...w, x, y } : w)) });
  },

  togglePopupPinned(id) {
    set({
      popups: get().popups.map((w) => (w.id === id ? { ...w, pinned: !w.pinned } : w)),
    });
  },

  closePopup(id) {
    set({ popups: get().popups.filter((w) => w.id !== id) });
  },

  closeUnpinnedPopups() {
    const popups = get().popups.filter((w) => w.pinned);
    if (popups.length === get().popups.length) return;
    set({ popups });
  },

  setPopupRecord(id, recordId) {
    set({ popups: get().popups.map((w) => (w.id === id ? { ...w, recordId } : w)) });
  },
}));

/** Resolve compare entries against loaded data. */
export function useCompareDetails() {
  const compare = useApp((s) => s.compare);
  const buildings = useApp((s) => s.buildings);

  return compare
    .map(({ spaceId, buildingId }) => {
      const building = buildings.find((b) => b.id === buildingId);
      const space = building?.spaces.find((s) => s.id === spaceId);
      return building && space ? { building, space } : null;
    })
    .filter((x): x is { building: BuildingWithSpaces; space: Space } => x !== null);
}

export function findSpace(
  buildings: BuildingWithSpaces[],
  spaceId: string,
): { building: BuildingWithSpaces; space: Space } | null {
  for (const building of buildings) {
    const space = building.spaces.find((s) => s.id === spaceId);
    if (space) return { building, space };
  }
  return null;
}
