/**
 * 全局共享类型。刻意只放「接口」，不放实现 —— 各层通过 GameCtx 单向依赖，
 * 表现层不反向引用逻辑层，逻辑层不直接碰 Canvas。
 */
import type { Vec2 } from './math';
import type { RNG } from './RNG';
import type { EventBus } from './Events';
import type { Input } from './Input';
import type { Pool } from './ObjectPool';
import type { RunState } from '../state/RunState';
import type { GameState } from '../state/SaveManager';
import type { Level } from '../world/Level';
import type { Room } from '../world/Room';
import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import type { Projectile } from '../entities/Projectile';
import type { Pickup, Particle } from '../entities/Pickup';
import type { Renderer } from '../render/Renderer';
import type { WeaponSystem } from '../weapons/Weapon';

export type Faction = 'player' | 'enemy';

/** 一次伤害的完整描述。战斗三件套（Hitbox / Hurtbox / Health）之间只传这个。 */
export interface DamageInfo {
  amount: number;
  source: Faction;
  crit: boolean;
  knockback: number;
  dir: Vec2;
}

/** 可受伤对象的统一契约：Player / Enemy / 可破坏物都实现它。 */
export interface Damageable {
  readonly faction: Faction;
  readonly pos: Vec2;
  readonly radius: number;
  readonly alive: boolean;
  hp: number;
  applyDamage(info: DamageInfo): void;
}

/** 对象池成员契约。alive=false 表示待回收，sweep() 时归还 free 列表。 */
export interface Poolable {
  alive: boolean;
  reset(): void;
}

export interface ProjectileOptions {
  x: number;
  y: number;
  angle: number;
  speed: number;
  damage: number;
  faction: Faction;
  color: string;
  pierce?: number;
  life?: number;
  radius?: number;
  knockback?: number;
  crit?: boolean;
  /** 撞墙反弹次数 */
  bounce?: number;
  /** 命中 / 引信结束时爆炸的半径（0 = 不爆炸） */
  explodeRadius?: number;
  /** 爆炸伤害。爆炸弹不再结算直击伤害，避免同一目标吃两份 */
  explodeDamage?: number;
  /** 追踪转向速率（弧度/秒） */
  homing?: number;
}

/**
 * 逻辑层唯一能看到的「世界」。Game 实现它并把自己传给每个 update()。
 * 这样实体不必知道 Game 的具体类型，也不必 import 渲染器之外的任何单例。
 */
export interface GameCtx {
  readonly dt: number;
  readonly time: number;
  readonly input: Input;
  readonly events: EventBus;
  readonly rng: RNG;
  readonly run: RunState;
  readonly meta: GameState;
  readonly level: Level;
  readonly room: Room;
  readonly player: Player;
  readonly enemies: Pool<Enemy>;
  readonly projectiles: Pool<Projectile>;
  readonly pickups: Pool<Pickup>;
  readonly particles: Pool<Particle>;
  readonly renderer: Renderer;
  readonly weapons: WeaponSystem;
  /**
   * 本逻辑步唯一允许响应 E 的交互物 id；-1 表示本步没有 E 交互。
   * 由 Game 在 pickup 更新前预扫描「最近的可交互物」得出 —— 一次按键
   * 只消费一个交互物，无论它们靠得多近、拾取范围天赋把半径放多大。
   */
  readonly interactTargetId: number;

  spawnProjectile(o: ProjectileOptions): Projectile;
  spawnEnemy(kind: string, x: number, y: number): Enemy;
  spawnPickup(kind: string, x: number, y: number, amount?: number, payload?: string): Pickup;
  spawnParticle(x: number, y: number, color: string, speed?: number): Particle;
  nextLevel(): void;
  gameOver(): void;
  /** 授予天赋；不传 id 则从天赋表随机抽一个。返回天赋名。 */
  grantTalent(id?: string): string;
  /** 打开当前商店房的购买面板（由商人交互点触发）。 */
  openShop(): void;
  /**
   * 给玩家一把武器。武器栏已满时，被顶替下来的那把会掉回 (x, y) 附近的地面
   * （而不是凭空消失），玩家可再走回去捡回。地面拾取 / 宝箱 / 商店买枪统一走这里，
   * 保证「换枪不丢枪」在单一入口生效，不会某个来源漏掉。
   */
  giveWeapon(id: string, x: number, y: number): void;
}
