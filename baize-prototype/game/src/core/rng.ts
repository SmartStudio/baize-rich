// Seeded RNG (mulberry32). The generator state is a single uint32 kept inside
// GameState.rng so a saved state resumes the exact same random sequence.

export function hashSeed(seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Advances `holder.rng` and returns a float in [0, 1). */
export function nextFloat(holder: { rng: number }): number {
  let t = (holder.rng = (holder.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Small standalone RNG object (used by AI controllers / sim, not by game state). */
export class Rng {
  rng: number;
  constructor(seed: number) {
    this.rng = hashSeed(seed);
  }
  float(): number {
    return nextFloat(this);
  }
  int(maxExclusive: number): number {
    return Math.floor(this.float() * maxExclusive);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
