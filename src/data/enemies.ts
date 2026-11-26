/**
 * 敌人配置表。AI（怎么走位）与攻击形态（怎么打）彻底分开：
 *   - ai 只负责位移策略，5 种就够覆盖绝大多数手感；
 *   - attack 描述前摇、伤害、弹数、爆炸、激光、召唤，由 Enemy 的状态机统一执行。
 *
 * 新增敌人的成本因此变成「加一条数据」，而不是在 Enemy.update 里再塞一个分支。
 * 攻击前摇一律显式声明 —— 没有前摇的远程攻击等于无法躲避，是设计事故。
 */
import type { RNG } from '../core/RNG';

/** 位移策略 */
export type EnemyAI =
  /** 直线贴脸 */
  | 'chaser'
  /** 蓄力后直线冲撞 */
  | 'charger'
  /** 保持中距离并侧移 */
  | 'shooter'
  /** 绕圈，始终切向移动 */
  | 'orbiter'
  /** 原地不动（炮台 / 召唤柱） */
  | 'sentinel';

/** 攻击形态 */
export type EnemyAttackKind = 'melee' | 'shot' | 'spread' | 'grenade' | 'laser' | 'summon';

export interface EnemyAttack {
  kind: EnemyAttackKind;
  /** 起手前摇（秒）。激光会在这段时间画出预警线。 */
  windup: number;
  damage: number;
  /** 一次攻击的弹数 / 召唤数 */
  count?: number;
  /** 扇形总角度（度） */
  spread?: number;
  speed?: number;
  color?: string;
  /** 榴弹爆炸半径 */
  blast?: number;
  /** 激光长度 / 半宽 / 持续（秒） */
  length?: number;
  width?: number;
  duration?: number;
  /** 召唤的敌人 id */
  summonId?: string;
  /** 起手距离 */
  range: number;
  /** 后摇（秒），默认 0.3 */
  recover?: number;
}

export interface EnemyData {
  id: string;
  name: string;
  ai: EnemyAI;
  hp: number;
  speed: number;
  radius: number;
  color: string;
  score: number;
  /** 两次攻击之间的间隔（秒） */
  cooldown: number;
  /** 轮换使用。BOSS 用多套攻击制造节奏，普通怪一般只有一条。 */
  attacks: EnemyAttack[];
  /** 接触伤害（贴身就掉血），和主动攻击独立 */
  touchDamage?: number;
  /** 死亡分裂 */
  splitInto?: string;
  splitCount?: number;
  /** 精灵放大倍数 */
  scale?: number;
}

