// 'cards' layout: options as cards side by side (机缘, 白泽现世), the effect written under each.
import { addImg, frameRef } from '../assets';
import { H } from '../layout';
import { COLORS, FS, HEX, txt } from '../theme';
import { header, keyHelp, modalFrame, placeX, TONE_FILL, TONE_HEX, type SheetBuilder } from './panel';
import { optionKey } from './spec';

const CW = 160;
const CH = 216;
const GAP = 16;
const HINT_H = 40;

export const buildCards: SheetBuilder = (s, spec, pick, hover) => {
  const n = spec.options.length;
  const rowW = n * CW + (n - 1) * GAP;
  const pw = Math.max(440, rowW + 48);
  const head = header(s, spec, pw - 48);
  const ph = 34 + head.h + 8 + CH + HINT_H + 28;
  const py = Math.round((H - ph) / 2);
  const px = placeX(pw, py, ph, spec.avoid, false);
  const layer = modalFrame(s, spec.title, px, py, pw, ph, true);
  layer.add(head.box.setPosition(Math.round(px + pw / 2), py + 30));
  const x0 = Math.round(px + (pw - rowW) / 2);
  const y0 = py + 34 + head.h + 8;
  const cards = spec.options.map((o, i) => {
    const x = x0 + i * (CW + GAP);
    const tone = o.tone ?? 'gold';
    const glow = s.add.rectangle(x - 4, y0 - 4, CW + 8, CH + 8, TONE_FILL[tone]).setOrigin(0, 0).setAlpha(0);
    const [fk, ff] = frameRef(s, spec.cardFrame ?? 'card_divine');
    const card = s.add.image(x, y0, fk, ff).setOrigin(0, 0).setScale(2).setInteractive({ useHandCursor: true });
    layer.add([glow, card]);
    layer.add(txt(s, x + CW / 2, y0 + 22, spec.cardLabel ?? '', { size: FS.sm, color: TONE_HEX[tone], origin: [0.5, 0.5], bold: true }));
    if (o.icon) layer.add(addImg(s, x + CW / 2, y0 + 96, o.icon).setScale(3));
    else if (o.glyph) layer.add(txt(s, x + CW / 2, y0 + 96, o.glyph, { size: FS.hero, bold: true, color: TONE_HEX[tone], origin: [0.5, 0.5] }));
    const key = optionKey(o, i);
    layer.add(txt(s, x + CW / 2, y0 + 176, `${key ? `${key}. ` : ''}${o.label}`, { size: FS.md, bold: true, color: HEX.ink, origin: [0.5, 0.5] }));
    if (o.hint) layer.add(txt(s, x + CW / 2, y0 + CH + 8, o.hint, { size: FS.sm, color: '#4A4766', origin: [0.5, 0], wrap: CW, align: 'center' }));
    card.on('pointerover', () => hover(o.id));
    card.on('pointerdown', () => pick(o.id));
    return { id: o.id, glow };
  });
  layer.add(keyHelp(s, spec, Math.round(px + pw / 2), py + ph - 16));
  return {
    layer,
    highlight: (id) => cards.forEach((c) => c.glow.setAlpha(c.id === id ? 0.7 : 0).setStrokeStyle(c.id === id ? 2 : 0, COLORS.outline)),
  };
};
