import { describe, expect, it, vi } from 'vitest';
import { breakthroughPanelPosition } from '../src/ui/Breakthrough';
import { BOARD_COL, H, type Rect } from '../src/ui/layout';

vi.mock('phaser', () => ({ default: {} }));

const PANEL = { w: 520, h: 300 };
const tokens: Rect[] = [
  { x: 320, y: 80, w: 32, h: 52 },
  { x: 928, y: 80, w: 32, h: 52 },
  { x: 320, y: 580, w: 32, h: 52 },
  { x: 928, y: 580, w: 32, h: 52 },
  { x: 624, y: 334, w: 32, h: 52 },
];

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('breakthrough panel placement', () => {
  it.each(tokens)('keeps the board token outside the panel at %#', (token) => {
    const at = breakthroughPanelPosition(token);
    expect(overlaps({ ...at, ...PANEL }, token)).toBe(false);
  });

  it.each(tokens)('keeps the compact panel inside the board column at %#', (token) => {
    const at = breakthroughPanelPosition(token);
    expect(at.x).toBeGreaterThanOrEqual(BOARD_COL.x);
    expect(at.x + PANEL.w).toBeLessThanOrEqual(BOARD_COL.x + BOARD_COL.w);
    expect(at.y).toBeGreaterThanOrEqual(0);
    expect(at.y + PANEL.h).toBeLessThanOrEqual(H);
  });
});