export const ENEMIES: Record<string, EnemyData> = {
  // ---------------------------------------------------------------- 普通
  goblin: {
    id: 'goblin', name: '哥布林', ai: 'chaser',
    hp: 8, speed: 52, radius: 6, color: '#8fc26a', score: 1, cooldown: 1.1,
    attacks: [{ kind: 'melee', windup: 0.18, damage: 1, range: 16, recover: 0.25 }],
  },
  bat: {
    id: 'bat', name: '洞穴蝙蝠', ai: 'chaser',
    hp: 5, speed: 88, radius: 5, color: '#a98bd8', score: 1, cooldown: 0.9,
    attacks: [{ kind: 'melee', windup: 0.1, damage: 1, range: 14, recover: 0.2 }],
  },
  boar: {
    id: 'boar', name: '野猪', ai: 'charger',
    hp: 14, speed: 46, radius: 8, color: '#d2905f', score: 2, cooldown: 2.2,
    attacks: [{ kind: 'melee', windup: 0.45, damage: 2, range: 22, recover: 0.8 }],
  },
  shaman: {
    id: 'shaman', name: '哥布林祭祀', ai: 'shooter',
    hp: 10, speed: 38, radius: 6, color: '#b58ce0', score: 2, cooldown: 1.35,
    attacks: [{
      kind: 'shot', windup: 0.42, damage: 1, speed: 170, color: '#ff8a8a',
      range: 160, recover: 0.2,
    }],
  },
  bomber: {
    id: 'bomber', name: '投弹哥布林', ai: 'shooter',
    hp: 9, speed: 34, radius: 6, color: '#d8b06a', score: 2, cooldown: 2.0,
    attacks: [{
      kind: 'grenade', windup: 0.5, damage: 2, speed: 132, blast: 30,
      color: '#ffb46a', range: 168, recover: 0.3,
    }],
  },
  slime: {
    id: 'slime', name: '分裂史莱姆', ai: 'chaser',
    hp: 12, speed: 40, radius: 8, color: '#7ad0a8', score: 2, cooldown: 1.2,
    attacks: [{ kind: 'melee', windup: 0.2, damage: 1, range: 18, recover: 0.3 }],
    splitInto: 'slimelet', splitCount: 2,
  },
  slimelet: {
    id: 'slimelet', name: '小史莱姆', ai: 'chaser',
    hp: 4, speed: 60, radius: 5, color: '#9fe0c0', score: 1, cooldown: 1.0,
    attacks: [{ kind: 'melee', windup: 0.15, damage: 1, range: 14, recover: 0.2 }],
  },
  eye: {
    id: 'eye', name: '邪眼', ai: 'orbiter',
    hp: 12, speed: 46, radius: 7, color: '#8fe3ff', score: 3, cooldown: 1.8,
    attacks: [{
      kind: 'spread', windup: 0.45, damage: 1, count: 3, spread: 30,
      speed: 150, color: '#8fe3ff', range: 185, recover: 0.3,
    }],
  },
  sniper: {
    id: 'sniper', name: '哥布林弩手', ai: 'shooter',
    hp: 9, speed: 30, radius: 6, color: '#c9a06a', score: 3, cooldown: 2.4,
    attacks: [{
      kind: 'shot', windup: 0.7, damage: 3, speed: 330, color: '#ffd0a0',
      range: 260, recover: 0.4,
    }],
  },
  sentinel: {
    id: 'sentinel', name: '石像鬼', ai: 'sentinel',
    hp: 26, speed: 0, radius: 9, color: '#8a8fa8', score: 4, cooldown: 2.8,
    touchDamage: 1,
    attacks: [{
      kind: 'laser', windup: 0.75, damage: 2, length: 240, width: 5,
      duration: 0.3, color: '#ff7b7b', range: 240, recover: 0.5,
    }],
  },
  necromancer: {
    id: 'necromancer', name: '亡灵召唤者', ai: 'shooter',
    hp: 16, speed: 30, radius: 7, color: '#9a7ac8', score: 5, cooldown: 3.2,
    attacks: [
      {
        kind: 'summon', windup: 0.7, damage: 0, count: 2, summonId: 'bat',
        color: '#c9a0ff', range: 250, recover: 0.5,
      },
      {
        kind: 'shot', windup: 0.45, damage: 1, speed: 150, color: '#c9a0ff',
        range: 210, recover: 0.3,
      },
    ],
  },

  // ---------------------------------------------------------------- BOSS
  boss: {
    id: 'boss', name: '关卡守卫', ai: 'shooter',
    hp: 90, speed: 34, radius: 13, color: '#e36a6a', score: 10, cooldown: 1.2, scale: 2,
    attacks: [
      {
        kind: 'spread', windup: 0.35, damage: 2, count: 5, spread: 36,
        speed: 190, color: '#ff9d5c', range: 240, recover: 0.3,
      },
      {
        kind: 'spread', windup: 0.5, damage: 2, count: 7, spread: 52,
        speed: 170, color: '#ff9d5c', range: 220, recover: 0.35,
      },
      {
        kind: 'grenade', windup: 0.55, damage: 2, speed: 150, blast: 36,
        color: '#ffb46a', range: 220, recover: 0.4,
      },
    ],
  },
  boss_laser: {
    id: 'boss_laser', name: '熔岩巨像', ai: 'shooter',
    hp: 120, speed: 26, radius: 14, color: '#ff7b4a', score: 14, cooldown: 2.2, scale: 2,
    attacks: [
      {
        kind: 'laser', windup: 0.85, damage: 3, length: 300, width: 6,
        duration: 0.35, color: '#ff7b4a', range: 280, recover: 0.6,
      },
      {
        kind: 'spread', windup: 0.5, damage: 2, count: 9, spread: 60,
        speed: 170, color: '#ffb46a', range: 240, recover: 0.4,
      },
    ],
  },
  boss_summon: {
    id: 'boss_summon', name: '死灵君王', ai: 'shooter',
    hp: 110, speed: 30, radius: 13, color: '#9a7ac8', score: 14, cooldown: 2.4, scale: 2,
    attacks: [
      {
        kind: 'summon', windup: 0.8, damage: 0, count: 3, summonId: 'bat',
        color: '#c9a0ff', range: 260, recover: 0.6,
      },
      {
        kind: 'spread', windup: 0.4, damage: 2, count: 3, spread: 24,
        speed: 200, color: '#c9a0ff', range: 220, recover: 0.3,
      },
      {
        kind: 'shot', windup: 0.5, damage: 3, speed: 300, color: '#e0c0ff',
        range: 260, recover: 0.4,
      },
    ],
  },
};

export const ENEMY_IDS = Object.keys(ENEMIES);

/** 普通房刷怪表：minLevel 控制出现层数，weight 是基础权重。 */
export interface SpawnEntry {
  id: string;
  minLevel: number;
  weight: number;
}

export const SPAWN_TABLE: readonly SpawnEntry[] = [
  { id: 'goblin', minLevel: 1, weight: 10 },
  { id: 'bat', minLevel: 1, weight: 8 },
  { id: 'boar', minLevel: 2, weight: 7 },
  { id: 'shaman', minLevel: 2, weight: 7 },
  { id: 'bomber', minLevel: 3, weight: 6 },
  { id: 'slime', minLevel: 3, weight: 6 },
  { id: 'eye', minLevel: 4, weight: 5 },
  { id: 'sniper', minLevel: 4, weight: 4 },
  { id: 'sentinel', minLevel: 5, weight: 4 },
  { id: 'necromancer', minLevel: 6, weight: 3 },
];

/** 按层数加权抽一只普通怪。低层不会出现炮台/召唤者，避免开局劝退。 */
export function rollEnemy(rng: RNG, level: number): string {
  const pool = SPAWN_TABLE.filter((e) => level >= e.minLevel);
  const total = pool.reduce((a, e) => a + e.weight, 0);
  let t = rng.next() * total;
  for (const e of pool) {
    t -= e.weight;
    if (t <= 0) return e.id;
  }
  return pool[pool.length - 1]?.id ?? 'goblin';
}

/** BOSS 每两层换一个，三套攻击模式轮着来，避免深层永远同一个木桩。 */
export function bossForLevel(level: number): string {
  const ids = ['boss', 'boss_laser', 'boss_summon'];
  const i = Math.floor((Math.max(1, level) - 1) / 2) % ids.length;
  return ids[i];
}

export const getEnemy = (id: string): EnemyData => ENEMIES[id] ?? ENEMIES.goblin;
