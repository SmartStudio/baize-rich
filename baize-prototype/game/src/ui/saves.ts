// Browser side of 对局记录: the localStorage autosave and the JSON download.
// Storage can throw (private mode, quota, blocked site data); the game must keep working.
import { parseRecord, type GameRecord } from '../core/record';

const AUTOSAVE_KEY = 'baize.autosave';

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
