import type { CharacterData } from '../data/characters';
import { rollWeapon } from '../data/weapons';
import type { Rarity } from '../data/rarity';
import { talentDecay, type TalentData } from '../data/talents';
import type { RNG } from '../core/RNG';

/**
 * 单局状态。与永久成长（GameState）严格分离：
 * 死亡时整个 RunState 被重置，永久成长不受影响。
 *
 * 天赋倍率也放在这里：它们是「本局成长」，死亡即清空。
 * 每个字段都在 Player / Weapon / Pickup 里有真实消费者，不是摆设。
 */
export class RunState {
  seed = 0;
  level = 1;
  roomId = 0;
  characterId = 'knight';

  hp = 0;
  maxHp = 0;
  armor = 0;
  maxArmor = 0;
  energy = 0;
  maxEnergy = 0;
  crit = 0;
  speed = 0;

  coins = 0;
  kills = 0;
  /** 整局用时（秒） */
  elapsed = 0;
  /** 本层用时（秒）：进下一层时归零，HUD 主要显示这个 */
  levelElapsed = 0;

  /** 本局已获得的天赋 id，可重复（同类叠加） */
  talents: string[] = [];
  /**
   * 每个 stat 已被叠加的次数。P2：纯数值天赋「越堆越赚」导致四件套霸榜，
   * 也让玩家成长无上限（P0 后期倒挂的病根）。递减让同类叠加边际收益下降，
   * 逼出多样化选择，同时给玩家成长加天花板。
   */
  statStacks: Record<string, number> = {};

  // —— 天赋倍率：默认 1，全部有消费者 ——
  damageMul = 1;
  fireRateMul = 1;
  energyRegenMul = 1;
  armorRegenMul = 1;
  coinGainMul = 1;
  pickupRangeMul = 1;
  rollCdMul = 1;
  /** 暴击伤害倍率（乘在 BALANCE.critMultiplier 之上，Weapon.fire 消费） */
  critDamageMul = 1;
  /** 每秒自动回血点数（Player.update 消费） */
  hpRegen = 0;
  /** 商店价格倍率（<1 为折扣，Game.buyShopItem 消费） */
  shopDiscountMul = 1;

  /** 最多两把武器，索引指向当前手持 */
  weapons: string[] = [];
  weaponIndex = 0;

  reset(c: CharacterData, seed: number): void {
    this.seed = seed;
    this.level = 1;
    this.roomId = 0;
    this.characterId = c.id;
    this.maxHp = c.hp;
    this.hp = c.hp;
    this.maxArmor = c.armor;
    this.armor = c.armor;
    this.maxEnergy = c.energy;
    this.energy = c.energy;
    this.crit = c.crit;
    this.speed = c.speed;
    this.coins = 0;
    this.kills = 0;
    this.elapsed = 0;
    this.levelElapsed = 0;
    this.talents = [];
    this.statStacks = {};
    this.damageMul = 1;
    this.fireRateMul = 1;
    this.energyRegenMul = 1;
    this.armorRegenMul = 1;
    this.coinGainMul = 1;
    this.pickupRangeMul = 1;
    this.rollCdMul = 1;
    this.critDamageMul = 1;
    this.hpRegen = 0;
    this.shopDiscountMul = 1;
    this.weapons = [c.startWeapon];
    this.weaponIndex = 0;
  }

  /**
   * 应用一条天赋，返回名字供通知用。add 用于上限/暴击，mul 用于倍率。
   *
   * P2 递减叠加：每个 stat 的本次效果乘以 talentDecay(已叠次数)。
   * mul 的「超出 1 的部分」打折（×1.4 叠第二次 → ×1.328），add 直接打折。
   * 这样同类天赋越堆越不划算，配合 rollTalentChoices 的跨类轮询把选择打散，
   * 同时给玩家成长加天花板 —— 直接缓解 P0 后期难度倒挂。
   */
  applyTalent(t: TalentData): string {
    for (const e of t.effects) {
      const stacks = this.statStacks[e.stat] ?? 0;
      const decay = talentDecay(stacks);
      const add = (e.add ?? 0) * decay;
      // 折扣类（mul<1，如 0.75 折「减少」的幅度）与增益类统一按「偏离 1 的幅度」打折
      const mul = 1 + ((e.mul ?? 1) - 1) * decay;
      switch (e.stat) {
        case 'maxHp':
          this.maxHp += add;
          this.hp = Math.min(this.maxHp, this.hp + add);
          break;
        case 'maxArmor':
          this.maxArmor += add;
          this.armor = Math.min(this.maxArmor, this.armor + add);
          break;
        case 'maxEnergy':
          this.maxEnergy += add;
          this.energy = Math.min(this.maxEnergy, this.energy + add);
          break;
        case 'crit':
          this.crit = Math.min(1, this.crit + add);
          break;
        case 'speed': this.speed *= mul; break;
        case 'damageMul': this.damageMul *= mul; break;
        case 'fireRateMul': this.fireRateMul *= mul; break;
        case 'energyRegenMul': this.energyRegenMul *= mul; break;
        case 'armorRegenMul': this.armorRegenMul *= mul; break;
        case 'coinGainMul': this.coinGainMul *= mul; break;
        case 'pickupRangeMul': this.pickupRangeMul *= mul; break;
        case 'rollCdMul': this.rollCdMul *= mul; break;
        case 'critDamageMul': this.critDamageMul *= mul; break;
        case 'hpRegen': this.hpRegen += add; break;
        case 'shopDiscountMul': this.shopDiscountMul *= mul; break;
        default: {
          // 编译期穷尽检查：往 TalentStat 加了新维度却忘了在这里接消费者，tsc 直接报错。
          const _exhaustive: never = e.stat;
          void _exhaustive;
        }
      }
      this.statStacks[e.stat] = stacks + 1;
    }
    this.talents.push(t.id);
    return t.name;
  }

  /** 金币统一入口：贪婪之心在这里生效，避免倍率散落到每个掉落点。 */
  addCoins(base: number): number {
    const gained = Math.max(1, Math.round(base * this.coinGainMul));
    this.coins += gained;
    return gained;
  }

  get currentWeaponId(): string {
    return this.weapons[this.weaponIndex] ?? 'pistol';
  }

  /**
   * 加入一把武器，返回「被顶替下来」的武器 id（武器栏未满则填副槽，返回 null）。
   * 纯数据层只负责告诉调用方谁被换下来了；掉回地面这件事由 GameCtx.giveWeapon
   * 统一处理 —— 否则「换枪 → 旧枪凭空消失」，玩家再也捡不回来。
   */
  addWeapon(id: string): string | null {
    if (this.weapons.length < 2) { this.weapons.push(id); return null; }
    const replaced = this.weapons[this.weaponIndex];
    this.weapons[this.weaponIndex] = id;
    return replaced;
  }

  switchWeapon(): string {
    if (this.weapons.length < 2) return this.currentWeaponId;
    this.weaponIndex = (this.weaponIndex + 1) % this.weapons.length;
    return this.currentWeaponId;
  }

  /**
   * 武器掉落统一入口：品质由「当前层数 + 最低品质门槛」共同决定。
   * BOSS 掉蓝装以上、宝箱保底、商店随机枪都走这里，避免散落多套抽取逻辑。
   */
  randomLoot(rng: RNG, level = this.level, minRarity: Rarity = 'common'): string {
    return rollWeapon(rng, level, minRarity);
  }
}
