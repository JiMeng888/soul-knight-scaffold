/**
 * 武器品质。这里只放「品质是什么 / 怎么配色 / 怎么随层数加权」，
 * 具体哪把武器属于哪档由 weapons.ts 声明，掉落在 weapons.rollWeapon 里做。
 *
 * 设计要点：
 *  1. 颜色是品质的唯一视觉语言，名字颜色 = rarity.color，不允许各系统自己写色值。
 *  2. 高稀有度有 minLevel 门槛：1 层不该开出传说，否则开局就把成长曲线打穿。
 *  3. 权重随层数变化（普通衰减、稀有上升），但永远保留非零权重，
 *     避免「某一层所有武器都被过滤光」导致抽取返回 undefined 的静默崩溃。
 */
import type { RNG } from '../core/RNG';

export type Rarity = 'common' | 'fine' | 'rare' | 'epic' | 'legendary';

export interface RarityData {
  id: Rarity;
  name: string;
  color: string;
  /** 基础权重，最终权重由 rarityWeight() 按层数修正 */
  weight: number;
  /** 从第几层开始可能掉落 */
  minLevel: number;
  /** 价值系数，用于商店定价与 UI 排序 */
  power: number;
}

export const RARITIES: Record<Rarity, RarityData> = {
  common: { id: 'common', name: '普通', color: '#c8cdd8', weight: 46, minLevel: 1, power: 1 },
  fine: { id: 'fine', name: '精良', color: '#7fd48a', weight: 30, minLevel: 1, power: 1.25 },
  rare: { id: 'rare', name: '稀有', color: '#6fb8ff', weight: 15, minLevel: 2, power: 1.6 },
  epic: { id: 'epic', name: '史诗', color: '#c9a0ff', weight: 7, minLevel: 4, power: 2.1 },
  legendary: { id: 'legendary', name: '传说', color: '#ffb347', weight: 2, minLevel: 6, power: 2.8 },
};

/** 从低到高。数组顺序即比较顺序，抽卡过滤也依赖它。 */
export const RARITY_ORDER: readonly Rarity[] = ['common', 'fine', 'rare', 'epic', 'legendary'];

export const rarityOf = (id: string): RarityData =>
  RARITIES[id as Rarity] ?? RARITIES.common;

export const rarityColor = (id: string): string => rarityOf(id).color;

export const rarityIndex = (id: string): number => {
  const i = RARITY_ORDER.indexOf(id as Rarity);
  return i < 0 ? 0 : i;
};

/** 层数修正后的权重。minLevel 未到直接 0，其余保证 > 0。 */
export function rarityWeight(r: RarityData, level: number): number {
  if (level < r.minLevel) return 0;
  const lv = Math.max(0, level - 1);
  switch (r.id) {
    case 'common': return Math.max(6, r.weight - lv * 2.2);
    case 'fine': return r.weight + lv * 0.6;
    case 'rare': return r.weight + lv * 1.4;
    case 'epic': return r.weight + lv * 1.1;
    case 'legendary': return r.weight + lv * 0.5;
  }
}

/**
 * 抽一个品质。minRarity 用于「BOSS 必掉蓝装以上」「宝箱保底」这类需求。
 * 若 minRarity 当前层还没解锁（比如 2 层要求传说），退化为当前层可得的最高档。
 */
export function rollRarity(rng: RNG, level: number, minRarity: Rarity = 'common'): Rarity {
  const floor = rarityIndex(minRarity);
  const pool = RARITY_ORDER.slice(floor).map((id) => RARITIES[id])
    .filter((r) => rarityWeight(r, level) > 0);
  // 门槛高于本层解锁上限时往下退，绝不允许空池。
  const usable = pool.length ? pool : RARITY_ORDER.map((id) => RARITIES[id])
    .filter((r) => rarityWeight(r, level) > 0);
  const weights = usable.map((r) => rarityWeight(r, level));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = rng.next() * total;
  for (let i = 0; i < usable.length; i++) {
    t -= weights[i];
    if (t <= 0) return usable[i].id;
  }
  return usable[usable.length - 1].id;
}
