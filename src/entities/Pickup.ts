import { dist } from '../core/math';
import type { DamageInfo, GameCtx } from '../core/types';
import { BALANCE, COLORS } from '../data/balance';
import { getWeapon, rarityLabel } from '../data/weapons';
import { rarityColor } from '../data/rarity';
import type { Renderer } from '../render/Renderer';
import { Entity } from './Entity';

export type PickupKind =
  | 'coin' | 'energy' | 'weapon' | 'chest' | 'portal'
  | 'heal' | 'armor' | 'shrine' | 'shopkeeper';

/** 需要按 E 交互的种类；其余为自动吸附。交互仲裁只在这些种类间选唯一目标。 */
export function isInteractable(kind: PickupKind): boolean {
  return kind === 'chest' || kind === 'shrine' || kind === 'weapon'
    || kind === 'portal' || kind === 'shopkeeper';
}

/**
 * 交互优先级权重（越小越优先）。装备最优先、服务类（神龛/商人）次之、
 * 传送门最后 —— 传送门是不可逆操作，玩家想拿武器/开箱时不能被它抢走。
 * 数值集中在 balance.ts，这里只做 kind → 三档的映射。
 */
export function interactBias(kind: PickupKind): number {
  switch (kind) {
    case 'weapon':
    case 'chest':
      return BALANCE.interactBias.gear;
    case 'shrine':
    case 'shopkeeper':
      return BALANCE.interactBias.service;
    case 'portal':
      return BALANCE.interactBias.portal;
    default:
      return 1;
  }
}

/**
 * 掉落物 / 宝箱 / 传送门 / 商店商人 / 天赋神龛。
 *
 * coin / energy / heal / armor 自动吸附（heal、armor 只在缺口时吸附，满状态不浪费）；
 * 其余按 E 交互。shopkeeper 是常驻交互点，按 E 打开面板但不消耗自己。
 */
export class Pickup extends Entity {
  kind: PickupKind = 'coin';
  amount = 0;
  /** 武器掉落时携带的武器 id */
  payload = '';
  age = 0;
  /**
   * 落地交互保护期（秒）。换枪时被顶替下来的旧武器掉回地面后，短暂不可按 E 拾取：
   * 否则玩家连按 E 会「捡起 A → 旧枪 B 落地 → 同一串连按又把 B 捡起 → A 落地」无限对换，
   * 也会让刚落地的枪抢占交互仲裁、把玩家真正想拿的近处目标挤掉。
   */
  dropGrace = 0;

  reset(): void {
    this.alive = false;
    this.id = 0;
    this.roomId = 0;
    this.pos.x = 0; this.pos.y = 0;
    this.vel.x = 0; this.vel.y = 0;
    this.radius = 5;
    this.kind = 'coin';
    this.amount = 0;
    this.payload = '';
    this.age = 0;
    this.dropGrace = 0;
    this.flash = 0;
  }

  init(kind: string, x: number, y: number, amount: number, payload: string): void {
    this.kind = kind as PickupKind;
    this.pos.x = x; this.pos.y = y;
    this.amount = amount;
    this.payload = payload;
    this.age = 0;
  }

  update(dt: number, ctx: GameCtx): void {
    if (!this.alive) return;
    this.age += dt;
    if (this.dropGrace > 0) this.dropGrace = Math.max(0, this.dropGrace - dt);
    const p = ctx.player;
    const d = dist(this.pos, p.pos);
    const magnet = ctx.run.pickupRangeMul;
    const range = BALANCE.pickupRange * magnet;

    // 商人不参与拾取，只负责开门营业。
    // 必须过交互仲裁：justPressed('KeyE') 对本步所有 pickup 都为真，
    // 少了 interactTargetId 这道闸，商人会和旁边的宝箱/神龛一起被同一次 E 触发。
    if (this.kind === 'shopkeeper') {
      if (d < range + 14 && ctx.input.justPressed('KeyE')
        && ctx.interactTargetId === this.id) ctx.openShop();
      return;
    }

    const auto = this.kind === 'coin' || this.kind === 'energy'
      || this.kind === 'heal' || this.kind === 'armor';
    if (auto) {
      // 缺口时才吸附：heal/armor 一直如此，energy 原来漏了（满蓝也把球吸走白费）。
      // P1 收紧能量后球变稀缺，满蓝吸走=补给被浪费在不需要的时刻，语义必须对齐。
      const useful = this.kind === 'heal' ? ctx.run.hp < ctx.run.maxHp
        : this.kind === 'armor' ? ctx.run.armor < ctx.run.maxArmor
          : this.kind === 'energy' ? ctx.run.energy < ctx.run.maxEnergy
            : true;
      if (!useful) return;
      if (d > 0 && d < 46 * magnet) {
        const k = (110 * dt) / Math.max(d, 1);
        this.pos.x += (p.pos.x - this.pos.x) * k;
        this.pos.y += (p.pos.y - this.pos.y) * k;
      }
      if (d < range) this.collect(ctx);
    } else if (this.dropGrace <= 0 && d < range + 10 && ctx.input.justPressed('KeyE')
      && ctx.interactTargetId === this.id) {
      this.collect(ctx);
    }
  }

