import type { Vec2 } from '../core/math';
import { dist2 } from '../core/math';
import type { GameCtx } from '../core/types';
import { rollAffixes, type AffixId } from '../data/affixes';
import { BALANCE, COLORS, CORRIDOR_TILES, TILE } from '../data/balance';
import { bossForLevel, getEnemy, rollEnemy } from '../data/enemies';
import { rollShopStock, type ShopSlot } from '../data/shop';
import type { Renderer } from '../render/Renderer';
import { DELTA, DIRS, RoomType } from './DungeonGenerator';
import type { Dir, RoomPlan } from './DungeonGenerator';
import type { RoomTemplate } from './RoomTemplate';

export type RoomState = 'unvisited' | 'fighting' | 'cleared';

/** 一波怪里的一只：生成点 + 词条。多波次时预先算好，保证同种子可复现。 */
interface WaveSpawn {
  x: number;
  y: number;
  kind: string;
  radius: number;
  affixes: AffixId[];
}

/** 挑出一组格子里欧氏距离最远的一对，用于把两个交互物尽量分开（纯体验优化）。 */
function farthestPair(tiles: ReadonlyArray<{ x: number; y: number }>): [number, number] {
  if (tiles.length < 2) return [0, 0];
  let ai = 0, bi = 1, best = -1;
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const dx = tiles[i].x - tiles[j].x;
      const dy = tiles[i].y - tiles[j].y;
      const d = dx * dx + dy * dy;
      if (d > best) { best = d; ai = i; bi = j; }
    }
  }
  return [ai, bi];
}

/**
 * 一层里的一个房间。所有房间同时实例化（一层 = 一个场景），
 * 过门只是「传送到邻居房间 + 相机移动」，没有场景加载，也就没有状态需要序列化。
 *
 * 坐标约定（改这里最容易 off-by-one，且是静默错误）：
 *   origin = 外墙环左上角世界坐标
 *   layer (0,0) 是墙环左上角；地面占 layer 1..size
 *   模板坐标 (x,y) 对应 layer (x+1, y+1)
 *   门开在墙环中心 layer (mid, 0) / (mid, size+1) / (0, mid) / (size+1, mid)
 */
export class Room {
  readonly plan: RoomPlan;
  readonly origin: Vec2;
  readonly template: RoomTemplate;
  readonly size: number;
  readonly mid: number;
  readonly worldW: number;

  state: RoomState = 'unvisited';
  doorCooldown = 0;
  portalActive = false;
  lockedFlash = 0;
  /** 商店房货位：跟随房间实例，玩家反复进出仍是同一批货、同一份已售标记。 */
  shopStock: ShopSlot[] = [];
  /** 关键交互物的实际落点（商人 / BOSS）：几何中心可能是柱子，画柜台要用吸附后的点。 */
  anchor: Vec2 | null = null;
  /** P0 多波次：进入战斗房时把后续波次排好队，前一波清空后按 waveGap 放出下一波。 */
  private pendingWaves: WaveSpawn[][] = [];
  private waveTimer = 0;
  /** 本房总波数（1/2/3），spawnContents 时确定。公开给自动试玩统计与未来 HUD 波次提示，
   *  避免统计脚本去读 private 的 pendingWaves（编译期私有、运行时可访问但语义不干净）。 */
  waveCount = 1;
  /** 进房时生成的精英怪数量，供统计。 */
  eliteCount = 0;

  constructor(plan: RoomPlan, template: RoomTemplate, origin: Vec2) {
    this.plan = plan;
    this.template = template;
    this.origin = origin;
    this.size = plan.size;
    this.mid = Math.floor((this.size + 2) / 2);
    this.worldW = (this.size + 2) * TILE;
  }

  get center(): Vec2 {
    return { x: this.origin.x + this.worldW / 2, y: this.origin.y + this.worldW / 2 };
  }

  layerToWorld(lx: number, ly: number): Vec2 {
    return {
      x: this.origin.x + (lx + 0.5) * TILE,
      y: this.origin.y + (ly + 0.5) * TILE,
    };
  }

  /** 按预先算好的一批生成点造怪。词条在 spawnEnemy（已含 applyLevelScale）之后附加，
   *  这样护盾按缩放后的 maxHp 计算。生成点进房时已吸附过，不会嵌墙。 */
  private spawnWave(ctx: GameCtx, specs: readonly WaveSpawn[]): void {
    for (const s of specs) {
      const e = ctx.spawnEnemy(s.kind, s.x, s.y);
      e.roomId = this.plan.id;
      if (s.affixes.length) {
        e.applyAffixes(s.affixes);
        this.eliteCount++;
      }
    }
  }

