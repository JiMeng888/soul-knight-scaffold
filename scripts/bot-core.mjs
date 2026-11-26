/**
 * 自动试玩机器人（纯逻辑，可在 Node 或浏览器里驱动真实 Game 实例）。
 *
 * 它不做任何「作弊」：只写 Input 的按键状态、鼠标坐标，读 Game 的公开状态，
 * 和人类玩家的输入通道完全一致。这样跑出来的死亡点、卡点、能量枯竭才是真问题。
 *
 * 之所以要一个机器人：单测只能证明「函数返回对」，玩法问题（难度曲线、
 * 资源经济、房间可达性、BOSS 时长）只有在完整对局里才会暴露。
 */
import { getWeapon } from '../src/data/weapons.ts';
import { getShopItem, shopPrice } from '../src/data/shop.ts';
import { talentDecay } from '../src/data/talents.ts';
import { RoomType, DIRS } from '../src/world/DungeonGenerator.ts';

const TILE = 16;
const STEP = 1 / 60;

// ---------------------------------------------------------------- 纯函数工具

/**
 * 武器综合评分：有效 DPS × 机制加成 × 能量可持续性 × 射程可达性。
 * 只用于「换不换枪」的比较和跨度指标，不是平衡表。
 *
 * 旧版有系统性偏差：近战无条件 ×1.3 且完全不扣能量，导致前 6 名里 5 把近战、
 * 破锈铁短剑（21.6）碾压磁暴狙击炮（11.9）；bounce/homing/lifesteal/arc 等机制
 * 则完全不计分。P3 重写：让「机制」和「射程风险」都进评分，跨度才反映真实取舍。
 */
export function weaponScore(w) {
  // 爆炸弹：直击伤害替换为 AOE，按爆炸伤害估等效 DPS（可命中多目标）
  let dps = w.explode ? (w.explodeDamage || 0) * w.fireRate
    : w.damage * (w.pellets || 1) * w.fireRate;
  if (w.burst) dps *= 1 + (w.burst - 1) * 0.5;

  let mech = 1;
  if (w.pierce) mech *= 1 + Math.min(0.5, 0.1 * w.pierce); // 穿透可一发多杀
  if (w.bounce) mech *= 1 + Math.min(0.35, 0.14 * w.bounce); // 弹墙补命中
  if (w.homing) mech *= 1 + Math.min(0.3, w.homing * 0.05); // 追踪补命中
  if (w.explode) mech *= 1.15; // AOE 覆盖面
  if (w.lifesteal) mech *= 1 + Math.min(0.25, w.lifesteal * 0.3); // 续航
  if (w.arc) mech *= 1 + Math.min(0.2, (w.arc - 0.95) * 0.35); // 宽扇形
  dps *= mech;

  // 射程可达性：近战贴脸、喷火极短射程都有代价，不能再白嫖「不耗能」。
  let reach = 1;
  if (w.bulletLife) reach *= 0.62;              // 火焰/龙息：speed×life ≈ 50px
  else if (w.kind === 'melee') reach *= 0.8;    // 近战要贴身，风险高
  dps *= reach;

  const eps = w.energy * w.fireRate * (w.burst || 1);
  const sustain = eps <= 9.5 ? 1 : Math.pow(9.5 / eps, 0.5); // 对齐回能 9.5/s
  return dps * sustain;
}

/** 天赋评分：感知 statStacks 递减 —— 已叠多次的 stat 边际收益下降，
 *  机器人（理性玩家代理）会自然转向别的维度，分布才不会被四件套锁死。 */
function talentScore(t, stacks) {
  let s = 0;
  for (const e of t.effects) {
    const decay = talentDecay(stacks?.[e.stat] ?? 0);
    if (e.add) {
      if (e.stat === 'maxHp') s += e.add * 6 * decay;
      else if (e.stat === 'maxArmor') s += e.add * 7 * decay;
      else if (e.stat === 'maxEnergy') s += e.add * 0.45 * decay;
      else if (e.stat === 'crit') s += e.add * 45 * decay;
      else if (e.stat === 'hpRegen') s += e.add * 11 * decay;
    }
    if (e.mul) {
      if (e.stat === 'damageMul') s += (e.mul - 1) * 62 * decay;
      else if (e.stat === 'fireRateMul') s += (e.mul - 1) * 55 * decay;
      else if (e.stat === 'speed') s += (e.mul - 1) * 28 * decay;
      else if (e.stat === 'critDamageMul') s += (e.mul - 1) * 26 * decay;
      else if (e.stat === 'rollCdMul') s += (1 - e.mul) * 24 * decay;
      else if (e.stat === 'shopDiscountMul') s += (1 - e.mul) * 18 * decay;
      else if (e.stat === 'energyRegenMul') s += (e.mul - 1) * 16 * decay;
      else if (e.stat === 'armorRegenMul') s += (e.mul - 1) * 16 * decay;
      else if (e.stat === 'pickupRangeMul') s += (e.mul - 1) * 7 * decay;
      else if (e.stat === 'coinGainMul') s += (e.mul - 1) * 9 * decay;
    }
  }
  return s;
}

