/**
 * 商店配置表 —— 纯数据。
 *
 * 商品只描述「效果 kind」，具体怎么作用到 RunState 由编排层 Game 统一处理，
 * 避免把 GameCtx 依赖塞进 data 层。价格随层数小幅上涨，防止后期金币溢出后无脑买。
 */
import type { RNG } from '../core/RNG';

export type ShopEffectKind =
  | 'heal' | 'fullHeal' | 'fullArmor' | 'fullEnergy'
  | 'maxHp' | 'maxArmor' | 'weapon' | 'talent';

export interface ShopEffect {
  kind: ShopEffectKind;
  value?: number;
}

export interface ShopItemData {
  id: string;
  name: string;
  desc: string;
  price: number;
  tag: string;
  color: string;
  effect: ShopEffect;
}

/** 一层商店里的一个货位。sold 存在 Room 上，跟随房间生命周期。 */
export interface ShopSlot {
  itemId: string;
  sold: boolean;
}

export const SHOP_ITEMS: Record<string, ShopItemData> = {
  potion_s: {
    id: 'potion_s', name: '小血瓶', desc: '回复 2 点生命', price: 10, tag: '回复', color: '#e05a5a',
    effect: { kind: 'heal', value: 2 },
  },
  potion_l: {
    id: 'potion_l', name: '大血瓶', desc: '生命回满', price: 24, tag: '回复', color: '#ff8a8a',
    effect: { kind: 'fullHeal' },
  },
  shield_fix: {
    id: 'shield_fix', name: '护盾充能', desc: '护盾回满', price: 14, tag: '回复', color: '#6fa8dc',
    effect: { kind: 'fullArmor' },
  },
  battery: {
    id: 'battery', name: '能量电池', desc: '能量回满', price: 12, tag: '回复', color: '#5ec8c8',
    effect: { kind: 'fullEnergy' },
  },
  hp_up: {
    id: 'hp_up', name: '生命强化', desc: '生命上限 +1', price: 36, tag: '强化', color: '#e05a5a',
    effect: { kind: 'maxHp', value: 1 },
  },
  armor_up: {
    id: 'armor_up', name: '护盾强化', desc: '护盾上限 +1', price: 34, tag: '强化', color: '#6fa8dc',
    effect: { kind: 'maxArmor', value: 1 },
  },
  random_gun: {
    id: 'random_gun', name: '神秘武器', desc: '获得一把随机武器', price: 30, tag: '装备', color: '#c9a45b',
    effect: { kind: 'weapon' },
  },
  talent_scroll: {
    id: 'talent_scroll', name: '天赋卷轴', desc: '随机获得一个天赋', price: 48, tag: '稀有', color: '#c9a0ff',
    effect: { kind: 'talent' },
  },
};

export const SHOP_ITEM_IDS: readonly string[] = Object.keys(SHOP_ITEMS);

export const getShopItem = (id: string): ShopItemData => SHOP_ITEMS[id] ?? SHOP_ITEMS.potion_s;

/**
 * 价格随层数增长。原实现「每两层 +2 金」是固定小额，30 局试玩显示金币一局
 * 结余 7807、商店只花 4.6 次 —— 后期金币收入远超定价涨幅，商品等于白送。
 * P1 改成随层复合增长：L1 原价，之后每层 ×6%，L30 约 5.4 倍，
 * 让「钱要花在刀刃上」重新成立，同时前期仍买得起（不劝退）。
 * 价格是确定值、不依赖随机流；原价，不含折扣。
 */
export const priceOf = (item: ShopItemData, level: number): number =>
  Math.round(item.price * Math.pow(1.06, Math.max(0, level - 1)));

/**
 * 最终成交价 = 原价 × 商店折扣倍率（砍价高手 / 贵宾卡天赋）。
 * 面板显示与实际扣款必须共用这一个函数，否则会出现「显示 30 金、扣 22 金」的静默错位。
 */
export const shopPrice = (item: ShopItemData, level: number, discountMul = 1): number =>
  Math.max(1, Math.round(priceOf(item, level) * discountMul));

/** 库存用注入的 RNG 派生，同 (seed, level, roomId) 永远得到同一批货。 */
export function rollShopStock(rng: RNG, count: number): ShopSlot[] {
  return rng.shuffle([...SHOP_ITEM_IDS]).slice(0, count).map((itemId) => ({ itemId, sold: false }));
}
