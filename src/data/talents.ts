/**
 * 天赋配置表 —— 纯数据，不依赖任何运行时单例。
 *
 * 效果用 (stat + add/mul) 声明，由 RunState.applyTalent() 统一消费。
 * 这里刻意不写回调：加一条天赋 = 加一行数据；每个 stat 都必须有真实消费者，
 * 否则就会重蹈「参数被认真赋值但没人读」的覆辙（见 ARCHITECTURE.md 踩坑清单）。
 * 24 条覆盖 15 个 stat；每个 stat 的读取点见 ARCHITECTURE.md §2.7 对照表，
 * 并由 npm run verify 逐条应用校验「确实改变了 RunState 字段」。
 */
export type TalentStat =
  | 'maxHp' | 'maxArmor' | 'maxEnergy' | 'crit' | 'speed'
  | 'damageMul' | 'fireRateMul' | 'energyRegenMul' | 'armorRegenMul'
  | 'coinGainMul' | 'pickupRangeMul' | 'rollCdMul'
  | 'critDamageMul' | 'hpRegen' | 'shopDiscountMul';

export interface TalentEffect {
  stat: TalentStat;
  /** 加法：用于 maxHp / maxArmor / maxEnergy / crit / hpRegen */
  add?: number;
  /** 乘法：用于 speed、暴伤与各类倍率（<1 表示折扣/减益） */
  mul?: number;
}

export interface TalentData {
  id: string;
  name: string;
  desc: string;
  /** 卡片右下角分类标签 */
  tag: string;
  color: string;
  effects: readonly TalentEffect[];
}

