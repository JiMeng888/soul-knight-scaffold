/**
 * 自动试玩：让机器人用真实 Game 实例连打 N 局，输出「能据以改数值」的数据。
 *
 *   node scripts/playtest.mjs --runs 20
 *   node scripts/playtest.mjs --runs 20 --json docs/playtest-data.json
 *
 * 与 verify 的区别：verify 证明「不会崩」，这里回答「好不好玩」——
 * 死在哪层、被什么打死、一层多久、能量够不够、商店买得起吗、会不会卡住。
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

async function loadTs(rel) {
  const result = await build({
    entryPoints: [resolve(root, rel)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

// ---------------------------------------------------------------- DOM 存根
const noop = () => {};
const makeCtx2d = () => {
  const store = {};
  return new Proxy(store, {
    get: (t, k) => {
      if (k === 'canvas') return { width: 960, height: 540 };
      if (k === 'measureText') return () => ({ width: 10 });
      return t[k] ?? noop;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
};
const makeCanvas = () => {
  const c = makeCtx2d();
  return {
    width: 960, height: 540, style: {},
    getContext: () => c,
    addEventListener: noop,
    removeEventListener: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
  };
};
globalThis.document = { createElement: () => makeCanvas() };
globalThis.window = { innerWidth: 1000, innerHeight: 700, addEventListener: noop, removeEventListener: noop };

const { Game } = await loadTs('src/core/Game.ts');
const { getWeapon } = await loadTs('src/data/weapons.ts');
// bot-core 里 import 了 .ts 配置，直接 import 会因扩展名失败，统一走 esbuild
const { installBot, weaponScore } = await loadTs('scripts/bot-core.mjs');

// ---------------------------------------------------------------- 参数
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const RUNS = Number(arg('runs', 8));
const MAX_LEVELS = Number(arg('max-levels', 40));
const SEED0 = Number(arg('seed0', 1));
const JSON_OUT = arg('json', '');
const VERBOSE = !!arg('verbose', false);
const STEP = 1 / 60;
const LEVEL_STEP_CAP = 60 * 240; // 单层最多 4 分钟游戏时间

const game = new Game(makeCanvas());
const bot = installBot(game, { collectCoins: true });

// ---------------------------------------------------------------- 单局
const runs = [];

function playRun(seed) {
  game.newRun(seed);
  bot.resetForRun();

  const rec = {
    seed,
    levels: [],
    died: false,
    deathLevel: 0,
    deathRoom: '',
    deathBy: null,
    level: 1,
    time: 0,
    kills: 0,
    coins: 0,
    steps: 0,
    stopReason: '',
    stuck: 0,
  };

  let levelStartTime = 0;
  let levelStartKills = 0;
  let levelStartCoins = 0;
  let levelStartDamage = 0;
  let levelDeathCount = 0;

  const snapLevel = (cleared) => {
    const s = bot.stats;
    rec.levels.push({
      level: game.run.level,
      cleared,
      seconds: +(game.run.levelElapsed).toFixed(1),
      kills: game.run.kills - levelStartKills,
      coins: game.run.coins - levelStartCoins,
      damage: s.damageTaken - levelStartDamage,
      hp: Math.round(game.run.hp * 10) / 10,
      armor: Math.round(game.run.armor * 10) / 10,
      maxHp: game.run.maxHp,
      weapons: [...game.run.weapons],
      talents: game.run.talents.length,
      deaths: levelDeathCount,
    });
    levelStartTime = game.run.elapsed;
    levelStartKills = game.run.kills;
    levelStartCoins = game.run.coins;
    levelStartDamage = s.damageTaken;
    levelDeathCount = 0;
  };

  const offs = [];
  offs.push(game.events.on('level:clear', ({ level, seconds }) => {
    if (VERBOSE) console.log(`    L${level} 通过 ${seconds.toFixed(1)}s  HP ${game.run.hp.toFixed(1)}/${game.run.maxHp}`);
    snapLevel(true);
    rec.level = level + 1;
    levelDeathCount = 0;
    levelSteps = 0;
  }));
  offs.push(game.events.on('player:dead', ({ level }) => {
    rec.died = true;
    rec.deathLevel = level;
    rec.deathRoom = game.room.plan.type;
    const ev = bot.stats.damageEvents;
    rec.deathBy = ev.length ? ev[ev.length - 1] : null;
  }));

  let steps = 0;
  let levelSteps = 0;
  const maxSteps = MAX_LEVELS * LEVEL_STEP_CAP;

  while (steps < maxSteps) {
    const beforeLevel = game.run.level;
    const beforeMode = game.mode;

    bot.step();
    try {
      game.update(STEP);
    } catch (e) {
      rec.stopReason = `crash: ${e.message}`;
      break;
    }
    game.input.endFrame();
    steps++;
    levelSteps++;
    levelDeathCount = Math.max(levelDeathCount, 0);

    if (game.mode === 'dead') { rec.stopReason = 'dead'; break; }
    // 到达层数上限就收束：不然后期没有难度上限，机器人能一直打到 100+ 层，
    // 层统计里全是 1 样本的长尾，反而看不出前中期的曲线。
    if (game.run.level > MAX_LEVELS) { rec.stopReason = 'reached-cap'; break; }
    if (bot.done) { rec.stopReason = bot.done; break; }

    // 层切换了但没走 level:clear（理论上不会）：兜底记录
    if (game.run.level !== beforeLevel && beforeMode !== 'talent') {
      // level:clear 已处理，这里不重复
    }
    if (levelSteps > LEVEL_STEP_CAP) {
      rec.stopReason = `level-timeout L${game.run.level}`;
      // 残血怪是不是根本打不到？从房间里每个可站格往它身上打一遍射线，
      // 一个能通的都没有 = 游戏侧不可命中，而不是机器人不会打。
      const tk = game.room;
      const hittable = (e) => {
        let ok = 0;
        for (let y = 1; y <= tk.size; y++) {
          for (let x = 1; x <= tk.size; x++) {
            const c = tk.layerToWorld(x, y);
            if (tk.collides(c.x, c.y, 6)) continue;
            const dx = e.pos.x - c.x, dy = e.pos.y - c.y;
            const len = Math.hypot(dx, dy) || 1;
            const n = Math.max(1, Math.ceil(len / 8));
            let clear = true;
            for (let k = 1; k < n; k++) {
              if (tk.isSolid(c.x + dx * k / n, c.y + dy * k / n)) { clear = false; break; }
            }
            if (clear) ok++;
          }
        }
        return ok;
      };
      rec.timeoutInfo = {
        mode: game.mode,
        room: game.room.plan.type,
        roomId: game.room.plan.id,
        roomState: game.room.state,
        waveCount: game.room.waveCount,
        eliteCount: game.room.eliteCount,
        coinChaseT: +(bot.coinChaseT || 0).toFixed(1),
        player: [Math.round(game.player.pos.x), Math.round(game.player.pos.y)],
        weapon: game.run.currentWeaponId,
        energy: +game.run.energy.toFixed(1),
        enemies: game.enemies.all.filter((e) => e.alive).map((e) => ({
          kind: e.data.id, room: e.roomId, x: Math.round(e.pos.x), y: Math.round(e.pos.y),
          hp: Math.round(e.hp), state: e.state, hittable: hittable(e),
        })),
        visited: game.level.plan.rooms.map((rp) => `${rp.id}:${rp.type}:${game.level.roomById(rp.id).state[0]}`).join(' '),
        goal: bot.inspect().goal,
      };
      // 接管测试：强制对准最近的同房怪物开火 1.5s。
      // 掉血 → 游戏没问题，是机器人瞄不准/没能量；不掉血 → 游戏侧命中或开火有问题。
      const near = game.enemies.all.find((e) => e.alive && e.roomId === game.room.plan.id);
      if (near) {
        const before = near.hp;
        const e0 = game.run.energy;
        let shots = 0;
        const off = game.events.on('shot', () => { shots++; });
        const r = game.renderer;
        for (let k = 0; k < 90; k++) {
          game.input.mouseX = (near.pos.x - r.camX) * r.scale + r.canvas.width / 2;
          game.input.mouseY = (near.pos.y - r.camY) * r.scale + r.canvas.height / 2;
          game.input.firing = true;
          game.update(STEP);
          game.input.endFrame();
        }
        off();
        game.input.firing = false;
        rec.timeoutInfo.aimProbe = {
          kind: near.data.id, before: Math.round(before * 10) / 10,
          after: Math.round(near.hp * 10) / 10, dmg: Math.round((before - near.hp) * 10) / 10,
          shots, energy0: +e0.toFixed(1), energy1: +game.run.energy.toFixed(1),
        };
      }
      snapLevel(false);
      break;
    }
  }

  for (const off of offs) off();

  rec.steps = steps;
  rec.time = +game.run.elapsed.toFixed(1);
  rec.kills = game.run.kills;
  rec.coins = game.run.coins;
  rec.talents = [...game.run.talents];
  rec.stuck = bot.stats.stuck;
  rec.stats = bot.stats;
  rec.stuckEvents = bot.stuckEvents;
  return rec;
}

// ---------------------------------------------------------------- 跑
const t0 = Date.now();
for (let i = 0; i < RUNS; i++) {
  const seed = SEED0 + i;
  const rec = playRun(seed);
  runs.push(rec);
  if (VERBOSE || true) {
    const tag = rec.died ? `死于第 ${rec.deathLevel} 层 (${rec.deathRoom})` : rec.stopReason;
    console.log(`  #${String(seed).padStart(3)} 到第 ${rec.level} 层 · ${rec.time}s · ${rec.kills} 杀 · ${rec.coins} 金 · ${tag}`);
    if (rec.timeoutInfo) console.log('      超时现场:', JSON.stringify(rec.timeoutInfo));
  }
}
const elapsedMs = Date.now() - t0;

// ---------------------------------------------------------------- 聚合
const num = (a) => a.slice().sort((x, y) => x - y);
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const med = (a) => { const b = num(a); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const pct = (a, p) => { const b = num(a); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : 0; };

const reached = runs.map((r) => (r.died ? r.deathLevel : r.level));
const levelRows = [];
for (let L = 1; L <= MAX_LEVELS; L++) {
  const rows = runs.flatMap((r) => r.levels.filter((x) => x.level === L));
  if (!rows.length) break;
  levelRows.push({
    level: L,
    samples: rows.length,
    time: +med(rows.map((x) => x.seconds)).toFixed(1),
    kills: +avg(rows.map((x) => x.kills)).toFixed(1),
    damage: +avg(rows.map((x) => x.damage)).toFixed(1),
    hpEnd: +avg(rows.map((x) => x.hp)).toFixed(1),
    deaths: rows.filter((x) => !x.cleared).length,
  });
}

const allDamage = runs.flatMap((r) => r.stats.damageEvents);
const bySource = {};
for (const d of allDamage) {
  const k = d.nearKind || 'unknown';
  bySource[k] = (bySource[k] || 0) + d.amount;
}
const byRoom = {};
for (const d of allDamage) byRoom[d.room] = (byRoom[d.room] || 0) + d.amount;

const weaponShots = {};
const weaponTime = {};
for (const r of runs) {
  for (const [k, v] of Object.entries(r.stats.shotsByWeapon)) weaponShots[k] = (weaponShots[k] || 0) + v;
  for (const [k, v] of Object.entries(r.stats.timeByWeapon)) weaponTime[k] = (weaponTime[k] || 0) + v;
}
const totalShots = Object.values(weaponShots).reduce((a, b) => a + b, 0) || 1;
const totalTime = Object.values(weaponTime).reduce((a, b) => a + b, 0) || 1;

const talentPicks = {};
for (const r of runs) for (const id of r.talents) talentPicks[id] = (talentPicks[id] || 0) + 1;

const summary = {
  meta: {
    runs: RUNS,
    seeds: [SEED0, SEED0 + RUNS - 1],
    maxLevels: MAX_LEVELS,
    wallMs: elapsedMs,
    stepsPerSecond: Math.round(runs.reduce((s, r) => s + r.steps, 0) / (elapsedMs / 1000)),
  },
  survival: {
    deaths: runs.filter((r) => r.died).length,
    deathRate: +(runs.filter((r) => r.died).length / RUNS).toFixed(2),
    avgLevel: +avg(reached).toFixed(2),
    medLevel: med(reached),
    p90Level: pct(reached, 0.9),
    maxLevel: Math.max(...reached),
    avgTimeSec: +avg(runs.map((r) => r.time)).toFixed(1),
    deathByLevel: runs.filter((r) => r.died).reduce((m, r) => {
      m[r.deathLevel] = (m[r.deathLevel] || 0) + 1; return m;
    }, {}),
  },
  levels: levelRows,
  damage: {
    total: +allDamage.reduce((s, d) => s + d.amount, 0).toFixed(0),
    hits: allDamage.length,
    perRun: +(allDamage.reduce((s, d) => s + d.amount, 0) / RUNS).toFixed(1),
    bySource: Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ kind: k, amount: v })),
    byRoom: Object.entries(byRoom).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ room: k, amount: v })),
    // BOSS 房（exit）伤害占比：P0 加词条/护卫/狂暴/多波次后应明显上升（旧 24%）。
    bossRoomShare: +(byRoom['exit']
      ? byRoom['exit'] / Math.max(1, Object.values(byRoom).reduce((s, v) => s + v, 0)) : 0).toFixed(3),
    biggestHit: allDamage.slice().sort((a, b) => b.amount - a.amount).slice(0, 5),
  },
  economy: {
    coinsPerRun: +avg(runs.map((r) => r.coins)).toFixed(1),
    coinsPerLevel: +(avg(runs.map((r) => r.coins)) / Math.max(1, avg(reached))).toFixed(1),
    shopOpensPerRun: +(avg(runs.map((r) => r.stats.shopOpened))).toFixed(2),
    shopBuysPerRun: +(avg(runs.map((r) => r.stats.shopBought))).toFixed(2),
  },
  energy: {
    firingFrames: runs.reduce((s, r) => s + r.stats.firingFrames, 0),
    starvedFrames: runs.reduce((s, r) => s + r.stats.starvedFrames, 0),
    starvationRate: +(runs.reduce((s, r) => s + r.stats.starvedFrames, 0)
      / Math.max(1, runs.reduce((s, r) => s + r.stats.firingFrames, 0))).toFixed(3),
    // 能量水位（战斗中采样）：反映能量条会不会被打下去、要不要留蓝，
    // 比「连一发都扣不起」的饥饿率更能说明能量是否是决策资源。
    energySamples: runs.reduce((s, r) => s + r.stats.energySamples, 0),
    avgEnergyRatio: +(runs.reduce((s, r) => s + r.stats.energyRatioSum, 0)
      / Math.max(1, runs.reduce((s, r) => s + r.stats.energySamples, 0))).toFixed(3),
    lowWaterRate: +(runs.reduce((s, r) => s + r.stats.lowWaterFrames, 0)
      / Math.max(1, runs.reduce((s, r) => s + r.stats.energySamples, 0))).toFixed(3),
    emptyRate: +(runs.reduce((s, r) => s + r.stats.emptyFrames, 0)
      / Math.max(1, runs.reduce((s, r) => s + r.stats.energySamples, 0))).toFixed(3),
    energyPickupsPerRun: +(runs.reduce((s, r) => s + r.stats.energyPickups, 0) / RUNS).toFixed(1),
    energyGainedPerRun: +(runs.reduce((s, r) => s + r.stats.energyGained, 0) / RUNS).toFixed(1),
  },
  // P0 机制落地观测：精英与多波次是否真的进了实战，而非只停在配置里。
  mechanics: {
    eliteEncountersPerRun: +(runs.reduce((s, r) => s + r.stats.eliteEncounters, 0) / RUNS).toFixed(2),
    multiWaveRoomsPerRun: +(runs.reduce((s, r) => s + r.stats.multiWaveRooms, 0) / RUNS).toFixed(2),
    totalEliteEncounters: runs.reduce((s, r) => s + r.stats.eliteEncounters, 0),
    totalMultiWaveRooms: runs.reduce((s, r) => s + r.stats.multiWaveRooms, 0),
  },
  weapons: {
    topShots: Object.entries(weaponShots).sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({ id, name: getWeapon(id).name, rarity: getWeapon(id).rarity, shots: n, share: +(n / totalShots).toFixed(3) })),
    topTime: Object.entries(weaponTime).sort((a, b) => b[1] - a[1])
      .slice(0, 12).map(([id, t]) => ({ id, name: getWeapon(id).name, sec: +t.toFixed(0), share: +(t / totalTime).toFixed(3) })),
    scoreSpread: (() => {
      const ids = Object.keys(weaponShots);
      const scored = ids.map((id) => ({ id, score: +weaponScore(getWeapon(id)).toFixed(1) }));
      scored.sort((a, b) => b.score - a.score);
      return { best: scored[0], worst: scored[scored.length - 1] };
    })(),
  },
  talents: Object.entries(talentPicks).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n })),
  // P2/P3 分布集中度：四件套霸榜 / 一把枪通吃 的可量化证据。
  concentration: {
    talentTotalPicks: Object.values(talentPicks).reduce((s, n) => s + n, 0),
    talentDistinct: Object.keys(talentPicks).length,
    talentTop4Share: (() => {
      const sorted = Object.values(talentPicks).sort((a, b) => b - a);
      const total = sorted.reduce((s, n) => s + n, 0) || 1;
      return +(sorted.slice(0, 4).reduce((s, n) => s + n, 0) / total).toFixed(3);
    })(),
    weaponTop1Share: (() => {
      const sorted = Object.values(weaponShots).sort((a, b) => b - a);
      return +((sorted[0] || 0) / totalShots).toFixed(3);
    })(),
    weaponTop3Share: (() => {
      const sorted = Object.values(weaponShots).sort((a, b) => b - a);
      return +(sorted.slice(0, 3).reduce((s, n) => s + n, 0) / totalShots).toFixed(3);
    })(),
  },
  stuck: {
    total: runs.reduce((s, r) => s + r.stats.stuck, 0),
    samples: runs.flatMap((r) => r.stuckEvents).slice(0, 10),
  },
};

console.log('\n=== 汇总 ===');
console.log(JSON.stringify(summary.survival, null, 2));
console.log('\n层  样本  中位用时  平均击杀  平均受伤  层末HP  未通过');
for (const r of levelRows) {
  console.log(`L${String(r.level).padStart(2)}  ${String(r.samples).padStart(3)}   ${String(r.time).padStart(7)}s  ${String(r.kills).padStart(8)}  ${String(r.damage).padStart(8)}  ${String(r.hpEnd).padStart(6)}  ${String(r.deaths).padStart(5)}`);
}
console.log('\n伤害来源:', summary.damage.bySource.slice(0, 10).map((x) => `${x.kind}:${x.amount}`).join('  '));
console.log('伤害房间:', summary.damage.byRoom.map((x) => `${x.room}:${x.amount}`).join('  '),
  ` BOSS房占比 ${(summary.damage.bossRoomShare * 100).toFixed(1)}%`);
console.log('能量:', summary.energy);
console.log('商店:', summary.economy);
console.log('P0 机制:', summary.mechanics);
console.log('集中度:', summary.concentration);
console.log('卡住:', summary.stuck.total, JSON.stringify(summary.stuck.samples.slice(0, 4)));
console.log('最高击杀武器:', summary.weapons.topShots.slice(0, 6).map((w) => `${w.name}(${w.rarity}) ${(w.share * 100).toFixed(0)}%`).join(', '));
console.log(`\n耗时 ${(elapsedMs / 1000).toFixed(1)}s · ${summary.meta.stepsPerSecond} 步/秒`);

if (JSON_OUT) {
  const out = resolve(root, JSON_OUT);
  writeFileSync(out, JSON.stringify({ summary, runs: runs.map((r) => ({ ...r, stats: { ...r.stats, damageEvents: r.stats.damageEvents.slice(0, 60) } })) }, null, 2));
  console.log('数据写入', out);
}