  doorLayer(dir: Dir): Vec2 {
    switch (dir) {
      case 'n': return { x: this.mid, y: 0 };
      case 's': return { x: this.mid, y: this.size + 1 };
      case 'w': return { x: 0, y: this.mid };
      case 'e': return { x: this.size + 1, y: this.mid };
    }
  }

  doorWorld(dir: Dir): Vec2 {
    const d = this.doorLayer(dir);
    return this.layerToWorld(d.x, d.y);
  }

  /** 从某个门进入房间时的落点：门内侧 2 格，避免刚进门就被敌人堵住。 */
  innerSpawn(entryDir: Dir, tiles = 2): Vec2 {
    switch (entryDir) {
      case 'n': return this.layerToWorld(this.mid, tiles);
      case 's': return this.layerToWorld(this.mid, this.size + 1 - tiles);
      case 'w': return this.layerToWorld(tiles, this.mid);
      case 'e': return this.layerToWorld(this.size + 1 - tiles, this.mid);
    }
  }

  /**
   * 把「房间中心 / 中心上方两格」这类**几何点**吸到最近的可走格上，并保证体型放得下。
   *
   * 之前 BOSS、商人、宝箱、传送门都直接摆在房间正中（或中心上方），
   * 而模板中心经常正好是柱子 —— 压测显示 43.7% 的关卡 BOSS 出生在墙里：
   * 它既出不来也打不到，房间永远 clear 不了，整局静默卡死。
   *
   * 注意 radius：BOSS 半径 13~14，比一格（16px）还宽，光「格子可走」不够，
   * 必须整块身体都不碰墙。4 邻格全空的格子中心距墙 16px，正好够 BOSS 站。
   */
  safeSpawn(prefer: Vec2, radius = 6): Vec2 {
    const tiles = this.template.walkableTiles(2);
    for (const r of [radius, radius * 0.62, 4]) {
      let best: Vec2 | null = null;
      let bestD = Infinity;
      for (const t of tiles) {
        const w = this.layerToWorld(t.x + 1, t.y + 1);
        if (this.collides(w.x, w.y, r)) continue;
        const d = dist2(w.x, w.y, prefer.x, prefer.y);
        if (d < bestD) { bestD = d; best = w; }
      }
      if (best) return best;
    }
    return this.center;
  }

  doorUnlocked(dir: Dir): boolean {
    return this.state === 'cleared' && this.plan.doors[dir] !== undefined;
  }

  /** 世界坐标是否实心。解锁的门格（含内外各一格）放行。 */
  isSolid(wx: number, wy: number): boolean {
    const lx = Math.floor((wx - this.origin.x) / TILE);
    const ly = Math.floor((wy - this.origin.y) / TILE);
    const onRing = lx <= 0 || ly <= 0 || lx >= this.size + 1 || ly >= this.size + 1;
    if (onRing) {
      for (const dir of DIRS) {
        if (this.plan.doors[dir] === undefined || !this.doorUnlocked(dir)) continue;
        const d = this.doorLayer(dir);
        const alongX = dir === 'e' || dir === 'w';
        if (alongX) {
          if (ly === d.y && Math.abs(lx - d.x) <= 1) return false;
        } else if (lx === d.x && Math.abs(ly - d.y) <= 1) return false;
      }
      return true;
    }
    return this.template.isWall(lx - 1, ly - 1);
  }

  /** 圆与墙的碰撞：圆心 + 四个轴向采样点。 */
  collides(x: number, y: number, r: number): boolean {
    return this.isSolid(x, y)
      || this.isSolid(x + r, y) || this.isSolid(x - r, y)
      || this.isSolid(x, y + r) || this.isSolid(x, y - r);
  }

  /** 玩家是否踩进某个门的触发框。锁定门只反馈、不通过。 */
  doorAt(x: number, y: number, ctx: GameCtx): { dir: Dir; targetId: number } | null {
    if (this.doorCooldown > 0) return null;
    for (const dir of DIRS) {
      const targetId = this.plan.doors[dir];
      if (targetId === undefined) continue;
      const d = this.doorWorld(dir);
      if (dist2(x, y, d.x, d.y) > (TILE * 1.15) ** 2) continue;
      if (!this.doorUnlocked(dir)) {
        if (this.lockedFlash <= 0) {
          this.lockedFlash = 0.6;
          ctx.events.emit('door:locked', { roomId: this.plan.id });
        }
        return null;
      }
      return { dir, targetId };
    }
    return null;
  }

