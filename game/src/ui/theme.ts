import Phaser from 'phaser';

/** UI palette (from the art brief). */
export const COLORS = {
  bg: 0x1b1a2e,
  panel: 0x2e2b4a,
  panelLight: 0x3c3860,
  outline: 0x0f0e1a,
  parchment: 0xf4e9d0,
  ink: 0x2a2238,
  gold: 0xf2b93b,
  /** Board cells the player can act on. Kept apart from every seat colour, so it never reads as ownership. */
  focus: 0x5ef0ff,
  dim: 0x8a86a8,
  good: 0x6fcf7f,
  bad: 0xe05a5a,
  disabled: 0x4a4766,
};

export const HEX = {
  parchment: '#F4E9D0',
  gold: '#F2B93B',
  ink: '#2A2238',
  dim: '#8A86A8',
  white: '#FFFFFF',
  bad: '#E05A5A',
  good: '#6FCF7F',
};

/** p1 gold, p2 white, p3 red, p4 blue */
export const PLAYER_COLORS = [0xf2b93b, 0xe6e4f0, 0xd9434b, 0x3a6fd8];
export const PLAYER_HEX = ['#F2B93B', '#E6E4F0', '#D9434B', '#3A6FD8'];

/**
 * Font stack. Fusion Pixel / Ark Pixel are the intended pixel fonts (not bundled);
 * Noto Sans SC / CJK SC are fallbacks. Devs should switch to a BitmapText pixel font.
 */
export const FONT = '"Fusion Pixel 12px", "Ark Pixel 12px", "Noto Sans SC", "Noto Sans CJK SC", sans-serif';

/** Font size steps for the in-game HUD and board text. */
export const FS = { xs: 10, sm: 12, md: 14, lg: 18, xl: 24, hero: 40 };

/**
 * Text texture resolution. Keep it at 1: the framebuffer is always 1280×720 (Scale.FIT only stretches it with CSS),
 * so a 2× texture gets downsampled and drops 1-px strokes, e.g. "+225" renders as "−225".
 */
export const TEXT_RESOLUTION = 1;

export interface TextOpts {
  size?: number;
  color?: string;
  bold?: boolean;
  wrap?: number;
  align?: 'left' | 'center' | 'right';
  origin?: [number, number];
  stroke?: string;
  lineSpacing?: number;
}

export function txt(scene: Phaser.Scene, x: number, y: number, s: string, o: TextOpts = {}): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, s, {
    fontFamily: FONT,
    fontSize: `${o.size ?? 12}px`,
    color: o.color ?? HEX.parchment,
    fontStyle: o.bold ? 'bold' : 'normal',
    align: o.align ?? 'left',
    resolution: TEXT_RESOLUTION,
    wordWrap: o.wrap ? { width: o.wrap, callback: (str: string, obj: Phaser.GameObjects.Text) => wrapCJK(str, obj, o.wrap!) } : undefined,
    stroke: o.stroke,
    strokeThickness: o.stroke ? 3 : 0,
    lineSpacing: o.lineSpacing ?? 2,
  });
  if (o.origin) t.setOrigin(o.origin[0], o.origin[1]);
  // pixelArt:true makes every texture NEAREST; text placed on half pixels (centred origins) looks better LINEAR-filtered.
  t.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return t;
}

/** Chinese punctuation that must not start a line. */
const NO_LINE_START = /^[，。、：；！？）」』】》,.:;!?)]/;

/**
 * Phaser's built-in wraps only break at spaces, so Chinese text breaks at the few spaces around numbers
 * and leaves ragged short lines. Break between any two characters instead, keeping runs of
 * Latin letters / digits / signs (e.g. "+225", "P2") whole.
 */
function wrapCJK(text: string, t: Phaser.GameObjects.Text, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const tok of para.match(/[A-Za-z0-9+\-−.%×/]+|./gu) ?? []) {
      if (line.trim() && !NO_LINE_START.test(tok) && t.context.measureText(line + tok).width > width) {
        out.push(line.trimEnd());
        line = tok.trimStart();
      } else {
        line += tok;
      }
    }
    out.push(line);
  }
  return out;
}

export interface Tab {
  ribbon: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

/** Small ribbon-style header tab centred on (cx, y). Returns its ribbon and label for updates. */
export function tab(scene: Phaser.Scene, cx: number, y: number, label: string, fill: number): Tab {
  const ribbon = scene.add.rectangle(cx, y, 150, 20, fill).setStrokeStyle(2, COLORS.outline).setOrigin(0.5, 0.5);
  scene.add.rectangle(cx, y - 7, 146, 2, COLORS.gold).setOrigin(0.5, 0.5);
  return { ribbon, label: txt(scene, cx, y + 1, label, { size: 12, bold: true, origin: [0.5, 0.5], color: HEX.parchment }) };
}

/** Floating HUD panels: translucent ink so the board shows through at the edges. */
export const FLOAT_ALPHA = 0.88;

/** Simple bordered panel rectangle. */
export function panel(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number,
  fill = COLORS.panel, stroke = COLORS.outline, alpha = 1,
): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(x, y, w, h, fill, alpha).setOrigin(0, 0).setStrokeStyle(2, stroke);
}
