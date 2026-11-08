// The player's sound settings and the bus levels they produce.

export interface AudioPrefs {
  /** M: silences everything without forgetting the other settings. */
  muted: boolean;
  music: boolean;
  sfx: boolean;
  /** One of VOLUMES. */
  volume: number;
}

export const VOLUMES = [0.25, 0.5, 0.75, 1] as const;

export const DEFAULT_PREFS: AudioPrefs = { muted: false, music: true, sfx: true, volume: 0.75 };

/** The bed sits well under the cues: it should be noticed when it stops, not while it plays. */
const MUSIC_LEVEL = 0.32;
/** Music level while a cutscene (闭关, 白泽现世, 斗法, the win) holds the screen. */
export const DUCK_LEVEL = 0.3;

export interface BusGains {
  master: number;
  music: number;
  sfx: number;
}

export function busGains(p: AudioPrefs): BusGains {
  return {
    master: p.muted ? 0 : p.volume,
    music: p.music ? MUSIC_LEVEL : 0,
    sfx: p.sfx ? 1 : 0,
  };
}

/** The next volume step up (+1) or down (−1), held at the ends. */
export function stepVolume(volume: number, dir: 1 | -1): number {
  const i = nearestVolume(volume);
  return VOLUMES[Math.min(VOLUMES.length - 1, Math.max(0, i + dir))];
}

/** The VOLUMES step closest to `v`. */
export function snapVolume(v: number): number {
  return VOLUMES[nearestVolume(v)];
}

function nearestVolume(v: number): number {
  let best = 0;
  VOLUMES.forEach((x, i) => { if (Math.abs(x - v) < Math.abs(VOLUMES[best] - v)) best = i; });
  return best;
}
