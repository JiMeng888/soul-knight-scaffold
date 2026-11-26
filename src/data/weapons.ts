/**
 * 武器配置表 —— 加一把枪 = 加一条数据，不写一行逻辑代码。
 *
 * 品质（rarity）只影响「名字颜色 + 掉落概率」，不直接改数值：
 * 数值仍逐把调，避免出现「史诗一定比精良强」的线性表，那样品质就退化成了等级。
 * 机制字段（burst / bounce / explode / homing / lifesteal / arc）由 WeaponSystem
 * 与 Projectile 通用实现，新武器可以自由组合。
 */
import type { RNG } from '../core/RNG';
import { rarityOf, rollRarity, type Rarity } from './rarity';

export type WeaponKind = 'ranged' | 'melee';

export interface WeaponData {
  id: string;
  name: string;
  kind: WeaponKind;
  /** 品质：决定名字颜色与掉落权重 */
  rarity: Rarity;
  damage: number;
  /** 每秒发射次数（连发武器是「每轮」的间隔） */
  fireRate: number;
  pellets: number;
  /** 散布角度（度） */
  spread: number;
  /** 每发消耗能量。0 = 不耗能，是弹尽粮绝时的退路 */
  energy: number;
  speed: number;
  pierce: number;
  color: string;
  radius: number;
  /** 近战扇区半径；远程为 0 */
  range: number;
  knockback: number;
  desc: string;

  // —— 可选机制 ——
  /** 一次扳机的连发数（含首发）。能量按 energy × burst 一次性扣除。 */
  burst?: number;
  /** 连发间隔（秒） */
  burstGap?: number;
  /** 弹墙次数 */
  bounce?: number;
  /** 命中爆炸半径；远程专用 */
  explode?: number;
  /** 爆炸伤害（与直击伤害独立，直击不再结算） */
  explodeDamage?: number;
  /** 追踪转向速率（弧度/秒） */
  homing?: number;
  /** 近战每次命中回复的生命 */
  lifesteal?: number;
  /** 近战扇形半角（弧度），默认 0.95 */
  arc?: number;
  /** 覆盖子弹存活时间（秒），喷火类用它做短射程 */
  bulletLife?: number;
}

