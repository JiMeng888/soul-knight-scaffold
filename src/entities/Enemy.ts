import { DEG, dist2, type Vec2 } from '../core/math';
import type { DamageInfo, GameCtx } from '../core/types';
import { BALANCE, COLORS, TILE } from '../data/balance';
import { AFFIXES, getAffix, type AffixData, type AffixId } from '../data/affixes';
import { getEnemy, type EnemyAttack, type EnemyData } from '../data/enemies';
import type { Renderer } from '../render/Renderer';
import { Entity } from './Entity';

export type EnemyState =
  | 'idle' | 'chase' | 'windup' | 'attack' | 'laser' | 'recover' | 'dodge' | 'dead';

/**
 * 敌人基类 + AI 状态机。所有敌人共用一份逻辑，差异只在 EnemyData 配置表。
 *
 * 攻击是「配置驱动」而不是分支堆叠：每条 EnemyAttack 声明前摇 / 伤害 / 弹数 /
 * 爆炸 / 激光 / 召唤，update 只负责推进 windup → execute → recover 三段。
 * 这样加一个会放激光的怪只需要填数据，不会把 update 撑成 if 地狱。
 */
export class Enemy extends Entity {
  data: EnemyData = getEnemy('goblin');
  state: EnemyState = 'idle';
  private timer = 0;
  /** 距离下次可起手的剩余时间 */
  private attackCd = 0;
  private attackIndex = 0;
  private push: Vec2 = { x: 0, y: 0 };
  private chargeDir: Vec2 = { x: 1, y: 0 };
  /** 激光的锁定角 / 激活剩余时间 / 伤害结算节拍 */
  private laserAngle = 0;
  private laserTime = 0;
  private laserTick = 0;
  private laserActive = false;
  private laserAtk: EnemyAttack | null = null;
  private touchCd = 0;
  /**
   * 层数成长倍率（伤害用）。血量倍率在 applyLevelScale 里直接算进 maxHp。
   * 之前敌人**完全不随层数成长**：自动试玩 30 局 0 死亡，
   * 每层受伤从 L6 的 15.3 一路掉到 L30 的 3.0 —— 越打越轻松，难度曲线是反的。
   */
  powerScale = 1;

  // —— 精英词条（P0）：用机制而非纯数值放大后期威胁 ——
  /** 本怪携带的词条 id，空数组表示普通怪 */
  affixes: AffixId[] = [];
  /** 护盾值（bulwark）：先扣盾再扣血，护盾期间不被打断、不闪血 */
  shield = 0;
  shieldMax = 0;
  /** 词条聚合后的倍率，避免每帧查表 */
  private speedMul = 1;
  private cooldownMul = 1;
  private takenMul = 1;
  /** 是否已附加词条（重生后需清空） */
  private affixApplied = false;

  /** BOSS 狂暴阶段：血量过半后攻速/移速提升，制造「阶段转换」节点。 */
  enraged = false;

  reset(): void {
    this.alive = false;
    this.id = 0;
    this.roomId = 0;
    this.faction = 'enemy';
    this.pos.x = 0; this.pos.y = 0;
    this.vel.x = 0; this.vel.y = 0;
    this.push.x = 0; this.push.y = 0;
    this.chargeDir.x = 1; this.chargeDir.y = 0;
    this.radius = 6;
    this.hp = 1; this.maxHp = 1;
    this.data = getEnemy('goblin');
    this.state = 'idle';
    this.timer = 0;
    this.attackCd = 0;
    this.attackIndex = 0;
    this.laserAngle = 0;
    this.laserTime = 0;
    this.laserTick = 0;
    this.laserActive = false;
    this.laserAtk = null;
    this.touchCd = 0;
    this.flash = 0;
    this.facing = 0;
    this.powerScale = 1;
    this.affixes = [];
    this.shield = 0;
    this.shieldMax = 0;
    this.speedMul = 1;
    this.cooldownMul = 1;
    this.takenMul = 1;
    this.affixApplied = false;
    this.enraged = false;
  }

  /**
   * 层数成长：血量每层 +8%，伤害每层 +3%。
   *
   * 曲线刻意分两条：血量长得快（战斗节奏不至于一秒清场），
   * 伤害长得慢（前期 1 点伤害的怪到 30 层也只到 1.9，不会一发秒人）。
   * 只加层数不加难度，玩家堆完天赋和品质武器之后就没有任何压力了。
   */
  applyLevelScale(level: number): void {
    const lv = Math.max(1, level);
    this.maxHp = Math.round(this.maxHp * (1 + (lv - 1) * 0.10) * 10) / 10;
    this.hp = this.maxHp;
    this.powerScale = 1 + (lv - 1) * 0.05;
  }

