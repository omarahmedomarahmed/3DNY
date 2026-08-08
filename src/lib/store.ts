'use client';

import { create } from 'zustand';
import { EMPTY_FILTERS } from '@/types';
import type {
  BuildingWithSpaces,
  ColorMode,
  Filters,
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

interface AppState {
  buildings: BuildingWithSpaces[];
  loading: boolean;
  error: string | null;

  filters: Filters;
  colorMode: ColorMode;
  /** Google photorealistic tiles instead of the free grey city massing. */
  photoreal: boolean;
  /**
   * Whether buildings with nothing available are drawn at all — the grey city
   * and the filtered-out massing. Off by default: the clean map is the one
   * that gets shown to a client.
   */
  showContext: boolean;
  /** Basemap and recessive-colour theme. Dark reads better in a dim room. */
  mapTheme: 'dark' | 'light';
  /** Draw subway, bus, ferry and rail stops, with walk lines from the selection. */
  showTransit: boolean;
  /** Which transit modes are drawn. Empty means all of them. */
  transitModes: string[];
  /** Hide every building except the selection, or those inside the radius. */
  isolateSelection: boolean;

  selectedBuildingId: string | null;
  selectedSpaceId: string | null;
  hoveredBuildingId: string | null;

  compare: CompareEntry[];
  compareOpen: boolean;

  radius: RadiusSelection | null;

  /** Building ids currently inside the map viewport, driving the sidebar. */
  visibleBuildingIds: string[];

  loadBuildings: () => Promise<void>;
  replaceBuilding: (b: BuildingWithSpaces) => void;
  updateSpace: (spaceId: string, patch: Partial<Space>) => void;

  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  setColorMode: (m: ColorMode) => void;
  setPhotoreal: (on: boolean) => void;
  setShowContext: (on: boolean) => void;
  setMapTheme: (t: 'dark' | 'light') => void;
  setShowTransit: (on: boolean) => void;
  toggleTransitMode: (mode: string) => void;
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
}

export const useApp = create<AppState>((set, get) => ({
  buildings: [],
  loading: false,
  error: null,

  filters: EMPTY_FILTERS,
  colorMode: 'rent',
  photoreal: false,
  showContext: false,
  mapTheme: 'dark',
  showTransit: false,
  transitModes: [],
  isolateSelection: false,

  selectedBuildingId: null,
  selectedSpaceId: null,
  hoveredBuildingId: null,

  compare: [],
  compareOpen: false,

  radius: null,
  visibleBuildingIds: [],

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

  setShowContext(showContext) {
    set({ showContext });
  },

  setMapTheme(mapTheme) {
    set({ mapTheme });
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