function tileWalkable(room, x, y) {
  const n = room.size + 2;
  if (x < 0 || y < 0 || x >= n || y >= n) return false;
  const c = room.layerToWorld(x, y);
  return !room.isSolid(c.x, c.y);
}

/** 房间网格 BFS（绕柱子）。返回 tile 数组（不含起点），不可达返回 null。 */
function findPath(room, from, to) {
  const n = room.size + 2;
  if (!tileWalkable(room, to.x, to.y)) return null;
  const total = n * n;
  const prev = new Int32Array(total).fill(-1);
  const seen = new Uint8Array(total);
  const start = from.y * n + from.x;
  if (start < 0 || start >= total) return null;
  const goal = to.y * n + to.x;
  seen[start] = 1;
  const q = new Int32Array(total);
  let head = 0, tail = 0;
  q[tail++] = start;
  while (head < tail) {
    const cur = q[head++];
    if (cur === goal) break;
    const cx = cur % n;
    const cy = (cur - cx) / n;
    for (let i = 0; i < 4; i++) {
      const nx = cx + (i === 0 ? 1 : i === 1 ? -1 : 0);
      const ny = cy + (i === 2 ? 1 : i === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const k = ny * n + nx;
      if (seen[k]) continue;
      if (!tileWalkable(room, nx, ny)) continue;
      seen[k] = 1;
      prev[k] = cur;
      q[tail++] = k;
    }
  }
  if (!seen[goal]) return null;
  const out = [];
  let k = goal;
  while (k !== start) {
    const x = k % n;
    out.push({ x, y: (k - x) / n });
    k = prev[k];
    if (k < 0) return null;
  }
  return out.reverse();
}

function lineClear(room, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (TILE * 0.5)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (room.isSolid(ax + dx * t, ay + dy * t)) return false;
  }
  return true;
}

