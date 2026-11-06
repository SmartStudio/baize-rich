import { describe, expect, it } from 'vitest';
import { HOVER_IDLE_MS, hoverTipOpen, type HoverGate } from '../src/ui/hoverTip';

const resting: HoverGate = {
  overTile: true,
  pinned: false,
  cameraMoving: false,
  cameraSincePointer: false,
  modalOpen: false,
  aiTurn: false,
  pointerIdleMs: 0,
};

describe('tile hover tip', () => {
  it('stays open while the pointer rests on a tile during a human turn', () => {
    expect(hoverTipOpen({ ...resting, pointerIdleMs: HOVER_IDLE_MS + 5000 })).toBe(true);
  });

  it('closes when the pointer leaves, the camera moves, or a modal is open', () => {
    expect(hoverTipOpen({ ...resting, overTile: false })).toBe(false);
    expect(hoverTipOpen({ ...resting, cameraMoving: true })).toBe(false);
    expect(hoverTipOpen({ ...resting, cameraSincePointer: true })).toBe(false);
    expect(hoverTipOpen({ ...resting, modalOpen: true })).toBe(false);
  });

  it('closes after the pointer sits still through an AI turn', () => {
    expect(hoverTipOpen({ ...resting, aiTurn: true, pointerIdleMs: HOVER_IDLE_MS - 1 })).toBe(true);
    expect(hoverTipOpen({ ...resting, aiTurn: true, pointerIdleMs: HOVER_IDLE_MS })).toBe(false);
  });

  it('keeps a pinned tip up through those dismissals', () => {
    expect(hoverTipOpen({
      ...resting,
      pinned: true,
      overTile: false,
      cameraMoving: true,
      cameraSincePointer: true,
      modalOpen: true,
      aiTurn: true,
      pointerIdleMs: HOVER_IDLE_MS,
    })).toBe(true);
  });
});
