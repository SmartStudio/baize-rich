// Browser side of 对局记录: the localStorage autosave and the JSON download.
// Storage can throw (private mode, quota, blocked site data); the game must keep working.
import { DEFAULT_PREFS, snapVolume, type AudioPrefs } from '../audio/mix';
import { defaultData } from '../core/data';
import { parseRecord, replayRecord, type GameRecord } from '../core/record';
import { isCoachStep, type CoachStep } from './coachTriggers';
import { SPEEDS } from './pacing';

const AUTOSAVE_KEY = 'baize.autosave';
const TUTORIAL_KEY = 'baize.tutorialSeen';
const COACH_KEY = 'baize.coach';
const AUDIO_KEY = 'baize.audio';
const SPEED_KEY = 'baize.speed';

/** An unfinished autosave that still replays, with a one-line summary for the 继续上局 button. */
export function findResumable(): { record: GameRecord; summary: string } | null {
  const record = loadAutosave();
  if (!record || record.finished) return null;
  let st;
  try {
    st = replayRecord(record).state;
  } catch (e) {
    console.info('[baize] 自动存档无法继续', e);
    return null;
  }
  const humans = record.seats.filter((s) => s.human).length;
  return { record, summary: `第 ${st.round}/${defaultData.config.rounds} 轮 · ${st.players[st.current].name} · 玩家 ${humans} 人` };
}

/** Whether the first-game 玩法说明 has been shown. Unreadable storage counts as unseen: one Esc beats a lost newcomer. */
export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    /* storage blocked: the tutorial stays reachable from the title screen */
  }
}

export function loadCoach(): { armed: boolean; seen: CoachStep[] } {
  let raw: string | null;
  try {
    raw = localStorage.getItem(COACH_KEY);
  } catch {
    return { armed: true, seen: [] };
  }
  return parseCoachSave(raw);
}

export function saveCoach(armed: boolean, seen: readonly CoachStep[]): void {
  try {
    localStorage.setItem(COACH_KEY, JSON.stringify({ armed, seen }));
  } catch {
    /* storage blocked: the guide stays on for this tab */
  }
}

/** Next game walks the seven steps again. */
export function armCoach(): void {
  saveCoach(true, []);
}

export function parseCoachSave(raw: string | null): { armed: boolean; seen: CoachStep[] } {
  if (!raw) return { armed: true, seen: [] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { armed: true, seen: [] };
  }
  if (!json || typeof json !== 'object') return { armed: true, seen: [] };
  const seenRaw = 'seen' in json ? json.seen : undefined;
  const armed = 'armed' in json ? json.armed : undefined;
  const seen = Array.isArray(seenRaw) ? seenRaw.filter((step): step is CoachStep => typeof step === 'string' && isCoachStep(step)) : [];
  return { armed: armed !== false, seen };
}

export function loadAudioPrefs(): AudioPrefs {
  try {
    return parseAudioPrefs(localStorage.getItem(AUDIO_KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveAudioPrefs(p: AudioPrefs): void {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: the settings hold for this tab */
  }
}

/** Unknown or broken fields fall back one by one, so an old save keeps whatever still reads. */
export function parseAudioPrefs(raw: string | null): AudioPrefs {
  let json: unknown = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    /* unreadable: defaults */
  }
  const o = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const flag = (k: 'muted' | 'music' | 'sfx') => (typeof o[k] === 'boolean' ? o[k] : DEFAULT_PREFS[k]);
  const volume = typeof o.volume === 'number' && Number.isFinite(o.volume) ? snapVolume(o.volume) : DEFAULT_PREFS.volume;
  return { muted: flag('muted'), music: flag('music'), sfx: flag('sfx'), volume };
}

/** The 倍速 last chosen with F; 1× when unset, unreadable or no longer offered. */
export function loadSpeed(): number {
  try {
    return parseSpeed(localStorage.getItem(SPEED_KEY));
  } catch {
    return 1;
  }
}

export function saveSpeed(speed: number): void {
  try {
    localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    /* storage blocked: the speed holds for this game */
  }
}

export function parseSpeed(raw: string | null): number {
  const n = Number(raw);
  return raw !== null && SPEEDS.some((s) => s.speed === n) ? n : 1;
}

export function saveAutosave(r: GameRecord): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(r));
  } catch (e) {
    console.info('[baize] autosave failed', e);
  }
}

/** The saved game, if it exists and is still a valid record for the current data. */
export function loadAutosave(): GameRecord | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = parseRecord(json);
  if (!r.ok) console.info(`[baize] 自动存档不可用：${r.error}`);
  return r.ok ? r.record : null;
}

export function recordFileName(r: GameRecord): string {
  const d = new Date(r.savedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `baize-record-${stamp}-seed${r.setup.seed}.json`;
}

export function downloadRecord(r: GameRecord): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = recordFileName(r);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
