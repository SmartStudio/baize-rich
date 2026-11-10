// Placeholder frames for HUD icons the atlas may not ship yet.
// PlayerCards registers them. When the atlas has the same frame name, that art wins.
import Phaser from 'phaser';
import { ATLAS_KEY } from './assets';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

interface IconSpec {
  name: string;
  w: number;
  h: number;
  draw: Draw;
}

function diamond(fill: string): Draw {
  return (ctx) => {
    ctx.fillStyle = '#0F0E1A';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(16, 8);
    ctx.lineTo(8, 16);
    ctx.lineTo(0, 8);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(8, 2);
    ctx.lineTo(14, 8);
    ctx.lineTo(8, 14);
    ctx.lineTo(2, 8);
    ctx.fill();
  };
}

function herb(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#1E6B32';
  ctx.fillRect(7, 8, 2, 7);
  ctx.fillStyle = '#3FA35A';
  ctx.fillRect(2, 4, 6, 5);
  ctx.fillRect(8, 3, 6, 5);
}

export const HUD_ICON_SPECS: readonly IconSpec[] = [
  { name: 'ic_herb', w: 16, h: 16, draw: herb },
  { name: 'ic_mind', w: 16, h: 16, draw: diamond('#C9B6F2') },
];

/** Create a canvas texture for each HUD icon the atlas does not already provide. */
export function ensureHudIcons(scene: Phaser.Scene): void {
  const atlas = scene.textures.exists(ATLAS_KEY) ? scene.textures.get(ATLAS_KEY) : null;
  for (const spec of HUD_ICON_SPECS) {
    if (atlas?.has(spec.name)) continue;
    if (scene.textures.exists(spec.name)) continue;
    const tex = scene.textures.createCanvas(spec.name, spec.w, spec.h);
    if (!tex) continue;
    spec.draw(tex.getContext(), spec.w, spec.h);
    tex.refresh();
  }
}
