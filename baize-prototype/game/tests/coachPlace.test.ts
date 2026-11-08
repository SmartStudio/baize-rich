import { describe, expect, it } from 'vitest';
import { bubbleOrigin } from '../src/ui/coachPlace';
import { H, RIGHT, W, type Rect } from '../src/ui/layout';
import { overlap } from '../src/ui/pickLayout';

const BUBBLE = { w: 260, h: 96 };

function bubbleAt(at: Rect): Rect {
  return { ...bubbleOrigin(at, BUBBLE.w, BUBBLE.h), ...BUBBLE };
}

describe('coach bubble placement', () => {
  const anchors: Rect[] = [];
  for (let x = 0; x < W; x += 40) for (let y = 0; y < H; y += 40) anchors.push({ x, y, w: 40, h: 30 });
  const dock: Rect = { x: RIGHT.x, y: 0, w: W - RIGHT.x, h: H };

  it('keeps out of the dock column wherever it points, so the main button is never covered', () => {
    for (const at of anchors) expect({ at, covers: overlap(bubbleAt(at), dock) }).toEqual({ at, covers: 0 });
  });

  it('stays on screen and off what it points at', () => {
    for (const at of anchors) {
      const b = bubbleAt(at);
      expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H).toBe(true);
      expect({ at, covers: overlap(b, at) }).toEqual({ at, covers: 0 });
    }
  });
});