/** 带身体半径的直线可达性：比 lineClear 严格，用来做「拉直路径」。 */
function bodyClear(room, ax, ay, bx, by, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 4));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (room.collides(ax + dx * t, ay + dy * t, r)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- 机器人

export function installBot(game, options = {}) {
  const opts = {
    /** 战斗时希望保持的距离倍率，越小越激进 */
    aggression: 1,
    /** 是否在清房后绕场捡金币 */
    collectCoins: true,
    ...options,
  };

  const bot = {
    stats: null,
    done: false,
    deathInfo: null,
    stuckEvents: [],
    ignored: new Map(),
    goalId: -1,
    unstick: null,
    // P0/P1 观测状态：按 (level:key) 去重，跨房不重复计数
    seenElites: new Set(),      // 已计入的精英敌人 id（避免每帧重复）
    seenWaveRooms: new Set(),   // 已计入的多波次房
    coinChaseT: 0,             // 本房累计「追金币」游戏秒数（房间级硬预算，与战斗时长无关）
    coinTargetId: -1,           // 锁定的金币 id，防 find() 每帧切换导致放弃计时归零
    coinTargetT: 0,             // 锁定目标已追逐时长
  };

  const g = game;

  function resetStats() {
    bot.stats = {
      shots: 0,
      shotsByWeapon: {},
      timeByWeapon: {},
      firingFrames: 0,
      starvedFrames: 0,
      // P1：饥饿率只统计「连一发都扣不起」的极端帧，在大能量池下结构性为 0，
      // 测不到「能量是否影响决策」。改看战斗中能量水位：池子若长期贴满就是摆设。
      energyRatioSum: 0,
      energySamples: 0,
      lowWaterFrames: 0,   // energy/maxEnergy < 0.5 的战斗帧
      emptyFrames: 0,      // energy/maxEnergy < 0.15 的战斗帧
      energyPickups: 0,    // 拾取的能量球个数
      energyGained: 0,     // 拾取的能量点总量
      // P0 机制观测
      eliteEncounters: 0,  // 遭遇的精英怪数（唯一敌人实体）
      multiWaveRooms: 0,   // 进入过的多波次房数
      rolls: 0,
      interactions: 0,
      damageTaken: 0,
      damageEvents: [],
      shopOpened: 0,
      shopBought: 0,
      coinsEarned: 0,
      talentPicks: [],
      levelTimes: [],
      roomTicks: 0,
      stuck: 0,
    };
  }
  resetStats();

  // —— 输入通道（与人类玩家共用同一套 Input）——
  function press(code) { g.input.pressed.add(code); }

  function clearMove() {
    const d = g.input.down;
    d.delete('KeyW'); d.delete('KeyA'); d.delete('KeyS'); d.delete('KeyD');
  }

  /** 按归一化方向设置 8 向按键。 */
  function setMove(vx, vy) {
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) { clearMove(); return; }
    const len = Math.hypot(vx, vy);
    if (len < 0.15) { clearMove(); return; }
    const nx = vx / len;
    const ny = vy / len;
    const d = g.input.down;
    clearMove();
    if (nx > 0.38) d.add('KeyD');
    else if (nx < -0.38) d.add('KeyA');
    if (ny > 0.38) d.add('KeyS');
    else if (ny < -0.38) d.add('KeyW');
  }

  function setAim(wx, wy) {
    const r = g.renderer;
    g.input.mouseX = (wx - r.camX) * r.scale + r.canvas.width / 2;
    g.input.mouseY = (wy - r.camY) * r.scale + r.canvas.height / 2;
  }

  // —— 统计钩子 ——
  let currentRoomKind = 'start';
  g.events.on('shot', ({ id }) => {
    const s = bot.stats;
    s.shots++;
    s.shotsByWeapon[id] = (s.shotsByWeapon[id] || 0) + 1;
  });
  g.events.on('pickup', ({ kind, amount }) => {
    if (kind === 'coin') bot.stats.coinsEarned += amount;
    if (kind === 'energy') { bot.stats.energyPickups++; bot.stats.energyGained += amount; }
  });
  g.events.on('shop:open', () => { bot.stats.shopOpened++; });
  g.events.on('shop:buy', () => { bot.stats.shopBought++; });
  g.events.on('talent:grant', ({ id }) => { bot.stats.talentPicks.push(id); });
  g.events.on('room:enter', ({ roomId }) => {
    const rp = g.level.plan.rooms[roomId];
    currentRoomKind = rp ? rp.type : '?';
    bot.coinFails = 0;
    bot.goalId = -1;
    bot.goalT = 0;
    // 房间级金币预算归零 + 清空金币锁定；多波次房按 (层:房) 去重计一次。
    bot.coinChaseT = 0;
    bot.coinTargetId = -1;
    bot.coinTargetT = 0;
    if ((g.room.waveCount || 1) > 1) {
      const key = `${g.run.level}:${roomId}`;
      if (!bot.seenWaveRooms.has(key)) { bot.seenWaveRooms.add(key); bot.stats.multiWaveRooms++; }
    }
  });

  const originalApply = g.player.applyDamage.bind(g.player);
  g.player.applyDamage = (info) => {
    const before = g.run.hp + g.run.armor;
    originalApply(info);
    const after = g.run.hp + g.run.armor;
    if (after >= before) return;
    const s = bot.stats;
    s.damageTaken += before - after;
    let near = null;
    let nd = Infinity;
    for (const e of g.enemies.all) {
      if (!e.alive || e.roomId !== g.room.plan.id) continue;
      const d = Math.hypot(e.pos.x - g.player.pos.x, e.pos.y - g.player.pos.y);
      if (d < nd) { nd = d; near = e; }
    }
    s.damageEvents.push({
      level: g.run.level,
      room: currentRoomKind,
      amount: before - after,
      hp: g.run.hp,
      armor: g.run.armor,
      nearKind: near ? near.data.id : null,
      nearDist: Math.round(nd),
      bombs: g.projectiles.all.filter((b) => b.alive && b.faction === 'enemy').length,
    });
  };

  // —— 面板选择 ——
  function pickTalent() {
    const list = g.talentChoices || [];
    if (!list.length) return;
    let best = 0;
    let bs = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const s = talentScore(list[i], g.run.statStacks);
      if (s > bs) { bs = s; best = i; }
    }
    press(`Digit${best + 1}`);
  }

  function wantShopItem(item) {
    const run = g.run;
    switch (item.effect.kind) {
      case 'heal': return run.hp < run.maxHp * 0.75;
      case 'fullHeal': return run.hp < run.maxHp * 0.9;
      case 'fullArmor': return run.armor < run.maxArmor * 0.6;
      case 'fullEnergy': return run.energy < run.maxEnergy * 0.5;
      case 'weapon': return true;
      case 'talent': return true;
      case 'maxHp':
      case 'maxArmor': return true;
      default: return true;
    }
  }

  function doShop() {
    const room = g.room;
    const run = g.run;
    const slots = room.shopStock || [];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.sold) continue;
      const item = getShopItem(slot.itemId);
      const price = shopPrice(item, run.level, run.shopDiscountMul);
      if (price > run.coins) continue;
      if (!wantShopItem(item)) continue;
      press(`Digit${i + 1}`);
      return;
    }
    press('Escape');
  }

  // —— 战斗 ——
  function fight(enemies) {
    const run = g.run;
    const p = g.player;
    const room = g.room;
    const w = getWeapon(run.currentWeaponId);

    let target = null;
    let best = Infinity;
    for (const e of enemies) {
      if (!e.alive || e.hp <= 0) continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
      const weight = e.data.scale === 2 ? d * 0.55 : d;
      if (weight < best) { best = weight; target = e; }
    }
    if (!target) { clearMove(); return; }

    const dx = target.pos.x - p.pos.x;
    const dy = target.pos.y - p.pos.y;
    const d = Math.hypot(dx, dy) || 1;

    // 提前量：慢速子弹打移动目标要打身前
    const travel = d / Math.max(120, w.speed || 260);
    const lead = w.kind === 'melee' ? 0 : Math.min(0.55, travel * 0.8);
    const aimX = target.pos.x + (target.vel.x || 0) * lead;
    const aimY = target.pos.y + (target.vel.y || 0) * lead;
    setAim(aimX, aimY);

    // 开火判定：射程内 + 有视线；能量不够就别按扳机（省得一直空转）
    // 射程要按弹道寿命算：火焰喷射器 150×0.34 = 51px、龙息 180×0.42 = 76px，
    // 固定按 250 判会站在够不到的距离一直扣扳机 —— 空烧能量、零伤害、整层超时。
    const burst = w.burst || 1;
    const effRange = w.kind === 'melee' ? w.range + 10 : (w.bulletLife ? w.speed * w.bulletLife : 250);
    const reach = Math.min(260, Math.max(24, effRange));
    const cost = w.energy * (w.burst || 1);
    const hasEnergy = run.energy >= cost;
    const los = w.kind === 'melee' || lineClear(room, p.pos.x, p.pos.y, aimX, aimY);
    const wantFire = d < reach && hasEnergy && los;
    g.input.firing = wantFire;
    if (wantFire) bot.stats.firingFrames++;
    else if (d < reach && !hasEnergy) bot.stats.starvedFrames++;

    // 希望保持的距离：近战贴身，霰弹近，狙击远
    let desired = 108;
    if (w.kind === 'melee') desired = w.range * 0.55;
    else if (w.pellets >= 4) desired = 62;
    else if (w.fireRate < 1.2) desired = 145;
    desired *= opts.aggression;
    // 站位距离必须被「真实射程」压住：短射程武器要贴身，长射程武器才拉开。
    const cap = w.kind === 'melee' ? 40 : Math.max(26, reach * 0.7);
    desired = Math.max(18, Math.min(desired, cap));

    // 躲子弹：来向 34px 内且正在靠近就翻滚，方向垂直于弹道
    for (const b of g.projectiles.all) {
      if (!b.alive || b.faction !== 'enemy') continue;
      const bd = Math.hypot(b.pos.x - p.pos.x, b.pos.y - p.pos.y);
      if (bd > 34) continue;
      const closing = (b.vel.x * (p.pos.x - b.pos.x) + b.vel.y * (p.pos.y - b.pos.y)) > 0;
      if (!closing) continue;
      const perp = Math.atan2(b.vel.y, b.vel.x) + Math.PI / 2;
      setMove(Math.cos(perp), Math.sin(perp));
      press('Space');
      bot.stats.rolls++;
      return;
    }
    // 近身起手也要躲：贴着蓄力怪时翻滚拉开
    if (target.state === 'windup' && d < 46 && w.kind !== 'melee') {
      setMove(-dx, -dy);
      press('Space');
      bot.stats.rolls++;
      return;
    }

    // 走位：绕柱子用 BFS 到「敌人周围合适距离」的格子，比直线推更不容易卡死
    bot.combatRepath = (bot.combatRepath || 0) - STEP;
    // 长时间没有射线（敌人在柱子背面）：直接贴过去，别在原地反复找角度
    if (!los) bot.noLosT = (bot.noLosT || 0) + STEP; else bot.noLosT = 0;

    // 「能打到」= 有射线 + 身体能直线走过去 + 距离够。
    // 只判 los 不够：柱子拐角处射线擦边能过，身体却过不去，
    // 这时若走直线兜底就是对着墙推 —— 位置一格不动，看起来像卡死。
    const straightOk = bodyClear(room, p.pos.x, p.pos.y, target.pos.x, target.pos.y, p.radius);
    const inReach = d <= reach * 0.95;

    if (inReach && straightOk) bot.path = null; // 已经能输出，专心走位
    else if (bot.combatRepath <= 0 || !bot.path || bot.combatTarget !== target.id) {
      bot.combatRepath = 0.45;
      bot.combatTarget = target.id;
      bot.path = null;
      const around = [];
      const radii = bot.noLosT > 0.8 ? [26, 40, desired * 0.6, desired] : [desired, desired * 0.7, desired * 1.2];
      for (const rad of radii) {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const gx = target.pos.x + Math.cos(a) * rad;
          const gy = target.pos.y + Math.sin(a) * rad;
          if (room.collides(gx, gy, 7)) continue;
          if (!lineClear(room, gx, gy, target.pos.x, target.pos.y)) continue;
          around.push({ x: gx, y: gy, score: Math.hypot(gx - p.pos.x, gy - p.pos.y) });
        }
        if (around.length) break;
      }
      around.sort((a, b) => a.score - b.score);
      const pick = around[0];
      if (pick) {
        const from = tileOf(room, p.pos);
        const to = tileOf(room, pick);
        const path = findPath(room, from, to);
        if (path) { bot.path = path; bot.pathIdx = 0; }
      } else {
        // 连一圈都没有可站的点：直接往敌人所在格贴（会绕柱子）
        const path = findPath(room, tileOf(room, p.pos), tileOf(room, target.pos));
        if (path) { bot.path = path; bot.pathIdx = 0; }
      }
    }

    let movedByPath = false;
    if (bot.path) movedByPath = followPath(room);
    if (!movedByPath) {
      if (!inReach && !straightOk) {
        // 目标在墙后、身体过不去：横着挪一步找角度，别正对着柱子推
        setMove(-dy, dx);
      } else if (d > desired + 18) setMove(dx, dy);
      else if (d < desired - 22) setMove(-dx, -dy);
      else {
        bot.strafeTimer = (bot.strafeTimer || 0) - STEP;
        if (bot.strafeTimer <= 0) { bot.strafeTimer = 1.2; bot.strafe = -(bot.strafe || 1); }
        setMove(-dy * (bot.strafe || 1), dx * (bot.strafe || 1));
      }
    }
    bot.dbg = {
      branch: 'fight', d: Math.round(d), desired: Math.round(desired), los, hasEnergy,
      wantFire, pathLen: bot.path ? bot.path.length : -1, pathIdx: bot.pathIdx,
      keys: [...g.input.down], target: target.data.id, dx: Math.round(dx), dy: Math.round(dy),
    };
  }

  // —— 导航 ——
  function tileOf(room, pos) {
    return {
      x: Math.floor((pos.x - room.origin.x) / TILE),
      y: Math.floor((pos.y - room.origin.y) / TILE),
    };
  }

  function followPath(room) {
    const p = g.player;
    while (bot.path && bot.pathIdx < bot.path.length) {
      // 拉直：找到最远的、身体能直线走到的路点，避免逐格贴角走
      let k = bot.pathIdx;
      for (let j = bot.path.length - 1; j > bot.pathIdx; j--) {
        const cj = room.layerToWorld(bot.path[j].x, bot.path[j].y);
        if (bodyClear(room, p.pos.x, p.pos.y, cj.x, cj.y, p.radius)) { k = j; break; }
      }
      const wp = bot.path[k];
      const c = room.layerToWorld(wp.x, wp.y);
      const dx = c.x - p.pos.x;
      const dy = c.y - p.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 8) {
        bot.pathIdx = k + 1;
        continue;
      }
      bot.pathIdx = k;
      const sx = Math.abs(dx) < 1.5 ? 0 : Math.sign(dx);
      const sy = Math.abs(dy) < 1.5 ? 0 : Math.sign(dy);
      const r = p.radius;
      const freeX = sx !== 0 && !room.collides(p.pos.x + sx * 7, p.pos.y, r);
      const freeY = sy !== 0 && !room.collides(p.pos.x, p.pos.y + sy * 7, r);
      // 正交优先：先取距离大的那根轴，走齐了再走另一根。
      // 斜向虽然快，但 8 向离散输入在柱子拐角会两轴同时吃墙，
      // 表现出来就是「原地抖动」——机器人卡住的绝大部分时间都耗在这里。
      if (Math.abs(dx) >= 3 && freeX) setMove(dx, 0);
      else if (Math.abs(dy) >= 3 && freeY) setMove(0, dy);
      else if (sx !== 0 && sy !== 0 && freeX && freeY
        && !room.collides(p.pos.x + sx * 7, p.pos.y + sy * 7, r)) setMove(dx, dy);
      else {
        // 两轴都堵（贴住柱子拐角）：沿一个「随机但稳定 0.4 秒」的方向蹭出去。
        // 每帧随机换方向会原地左右抖动，看起来像在走其实位移为零。
        const now = g.run.elapsed;
        if (!bot.unstick || bot.unstick.until < now) {
          const a = Math.random() * Math.PI * 2;
          bot.unstick = { x: Math.cos(a), y: Math.sin(a), until: now + 0.4 };
        }
        setMove(bot.unstick.x, bot.unstick.y);
        bot.path = null;
      }
      return true;
    }
    bot.path = null;
    clearMove();
    return false;
  }

  function goalTile(room, worldPos) {
    const t = tileOf(room, worldPos);
    if (tileWalkable(room, t.x, t.y)) return t;
    // 目标点本身在墙里（比如掉在柱子上的掉落）：找最近可走格
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (tileWalkable(room, t.x + dx, t.y + dy)) return { x: t.x + dx, y: t.y + dy };
        }
      }
    }
    return t;
  }

  function inRoom(room, pos) {
    const w = room.worldW;
    return pos.x >= room.origin.x && pos.x <= room.origin.x + w
      && pos.y >= room.origin.y && pos.y <= room.origin.y + w;
  }

  function pickupsHere(room) {
    const out = [];
    for (const pk of g.pickups.all) {
      if (!pk.alive) continue;
      if (!inRoom(room, pk.pos)) continue;
      out.push(pk);
    }
    return out;
  }

  function roomGraphNext(fromId, toId) {
    const plan = g.level.plan;
    if (fromId === toId) return -1;
    const prev = new Map([[fromId, -1]]);
    const q = [fromId];
    while (q.length) {
      const id = q.shift();
      if (id === toId) break;
      const rp = plan.rooms[id];
      if (!rp) continue;
      for (const dir of DIRS) {
        const nb = rp.doors[dir];
        if (nb === undefined || prev.has(nb)) continue;
        prev.set(nb, id);
        q.push(nb);
      }
    }
    if (!prev.has(toId)) return -1;
    let cur = toId;
    while (prev.get(cur) !== fromId && prev.get(cur) !== -1) cur = prev.get(cur);
    return cur;
  }

  function dirTo(fromId, nextId) {
    const rp = g.level.plan.rooms[fromId];
    if (!rp) return null;
    for (const dir of DIRS) if (rp.doors[dir] === nextId) return dir;
    return null;
  }

  /** 目标房间：先把宝箱/战斗逛完，再去奖励房和商店，最后 EXIT。 */
  function chooseTargetRoom() {
    const plan = g.level.plan;
    const cur = g.room.plan.id;
    const order = [RoomType.TREASURE, RoomType.COMBAT, RoomType.BONUS, RoomType.SHOP];
    for (const type of order) {
      for (const rp of plan.rooms) {
        if (rp.type !== type) continue;
        // 没钱进商店纯属浪费脚程（叶子房还要原路返回）
        if (type === RoomType.SHOP && g.run.coins < 20) continue;
        const room = g.level.roomById(rp.id);
        if (room && room.state === 'unvisited') return rp.id;
      }
    }
    if (cur !== plan.exitId) return plan.exitId;
    return -1;
  }

  function bestWeaponWish(run) {
    // 只捡「比手上最弱那把更强」的枪，避免机器人拿白装换掉橙装
    let weakest = Infinity;
    for (const id of run.weapons) weakest = Math.min(weakest, weaponScore(getWeapon(id)));
    if (run.weapons.length < 2) return Infinity;
    return weakest * 1.02;
  }

  function interactTarget(room) {
    const p = g.player;
    const run = g.run;
    const list = pickupsHere(room);
    const want = bestWeaponWish(run);
    let best = null;
    let bestScore = -Infinity;
    for (const pk of list) {
      if ((bot.ignored.get(pk.id) || 0) > g.run.elapsed) continue;
      const d = Math.hypot(pk.pos.x - p.pos.x, pk.pos.y - p.pos.y);
      let score = -1;
      if (pk.kind === 'weapon') {
        const w = getWeapon(pk.payload);
        if (weaponScore(w) < want) continue;
        score = 100;
      } else if (pk.kind === 'chest') score = 90;
      else if (pk.kind === 'shrine') score = 80;
      else if (pk.kind === 'portal') score = 70;
      else if (pk.kind === 'shopkeeper') {
        if (bot.shopDone === room.plan.id) continue;
        // 没钱就别进商店浪费时间
        let affordable = false;
        for (const slot of room.shopStock || []) {
          if (slot.sold) continue;
          const item = getShopItem(slot.itemId);
          if (shopPrice(item, run.level, run.shopDiscountMul) <= run.coins) { affordable = true; break; }
        }
        if (!affordable) continue;
        score = 85;
      } else continue;
      score -= d * 0.25;
      if (score > bestScore) { bestScore = score; best = pk; }
    }
    return best;
  }

  function walkTo(room, wx, wy) {
    const p = g.player;
    const key = `${room.plan.id}:${Math.round(wx)}:${Math.round(wy)}`;
    if (bot.pathGoal !== key || !bot.path) {
      const from = tileOf(room, p.pos);
      const to = goalTile(room, { x: wx, y: wy });
      const path = findPath(room, from, to);
      bot.pathGoal = key;
      if (!path) { setMove(wx - p.pos.x, wy - p.pos.y); return false; }
      bot.path = path;
      bot.pathIdx = 0;
    }
    followPath(room);
    return true;
  }

  // —— 主 step ——
  bot.step = function step() {
    const mode = g.mode;
    bot.dbg = { branch: `mode:${mode}` };
    if (mode === 'menu') { press('Enter'); return; }
    if (mode === 'talent') { pickTalent(); return; }
    if (mode === 'shop') { doShop(); return; }
    if (mode === 'dead') { bot.done = true; return; }
    if (mode !== 'playing') return;

    const s = bot.stats;
    const run = g.run;
    const p = g.player;
    const room = g.room;

    s.roomTicks++;

    // 武器持有时长
    const wid = run.currentWeaponId;
    s.timeByWeapon[wid] = (s.timeByWeapon[wid] || 0) + STEP;

    const enemies = [];
    for (const e of g.enemies.all) {
      if (e.alive && e.hp > 0 && e.roomId === room.plan.id) {
        enemies.push(e);
        // P0：精英遭遇按敌人全局唯一 id 去重计一次（对象池 id 单调递增不复用）。
        if (e.affixes && e.affixes.length && !bot.seenElites.has(e.id)) {
          bot.seenElites.add(e.id);
          s.eliteEncounters++;
        }
      }
    }

    if (enemies.length) {
      // P1：能量水位采样只在「战斗帧」——idle 时能量自然回满，混进去会把水位抬高，
      // 掩盖「连续交战能不能把蓝打下去」这个真问题。
      const ratio = run.maxEnergy > 0 ? run.energy / run.maxEnergy : 1;
      s.energyRatioSum += ratio;
      s.energySamples++;
      if (ratio < 0.5) s.lowWaterFrames++;
      if (ratio < 0.15) s.emptyFrames++;
      // 注意：这里不能每帧清 path，否则 BFS 绕柱子的路径只生效一帧，
      // 之后永远退回直线走位 —— 会被柱子卡在同一行来回滑动打不到 BOSS。
      fight(enemies);
      return;
    }

    g.input.firing = false;

    // 清房后：先拿东西，再走门 / 进传送门
    const walk = (wx, wy, tag) => {
      bot.lastGoal = { tag, wx: Math.round(wx), wy: Math.round(wy), path: bot.path ? bot.path.length : 0 };
      walkTo(room, wx, wy);
    };

    const target = interactTarget(room);
    if (target) {
      const d = Math.hypot(target.pos.x - p.pos.x, target.pos.y - p.pos.y);
      // 长时间拿不到的掉落（卡在柱子夹角/不可达点）就先放弃，别把整层拖成超时
      if (bot.goalId !== target.id) {
        bot.goalId = target.id;
        bot.goalBest = d;
        bot.goalT = 0;
      } else {
        bot.goalT = (bot.goalT || 0) + STEP;
        bot.goalBest = Math.min(bot.goalBest ?? d, d);
        if (bot.goalT > 6 && d > 44) {
          bot.ignored.set(target.id, Infinity);
          bot.goalId = -1;
          s.stuck++;
          bot.stuckEvents.push({
            level: run.level, room: room.plan.type, target: target.kind,
            x: Math.round(p.pos.x), y: Math.round(p.pos.y),
          });
        }
      }
      const reach = target.kind === 'shopkeeper' ? 26 : 22;
      if (d < reach) {
        // 换枪前先切到较弱的槽位，避免把好枪换掉
        if (target.kind === 'weapon' && run.weapons.length >= 2) {
          const cur = getWeapon(run.currentWeaponId);
          const other = getWeapon(run.weapons[(run.weaponIndex + 1) % 2]);
          if (weaponScore(cur) > weaponScore(other)) { press('KeyQ'); }
        }
        press('KeyE');
        s.interactions++;
        if (target.kind === 'shopkeeper') bot.shopDone = room.plan.id;
        return;
      }
      // 走进拾取范围
      walk(target.pos.x, target.pos.y, `pickup:${target.kind}`);
      // 卡住检测：1.4 秒内位移过小就换条路（记录一次真实卡点）
      if (bot.lastPos) {
        const moved = Math.hypot(p.pos.x - bot.lastPos.x, p.pos.y - bot.lastPos.y);
        if (moved < 4) {
          bot.stuckTimer = (bot.stuckTimer || 0) + STEP;
          if (bot.stuckTimer > 1.4) {
            s.stuck++;
            bot.stuckEvents.push({
              level: run.level, room: room.plan.type, target: target.kind,
              x: Math.round(p.pos.x), y: Math.round(p.pos.y),
            });
            bot.stuckTimer = 0;
            bot.path = null;
          }
        } else bot.stuckTimer = 0;
      }
      bot.lastPos = { x: p.pos.x, y: p.pos.y };
      return;
    }

    // 传送门：本层已清完（BOSS 房清空后才会生成）
    const portal = pickupsHere(room).find((pk) => pk.kind === 'portal');
    if (portal) {
      const d = Math.hypot(portal.pos.x - p.pos.x, portal.pos.y - p.pos.y);
      if (d < 22) { press('KeyE'); s.interactions++; return; }
      walk(portal.pos.x, portal.pos.y, 'portal');
      return;
    }

    // 清房后顺路捡金币（磁吸半径 46，走到附近就会吸过来）。
    //
    // 根治整层超时：P0 多波次让每波怪都掉金币，清房后满地 coin/energy。旧逻辑用
    // find() 每帧挑「第一个 150px 内的」目标，玩家一动 find 结果就变 → goalT 反复
    // 归零 → 3 秒放弃永不触发、coinFails 永不增长 → 在一地金币间无限巡游。verbose
    // 复现的超时现场全是 roomState=cleared / enemies=[] / goal:coin / 能量爆满，
    // 恰好印证「不是打不动，是捡不完」。三处结构性修复：
    //   ① 目标锁定：认准一颗追到手/放弃才换，find 不再每帧漂移；
    //   ② 房间级硬预算：本房追金币累计 > COIN_ROOM_BUDGET 秒就直接走门，
    //      与战斗时长解耦（不能用「进房时间」，战斗会把预算吃光）；
    //   ③ 保留 3 次放弃上限作为兜底。
    const COIN_ROOM_BUDGET = 5; // 游戏秒
    if (opts.collectCoins && (bot.coinFails || 0) < 3
        && bot.coinChaseT < COIN_ROOM_BUDGET) {
      // 已锁定的目标若还在场就继续追（含被忽略判断），否则挑一颗最近的新目标。
      let coin = null;
      if (bot.coinTargetId >= 0) {
        coin = pickupsHere(room).find((pk) => pk.id === bot.coinTargetId
          && (bot.ignored.get(pk.id) || 0) <= g.run.elapsed) || null;
      }
      if (!coin) {
        let bestD = 150;
        for (const pk of pickupsHere(room)) {
          if (pk.kind !== 'coin' && pk.kind !== 'energy') continue;
          if ((bot.ignored.get(pk.id) || 0) > g.run.elapsed) continue;
          const dd = Math.hypot(pk.pos.x - p.pos.x, pk.pos.y - p.pos.y);
          if (dd < bestD) { bestD = dd; coin = pk; }
        }
        bot.coinTargetId = coin ? coin.id : -1;
        bot.coinTargetT = 0;
      }
      if (coin) {
        const d = Math.hypot(coin.pos.x - p.pos.x, coin.pos.y - p.pos.y);
        if (d > 26) {
          bot.coinChaseT += STEP;
          bot.coinTargetT += STEP;
          // 单颗追 2.5s 还够不到（卡柱子/不可达）就永久放弃，计入 3 次上限。
          if (bot.coinTargetT > 2.5) {
            bot.ignored.set(coin.id, Infinity);
            bot.coinTargetId = -1;
            bot.coinTargetT = 0;
            bot.coinFails = (bot.coinFails || 0) + 1;
          } else {
            walk(coin.pos.x, coin.pos.y, 'coin');
            return;
          }
        }
      }
    }

    // 去下一个房间：先算出「通往目标房的下一跳」，再走向对应那扇门。
    // 之前只处理了相邻房，目标隔两间时 dir 为 null，机器人会原地站到超时。
    const goalRoom = chooseTargetRoom();
    if (goalRoom < 0) { clearMove(); return; }
    const hop = roomGraphNext(room.plan.id, goalRoom);
    const dir = hop >= 0 ? dirTo(room.plan.id, hop) : null;
    if (!dir) { clearMove(); return; }
    const door = room.doorWorld(dir);
    const dd = Math.hypot(door.x - p.pos.x, door.y - p.pos.y);
    if (dd < 10) { /* 门会在地板检测里自动触发 */ }
    walk(door.x, door.y, `door:${dir}->${hop}`);

    // 走门途中的卡点检测
    if (bot.lastPos) {
      const moved = Math.hypot(p.pos.x - bot.lastPos.x, p.pos.y - bot.lastPos.y);
      if (moved < 4) {
        bot.stuckTimer = (bot.stuckTimer || 0) + STEP;
        if (bot.stuckTimer > 1.6) {
          s.stuck++;
          bot.stuckEvents.push({
            level: run.level, room: room.plan.type, target: `door:${dir}`,
            x: Math.round(p.pos.x), y: Math.round(p.pos.y),
          });
          bot.stuckTimer = 0;
          bot.path = null;
          setMove(Math.random() * 2 - 1, Math.random() * 2 - 1);
        }
      } else bot.stuckTimer = 0;
    }
    bot.lastPos = { x: p.pos.x, y: p.pos.y };
  };

  bot.resetForRun = function resetForRun() {
    bot.path = null;
    bot.pathIdx = 0;
    bot.pathGoal = null;
    bot.combatTarget = -1;
    bot.lastGoal = null;
    bot.combatRepath = 0;
    bot.shopDone = -1;
    bot.lastPos = null;
    bot.stuckTimer = 0;
    bot.goalId = -1;
    bot.goalT = 0;
    bot.goalBest = 0;
    bot.coinFails = 0;
    bot.coinChaseT = 0;
    bot.coinTargetId = -1;
    bot.coinTargetT = 0;
    bot.seenElites = new Set();
    bot.seenWaveRooms = new Set();
    bot.ignored = new Map();
    bot.unstick = null;
    bot.done = false;
    bot.stuckEvents = [];
    resetStats();
  };

  bot.inspect = function inspect() {
    const room = g.room;
    return {
      mode: g.mode,
      level: g.run.level,
      roomId: room.plan.id,
      roomType: room.plan.type,
      roomState: room.state,
      pos: [Math.round(g.player.pos.x), Math.round(g.player.pos.y)],
      posExact: [+g.player.pos.x.toFixed(2), +g.player.pos.y.toFixed(2)],
      gameTime: +g.time.toFixed(2),
      curRoomId: g.level.currentRoomId,
      enemies: g.enemies.all.filter((e) => e.alive && e.roomId === room.plan.id).length,
      enemyInfo: g.enemies.all.filter((e) => e.alive && e.roomId === room.plan.id)
        .map((e) => `${e.data.id}@${Math.round(e.pos.x)},${Math.round(e.pos.y)} hp${Math.round(e.hp)} ${e.state}`),
      goal: bot.lastGoal,
      pathLeft: bot.path ? bot.path.length - bot.pathIdx : -1,
      keys: [...g.input.down],
      vel: [Math.round(g.player.vel.x), Math.round(g.player.vel.y)],
      pstate: g.player.state,
      pathGoal: bot.pathGoal,
      doorCooldown: +room.doorCooldown.toFixed(2),
      dbg: bot.dbg,
    };
  };

  return bot;
}