export const TALENTS: Record<string, TalentData> = {
  // ——— 基础 12 条：单属性、易理解 ———
  vigor: {
    id: 'vigor', name: '强健体魄', desc: '生命上限 +2，并立即回复 2 点', tag: '生存', color: '#e05a5a',
    effects: [{ stat: 'maxHp', add: 2 }],
  },
  plating: {
    id: 'plating', name: '合金镀层', desc: '护盾上限 +2，并立即补满这 2 点', tag: '生存', color: '#6fa8dc',
    effects: [{ stat: 'maxArmor', add: 2 }],
  },
  battery: {
    id: 'battery', name: '扩容电池', desc: '能量上限 +40，并立即回复 40 点', tag: '能量', color: '#5ec8c8',
    effects: [{ stat: 'maxEnergy', add: 40 }],
  },
  keen: {
    id: 'keen', name: '精准打击', desc: '暴击率 +8%', tag: '输出', color: '#ffd479',
    effects: [{ stat: 'crit', add: 0.08 }],
  },
  swift: {
    id: 'swift', name: '疾风之足', desc: '移动速度 +12%', tag: '机动', color: '#8fd6a0',
    effects: [{ stat: 'speed', mul: 1.12 }],
  },
  power: {
    id: 'power', name: '火力强化', desc: '所有武器伤害 +20%', tag: '输出', color: '#ff8a5a',
    effects: [{ stat: 'damageMul', mul: 1.2 }],
  },
  rapid: {
    id: 'rapid', name: '急速装填', desc: '所有武器射速 +15%', tag: '输出', color: '#9ee8ff',
    effects: [{ stat: 'fireRateMul', mul: 1.15 }],
  },
  regen: {
    id: 'regen', name: '能量回流', desc: '能量自动恢复 +30%', tag: '能量', color: '#5ec8c8',
    effects: [{ stat: 'energyRegenMul', mul: 1.3 }],
  },
  repair: {
    id: 'repair', name: '纳米修复', desc: '护盾自动恢复 +60%', tag: '生存', color: '#6fa8dc',
    effects: [{ stat: 'armorRegenMul', mul: 1.6 }],
  },
  greed: {
    id: 'greed', name: '贪婪之心', desc: '金币获取 +50%', tag: '资源', color: '#f2c14e',
    effects: [{ stat: 'coinGainMul', mul: 1.5 }],
  },
  magnet: {
    id: 'magnet', name: '磁场吸附', desc: '拾取范围 +50%', tag: '资源', color: '#f2c14e',
    effects: [{ stat: 'pickupRangeMul', mul: 1.5 }],
  },
  dodge: {
    id: 'dodge', name: '轻身术', desc: '翻滚冷却 -20%', tag: '机动', color: '#8fd6a0',
    effects: [{ stat: 'rollCdMul', mul: 0.8 }],
  },

  // ——— 新增维度：暴击伤害（Weapon.fire 消费） ———
  execution: {
    id: 'execution', name: '致命处决', desc: '暴击伤害 +50%（基础 2 倍→3 倍）', tag: '输出', color: '#ffb04a',
    effects: [{ stat: 'critDamageMul', mul: 1.5 }],
  },
  assassin: {
    id: 'assassin', name: '暗杀艺术', desc: '暴击率 +10%，暴击伤害 +30%', tag: '输出', color: '#ffd479',
    effects: [{ stat: 'crit', add: 0.1 }, { stat: 'critDamageMul', mul: 1.3 }],
  },
  deadeye: {
    id: 'deadeye', name: '鹰眼', desc: '暴击率 +15%', tag: '输出', color: '#ffd479',
    effects: [{ stat: 'crit', add: 0.15 }],
  },
  berserk: {
    id: 'berserk', name: '狂战之血', desc: '所有武器伤害 +40%', tag: '输出', color: '#ff6a4a',
    effects: [{ stat: 'damageMul', mul: 1.4 }],
  },
  overclock: {
    id: 'overclock', name: '超频核心', desc: '射速 +22%，能量恢复 +10%', tag: '输出', color: '#9ee8ff',
    effects: [{ stat: 'fireRateMul', mul: 1.22 }, { stat: 'energyRegenMul', mul: 1.1 }],
  },

  // ——— 新增维度：生命再生（Player.update 消费） ———
  field_medic: {
    id: 'field_medic', name: '战地医疗', desc: '每秒自动回复 0.6 点生命', tag: '生存', color: '#7bd88f',
    effects: [{ stat: 'hpRegen', add: 0.6 }],
  },
  immortal: {
    id: 'immortal', name: '不死之身', desc: '每秒回复 1.1 生命，护盾恢复 +30%', tag: '生存', color: '#7bd88f',
    effects: [{ stat: 'hpRegen', add: 1.1 }, { stat: 'armorRegenMul', mul: 1.3 }],
  },
  bulwark: {
    id: 'bulwark', name: '铁壁', desc: '护盾上限 +2，护盾恢复 +40%', tag: '生存', color: '#6fa8dc',
    effects: [{ stat: 'maxArmor', add: 2 }, { stat: 'armorRegenMul', mul: 1.4 }],
  },
  juggernaut: {
    id: 'juggernaut', name: '重甲巨兽', desc: '生命上限 +3，但移速 -6%', tag: '生存', color: '#e05a5a',
    effects: [{ stat: 'maxHp', add: 3 }, { stat: 'speed', mul: 0.94 }],
  },
  capacitor: {
    id: 'capacitor', name: '超级电容', desc: '能量上限 +30，能量恢复 +25%', tag: '能量', color: '#5ec8c8',
    effects: [{ stat: 'maxEnergy', add: 30 }, { stat: 'energyRegenMul', mul: 1.25 }],
  },

  // ——— 新增维度：商店折扣（Game.buyShopItem + Panels 消费） ———
  haggler: {
    id: 'haggler', name: '砍价高手', desc: '商店全场 75 折', tag: '资源', color: '#f2c14e',
    effects: [{ stat: 'shopDiscountMul', mul: 0.75 }],
  },
  vip: {
    id: 'vip', name: '贵宾卡', desc: '商店 85 折，金币获取 +20%', tag: '资源', color: '#f2c14e',
    effects: [{ stat: 'shopDiscountMul', mul: 0.85 }, { stat: 'coinGainMul', mul: 1.2 }],
  },
  tycoon: {
    id: 'tycoon', name: '点金之手', desc: '金币获取 +80%', tag: '资源', color: '#f2c14e',
    effects: [{ stat: 'coinGainMul', mul: 1.8 }],
  },
  scavenger: {
    id: 'scavenger', name: '拾荒者', desc: '拾取范围 +80%，金币获取 +20%', tag: '资源', color: '#f2c14e',
    effects: [{ stat: 'pickupRangeMul', mul: 1.8 }, { stat: 'coinGainMul', mul: 1.2 }],
  },
  sprinter: {
    id: 'sprinter', name: '疾跑专家', desc: '移速 +20%，翻滚冷却 -15%', tag: '机动', color: '#8fd6a0',
    effects: [{ stat: 'speed', mul: 1.2 }, { stat: 'rollCdMul', mul: 0.85 }],
  },
};