  init(kind: string, x: number, y: number): void {
    this.data = getEnemy(kind);
    this.pos.x = x; this.pos.y = y;
    this.radius = this.data.radius;
    this.hp = this.data.hp;
    this.maxHp = this.data.hp;
    this.state = 'idle';
    // 首次攻击给一点延迟，避免刚生成就贴脸开火
    this.timer = 0.35;
    this.attackCd = 0.35 + this.data.cooldown * 0.5;
  }

  /**
   * 附加精英词条（在 applyLevelScale 之后调用，护盾按缩放后的 maxHp 计算）。
   * 只聚合倍率 + 初始化护盾，行为分支在 applyDamage / die / update 里读这些字段。
   */
  applyAffixes(ids: readonly AffixId[]): void {
    if (this.affixApplied) return;
    this.affixApplied = true;
    this.affixes = [...ids];
    let shieldRatio = 0;
    for (const id of ids) {
      const a: AffixData | undefined = getAffix(id);
      if (!a) continue;
      if (a.shieldRatio) shieldRatio += a.shieldRatio;
      if (a.speedMul) this.speedMul *= a.speedMul;
      if (a.cooldownMul) this.cooldownMul *= a.cooldownMul;
      if (a.takenMul) this.takenMul *= a.takenMul;
    }
    if (shieldRatio > 0) {
      this.shieldMax = Math.max(1, Math.round(this.maxHp * shieldRatio));
      this.shield = this.shieldMax;
    }
  }

  get isElite(): boolean { return this.affixes.length > 0; }
  get isBoss(): boolean { return this.data.id.startsWith('boss'); }

  /** 当前轮到的攻击。BOSS 的 attacks 有多条，按顺序轮换。 */
  private get attack(): EnemyAttack {
    const list = this.data.attacks;
    return list[this.attackIndex % list.length];
  }

  update(dt: number, ctx: GameCtx): void {
    if (!this.alive) return;
    if (this.hp <= 0) { this.die(ctx); return; }
    // 非当前房间的实体不更新（一层里所有房间同时存在，但只有当前房在跑）
    if (this.roomId !== ctx.room.plan.id) return;

    // BOSS 阶段转换：血量首次跌破一半进入狂暴，攻速/移速提升并放一次全屏提示。
    // 这是「机制节点」而不是继续叠血 —— 让 BOSS 战有节奏、后半段更有存在感。
    if (this.isBoss && !this.enraged && this.hp <= this.maxHp * 0.5) {
      this.enraged = true;
      this.cooldownMul *= 0.7;
      this.speedMul *= 1.2;
      ctx.renderer.shake(3);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        ctx.spawnParticle(this.pos.x + Math.cos(a) * this.radius,
          this.pos.y + Math.sin(a) * this.radius, '#ff6a4a', 120);
      }
    }

    this.flash = Math.max(0, this.flash - dt);
    this.touchCd = Math.max(0, this.touchCd - dt);
    if (this.attackCd > 0) this.attackCd -= dt;
    this.timer -= dt;

    const p = ctx.player;
    const dx = p.pos.x - this.pos.x;
    const dy = p.pos.y - this.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    this.facing = Math.atan2(dy, dx);

    // —— 激光激活：站定输出，按节拍结算，墙会挡光 ——
    if (this.laserActive) {
      this.state = 'laser';
      this.laserTime -= dt;
      this.laserTick -= dt;
      if (this.laserTick <= 0) {
        this.laserTick = 0.15;
        if (this.beamHitsPlayer(ctx)) {
          this.hitPlayer(p, Math.cos(this.laserAngle), Math.sin(this.laserAngle),
            this.laserAtk?.damage ?? 2);
        }
      }
      this.applyMotion(0, 0, dt, ctx);
      if (this.laserTime <= 0) {
        this.laserActive = false;
        this.state = 'recover';
        this.timer = this.laserAtk?.recover ?? 0.4;
      }
      return;
    }

