import { describe, expect, it } from 'vitest';
import { ITEM_PICTURES, PAL } from '../src/ui/sprites';

const maps = Object.entries(ITEM_PICTURES).map(([name, p]) => [`card_${name}`, p.rows] as const);

describe('pixel placeholder maps', () => {
  it.each(maps)('%s is a rectangle of palette keys', (_name, rows) => {
    const width = rows[0].length;
    for (const row of rows) {
      expect(row.length).toBe(width);
      for (const key of row) if (key !== '.') expect(PAL[key]).toBeDefined();
    }
  });
});