/** 抽取顺序基于 Object.keys 的稳定顺序；打乱交给注入的 RNG，保证可复现。 */
export const TALENT_IDS: readonly string[] = Object.keys(TALENTS);

export const getTalent = (id: string): TalentData => TALENTS[id] ?? TALENTS.vigor;

/**
 * P2 递减叠加：某个 stat 已被叠加 stacks 次后，本次效果打几折。
 *
 * 之前纯数值天赋能无限乘法叠加（damageMul 连拿 4 次 = ×3.8），既让四件套
 * 无脑霸榜，又让「玩家成长无上限」—— 这正是 P0 后期难度倒挂的病根。
 * 每叠一次打 82 折（1 / .82 / .67 / .55 / .45…），边际收益递减但不归零，
 * 逼玩家横向 diversify，同时给成长加天花板。
 *
 * 单一事实源：RunState.applyTalent、机器人评分、verify 测试都引用它，避免三处各算一套。
 */
export const talentDecay = (stacks: number): number => Math.pow(0.82, Math.max(0, stacks));

/**
 * 把一组 id 按 tag 做「跨类轮询」重排：第一轮每类各出一个，第二轮再各出一个……
 * 是纯重排（元素不多不少、不重复），只改变出场顺序，不改变集合。
 * 目的：一次 4 张候选尽量覆盖「生存/输出/能量/机动/资源」不同类别，
 * 避免四张全是输出、玩家/机器人只能矮子里挑将军（P2 同质化的选择端成因）。
 */
function diversifyByTag(ids: readonly string[]): string[] {
  const buckets = new Map<string, string[]>();
  for (const id of ids) {
    const tag = getTalent(id).tag;
    if (!buckets.has(tag)) buckets.set(tag, []);
    buckets.get(tag)!.push(id);
  }
  const keys = [...buckets.keys()];
  const out: string[] = [];
  let round = 0;
  while (out.length < ids.length) {
    let added = false;
    for (const k of keys) {
      const b = buckets.get(k)!;
      if (b[round] !== undefined) { out.push(b[round]); added = true; }
    }
    if (!added) break;
    round++;
  }
  return out;
}

/**
 * 抽天赋候选：优先给「本局还没拿过的」，全拿光了才允许重复叠加。
 *
 * 每层都弹面板时，纯随机三选一会很快反复出同一批，体验很差。这里把已拥有
 * 的排到后面，保证前若干层都是新天赋；再对 fresh / taken 各自做跨 tag 轮询，
 * 让同批候选类别更分散。shuffle 由调用方注入（data 层不依赖 RNG）。
 * 纯函数、可单测；同一次返回的候选互不重复（除非池子小于 count，那才循环补齐）。
 */
export function rollTalentChoices(
  owned: readonly string[],
  count: number,
  shuffle: (arr: string[]) => string[],
): TalentData[] {
  const ownedSet = new Set(owned);
  const fresh = shuffle(TALENT_IDS.filter((id) => !ownedSet.has(id)));
  const taken = shuffle(TALENT_IDS.filter((id) => ownedSet.has(id)));
  const ids = [...diversifyByTag(fresh), ...diversifyByTag(taken)];
  const out: TalentData[] = [];
  for (let i = 0; i < count; i++) {
    out.push(getTalent(ids[i % ids.length]));
  }
  return out;
}