export const WEAPONS: Record<string, WeaponData> = {
  // ---------------------------------------------------------------- 普通
  pistol: {
    id: 'pistol', name: '破旧的手枪', kind: 'ranged', rarity: 'common',
    damage: 3, fireRate: 4.0, pellets: 1, spread: 3, energy: 1,
    speed: 260, pierce: 0, color: '#ffe08a', radius: 2.5, range: 0, knockback: 18,
    desc: '省能量，起始武器',
  },
  rusty_blade: {
    id: 'rusty_blade', name: '锈铁短剑', kind: 'melee', rarity: 'common',
    damage: 4, fireRate: 2.6, pellets: 1, spread: 0, energy: 0,
    speed: 0, pierce: 99, color: '#c9b08a', radius: 4, range: 34, knockback: 42,
    desc: '完全不耗能，扇形较窄',
  },
  hunting_bow: {
    id: 'hunting_bow', name: '猎弓', kind: 'ranged', rarity: 'common',
    damage: 9, fireRate: 1.1, pellets: 1, spread: 1, energy: 4,
    speed: 420, pierce: 2, color: '#d8e3b0', radius: 2.5, range: 0, knockback: 30,
    desc: '慢而准，可穿透 2 个目标',
  },

  // ---------------------------------------------------------------- 精良
  shotgun: {
    id: 'shotgun', name: '霰弹枪', kind: 'ranged', rarity: 'fine',
    damage: 2, fireRate: 1.3, pellets: 5, spread: 34, energy: 8,
    speed: 235, pierce: 0, color: '#ffb27a', radius: 2.5, range: 0, knockback: 46,
    desc: '近距离高僵直，一轮 8 点能量',
  },
  smg: {
    id: 'smg', name: '冲锋枪', kind: 'ranged', rarity: 'fine',
    damage: 1.4, fireRate: 11, pellets: 1, spread: 11, energy: 1.3,
    speed: 320, pierce: 0, color: '#9ee8ff', radius: 2, range: 0, knockback: 8,
    desc: '弹幕压制，能量掉得飞快',
  },
  sword: {
    id: 'sword', name: '光剑·蓝', kind: 'melee', rarity: 'fine',
    damage: 5, fireRate: 2.2, pellets: 1, spread: 0, energy: 0,
    speed: 0, pierce: 99, color: '#7ad7ff', radius: 4, range: 40, knockback: 60,
    desc: '无消耗，顺手劈掉敌方子弹',
  },
  burst_pistol: {
    id: 'burst_pistol', name: '三连发手枪', kind: 'ranged', rarity: 'fine',
    damage: 3, fireRate: 1.9, pellets: 1, spread: 4, energy: 1.6,
    speed: 310, pierce: 1, color: '#ffe9b0', radius: 2.2, range: 0, knockback: 10,
    burst: 3, burstGap: 0.055,
    desc: '三连点射，子弹可穿透 1 个目标',
  },
  kunai: {
    id: 'kunai', name: '苦无', kind: 'ranged', rarity: 'fine',
    damage: 3, fireRate: 3.2, pellets: 1, spread: 7, energy: 1.2,
    speed: 430, pierce: 1, color: '#d8d8f0', radius: 2, range: 0, knockback: 6,
    desc: '高速薄片，穿透 1 个目标',
  },
  crossbow: {
    id: 'crossbow', name: '十字弩', kind: 'ranged', rarity: 'fine',
    damage: 9, fireRate: 0.9, pellets: 1, spread: 1, energy: 7,
    speed: 470, pierce: 2, color: '#e8c88a', radius: 3, range: 0, knockback: 55,
    desc: '重弩，一箭穿 2 个',
  },

  // ---------------------------------------------------------------- 稀有
  railgun: {
    id: 'railgun', name: '轨道炮', kind: 'ranged', rarity: 'rare',
    damage: 9, fireRate: 1.2, pellets: 1, spread: 0, energy: 10,
    speed: 520, pierce: 5, color: '#c9a0ff', radius: 3, range: 0, knockback: 70,
    desc: '直线穿透 5 个目标',
  },
  grenade_launcher: {
    id: 'grenade_launcher', name: '榴弹发射器', kind: 'ranged', rarity: 'rare',
    damage: 0, fireRate: 1.3, pellets: 1, spread: 2, energy: 8,
    speed: 200, pierce: 0, color: '#b8d06a', radius: 4, range: 0, knockback: 0,
    explode: 40, explodeDamage: 9,
    desc: '抛射榴弹，落点 40 半径范围伤害',
  },
  ricochet_bow: {
    id: 'ricochet_bow', name: '弹射短弓', kind: 'ranged', rarity: 'rare',
    damage: 5, fireRate: 2.2, pellets: 1, spread: 3, energy: 4,
    speed: 310, pierce: 1, color: '#9ef0c0', radius: 2.5, range: 0, knockback: 12,
    bounce: 3,
    desc: '撞墙反弹 3 次并穿透，狭小房间里的清场利器',
  },
  flamethrower: {
    id: 'flamethrower', name: '火焰喷射器', kind: 'ranged', rarity: 'rare',
    damage: 0.8, fireRate: 16, pellets: 2, spread: 18, energy: 1.2,
    speed: 150, pierce: 0, color: '#ff9a4a', radius: 3, range: 0, knockback: 4,
    bulletLife: 0.34,
    desc: '极短射程，贴脸才烧得到',
  },
  katana: {
    id: 'katana', name: '武士刀', kind: 'melee', rarity: 'rare',
    damage: 7, fireRate: 1.8, pellets: 1, spread: 0, energy: 0,
    speed: 0, pierce: 99, color: '#ffb0b0', radius: 5, range: 46, knockback: 55,
    arc: 1.25, lifesteal: 0.3,
    desc: '宽扇形，每次命中回 0.3 血',
  },
  homing_dart: {
    id: 'homing_dart', name: '追踪飞镖', kind: 'ranged', rarity: 'rare',
    damage: 3, fireRate: 2.6, pellets: 1, spread: 6, energy: 3,
    speed: 230, pierce: 0, color: '#8fe3ff', radius: 2.4, range: 0, knockback: 8,
    homing: 5,
    desc: '自动转向最近的敌人',
  },

  // ---------------------------------------------------------------- 史诗
  plasma_rifle: {
    id: 'plasma_rifle', name: '等离子步枪', kind: 'ranged', rarity: 'epic',
    damage: 5.5, fireRate: 3.6, pellets: 1, spread: 2, energy: 4.5,
    speed: 470, pierce: 2, color: '#7ef0ff', radius: 3, range: 0, knockback: 22,
    desc: '高射速穿透弹，能量消耗大',
  },
  rocket_launcher: {
    id: 'rocket_launcher', name: '火箭筒', kind: 'ranged', rarity: 'epic',
    damage: 0, fireRate: 1.0, pellets: 1, spread: 1, energy: 12,
    speed: 230, pierce: 0, color: '#ff8a5c', radius: 4.5, range: 0, knockback: 0,
    explode: 50, explodeDamage: 12, homing: 1.5,
    desc: '轻微追踪的大范围爆炸，小心贴脸',
  },
  minigun: {
    id: 'minigun', name: '加特林', kind: 'ranged', rarity: 'epic',
    damage: 1.3, fireRate: 17, pellets: 1, spread: 12, energy: 1.1,
    speed: 340, pierce: 0, color: '#ffe08a', radius: 2, range: 0, knockback: 5,
    desc: '射速极高，蓝条撑不过 8 秒',
  },
  storm_bow: {
    id: 'storm_bow', name: '风暴之弓', kind: 'ranged', rarity: 'epic',
    damage: 4.5, fireRate: 1.7, pellets: 1, spread: 2, energy: 6,
    speed: 430, pierce: 2, color: '#a8e8ff', radius: 3, range: 0, knockback: 30,
    bounce: 1,
    desc: '穿透 2 个，还能弹墙 1 次',
  },
  void_blade: {
    id: 'void_blade', name: '虚空之刃', kind: 'melee', rarity: 'epic',
    damage: 10, fireRate: 1.5, pellets: 1, spread: 0, energy: 0,
    speed: 0, pierce: 99, color: '#c9a0ff', radius: 6, range: 50, knockback: 80,
    arc: 1.35, lifesteal: 0.5,
    desc: '大剑，命中回 0.5 血',
  },

  // ---------------------------------------------------------------- 传说
  singularity: {
    id: 'singularity', name: '奇点炮', kind: 'ranged', rarity: 'legendary',
    damage: 6, fireRate: 0.85, pellets: 1, spread: 0, energy: 14,
    speed: 160, pierce: 2, color: '#d8a0ff', radius: 4.5, range: 0, knockback: 40,
    explode: 52, explodeDamage: 12, homing: 1.8,
    desc: '缓慢追踪，命中炸开 52 半径',
  },
  excalibur: {
    id: 'excalibur', name: '圣剑', kind: 'melee', rarity: 'legendary',
    damage: 13, fireRate: 1.4, pellets: 1, spread: 0, energy: 0,
    speed: 0, pierce: 99, color: '#ffe9a0', radius: 7, range: 58, knockback: 110,
    arc: 1.6, lifesteal: 0.8,
    desc: '近乎半圆的大挥砍，命中回 0.8 血',
  },
  dragon_breath: {
    id: 'dragon_breath', name: '龙息', kind: 'ranged', rarity: 'legendary',
    damage: 1.5, fireRate: 20, pellets: 2, spread: 24, energy: 1.5,
    speed: 180, pierce: 0, color: '#ffd06a', radius: 3.2, range: 0, knockback: 6,
    bulletLife: 0.42,
    desc: '喷吐火舌，射程短但瞬间伤害极高',
  },
  storm_rail: {
    id: 'storm_rail', name: '磁暴狙击炮', kind: 'ranged', rarity: 'legendary',
    damage: 15, fireRate: 0.8, pellets: 1, spread: 0, energy: 18,
    speed: 700, pierce: 8, color: '#a0f0ff', radius: 3.5, range: 0, knockback: 90,
    desc: '一枪穿 8 个，蓄力慢但足以清场',
  },
};

