import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from '@/lib/store';

/**
 * The mode machine.
 *
 * Explore mode now has four states that can each be entered from more than one
 * place — the flat map, the drone camera, the walk, free look, and inside an
 * availability — and the ways they can go wrong are all the same shape: two
 * cameras driving `jumpTo` at once, or a state left set that nothing can now
 * clear. A broker stuck inside a floor plate with no way out is not a bug you
 * find by looking at a screenshot.
 *
 * So the transitions are asserted here rather than being left to the four
 * components that trigger them. Every one of these was a real possible path
 * through the buttons.
 */

const reset = () =>
  useApp.setState({
    mapMode: 'flat',
    walking: false,
    freeLook: false,
    spaceExplore: null,
    standingOn: null,
    selectedBuildingId: null,
    selectedSpaceId: null,
  });

describe('entering a space', () => {
  beforeEach(reset);

  it('turns on everything it needs, from the flat map, in one step', () => {
    useApp.getState().enterSpace('b1', 's1', 14);
    const s = useApp.getState();
    expect(s.spaceExplore).toEqual({ buildingId: 'b1', spaceId: 's1', floorNumber: 14 });
    expect(s.mapMode).toBe('explore');
    // A space is explored WITH the free camera: it is the only camera that can
    // stand on a floor plate and look up out of the glass.
    expect(s.freeLook).toBe(true);
  });

  it('selects the building and the space it put you in', () => {
    useApp.getState().enterSpace('b1', 's1', 14);
    expect(useApp.getState().selectedBuildingId).toBe('b1');
    expect(useApp.getState().selectedSpaceId).toBe('s1');
  });

  it('never leaves the walk running alongside it', () => {
    useApp.setState({ walking: true, mapMode: 'explore' });
    useApp.getState().enterSpace('b1', 's1', 14);
    // Two cameras both calling jumpTo sixty times a second is the failure.
    expect(useApp.getState().walking).toBe(false);
    expect(useApp.getState().standingOn).toBeNull();
  });

  it('moves straight from one space to another', () => {
    useApp.getState().enterSpace('b1', 's1', 14);
    useApp.getState().enterSpace('b2', 's2', 31);
    const s = useApp.getState();
    expect(s.spaceExplore).toEqual({ buildingId: 'b2', spaceId: 's2', floorNumber: 31 });
    expect(s.freeLook).toBe(true);
    expect(s.selectedBuildingId).toBe('b2');
  });

  it('accepts a floor with no availability on it', () => {
    useApp.getState().enterSpace('b1', null, 9);
    expect(useApp.getState().spaceExplore?.spaceId).toBeNull();
    // The previous space selection is left alone rather than being cleared:
    // you have moved, you have not decided the shortlist was wrong.
    expect(useApp.getState().selectedBuildingId).toBe('b1');
  });
});

describe('leaving', () => {
  beforeEach(reset);

  it('leaveSpace puts you back outside, still in free look', () => {
    useApp.getState().enterSpace('b1', 's1', 14);
    useApp.getState().leaveSpace();
    const s = useApp.getState();
    expect(s.spaceExplore).toBeNull();
    // You came in from the city and that is where stepping out of a room puts
    // you — not all the way back to the flat map.
    expect(s.freeLook).toBe(true);
    expect(s.mapMode).toBe('explore');
  });

  it('switching free look off leaves the space with it', () => {
    useApp.getState().enterSpace('b1', 's1', 14);
    useApp.getState().setFreeLook(false);
    expect(useApp.getState().spaceExplore).toBeNull();
    expect(useApp.getState().freeLook).toBe(false);
  });

  it('going back to the flat map clears every Explore state', () => {
    useApp.getState().enterSpace('b1', 's1', 14);
    useApp.getState().setMapMode('flat');
    const s = useApp.getState();
    expect(s.spaceExplore).toBeNull();
    expect(s.freeLook).toBe(false);
    expect(s.walking).toBe(false);
    expect(s.standingOn).toBeNull();
  });
});

describe('the two cameras never run together', () => {
  beforeEach(reset);

  it('walking switches free look off', () => {
    useApp.getState().setFreeLook(true);
    useApp.getState().setWalking(true);
    expect(useApp.getState().freeLook).toBe(false);
    expect(useApp.getState().walking).toBe(true);
  });

  it('free look switches walking off', () => {
    useApp.getState().setWalking(true);
    useApp.getState().setFreeLook(true);
    expect(useApp.getState().walking).toBe(false);
    expect(useApp.getState().freeLook).toBe(true);
  });

  it('standing on a floor switches free look off', () => {
    useApp.getState().setFreeLook(true);
    useApp.getState().standOnFloor('b1', 14);
    expect(useApp.getState().freeLook).toBe(false);
    expect(useApp.getState().walking).toBe(true);
  });
});

describe('the flat map is not reachable from any of this', () => {
  beforeEach(reset);

  it('none of the Explore states are set by default', () => {
    const s = useApp.getState();
    expect(s.mapMode).toBe('flat');
    expect(s.freeLook).toBe(false);
    expect(s.spaceExplore).toBeNull();
  });

  it('turning Explore on does not turn any camera on by itself', () => {
    useApp.getState().setMapMode('explore');
    const s = useApp.getState();
    expect(s.walking).toBe(false);
    expect(s.freeLook).toBe(false);
    expect(s.spaceExplore).toBeNull();
  });
});
