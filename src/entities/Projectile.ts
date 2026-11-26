import { circleHit, clamp, dist2, type Vec2 } from '../core/math';
import type { DamageInfo, GameCtx, ProjectileOptions } from '../core/types';
import { BALANCE, TILE } from '../data/balance';
import type { Renderer } from '../render/Renderer';
import { Entity } from './Entity';

/** 把角度折回 (-π, π]，追踪转向时必需，否则会绕远路。 */
const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
};

/**
 * 子弹。四个关键设计：
 *  1. 阵营 mask：玩家子弹只遍历敌人，敌人子弹只打玩家。两边共用一个 mask
 *     会让某一方永远打不中，而且完全不报错。
 *  2. 打墙用射线步进，不用「重叠检测」—— 高速子弹一帧位移超过墙厚会直接穿墙。
 *  3. 弹墙按轴分别判定：只翻转被挡住的那一轴分量，斜射进墙角才不会卡死。
 *  4. 爆炸弹不结算直击伤害，只结算一次 AoE —— 否则同一目标会被吃两份伤害，
 *     而且改数值时很难看出是哪一份。
 */
export class Projectile extends Entity {
  angle = 0;
  speed = 0;
  damage = 0;
  color = '#ffffff';
  pierce = 0;
  life = 0;
  knockback = 0;
  crit = false;
  bounce = 0;
  explodeRadius = 0;
  explodeDamage = 0;
  homing = 0;
  private hitIds = new Set<number>();
  private tail: Vec2 = { x: 0, y: 0 };
  private age = 0;
  /** 刚出生那一帧必检一次命中：枪口嵌在敌人体内时不会「跳」过去。 */
  private spawned = false;

  reset(): void {
    this.alive = false;
    this.id = 0;
    this.roomId = 0;
    this.pos.x = 0; this.pos.y = 0;
    this.vel.x = 0; this.vel.y = 0;
    this.tail.x = 0; this.tail.y = 0;
    this.radius = 2.5;
    this.faction = 'player';
    this.angle = 0; this.speed = 0; this.damage = 0;
    this.color = '#ffffff'; this.pierce = 0; this.life = 0;
    this.knockback = 0; this.crit = false; this.flash = 0;
    this.bounce = 0; this.explodeRadius = 0; this.explodeDamage = 0; this.homing = 0;
    this.age = 0;
    this.spawned = false;
    this.hitIds.clear();
  }

  launch(o: ProjectileOptions): void {
    this.pos.x = o.x; this.pos.y = o.y;
    this.tail.x = o.x; this.tail.y = o.y;
    this.angle = o.angle;
    this.speed = o.speed;
    this.damage = o.damage;
    this.faction = o.faction;
    this.color = o.color;
    this.pierce = o.pierce ?? 0;
    this.life = o.life ?? BALANCE.bulletLife;
    this.radius = o.radius ?? 2.5;
    this.knockback = o.knockback ?? 0;
    this.crit = o.crit ?? false;
    this.bounce = o.bounce ?? 0;
    this.explodeRadius = o.explodeRadius ?? 0;
    this.explodeDamage = o.explodeDamage ?? 0;
    this.homing = o.homing ?? 0;
    this.spawned = true;
    this.hitIds.clear();
  }

  update(dt: number, ctx: GameCtx): void {
    if (!this.alive) return;
    this.age += dt;
    this.life -= dt;
    if (this.life <= 0) {
      // 引信结束：爆炸弹在空中自爆（榴弹的核心），普通弹静默消失
      if (this.explodeRadius > 0) this.explode(ctx);
      else this.alive = false;
      return;
    }

    if (this.homing > 0) this.turnToward(ctx, dt);

    // 枪口检查：开火点在玩家身侧 10px，贴脸时会直接落在敌人体内。
    // 先结算一次，否则第一步位移（最慢也有 5~8px）就把目标「跳」过去了 ——
    // 实测磁暴狙击炮（速度 700）贴脸连打 2 发、伤害 0。
    if (this.spawned) {
      this.spawned = false;
      if (this.checkHits(ctx)) return;
    }

    let travel = this.speed * dt;
    const maxStep = TILE * 0.5;
    while (travel > 1e-4 && this.alive) {
      const step = Math.min(maxStep, travel);
      travel -= step;
      const nx = this.pos.x + Math.cos(this.angle) * step;
      const ny = this.pos.y + Math.sin(this.angle) * step;

      if (!ctx.room.isSolid(nx, ny)) {
        this.tail.x = this.pos.x;
        this.tail.y = this.pos.y;
        this.pos.x = nx;
        this.pos.y = ny;
      } else if (this.bounce > 0) {
        // 哪一轴被挡就翻转哪一轴的速度分量：cos 取反 → π-θ，sin 取反 → -θ
        const blockX = ctx.room.isSolid(nx, this.pos.y);
        const blockY = ctx.room.isSolid(this.pos.x, ny);
        if (blockX && !blockY) this.angle = Math.PI - this.angle;
        else if (blockY && !blockX) this.angle = -this.angle;
        else this.angle += Math.PI;
        this.bounce--;
        this.tail.x = this.pos.x;
        this.tail.y = this.pos.y;
        for (let k = 0; k < 2; k++) {
          ctx.spawnParticle(this.pos.x, this.pos.y, this.color, 40);
        }
      } else {
        this.impact(ctx);
        return;
      }
      if (this.checkHits(ctx)) return;
    }
  }

