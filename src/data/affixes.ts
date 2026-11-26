/**
 * 精英词条 —— 让「层数」通过机制（而非单纯加血加伤）放大威胁。
 *
 * 设计动机：自动试玩 30 局发现难度曲线倒挂（L5 每层受伤 20.3 → L30 仅 5.7）。
 * 根因是玩家线性成长无上限（天赋叠加 + 品质武器 + 血量 7→19），而敌人只有
 * 血/伤两个线性维度。继续加血伤只会把前期也变硬、且变成「数值墙」。
 *
 * 词条走「改变交战方式」而非「加数值」：
 *   - bulwark 护盾：进战先破一层护盾，拖长 TTK，让远程怪有输出窗口
 *   - swift    迅捷：移速/攻速提升，压缩玩家走位空间
 *   - armored  重甲：减伤，逼玩家换高伤武器/暴击，而不是无脑泼水
 *   - volatile 爆裂：死亡放环形弹，惩罚贴脸清场，制造残局风险
 *
 * 概率随层数递增：低层保持干净，深层精英密集。纯数据 + 纯函数，可单测、可复现。
 */
import type { RNG } from '../core/RNG';

export type AffixId = 'bulwark' | 'swift' | 'armored' | 'volatile';

export interface AffixData {
  id: AffixId;
  name: string;
  /** HUD/血条旁的角标颜色 */
  color: string;
  desc: string;
  /** 护盾占最大生命的比例（bulwark） */
  shieldRatio?: number;
  /** 移速倍率（swift） */
  speedMul?: number;
  /** 攻击间隔倍率，<1 更快（swift） */
  cooldownMul?: number;
  /** 受伤倍率，<1 更硬（armored） */
  takenMul?: number;
  /** 死亡环形弹数量（volatile） */
  deathBullets?: number;
  deathDamage?: number;
}

export const AFFIXES: Record<AffixId, AffixData> = {
  bulwark: {
    id: 'bulwark', name: '护盾', color: '#7fb8ff',
    desc: '额外一层护盾', shieldRatio: 0.45,
  },
  swift: {
    id: 'swift', name: '迅捷', color: '#ffe066',
    desc: '移动与攻击更快', speedMul: 1.35, cooldownMul: 0.72,
  },
  armored: {
    id: 'armored', name: '重甲', color: '#b0b8c8',
    desc: '受到的伤害降低', takenMul: 0.55,
  },
  volatile: {
    id: 'volatile', name: '爆裂', color: '#ff8a5c',
    desc: '死亡时爆出环形弹', deathBullets: 8, deathDamage: 2,
  },
};

export const AFFIX_IDS: readonly AffixId[] = Object.keys(AFFIXES) as AffixId[];

export const getAffix = (id: string): AffixData | undefined => AFFIXES[id as AffixId];

/** 从第 N 层开始出现精英。低层不打扰新手。 */
export const ELITE_START_LEVEL = 6;

/**
 * 某层每只怪成为精英的概率。L6=0 → L30≈0.62，线性爬升封顶 0.7。
 * 是「每只怪独立 roll」，深层几乎每房都有若干精英，且可能出现多词条。
 */
export function eliteChance(level: number): number {
  if (level < ELITE_START_LEVEL) return 0;
  return Math.min(0.7, (level - ELITE_START_LEVEL + 1) * 0.026);
}

/** 精英携带第二词条的概率（L14 起），让深层出现「双词条」压迫感。 */
export function dualAffixChance(level: number): number {
  if (level < 14) return 0;
  return Math.min(0.5, (level - 13) * 0.03);
}

/**
 * 抽一只怪的词条。返回 0~2 个不重复词条；非精英返回空数组。
 * 调用方对每只怪独立调用，注入的 rng 保证同种子可复现。
 */
export function rollAffixes(rng: RNG, level: number): AffixId[] {
  if (!rng.chance(eliteChance(level))) return [];
  const pool = rng.shuffle([...AFFIX_IDS]);
  const count = rng.chance(dualAffixChance(level)) ? 2 : 1;
  return pool.slice(0, count) as AffixId[];
}