    // —— 起手：站定、持续瞄准，最后一刻锁死（激光锁得更早，留出躲避窗口）——
    if (this.state === 'windup') {
      const atk = this.attack;
      const lockFrom = atk.kind === 'laser' ? atk.windup * 0.55 : 0;
      if (this.timer > lockFrom) this.laserAngle = Math.atan2(dy, dx);
      if (this.timer <= 0) {
        // 冲撞型：前摇结束不是直接结算伤害，而是锁定方向进入冲刺
        if (this.data.ai === 'charger') {
          this.state = 'attack';
          this.timer = 0.35;
          this.chargeDir.x = ux;
          this.chargeDir.y = uy;
        } else {
          this.execute(ctx, atk, dx, dy, d);
        }
      }
      this.applyMotion(0, 0, dt, ctx);
      return;
    }

    // —— 后摇：能缓慢挪动，但不发起新攻击 ——
    if (this.state === 'recover') {
      if (this.timer <= 0) this.state = 'idle';
    }

    let mx = 0;
    let my = 0;

    switch (this.data.ai) {
      case 'chaser': {
        const stop = this.attack.range + this.radius - 2;
        if (d > stop) { mx = ux; my = uy; this.state = 'chase'; }
        else if (this.state === 'chase') this.state = 'idle';
        break;
      }

      case 'charger': {
        const atk = this.attack;
        if (this.state === 'attack') {
          mx = this.chargeDir.x * 4;
          my = this.chargeDir.y * 4;
          if (d < atk.range + this.radius + 6) this.hitPlayer(p, ux, uy, atk.damage);
          if (this.timer <= 0) {
            this.state = 'recover';
            this.timer = atk.recover ?? 0.8;
            this.attackCd = this.data.cooldown * this.cooldownMul;
          }
        } else if (this.state === 'recover') {
          // 后摇结束由上面的通用分支收尾
        } else if (d < 175 && this.attackCd <= 0) {
          this.state = 'windup';
          this.timer = atk.windup;
        } else {
          mx = ux; my = uy;
          this.state = 'chase';
        }
        break;
      }

      case 'shooter': {
        const desired = this.attack.range * 0.72;
        if (d > desired + 26) { mx = ux; my = uy; }
        else if (d < desired - 30) { mx = -ux; my = -uy; }
        else { mx = -uy * 0.75; my = ux * 0.75; }
        if (this.state !== 'recover') this.state = 'chase';
        break;
      }

      case 'orbiter': {
        // 切向绕圈 + 径向修正，始终保持在中距离
        const desired = this.attack.range * 0.6;
        const radial = Math.max(-1, Math.min(1, (d - desired) / 80));
        mx = -uy * 0.95 + ux * radial * 0.8;
        my = ux * 0.95 + uy * radial * 0.8;
        const len = Math.hypot(mx, my) || 1;
        mx /= len; my /= len;
        if (this.state !== 'recover') this.state = 'chase';
        break;
      }

      case 'sentinel':
        mx = 0; my = 0;
        if (this.state !== 'recover') this.state = 'idle';
        break;
    }

    // 通用起手判定：够近 + 冷却好了 + 不在起手/后摇中
    if (this.data.ai !== 'charger' && this.attackCd <= 0
      && (this.state === 'idle' || this.state === 'chase')) {
      const atk = this.attack;
      if (d <= atk.range) {
        this.state = 'windup';
        this.timer = atk.windup;
        this.laserAngle = Math.atan2(dy, dx);
      }
    }

    this.applyMotion(mx, my, dt, ctx);

