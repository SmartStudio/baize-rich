// 炼丹 (丹房 / 随身药炉) and 坊市: tiles that show what goes in and what comes out before the pick.
import type { ModalOption, Presenter } from './spec';

/** One tap brews the most; − / + take fewer, Esc brews none. */
export const brew: Presenter<'brew'> = (c, { game }) => {
  const per = game.data.config.alchemy.herbsPerPill;
  const p = game.state.players[c.player];
  const byCount = [...c.options].sort((a, b) => a.value - b.value);
  const most = byCount.at(-1)!.value;
  return {
    title: c.title,
    headline: `${per} 灵草 → 1 颗丹药`,
    desc: c.desc,
    facts: [{ label: '灵草', value: String(p.herbs) }, { label: '丹药', value: String(p.pills) }],
    options: byCount.map((o): ModalOption => ({
      id: o.id,
      key: o.value <= 9 ? String(o.value) : '',
      label: o.value === 0 ? '不炼' : o.value === most ? `炼满 ${o.value} 炉` : `炼 ${o.value} 炉`,
      big: o.value === 0 ? '—' : `+${o.value} 丹药`,
      tone: o.value === 0 ? 'dim' : 'good',
      hint: `灵草 ${p.herbs} → ${p.herbs - o.value * per}`,
    })),
    defaultId: c.defaultId,
    cancelId: c.cancelId,
    layout: 'stepper',
  };
};

const GOODS = {
  pill: { name: '丹药', icon: { icon: 'ic_pill' } },
  card: { name: '符箓', icon: { glyph: '符' } },
} as const;

/** Every lot the market sells, the ones you cannot take greyed out with the reason. */
export const market: Presenter<'market'> = (c, { game }) => {
  const m = game.data.config.market;
  const p = game.state.players[c.player];
  const lots = [
    ...Array.from({ length: m.pillMax }, (_, i) => ({ item: 'pill' as const, n: i + 1, price: (i + 1) * m.pillPrice })),
    ...Array.from({ length: m.cardMax }, (_, i) => ({ item: 'card' as const, n: i + 1, price: (i + 1) * m.cardPrice })),
  ];
  let key = 0;
  const tiles = lots.map((lot): ModalOption => {
    const offer = c.options.find((o) => o.value.item !== 'none' && o.value.item === lot.item && o.value.n === lot.n);
    const base = { label: `${GOODS[lot.item].name} ×${lot.n}`, ...GOODS[lot.item].icon, count: lot.n };
    if (!offer) {
      return { ...base, id: `x:${lot.item}${lot.n}`, disabled: true, big: `${lot.price}`, tone: 'dim', hint: lot.price > p.stones ? '灵石不足' : '符箓已满' };
    }
    return { ...base, id: offer.id, key: String(++key), big: `−${lot.price}`, tone: 'gold', hint: `余 ${p.stones - lot.price} 灵石` };
  });
  const none = c.options.find((o) => o.value.item === 'none')!;
  return {
    title: c.title,
    headline: `丹药 ${m.pillPrice} · 符箓 ${m.cardPrice}`,
    facts: [
      { label: '灵石', value: String(p.stones), tone: 'gold' },
      { label: '丹药', value: String(p.pills) },
      { label: '符箓', value: `${p.hand.length}/${game.data.config.handLimit}` },
    ],
    options: [...tiles, { id: none.id, key: '0', label: none.label, big: '—', tone: 'dim', hint: '离开坊市' }],
    defaultId: c.defaultId,
    cancelId: c.cancelId,
    layout: 'tiles',
  };
};
