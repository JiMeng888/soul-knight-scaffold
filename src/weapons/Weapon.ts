import { DEG, inArc, type Vec2 } from '../core/math';
import type { DamageInfo, GameCtx } from '../core/types';
import { BALANCE } from '../data/balance';
import { getWeapon, type WeaponData } from '../data/weapons';

/**
 * 武器系统：一把武器 = 一条 WeaponData + 这份通用开火逻辑。
 * 加新武器只改 data/weapons.ts，不碰这里。
 *
 * 能量池全局共享 —— 这让「带什么枪」变成资源决策而不是冷却计时。
 * 近战不耗能，刻意保留它作为弹尽粮绝时的退路，不要「平衡」掉。
 */
export class WeaponSystem {
  /**
   * 每把武器各自计时。共用一个 cooldown 会让「切枪」继承上一把的冷却：
   * 刚打完轨道炮（1.1 发/秒）切到手枪，还得等 0.9 秒才能开火，
   * 而切枪本应是应对不同距离的手段。Map 只留当前持有过的武器，条目很少。
   */
  private cooldowns = new Map<string, number>();
  /** 连发剩余发数与倒计时。能量在扳机按下时按 burst 总量预扣，中途不会断供。 */
  private burstLeft = 0;
  private burstTimer = 0;
  private burstWeapon: WeaponData | null = null;

  reset(): void {
    this.cooldowns.clear();
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.burstWeapon = null;
  }

  update(dt: number, ctx: GameCtx): void {
    // 所有武器的冷却一起走，切枪不会冻结另一把的计时
    for (const [id, cd] of this.cooldowns) {
      const next = cd - dt;
      if (next <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, next);
    }

    if (ctx.input.justPressed('KeyQ') || ctx.input.justPressed('Tab')) {
      // 换枪打断连发：否则会出现「切到手枪还在打刚才那把的连发」
      this.burstLeft = 0;
      this.burstWeapon = null;
      const id = ctx.run.switchWeapon();
      ctx.events.emit('weapon:switch', { id });
    }

    const canAct = ctx.player.state !== 'dead' && ctx.player.state !== 'roll';

    // 连发已扣过能量，必须打完；只有玩家死亡/翻滚才中止，避免连发把翻滚后的位置打歪。
    if (this.burstLeft > 0 && this.burstWeapon) {
      if (!canAct) {
        this.burstLeft = 0;
        this.burstWeapon = null;
        return;
      }
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.fireOnce(this.burstWeapon, ctx);
        this.burstLeft--;
        this.burstTimer = this.burstWeapon.burstGap ?? 0.06;
        if (this.burstLeft <= 0) this.burstWeapon = null;
      }
      return;
    }

    if (!ctx.input.firing || !canAct) return;

    const w = getWeapon(ctx.run.currentWeaponId);
    if ((this.cooldowns.get(w.id) ?? 0) > 0) return;

    const shots = Math.max(1, w.burst ?? 1);
    // 连发按总弹数预扣：中途按不出第二发时不会出现「打了两发却只收一发能量」
    const cost = w.energy * shots;
    if (ctx.run.energy < cost) return;

    ctx.run.energy -= cost;
    // 急速装填天赋在这里生效
    this.cooldowns.set(w.id, 1 / (w.fireRate * ctx.run.fireRateMul));
    this.fireOnce(w, ctx);

    if (shots > 1) {
      this.burstLeft = shots - 1;
      this.burstWeapon = w;
      this.burstTimer = w.burstGap ?? 0.06;
    }
  }

  private fireOnce(w: WeaponData, ctx: GameCtx): void {
    const p = ctx.player;
    const crit = ctx.rng.chance(ctx.run.crit);
    // 火力强化 / 致命处决天赋在这里生效；基础暴击倍率 × 天赋暴伤倍率 × 伤害倍率，
    // 三者相乘而不是互相覆盖（见 ARCHITECTURE.md「参数被赋值但没人读」踩坑）
    const base = w.damage * ctx.run.damageMul;
    const damage = crit ? base * BALANCE.critMultiplier * ctx.run.critDamageMul : base;
    ctx.events.emit('shot', { id: w.id });

    if (w.kind === 'melee') {
      const dir: Vec2 = { x: Math.cos(p.aimAngle), y: Math.sin(p.aimAngle) };
      const arc = w.arc ?? 0.95;
      const info: DamageInfo = {
        amount: damage, source: 'player', crit,
        knockback: w.knockback, dir,
      };
      let hits = 0;
      ctx.enemies.forEachActive((e) => {
        if (!e.alive || e.roomId !== ctx.room.plan.id) return;
        if (inArc(e.pos.x, e.pos.y, p.pos.x, p.pos.y, p.aimAngle, arc, w.range + e.radius)) {
          e.applyDamage(info);
          hits++;
        }
      });
      // 吸血：命中数 × 单次回复，封顶当前最大生命 —— 不设上限会变成无敌
      if (w.lifesteal && hits > 0) {
        ctx.run.hp = Math.min(ctx.run.maxHp, ctx.run.hp + w.lifesteal * hits);
      }
      // 近战同时劈掉扇区内的敌方子弹
      const blank: DamageInfo = { amount: 0, source: 'player', crit: false, knockback: 0, dir };
      ctx.projectiles.forEachActive((b) => {
        if (b.faction === 'enemy'
          && inArc(b.pos.x, b.pos.y, p.pos.x, p.pos.y, p.aimAngle, arc, w.range)) {
          b.applyDamage(blank);
        }
      });
      for (let i = 0; i < 5; i++) {
        const a = p.aimAngle + (i - 2) * 0.22;
        ctx.spawnParticle(p.pos.x + Math.cos(a) * 26, p.pos.y + Math.sin(a) * 26, w.color, 70);
      }
      ctx.renderer.shake(w.id === 'excalibur' ? 2.6 : 1.6);
      return;
    }

    for (let i = 0; i < w.pellets; i++) {
      const fan = w.pellets > 1 ? (i / (w.pellets - 1) - 0.5) * w.spread * DEG : 0;
      const jitter = (ctx.rng.next() - 0.5) * w.spread * DEG;
      const a = p.aimAngle + fan + jitter;
      ctx.spawnProjectile({
        x: p.pos.x + Math.cos(a) * 10,
        y: p.pos.y + Math.sin(a) * 10,
        angle: a,
        speed: w.speed,
        damage,
        faction: 'player',
        color: crit ? '#fff3a0' : w.color,
        pierce: w.pierce,
        radius: w.radius,
        knockback: w.knockback,
        crit,
        life: w.bulletLife ?? BALANCE.bulletLife,
        bounce: w.bounce,
        explodeRadius: w.explode,
        explodeDamage: w.explodeDamage ? w.explodeDamage * ctx.run.damageMul : 0,
        homing: w.homing,
      });
    }
    const heavy = w.explode ? 3 : w.id === 'railgun' || w.id === 'storm_rail' ? 3 : 1.2;
    ctx.renderer.shake(heavy);
  }
}
