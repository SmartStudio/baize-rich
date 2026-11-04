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

/** Text is rendered at this resolution so it stays legible when Scale.FIT enlarges the canvas. */
export const TEXT_RESOLUTION = 2;

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
    wordWrap: o.wrap ? { width: o.wrap, useAdvancedWrap: true } : undefined,
    stroke: o.stroke,
    strokeThickness: o.stroke ? 3 : 0,
    lineSpacing: o.lineSpacing ?? 2,
  });
  if (o.origin) t.setOrigin(o.origin[0], o.origin[1]);
  // pixelArt:true makes every texture NEAREST; text rendered at 2× looks better LINEAR-filtered.
  t.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return t;
}

/** Small ribbon-style header tab centred on (cx, y). Returns its label for updates. */
export function tab(scene: Phaser.Scene, cx: number, y: number, label: string, fill: number): Phaser.GameObjects.Text {
  scene.add.rectangle(cx, y, 150, 20, fill).setStrokeStyle(2, COLORS.outline).setOrigin(0.5, 0.5);
  scene.add.rectangle(cx, y - 7, 146, 2, COLORS.gold).setOrigin(0.5, 0.5);
  return txt(scene, cx, y + 1, label, { size: 12, bold: true, origin: [0.5, 0.5], color: HEX.parchment });
}

/** Simple bordered panel rectangle. */
export function panel(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number,
  fill = COLORS.panel, stroke = COLORS.outline, alpha = 1,
): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(x, y, w, h, fill, alpha).setOrigin(0, 0).setStrokeStyle(2, stroke);
}