/** 可掉落武器池：目前没有敌人专属武器，保留过滤位给以后加。 */
export const LOOT_WEAPONS: readonly string[] = Object.values(WEAPONS)
  .filter((w) => !w.id.startsWith('enemy_'))
  .map((w) => w.id);

export const getWeapon = (id: string): WeaponData => WEAPONS[id] ?? WEAPONS.pistol;

/** 某品质下的可掉落武器 id。空数组是合法状态，调用方必须降级。 */
export function weaponsOfRarity(rarity: Rarity): string[] {
  return LOOT_WEAPONS.filter((id) => WEAPONS[id].rarity === rarity);
}

/**
 * 按层数 + 品质门槛抽一把武器。
 *
 * 为什么必须带降级：某档品质可能暂时没有武器（比如以后把传说全删了），
 * 若直接 `rng.pick([])` 会静默返回 undefined，一路传到 addWeapon 才炸。
 * 这里从抽到的品质往下降，直到找到非空池；全空则退回起始手枪。
 */
export function rollWeapon(rng: RNG, level: number, minRarity: Rarity = 'common'): string {
  const rarity = rollRarity(rng, level, minRarity);
  const order = ['legendary', 'epic', 'rare', 'fine', 'common'] as const;
  let start = order.indexOf(rarity as typeof order[number]);
  if (start < 0) start = order.length - 1;
  for (let i = start; i < order.length; i++) {
    const pool = weaponsOfRarity(order[i]);
    if (pool.length) return rng.pick(pool);
  }
  return 'pistol';
}

/** 品质标签，UI 统一从这儿取，不要在页面里硬编码「传说」。 */
export const rarityLabel = (id: string): string => rarityOf(id).name;
