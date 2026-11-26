import { angleOf, type Vec2 } from '../core/math';
import type { DamageInfo, GameCtx } from '../core/types';
import { BALANCE } from '../data/balance';
import type { Renderer } from '../render/Renderer';
import type { RunState } from '../state/RunState';
import { Entity } from './Entity';

export type PlayerState = 'idle' | 'move' | 'roll' | 'hurt' | 'dead';

/** 玩家状态机。血量/护盾/能量都读 RunState，Player 本身不持久化任何单局数据。 */
export class Player extends Entity {
  state: PlayerState = 'idle';
  invuln = 0;
  rollTimer = 0;
  rollCd = 0;
  hurtTimer = 0;
  armorDelay = 0;
  aimAngle = 0;

  onHurt?: (amount: number) => void;
  onDead?: () => void;

  private rollDir: Vec2 = { x: 1, y: 0 };
  private readonly run: RunState;

  constructor(run: RunState) {
    super();
    this.run = run;
    this.faction = 'player';
    this.radius = 6;
  }

  reset(): void {
    this.alive = true;
    this.state = 'idle';
    this.id = 0;
    this.roomId = 0;
    this.pos.x = 0; this.pos.y = 0;
    this.vel.x = 0; this.vel.y = 0;
    this.hp = 1; this.maxHp = 1; this.flash = 0;
    this.invuln = 0; this.rollTimer = 0; this.rollCd = 0;
    this.hurtTimer = 0; this.armorDelay = 0;
    this.aimAngle = 0;
    this.rollDir.x = 1; this.rollDir.y = 0;
  }

  spawnAt(x: number, y: number): void {
    this.pos.x = x;
    this.pos.y = y;
    this.state = 'idle';
  }

  update(dt: number, ctx: GameCtx): void {
    const run = this.run;

    // 瞄准方向永远独立：后退射击（backpedal）是这类游戏的核心技巧，
    // 一旦让移动方向决定朝向，这个技巧就没了。
    this.aimAngle = angleOf(ctx.input.aim.x - this.pos.x, ctx.input.aim.y - this.pos.y);
    this.facing = this.aimAngle;

    // 参数必须有真实消费者：护盾/能量恢复速率、翻滚冷却都在这里被读取，
    // 天赋倍率（能量回流 / 纳米修复 / 轻身术）通过 RunState 生效。
    run.energy = Math.min(run.maxEnergy, run.energy + BALANCE.energyRegen * run.energyRegenMul * dt);
    if (this.armorDelay > 0) this.armorDelay -= dt;
    else if (run.armor < run.maxArmor) {
      run.armor = Math.min(run.maxArmor, run.armor + BALANCE.armorRegenRate * run.armorRegenMul * dt);
    }
    // 战地医疗 / 不死之身天赋在这里生效：每秒回血，死亡后不再恢复。
    if (run.hpRegen > 0 && run.hp > 0 && this.state !== 'dead') {
      run.hp = Math.min(run.maxHp, run.hp + run.hpRegen * dt);
    }

    if (this.invuln > 0) this.invuln -= dt;
    if (this.rollCd > 0) this.rollCd -= dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.state === 'dead') { this.vel.x = 0; this.vel.y = 0; return; }

    const axis = ctx.input.moveAxis();
    if ((ctx.input.justPressed('Space') || ctx.input.justPressed('ShiftLeft'))
      && this.rollCd <= 0 && this.state !== 'roll') {
      this.state = 'roll';
      this.rollTimer = BALANCE.rollDuration;
      this.rollCd = BALANCE.rollCooldown * run.rollCdMul;
      this.invuln = Math.max(this.invuln, BALANCE.rollInvuln);
      this.rollDir = (axis.x !== 0 || axis.y !== 0)
        ? axis
        : { x: Math.cos(this.aimAngle), y: Math.sin(this.aimAngle) };
    }

    if (this.state === 'roll') {
      // 翻滚是固定动量，不做减速：承诺感来自「不能中途取消」。
      this.vel.x = this.rollDir.x * BALANCE.rollSpeed;
      this.vel.y = this.rollDir.y * BALANCE.rollSpeed;
      this.rollTimer -= dt;
      if (this.rollTimer <= 0) this.state = 'idle';
    } else if (this.state === 'hurt') {
      this.vel.x = 0; this.vel.y = 0;
      this.hurtTimer -= dt;
      if (this.hurtTimer <= 0) this.state = 'idle';
    } else {
      const speed = BALANCE.playerSpeed * run.speed;
      this.vel.x = axis.x * speed;
      this.vel.y = axis.y * speed;
      this.state = (axis.x !== 0 || axis.y !== 0) ? 'move' : 'idle';
    }

    this.moveWithWalls(dt, ctx);
  }

  applyDamage(info: DamageInfo): void {
    if (info.source === this.faction || this.state === 'dead' || this.invuln > 0) return;
    const run = this.run;
    // 护甲优先吸收单次伤害（对标原作「护甲抵消单次伤害」）
    if (run.armor > 0) run.armor -= 1;
    else run.hp -= info.amount;

    this.invuln = BALANCE.hurtInvuln;
    this.armorDelay = BALANCE.armorRegenDelay;
    this.flash = 0.2;
    this.state = 'hurt';
    this.hurtTimer = BALANCE.hurtStun;
    this.onHurt?.(info.amount);
    if (run.hp <= 0) {
      run.hp = 0;
      this.state = 'dead';
      this.onDead?.();
    }
  }

  draw(r: Renderer): void {
    if (this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0) return;
    r.sprite('player', this.pos.x, this.pos.y, 1, Math.cos(this.aimAngle) < 0);
    const gx = this.pos.x + Math.cos(this.aimAngle) * 9;
    const gy = this.pos.y + Math.sin(this.aimAngle) * 9;
    r.line(this.pos.x, this.pos.y, gx, gy, '#d9d2b8', 3);
    if (this.state === 'roll') r.circle(this.pos.x, this.pos.y, this.radius + 3, '#ffffff44');
  }
}