  /** 首次进入时按房间类型布置内容。用 (seed, roomId) 派生子流，同种子完全可复现。 */
  spawnContents(ctx: GameCtx): void {
    if (this.state !== 'unvisited') return;
    const rng = ctx.rng.fork(this.plan.id * 101 + ctx.run.level * 17);
    const tiles = rng.shuffle(this.template.walkableTiles(2));
    let cursor = 0;
    const point = (): Vec2 => {
      const t = tiles[cursor++ % tiles.length];
      return this.layerToWorld(t.x + 1, t.y + 1);
    };

    switch (this.plan.type) {
      case RoomType.START:
        this.state = 'cleared';
        break;

      case RoomType.TREASURE: {
        this.state = 'cleared';
        const c = this.safeSpawn(this.center);
        ctx.spawnPickup('chest', c.x, c.y);
        for (let i = 0; i < 3; i++) {
          const p = point();
          ctx.spawnPickup('coin', p.x, p.y, 2);
        }        break;
      }

      case RoomType.BONUS: {
        // 奖励房：进门即安全，不刷任何敌人。金币撒在可走格上，
        // 回血/回盾只在缺口时才会被吸附（Pickup 里判断），避免满血浪费。
        this.state = 'cleared';
        for (let i = 0; i < BALANCE.bonusCoinPiles; i++) {
          const p = point();
          ctx.spawnPickup('coin', p.x, p.y, rng.int(2, 3));
        }
        for (let i = 0; i < 2; i++) {
          const p = point();
          ctx.spawnPickup('energy', p.x, p.y, 10);
        }
        const h = point();
        ctx.spawnPickup('heal', h.x, h.y, 3);
        const a = point();
        ctx.spawnPickup('armor', a.x, a.y, 3);
        // 宝箱与神龛拉到房间两端，避免两个「E 提示」文字叠在一起影响阅读。
        // 注意：这已不是正确性依赖 —— 一次 E 只消费一个交互物由 Game 层的
        // 交互仲裁（interactTargetId）保证，即使两点贴在一起也不会双消费。
        // 从「x 两极」改为「欧氏距离最远的一对」，任意模板下都拿得到两点。
        const specials = this.template.walkableTiles(3);
        if (specials.length >= 2) {
          const [ai, bi] = farthestPair(specials);
          const lc = this.layerToWorld(specials[ai].x + 1, specials[ai].y + 1);
          const rc = this.layerToWorld(specials[bi].x + 1, specials[bi].y + 1);
          ctx.spawnPickup('chest', lc.x, lc.y);
          ctx.spawnPickup('shrine', rc.x, rc.y);
        } else {
          ctx.spawnPickup('chest', this.center.x - TILE * 4, this.center.y);
          ctx.spawnPickup('shrine', this.center.x + TILE * 4, this.center.y);
        }
        break;
      }

      case RoomType.SHOP: {
        this.state = 'cleared';
        this.shopStock = rollShopStock(rng, BALANCE.shopStockSize);
        // 商人也要吸附：柜台是照着他的位置画的，中心有柱子时不能把柜台画进墙里
        this.anchor = this.safeSpawn(this.center);
        ctx.spawnPickup('shopkeeper', this.anchor.x, this.anchor.y);
        break;
      }

      case RoomType.COMBAT: {
        // 数量随层数增长，但封顶 8 只：再多就变成数值墙而不是战斗。
        // P0：深层把这一波拆成 2~3 波分批出 —— 打断「一波 AOE 全清 + 站着回血」，
        // 让压力持续，也给精英词条（护盾/重甲）更长的交战窗口。
        const lv = ctx.run.level;
        const waves = lv >= BALANCE.waveThreeFrom ? 3 : lv >= BALANCE.waveTwoFrom ? 2 : 1;
        const count = Math.min(3 + lv, 8) + rng.int(0, 1);
        // 每多一波额外补 1 只，避免拆波后同时威胁反而下降（总上限仍受控）。
        const total = count + (waves - 1);
        const specs: WaveSpawn[] = [];
        for (let i = 0; i < total; i++) {
          const kind = rollEnemy(rng, lv);
          const rad = getEnemy(kind).radius;
          const at = this.safeSpawn(point(), rad); // 大体型怪按体型吸附，避免卡柱子
          specs.push({ x: at.x, y: at.y, kind, radius: rad, affixes: rollAffixes(rng, lv) });
        }
        this.queueWaves(ctx, specs, waves);
        this.state = 'fighting';
        break;
      }

      case RoomType.EXIT: {
        // BOSS 每两层轮换一套（守卫 / 巨像 / 君王），深层不再重复同一个木桩。
        // 出生点必须吸附到「放得下体型」的可走格：模板中心上方两格常常正好是柱子。
        const lv = ctx.run.level;
        const bossId = bossForLevel(lv);
        const bp = this.safeSpawn({ x: this.center.x, y: this.center.y - TILE * 2 },
          getEnemy(bossId).radius + 1);
        this.anchor = bp;
        const bossAffixes = rollAffixes(rng, lv);
        const first: WaveSpawn[] = [{
          x: bp.x, y: bp.y, kind: bossId, radius: getEnemy(bossId).radius,
          // BOSS 至少从 L12 起稳定带 1 条词条，深层可能双词条；让它成为真正的关卡节点。
          affixes: lv >= 12 ? (bossAffixes.length ? bossAffixes : ['armored' as AffixId]) : [],
        }];
        const adds = lv >= BALANCE.waveTwoFrom ? 3 : 2;
        for (let i = 0; i < adds; i++) {
          const kind = rollEnemy(rng, lv);
          const rad = getEnemy(kind).radius;
          const at = this.safeSpawn(point(), rad);
          first.push({ x: at.x, y: at.y, kind, radius: rad, affixes: rollAffixes(rng, lv) });
        }
        // BOSS 房也分两波（深层）：第一批 BOSS+护卫，第二批精英援军，拉长 BOSS 战存在感。
        const waves = lv >= BALANCE.waveThreeFrom ? 2 : 1;
        this.waveCount = waves;
        if (waves === 2) {
          const second: WaveSpawn[] = [];
          for (let i = 0; i < 2; i++) {
            const kind = rollEnemy(rng, lv);
            const rad = getEnemy(kind).radius;
            const at = this.safeSpawn(point(), rad);
            const af = rollAffixes(rng, lv);
            second.push({ x: at.x, y: at.y, kind, radius: rad,
              affixes: af.length ? af : ['swift' as AffixId] });
          }
          this.spawnWave(ctx, first);
          this.pendingWaves = [second];
          this.waveTimer = BALANCE.waveGap;
        } else {
          this.spawnWave(ctx, first);
        }
        this.state = 'fighting';
        break;
      }
    }
  }

