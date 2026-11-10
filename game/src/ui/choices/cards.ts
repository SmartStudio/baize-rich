// 古修洞府 (two 机缘, keep one) and 白泽现世 (the remaining gifts): the cards laid side by side.
import type { ManifestGift } from '../../core/choices';
import type { EventEffect } from '../../core/types';
import type { ModalOption, Presenter } from './spec';

type Art = Pick<ModalOption, 'icon' | 'glyph'>;

function fortuneArt(e: EventEffect): Art {
  if (e.rift) return { icon: 'ic_baize' };
  if (e.cult) return { icon: e.cult > 0 ? 'ic_cult' : 'ic_demon' };
  if (e.pills) return { icon: 'ic_pill' };
  if (e.stones) return e.stones > 0 ? { icon: 'ic_stone' } : { glyph: '兽' };
  if (e.herbs) return { glyph: '草' };
  if (e.draw) return { glyph: '符' };
  if (e.guidance) return { glyph: '师' };
  return { glyph: '光' };
}

export const fortunePick: Presenter<'fortunePick'> = (c, { game }) => ({
  title: c.title,
  desc: c.desc,
  options: c.options.map((o): ModalOption => {
    const ev = game.eventById.get(o.value)!;
    return { id: o.id, label: ev.name, hint: ev.desc, tone: ev.good ? 'good' : 'bad', ...fortuneArt(ev.effect) };
  }),
  defaultId: c.defaultId,
  layout: 'cards',
  cardFrame: 'card_divine',
  cardLabel: '机缘',
});

const GIFT_ART: Record<ManifestGift, Art> = {
  chart: { icon: 'ic_cult' },
  stones: { icon: 'ic_stone' },
  pills: { icon: 'ic_pill' },
  guide: { icon: 'ic_baize' },
};

export const manifestPick: Presenter<'manifestPick'> = (c) => ({
  title: c.title,
  desc: `「秘境过半。走得慢的，先来挑。」 还剩 ${c.options.length} 份`,
  options: c.options.map((o): ModalOption => ({ id: o.id, label: o.label, hint: o.hint, tone: 'gold', ...GIFT_ART[o.value] })),
  defaultId: c.defaultId,
  layout: 'cards',
  cardFrame: 'card_heaven',
  cardLabel: '白泽',
});