  private collect(ctx: GameCtx): void {
    switch (this.kind) {
      case 'coin':
        ctx.run.addCoins(this.amount);
        break;
      case 'energy':
        ctx.run.energy = Math.min(ctx.run.maxEnergy, ctx.run.energy + this.amount);
        break;
      case 'heal':
        ctx.run.hp = Math.min(ctx.run.maxHp, ctx.run.hp + this.amount);
        break;
      case 'armor':
        ctx.run.armor = Math.min(ctx.run.maxArmor, ctx.run.armor + this.amount);
        break;
      case 'weapon':
        // 统一走 giveWeapon：武器栏满时把顶替下来的旧枪掉回地面，不再凭空消失。
        ctx.giveWeapon(this.payload || ctx.run.randomLoot(ctx.rng), this.pos.x, this.pos.y);
        break;
      case 'chest': {
        const id = ctx.run.randomLoot(ctx.rng);
        ctx.giveWeapon(id, this.pos.x, this.pos.y);
        ctx.run.addCoins(5);
        for (let i = 0; i < 6; i++) ctx.spawnParticle(this.pos.x, this.pos.y, COLORS.coin, 80);
        break;
      }
      case 'shrine':
        ctx.grantTalent();
        for (let i = 0; i < 8; i++) ctx.spawnParticle(this.pos.x, this.pos.y, COLORS.shrine, 90);
        break;
      case 'portal':
        ctx.nextLevel();
        break;
      case 'shopkeeper':
        return;
    }
    ctx.events.emit('pickup', { kind: this.kind, amount: this.amount });
    for (let i = 0; i < 3; i++) ctx.spawnParticle(this.pos.x, this.pos.y, '#ffffff', 50);
    this.alive = false;
  }

  applyDamage(_info: DamageInfo): void { /* 掉落物不受伤 */ }

  draw(r: Renderer): void {
    const y = this.pos.y + Math.sin(this.age * 4) * 2;
    if (this.kind === 'portal') {
      r.circle(this.pos.x, y, 15, '#4a3fa8');
      r.circle(this.pos.x, y, 10, '#8f7dff');
      r.circle(this.pos.x, y, 5, '#ffffff');
      r.text('E · 进入下一层', this.pos.x - 38, y - 24, COLORS.text, 8);
      return;
    }

    // 武器光晕画在精灵下面，否则半透明色块会糊住武器图标
    if (this.kind === 'weapon') {
      const glow = getWeapon(this.payload);
      r.circle(this.pos.x, y, 9, `${rarityColor(glow.rarity)}33`);
    }
    r.sprite(this.kind, this.pos.x, y);
    switch (this.kind) {
      case 'weapon': {
        // 品质用光晕 + 名字颜色双重表达：只靠名字颜色在小尺寸下不好辨认
        const w = getWeapon(this.payload);
        const wc = rarityColor(w.rarity);
        r.strokeRect(this.pos.x - 8, y - 8, 16, 16, wc, 1);
        r.text(w.name, this.pos.x, y - 19, wc, 7, 'center');
        // 刚从武器栏换下来的枪在保护期内不可捡，明确标注「放下」而不是「E 拾取」
        const hint = this.dropGrace > 0 ? '刚放下 · 稍后可捡' : `E 拾取 · ${rarityLabel(w.rarity)}`;
        r.text(hint, this.pos.x, y + 12, COLORS.dim, 6, 'center');
        break;
      }
      case 'chest':
        r.text('E 开启', this.pos.x - 16, y + 13, COLORS.dim, 7);
        break;
      case 'shrine':
        r.text('天赋神龛 · E 领取', this.pos.x - 40, y - 20, COLORS.shrine, 7);
        break;
      case 'shopkeeper':
        r.text('商人 · E 打开商店', this.pos.x - 44, y - 20, COLORS.shop, 7);
        break;
      case 'heal':
        r.text(`+${this.amount} 生命`, this.pos.x - 18, y - 16, COLORS.hp, 7);
        break;
      case 'armor':
        r.text(`+${this.amount} 护盾`, this.pos.x - 18, y - 16, COLORS.armor, 7);
        break;
      default:
        break;
    }
  }
}

/** 粒子也走对象池，避免弹幕命中时频繁分配。 */
export class Particle extends Entity {
  color = '#ffffff';
  life = 0;
  maxLife = 0;
  size = 2;

  reset(): void {
    this.alive = false;
    this.pos.x = 0; this.pos.y = 0;
    this.vel.x = 0; this.vel.y = 0;
    this.color = '#ffffff';
    this.life = 0; this.maxLife = 0; this.size = 2;
  }

  init(x: number, y: number, color: string, vx: number, vy: number, life: number, size: number): void {
    this.pos.x = x; this.pos.y = y;
    this.vel.x = vx; this.vel.y = vy;
    this.color = color;
    this.life = life; this.maxLife = life; this.size = size;
  }

  update(dt: number, _ctx: GameCtx): void {
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    const damp = Math.max(0, 1 - dt * 4);
    this.vel.x *= damp;
    this.vel.y *= damp;
  }

  applyDamage(_info: DamageInfo): void { /* 粒子不受伤 */ }

  draw(r: Renderer): void {
    const s = Math.max(1, this.size * (this.life / this.maxLife));
    r.fillRect(this.pos.x - s / 2, this.pos.y - s / 2, s, s, this.color);
  }
}