  /** 把 specs 均分成 waves 波，首波立即生成，其余排队。 */
  private queueWaves(ctx: GameCtx, specs: WaveSpawn[], waves: number): void {
    this.waveCount = waves;
    this.pendingWaves = [];
    if (waves <= 1) { this.spawnWave(ctx, specs); return; }
    const per = Math.ceil(specs.length / waves);
    this.spawnWave(ctx, specs.slice(0, per));
    for (let i = per; i < specs.length; i += per) {
      this.pendingWaves.push(specs.slice(i, i + per));
    }
    this.waveTimer = BALANCE.waveGap;
  }

  update(dt: number, ctx: GameCtx): void {
    if (this.doorCooldown > 0) this.doorCooldown -= dt;
    if (this.lockedFlash > 0) this.lockedFlash -= dt;

    if (this.state === 'fighting') {
      let alive = 0;
      ctx.enemies.forEachActive((e) => {
        if (e.alive && e.roomId === this.plan.id) alive++;
      });
      if (alive === 0) {
        // 还有排队波次：等 waveGap 喘息间隔后放下一波，房间继续保持 fighting（门锁着）。
        // 这样玩家不能「清空第一波就跑去门口」，必须打完全部波次才开门。
        if (this.pendingWaves.length > 0) {
          this.waveTimer -= dt;
          if (this.waveTimer <= 0) {
            const next = this.pendingWaves.shift();
            if (next) this.spawnWave(ctx, next);
            this.waveTimer = BALANCE.waveGap;
          }
        } else {
          this.clear(ctx);
        }
      }
    }
  }

  private clear(ctx: GameCtx): void {
    this.state = 'cleared';
    ctx.events.emit('room:clear', { roomId: this.plan.id });
    const rng = ctx.rng.fork(this.plan.id * 733 + ctx.run.level);

    // P1：清房固定掉落收敛（金币 4→3 堆），能量球从「每房必给」改为 40% 概率 ——
    // 配合缩小的能量池，清房间隙回能为主、偶发补给为辅，能量条才有起伏可言。
    for (let i = 0; i < 3; i++) {
      ctx.spawnPickup('coin', this.center.x + rng.range(-30, 30), this.center.y + rng.range(-30, 30), 1);
    }
    if (rng.chance(0.4)) {
      ctx.spawnPickup('energy', this.center.x + rng.range(-24, 24), this.center.y + rng.range(-24, 24), 7);
    }

    if (this.plan.type === RoomType.COMBAT && rng.chance(0.35)) {
      const at = this.safeSpawn({ x: this.center.x, y: this.center.y + 14 }, 6);
      ctx.spawnPickup('weapon', at.x, at.y, 0, ctx.run.randomLoot(rng, ctx.run.level));
    }
    if (this.plan.type === RoomType.EXIT) {
      this.portalActive = true;
      const p = this.safeSpawn(this.center);
      ctx.spawnPickup('portal', p.x, p.y);
    }
  }