    // 接触伤害：和主动攻击分开，贴身就有代价，但不会每帧结算
    if (this.data.touchDamage && this.touchCd <= 0
      && d < this.radius + p.radius + 1) {
      this.hitPlayer(p, ux, uy, this.data.touchDamage);
      this.touchCd = 0.7;
    }
  }

  private applyMotion(mx: number, my: number, dt: number, ctx: GameCtx): void {
    this.vel.x = mx * this.data.speed * this.speedMul + this.push.x;
    this.vel.y = my * this.data.speed * this.speedMul + this.push.y;
    const decay = Math.max(0, 1 - dt * 9);
    this.push.x *= decay;
    this.push.y *= decay;
    this.moveWithWalls(dt, ctx);
  }

  private execute(ctx: GameCtx, atk: EnemyAttack, dx: number, dy: number, d: number): void {
    const p = ctx.player;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const aim = Math.atan2(dy, dx);

    switch (atk.kind) {
      case 'melee': {
        if (d <= atk.range + this.radius + 4) this.hitPlayer(p, ux, uy, atk.damage);
        for (let i = 0; i < 4; i++) {
          const a = aim + (i - 1.5) * 0.25;
          ctx.spawnParticle(this.pos.x + Math.cos(a) * this.radius, this.pos.y + Math.sin(a) * this.radius,
            this.data.color, 60);
        }
        this.finish(atk);
        break;
      }

      case 'shot':
      case 'spread': {
        const n = atk.kind === 'shot' ? 1 : Math.max(1, atk.count ?? 3);
        const spread = (atk.spread ?? 0) * DEG;
        const color = atk.color ?? this.data.color;
        for (let i = 0; i < n; i++) {
          const a = aim + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
          ctx.spawnProjectile({
            x: this.pos.x + Math.cos(a) * (this.radius + 3),
            y: this.pos.y + Math.sin(a) * (this.radius + 3),
            angle: a,
            speed: atk.speed ?? 160,
            // 修正漏乘：远程弹幕此前用原始 atk.damage，完全不随层成长。
            // 近战/激光走 hitPlayer 已乘 powerScale，这里补齐才一致。
            damage: atk.damage * this.powerScale,
            faction: 'enemy',
            color,
            radius: 3,
            knockback: 14,
            life: BALANCE.bulletLife,
          });
        }
        this.finish(atk);
        break;
      }

      case 'grenade': {
        const blast = atk.blast ?? 30;
        ctx.spawnProjectile({
          x: this.pos.x + ux * (this.radius + 4),
          y: this.pos.y + uy * (this.radius + 4),
          angle: aim,
          speed: atk.speed ?? 132,
          damage: atk.damage * this.powerScale,
          faction: 'enemy',
          color: atk.color ?? '#ffb46a',
          radius: 4,
          knockback: 0,
          // 引信：哪怕没砸到人，1.5 秒后也会在空中引爆
          life: 1.5,
          explodeRadius: blast,
          explodeDamage: atk.damage * this.powerScale,
        });
        this.finish(atk);
        break;
      }

      case 'laser': {
        this.laserActive = true;
        this.laserAtk = atk;
        this.laserAngle = aim;
        this.laserTime = atk.duration ?? 0.3;
        this.laserTick = 0;
        this.state = 'laser';
        this.attackIndex = (this.attackIndex + 1) % this.data.attacks.length;
        this.attackCd = this.data.cooldown * this.cooldownMul;
        ctx.renderer.shake(1.8);
        break;
      }

      case 'summon': {
        const id = atk.summonId ?? 'goblin';
        const count = Math.max(1, atk.count ?? 2);
        // 场上敌人太多就跳过这一轮，避免召唤海把帧数和玩家耐心一起打穿
        let alive = 0;
        ctx.enemies.forEachActive((e) => { if (e.alive && e.roomId === this.roomId) alive++; });
        if (alive < 16) {
          const kidR = getEnemy(id).radius;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + aim;
            const at = ctx.room.safeSpawn({
              x: this.pos.x + Math.cos(a) * (this.radius + 14),
              y: this.pos.y + Math.sin(a) * (this.radius + 14),
            }, kidR);
            const e = ctx.spawnEnemy(id, at.x, at.y);
            e.roomId = this.roomId;
          }
          for (let i = 0; i < 8; i++) {
            ctx.spawnParticle(this.pos.x, this.pos.y, atk.color ?? '#c9a0ff', 90);
          }
        }
        this.finish(atk);
        break;
      }
    }
  }

  /** 一次攻击结束后的统一收尾：推进轮换、重置冷却、进入后摇。 */
  private finish(atk: EnemyAttack): void {
    this.attackIndex = (this.attackIndex + 1) % this.data.attacks.length;
    this.attackCd = this.data.cooldown * this.cooldownMul;
    this.state = 'recover';
    this.timer = atk.recover ?? 0.3;
  }

  /** 激光是否命中玩家：投影落在射程内 + 垂直距离在宽度内 + 中途没有墙。 */
  private beamHitsPlayer(ctx: GameCtx): boolean {
    const atk = this.laserAtk;
    if (!atk) return false;
    const p = ctx.player;
    if (!p.alive || p.state === 'dead') return false;
    const dx = Math.cos(this.laserAngle);
    const dy = Math.sin(this.laserAngle);
    const px = p.pos.x - this.pos.x;
    const py = p.pos.y - this.pos.y;
    const along = px * dx + py * dy;
    const length = atk.length ?? 240;
    if (along < 0 || along > length) return false;
    const perp = Math.abs(px * dy - py * dx);
    if (perp > (atk.width ?? 5) + p.radius) return false;
    const steps = Math.max(1, Math.ceil(along / (TILE * 0.5)));
    for (let i = 1; i <= steps; i++) {
      const s = (along * i) / steps;
      if (ctx.room.isSolid(this.pos.x + dx * s, this.pos.y + dy * s)) return false;
    }
    return true;
  }

  private hitPlayer(p: GameCtx['player'], ux: number, uy: number, amount: number): void {
    p.applyDamage({
      amount: amount * this.powerScale, source: 'enemy', crit: false,
      knockback: 22, dir: { x: ux, y: uy },
    });
  }

  applyDamage(info: DamageInfo): void {
    if (info.source === this.faction) return;
    let dmg = info.amount * this.takenMul; // 重甲词条：先减伤
    // 护盾词条：先扣盾，扣穿的溢出伤害才进血条。护盾期间给蓝色闪光反馈。
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
      this.flash = 0.1;
      if (dmg <= 0) {
        this.push.x += info.dir.x * info.knockback * 0.3;
        this.push.y += info.dir.y * info.knockback * 0.3;
        return;
      }
    }
    this.hp -= dmg;
    this.flash = 0.12;
    this.push.x += info.dir.x * info.knockback;
    this.push.y += info.dir.y * info.knockback;
  }

  private die(ctx: GameCtx): void {
    this.alive = false;
    this.state = 'dead';
    this.laserActive = false;
    ctx.run.kills += 1;
    ctx.events.emit('enemy:dead', { x: this.pos.x, y: this.pos.y, kind: this.data.id });
    for (let i = 0; i < 6; i++) {
      ctx.spawnParticle(this.pos.x, this.pos.y, this.data.color, 90);
    }
    // 爆裂词条：死亡放一圈敌弹，惩罚贴脸清场、制造残局走位压力。
    const volatile = this.affixes.includes('volatile') ? AFFIXES.volatile : null;
    if (volatile?.deathBullets) {
      const n = volatile.deathBullets;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.spawnProjectile({
          x: this.pos.x + Math.cos(a) * (this.radius + 2),
          y: this.pos.y + Math.sin(a) * (this.radius + 2),
          angle: a,
          speed: 130,
          damage: volatile.deathDamage ?? 2,
          faction: 'enemy',
          color: volatile.color,
          radius: 3,
          knockback: 10,
          life: 1.1,
        });
      }
    }
    const r = ctx.rng;

    // 分裂：只分裂一层（slimelet 没有 splitInto），否则会指数爆炸
    if (this.data.splitInto && this.data.splitCount) {
      const childKind = this.data.splitInto;
      const childR = getEnemy(childKind).radius;
      for (let i = 0; i < this.data.splitCount; i++) {
        const a = (i / this.data.splitCount) * Math.PI * 2 + r.next();
        const at = ctx.room.safeSpawn({
          x: this.pos.x + Math.cos(a) * (this.radius + 6),
          y: this.pos.y + Math.sin(a) * (this.radius + 6),
        }, childR);
        const child = ctx.spawnEnemy(childKind, at.x, at.y);
        child.roomId = this.roomId;
      }
    }

    // P1：金币/能量产出下调，配合商店定价上涨，收敛「收入 >> 消耗」。
    // 8 局实测一局捡 448 个能量球、战斗中能量条 97.6% 贴满 —— 能量球已成背景噪音，
    // 击杀掉球再收 0.24→0.13、面额 8→7，让它回到「偶发补给」而非「满地自来水」。
    // 注意：只收产出，不动回能/单发能耗（那是熄火安全地板，动它会回到 BOSS 房超时）。
    if (r.chance(0.5)) {
      ctx.spawnPickup('coin', this.pos.x + r.range(-8, 8), this.pos.y + r.range(-8, 8), 1);
    }
    if (r.chance(0.13)) {
      ctx.spawnPickup('energy', this.pos.x + r.range(-8, 8), this.pos.y + r.range(-8, 8), 7);
    }
    if (this.data.id.startsWith('boss')) {
      for (let i = 0; i < 6; i++) {
        ctx.spawnPickup('coin', this.pos.x + r.range(-24, 24), this.pos.y + r.range(-24, 24), 3);
      }
      // 传送门开在房间正中。BOSS 常死在中心附近，掉落若贴着尸体就会和传送门
      // 挤在一起（提示文字重叠、玩家想捡枪却误进下一层）。这里沿「远离中心」
      // 方向至少推开 3 格；交互权重是逻辑兜底，这一步只是让视觉也别叠。
      const c = ctx.room.center;
      let dx = this.pos.x - c.x;
      let dy = this.pos.y - c.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) { dx = 0; dy = 1; } else { dx /= len; dy /= len; }
      const push = TILE * 3.5;
      // BOSS 保底蓝装：深层靠品质曲线自然出紫/橙，不额外写死。
      // 掉落点同样要吸附，否则枪会掉进柱子里，玩家看得到名字却永远 E 不到。
      const drop = ctx.room.safeSpawn({ x: c.x + dx * push, y: c.y + dy * push }, 6);
      ctx.spawnPickup('weapon', drop.x, drop.y, 0,
        ctx.run.randomLoot(r, ctx.run.level, 'rare'));
    }
  }

  draw(r: Renderer): void {
    const scale = this.data.scale ?? 1;
    r.sprite(this.data.id, this.pos.x, this.pos.y, scale, Math.cos(this.facing) < 0);
    if (this.flash > 0) r.circle(this.pos.x, this.pos.y, this.radius, '#ffffffaa');

    // 起手预警：激光画一条细线指示方向，其余攻击用方框闪烁
    if (this.state === 'windup') {
      const atk = this.attack;
      if (atk.kind === 'laser') {
        const length = atk.length ?? 240;
        const dx = Math.cos(this.laserAngle);
        const dy = Math.sin(this.laserAngle);
        r.line(this.pos.x, this.pos.y, this.pos.x + dx * length, this.pos.y + dy * length,
          '#ff7b7b55', 1);
        const pulse = 0.45 + Math.sin(this.timer * 40) * 0.25;
        r.line(this.pos.x, this.pos.y, this.pos.x + dx * length, this.pos.y + dy * length,
          `rgba(255,120,120,${pulse.toFixed(2)})`, 3);
      } else {
        r.strokeRect(this.pos.x - this.radius - 4, this.pos.y - this.radius - 4,
          (this.radius + 4) * 2, (this.radius + 4) * 2, '#ffcc66', 1);
      }
    }

    // 激光激活：外层光晕 + 白色芯
    if (this.laserActive && this.laserAtk) {
      const length = this.laserAtk.length ?? 240;
      const width = this.laserAtk.width ?? 5;
      const dx = Math.cos(this.laserAngle);
      const dy = Math.sin(this.laserAngle);
      const ex = this.pos.x + dx * length;
      const ey = this.pos.y + dy * length;
      r.line(this.pos.x, this.pos.y, ex, ey, `${this.laserAtk.color ?? '#ff7b7b'}66`, width * 2.6);
      r.line(this.pos.x, this.pos.y, ex, ey, this.laserAtk.color ?? '#ff7b7b', width * 1.5);
      r.line(this.pos.x, this.pos.y, ex, ey, '#ffffff', Math.max(1, width * 0.5));
    }

    // 精英视觉：脚下淡色光环 + 头顶词条角标 + 护盾条，让玩家一眼认出「这只不一样」。
    if (this.isElite) {
      r.circle(this.pos.x, this.pos.y, this.radius * scale + 2, '#ffffff10');
      let ax = this.pos.x - (this.affixes.length * 6) / 2;
      const badgeY = this.pos.y - this.radius * scale - 15;
      for (const id of this.affixes) {
        const a = getAffix(id);
        r.fillRect(ax, badgeY, 5, 3, a?.color ?? '#ffffff');
        ax += 6;
      }
    }

    const w = (this.data.scale === 2 ? 34 : 18);
    const y = this.pos.y - this.radius * scale - 8;
    if (this.shield > 0) {
      r.fillRect(this.pos.x - w / 2, y - 3, w, 2, '#1a1d28');
      r.fillRect(this.pos.x - w / 2, y - 3, w * (this.shield / this.shieldMax), 2, '#7fb8ff');
    }
    if (this.hp < this.maxHp || this.shield > 0) {
      const ratio = Math.max(0, this.hp / this.maxHp);
      r.fillRect(this.pos.x - w / 2, y, w, 2, '#1a1d28');
      r.fillRect(this.pos.x - w / 2, y, w * ratio, 2, COLORS.hp);
    }
  }
}