  /** 追踪：限速转向最近目标，不做瞬时锁定，否则等于自瞄。 */
  private turnToward(ctx: GameCtx, dt: number): void {
    let tx = 0;
    let ty = 0;
    let best = 320 * 320;
    let found = false;

    if (this.faction === 'player') {
      ctx.enemies.forEachActive((e) => {
        if (!e.alive || e.roomId !== ctx.room.plan.id) return;
        const d = dist2(e.pos.x, e.pos.y, this.pos.x, this.pos.y);
        if (d < best) { best = d; tx = e.pos.x; ty = e.pos.y; found = true; }
      });
    } else {
      const p = ctx.player;
      if (p.alive && p.state !== 'dead') {
        const d = dist2(p.pos.x, p.pos.y, this.pos.x, this.pos.y);
        if (d < best) { best = d; tx = p.pos.x; ty = p.pos.y; found = true; }
      }
    }
    if (!found) return;

    const desired = Math.atan2(ty - this.pos.y, tx - this.pos.x);
    const diff = wrapAngle(desired - this.angle);
    const turn = this.homing * dt;
    this.angle = wrapAngle(this.angle + clamp(diff, -turn, turn));
  }

  private checkHits(ctx: GameCtx): boolean {
    const dir: Vec2 = { x: Math.cos(this.angle), y: Math.sin(this.angle) };

    if (this.faction === 'player') {
      let consumed = false;
      ctx.enemies.forEachActive((e) => {
        if (consumed || !e.alive || this.hitIds.has(e.id) || e.faction !== 'enemy') return;
        if (!circleHit(this.pos.x, this.pos.y, this.radius, e.pos.x, e.pos.y, e.radius)) return;
        this.hitIds.add(e.id);
        if (this.explodeRadius > 0) {
          // 爆炸弹：命中即引爆，伤害全部由 AoE 结算
          this.explode(ctx);
          consumed = true;
          return;
        }
        e.applyDamage({
          amount: this.damage, source: 'player', crit: this.crit,
          knockback: this.knockback, dir,
        });
        for (let k = 0; k < 3; k++) ctx.spawnParticle(e.pos.x, e.pos.y, this.color, 60);
        if (this.pierce-- <= 0) { this.alive = false; consumed = true; }
      });
      return consumed;
    }

    const p = ctx.player;
    if (p.alive && p.state !== 'dead'
      && circleHit(this.pos.x, this.pos.y, this.radius, p.pos.x, p.pos.y, p.radius)) {
      if (this.explodeRadius > 0) {
        this.explode(ctx);
        return true;
      }
      p.applyDamage({
        amount: this.damage, source: 'enemy', crit: false,
        knockback: this.knockback, dir,
      });
      this.alive = false;
      return true;
    }
    return false;
  }

  private impact(ctx: GameCtx): void {
    if (this.explodeRadius > 0) {
      this.explode(ctx);
      return;
    }
    this.alive = false;
    for (let k = 0; k < 3; k++) ctx.spawnParticle(this.pos.x, this.pos.y, this.color, 45);
  }

  /** 只打对方阵营：玩家爆炸不伤自己，敌人榴弹不误伤同伴。 */
  private explode(ctx: GameCtx): void {
    this.alive = false;
    const r = this.explodeRadius;
    const r2 = r * r;
    const dmg = this.explodeDamage;

    if (this.faction === 'player') {
      ctx.enemies.forEachActive((e) => {
        if (!e.alive || e.faction !== 'enemy') return;
        const d = dist2(e.pos.x, e.pos.y, this.pos.x, this.pos.y);
        if (d > r2) return;
        const len = Math.sqrt(d) || 1;
        e.applyDamage({
          amount: dmg, source: 'player', crit: this.crit, knockback: 70,
          dir: { x: (e.pos.x - this.pos.x) / len, y: (e.pos.y - this.pos.y) / len },
        });
      });
    } else {
      const p = ctx.player;
      if (p.alive && p.state !== 'dead') {
        const d = dist2(p.pos.x, p.pos.y, this.pos.x, this.pos.y);
        if (d <= r2) {
          const len = Math.sqrt(d) || 1;
          p.applyDamage({
            amount: dmg, source: 'enemy', crit: false, knockback: 40,
            dir: { x: (p.pos.x - this.pos.x) / len, y: (p.pos.y - this.pos.y) / len },
          });
        }
      }
    }

    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.spawnParticle(
        this.pos.x + Math.cos(a) * r * 0.45,
        this.pos.y + Math.sin(a) * r * 0.45,
        i % 2 ? '#fff3a0' : this.color, 90,
      );
    }
    ctx.renderer.shake(Math.min(5, 2 + r * 0.05));
  }

  /** 近战可以劈掉敌方子弹。 */
  applyDamage(_info: DamageInfo): void {
    this.alive = false;
  }

  draw(r: Renderer): void {
    if (this.explodeRadius > 0) {
      // 榴弹：实心弹体 + 引信闪烁圈，让人一眼看出「这是会炸的」
      const pulse = 0.7 + Math.sin(this.age * 18) * 0.3;
      r.circle(this.pos.x, this.pos.y, this.radius + 2 + pulse * 2, `${this.color}55`);
      r.circle(this.pos.x, this.pos.y, this.radius, this.color);
      r.line(this.tail.x, this.tail.y, this.pos.x, this.pos.y, this.color, 2);
      return;
    }
    r.line(this.tail.x, this.tail.y, this.pos.x, this.pos.y, this.color, this.radius * 1.4);
    r.circle(this.pos.x, this.pos.y, this.radius, this.color);
    if (this.crit) r.circle(this.pos.x, this.pos.y, this.radius + 2, '#fff3a0');
  }
}
