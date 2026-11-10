// What a choice screen shows, as plain data. Presenters (registry.ts) build it from a PendingChoice;
// ChoiceModal draws it. No Phaser here, so the presenters are unit-tested headless.
import type { ChoiceKind, PendingChoiceOf } from '../../core/choices';
import type { Game } from '../../core/engine';
import type { Rect } from '../layout';

export interface ChoiceEnv {
  game: Game;
  /** Name shown before the title when several humans share the screen. */
  who?: string;
}

/** Turns one kind of engine choice into the screen that asks it. */
export type Presenter<K extends ChoiceKind> = (c: PendingChoiceOf<K>, env: ChoiceEnv) => ModalSpec;

export type Tone = 'good' | 'gold' | 'bad' | 'dim';

export interface ModalOption {
  id: string;
  label: string;
  hint?: string;
  /** Icon frame: on the card in 'cards', repeated `count` times on a tile, left of the label in 'list'. */
  icon?: string;
  count?: number;
  /** Large glyph drawn instead of an icon when no frame fits (e.g. 灵草). */
  glyph?: string;
  /** Keyboard digit that picks this option. Defaults to its 1-based position. */
  key?: string;
  /** Shown for comparison but not pickable (坊市 goods you cannot afford). */
  disabled?: boolean;
  /** 'tiles': the consequence in large type ("72%", "+3 丹药") and its colour. */
  big?: string;
  tone?: Tone;
  /** 'tiles': a 0–1 bar under `big` (success odds). */
  meter?: number;
}

/** One labelled number in the strip under the title (地利 +1, 灵石 1500). */
export interface Fact {
  label: string;
  value: string;
  tone?: Tone;
}

export type ModalLayout = 'list' | 'cards' | 'tiles' | 'stepper';

export interface ModalSpec {
  title: string;
  desc?: string;
  /** 'tiles' / 'cards': one large line above the facts ("练气 → 筑基 · 目标 9"). */
  headline?: string;
  facts?: Fact[];
  options: ModalOption[];
  defaultId?: string;
  /** Option id returned on Esc. `null` = Esc closes the modal and resolves null. */
  cancelId?: string | null;
  placement?: 'center' | 'side';
  /** Extra "返回" button that resolves null (sub-menus). */
  closable?: boolean;
  layout?: ModalLayout;
  /** Card frame for 'cards' layout ('card_divine' / 'card_heaven'). */
  cardFrame?: string;
  cardLabel?: string;
  /** A frame shown at the left at the largest whole scale that fits (e.g. the land block for 购买灵田). */
  preview?: string;
  /** false hides the "1. " key prefix when the label already is the number. */
  numbered?: boolean;
  avoid?: Rect;
}

/** Keyboard digit of the option at `i`: its own key ('' = none), else its 1-based position (1–9). */
export function optionKey(o: ModalOption, i: number): string | null {
  if (o.disabled) return null;
  if (o.key !== undefined) return o.key || null;
  return i < 9 ? String(i + 1) : null;
}

/** "+2" / "−1" / "0", with a real minus sign. */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}
