import type { Vec2 } from '../core/math';
import type { DamageInfo, Damageable, Faction, GameCtx, Poolable } from '../core/types';
import type { Renderer } from '../render/Renderer';

/** 所有运行时对象的基类：位置 / 碰撞 / 血量 / 阵营。逻辑与渲染分离。 */
export abstract class Entity implements Poolable, Damageable {
  alive = false;
  id = 0;
  roomId = 0;
  faction: Faction = 'enemy';
  pos: Vec2 = { x: 0, y: 0 };
  vel: Vec2 = { x: 0, y: 0 };
  radius = 6;
  hp = 1;
  maxHp = 1;
  facing = 0;
  flash = 0;

  abstract reset(): void;
  abstract update(dt: number, ctx: GameCtx): void;
  abstract draw(r: Renderer): void;
  abstract applyDamage(info: DamageInfo): void;

  /** 分轴移动：撞墙只回退该轴，贴墙滑行不会粘住。 */
  protected moveWithWalls(dt: number, ctx: GameCtx): boolean {
    const nx = this.pos.x + this.vel.x * dt;
    const ny = this.pos.y + this.vel.y * dt;
    let hit = false;
    if (!ctx.room.collides(nx, this.pos.y, this.radius)) this.pos.x = nx;
    else { this.vel.x = 0; hit = true; }
    if (!ctx.room.collides(this.pos.x, ny, this.radius)) this.pos.y = ny;
    else { this.vel.y = 0; hit = true; }
    return hit;
  }
}