  // ---------------------------------------------------------------- 渲染

  draw(r: Renderer): void {
    const { x: ox, y: oy } = this.origin;
    const n = this.size;

    r.fillRect(ox, oy, this.worldW, this.worldW, COLORS.wallShadow);

    // 地板：棋盘格，整数像素对齐
    for (let y = 1; y <= n; y++) {
      for (let x = 1; x <= n; x++) {
        const c = (x + y) % 2 === 0 ? COLORS.floor : COLORS.floorAlt;
        r.fillRect(ox + x * TILE, oy + y * TILE, TILE, TILE, c);
      }
    }

    // 走廊：门朝外延伸一段，视觉上把相邻房间连起来
    for (const dir of DIRS) {
      if (this.plan.doors[dir] === undefined) continue;
      this.drawCorridor(r, dir);
    }

    // 内部柱子
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!this.template.walls[y][x]) continue;
        const px = ox + (x + 1) * TILE;
        const py = oy + (y + 1) * TILE;
        r.fillRect(px, py, TILE, TILE, COLORS.wall);
        r.fillRect(px, py, TILE, 3, COLORS.wallTop);
      }
    }

    // 外墙环 + 门
    for (let i = 0; i <= n + 1; i++) {
      for (const [lx, ly] of [[i, 0], [i, n + 1], [0, i], [n + 1, i]]) {
        const px = ox + lx * TILE;
        const py = oy + ly * TILE;
        r.fillRect(px, py, TILE, TILE, COLORS.wall);
        r.fillRect(px, py, TILE, 3, COLORS.wallTop);
      }
    }
    for (const dir of DIRS) {
      if (this.plan.doors[dir] === undefined) continue;
      const d = this.doorLayer(dir);
      const px = ox + d.x * TILE;
      const py = oy + d.y * TILE;
      const unlocked = this.doorUnlocked(dir);
      const color = unlocked ? COLORS.door : COLORS.doorLocked;
      r.fillRect(px, py, TILE, TILE, color);
      r.fillRect(px + 2, py + 2, TILE - 4, TILE - 4, unlocked ? '#3a3320' : '#3a2020');
      if (!unlocked) {
        r.strokeRect(px + 4, py + 5, TILE - 8, TILE - 8, '#ffb0b0', 1);
      }
    }

    if (this.lockedFlash > 0) {
      r.text('清怪后才能开门', this.center.x - 44, this.origin.y + TILE * 1.2, '#ffb0b0', 8);
    }
    if (this.plan.type === RoomType.START && this.state === 'cleared') {
      r.text('找传送门，往深处走', this.center.x - 52, this.center.y - TILE * 3, COLORS.dim, 8);
    }
    if (this.plan.type === RoomType.BONUS) {
      r.text('奖励房 · 全部免费', this.center.x - 52, this.origin.y + TILE * 1.2, COLORS.bonus, 8);
    }
    if (this.plan.type === RoomType.SHOP) {
      r.text('商店 · 靠近商人按 E', this.center.x - 56, this.origin.y + TILE * 1.2, COLORS.shop, 8);
      // 柜台：纯程序化绘制，商人的 sprite 会站在它后面。
      // 位置跟商人实际落点走 —— 中心是柱子时商人会被吸附到旁边。
      const a = this.anchor ?? this.center;
      r.fillRect(a.x - 26, a.y + 10, 52, 9, '#5a4630');
      r.fillRect(a.x - 26, a.y + 10, 52, 3, '#8b6a45');
    }
  }

  private drawCorridor(r: Renderer, dir: Dir): void {
    const d = this.doorWorld(dir);
    const [dx, dy] = DELTA[dir];
    const length = CORRIDOR_TILES * TILE;
    const halfW = TILE;
    const horizontal = dx !== 0;
    const x = horizontal
      ? (dx > 0 ? d.x : d.x - length)
      : d.x - halfW;
    const y = horizontal
      ? d.y - halfW
      : (dy > 0 ? d.y : d.y - length);
    const w = horizontal ? length : halfW * 2;
    const h = horizontal ? halfW * 2 : length;
    r.fillRect(x, y, w, h, COLORS.corridor);
    r.strokeRect(x, y, w, h, COLORS.wall, 2);
  }
}
