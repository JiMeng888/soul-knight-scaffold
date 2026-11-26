/**
 * 生成器 / 交互仲裁 / 相机跟随回归压测 —— `npm run verify`
 *
 * 背景：商店/奖励房曾因「按序抢位置」在过半楼层静默缺失，而当时的自检
 * 根本不检查它们、F3 永远显示 OK；一次性手工压测跑完就删，下次改生成器
 * 又会悄悄退化。所以把压测固化成常驻脚本，并故意用极端参数逼出降级路径。
 * 后来镜头锁房间中心导致「走到门口看不到出口」，也把相机目标做成纯函数
 * 在这里逐点校验，避免再次靠肉眼发现。
 *
 * 零临时文件：esbuild 把 TS 打成纯 ESM 字符串，用 data: URL 动态 import。
 * 不引入新依赖（esbuild 是 vite 的传递依赖）。
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const gen = await loadTs('src/world/DungeonGenerator.ts');
const ia = await loadTs('src/core/interaction.ts');
const cm = await loadTs('src/render/camera.ts');
const ta = await loadTs('src/data/talents.ts');
const rs = await loadTs('src/state/RunState.ts');
const ch = await loadTs('src/data/characters.ts');
const pn = await loadTs('src/ui/Panels.ts');
const bal = await loadTs('src/data/balance.ts');
const wp = await loadTs('src/data/weapons.ts');
const rt = await loadTs('src/data/rarity.ts');
const en = await loadTs('src/data/enemies.ts');
const spr = await loadTs('src/render/SpriteAtlas.ts');
const rngMod = await loadTs('src/core/RNG.ts');
const { generateLevel, validatePlan, GUARANTEED_TYPES } = gen;
const { pickInteractTarget } = ia;
const { cameraTarget } = cm;
const { TALENTS, TALENT_IDS, rollTalentChoices, talentDecay } = ta;
const { RunState } = rs;
const { getCharacter } = ch;
const { CARD, cardRect } = pn;
const { BALANCE, VIEW_W: BAL_VIEW_W } = bal;
const { WEAPONS, LOOT_WEAPONS, weaponsOfRarity, rollWeapon } = wp;
const { RARITIES, RARITY_ORDER, rarityColor, rarityIndex } = rt;
const { ENEMIES, ENEMY_IDS, SPAWN_TABLE, rollEnemy, bossForLevel } = en;
const af = await loadTs('src/data/affixes.ts');
const sh = await loadTs('src/data/shop.ts');
const { AFFIXES, AFFIX_IDS, eliteChance, dualAffixChance, rollAffixes } = af;
const { SHOP_ITEMS, priceOf } = sh;
const { SPRITE_IDS } = spr;
const { RNG } = rngMod;

const SEEDS = 200;
const LEVELS = 12;
let plans = 0, issueCount = 0, missing = 0, badExit = 0;
let normalFallback = 0, stressFallback = 0;
const samples = [];

function checkPlan(seed, level, config, tag, stress) {
  plans++;
  let plan;
  try {
    plan = generateLevel(seed, level, config);
  } catch (e) {
    issueCount++;
    if (samples.length < 8) samples.push(`[${tag}] seed=${seed} level=${level} THREW ${e.message}`);
    return;
  }
  if (plan.fallbackCount > 0) {
    if (stress) stressFallback++; else normalFallback++;
  }
  const issues = validatePlan(plan);
  if (issues.length) {
    issueCount++;
    if (samples.length < 8) samples.push(`[${tag}] seed=${seed} level=${level}: ${issues.join(' | ')}`);
  }
  for (const t of GUARANTEED_TYPES) {
    if (plan.rooms.filter((r) => r.type === t).length !== 1) missing++;
  }
  const exit = plan.rooms.find((r) => r.id === plan.exitId);
  if (!exit || exit.id === plan.startId) badExit++;
}

// 常规：200 种子 × 12 层
for (let s = 0; s < SEEDS; s++) {
  const seed = (Math.imul(s + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
  for (let lv = 1; lv <= LEVELS; lv++) checkPlan(seed, lv, undefined, 'normal', false);
}

// 压力：拉长主干 / 缩小网格，逼出「空位耗尽 → 就地改类型」降级路径，
// 验证即使这样保证房仍齐全、门图仍是树、自检仍零异常。
const STRESS = [
  { mainLen: 24 },
  { mainLen: 24, grid: 4 },
  { mainLen: 40, grid: 3 },
];
for (const cfg of STRESS) {
  for (let s = 0; s < 40; s++) {
    const seed = (Math.imul(s + 1, 40503) ^ 0x5bf03635) >>> 0;
    for (let lv = 1; lv <= 4; lv++) checkPlan(seed, lv, cfg, `stress ${JSON.stringify(cfg)}`, true);
  }
}

// 同 seed 可复现：关卡生成不允许用 Math.random
const a = generateLevel(1234567, 5);
const b = generateLevel(1234567, 5);
const reproducible = JSON.stringify(a) === JSON.stringify(b);

// 交互仲裁单测：一次 E 只能返回一个目标，且必须是最近的那个。
// 这条直接锁死「一次 E 双消费」——早期靠拉开距离规避，天赋一放大半径就失效。
const P = { x: 0, y: 0 };
const near = [{ id: 11, pos: { x: 2, y: 0 }, reachBonus: 10 }];
const overlap = [
  { id: 21, pos: { x: 3, y: 0 }, reachBonus: 10 },
  { id: 22, pos: { x: 1, y: 0 }, reachBonus: 10 },
  { id: 23, pos: { x: 2, y: 1 }, reachBonus: 14 },
];
const iaCases = [
  ['没按 E 返回 -1', pickInteractTarget(false, P, 24, 1, overlap) === -1],
  ['单个候选命中', pickInteractTarget(true, P, 24, 1, near) === 11],
  ['三个重叠候选只返回最近的', pickInteractTarget(true, P, 24, 1, overlap) === 22],
  ['拾取范围天赋放大 3 倍仍只返回一个', pickInteractTarget(true, P, 24, 3, overlap) === 22],
  ['全部超范围返回 -1', pickInteractTarget(true, { x: 999, y: 999 }, 24, 1, overlap) === -1],
  // 交互权重：score = 距离² × bias（装备 0.7 / 传送门 1.5）。传送门不可逆，
  // 与装备重叠时必须让位 —— 这就是「想捡枪却误进下一层」的回归锁。
  ['武器与传送门重叠时选武器', pickInteractTarget(true, P, 24, 1, [
    { id: 31, pos: { x: 2, y: 0 }, reachBonus: 10, bias: 0.7 },
    { id: 32, pos: { x: 2, y: 0 }, reachBonus: 10, bias: 1.5 },
  ]) === 31],
  ['武器稍远（1.25 倍）仍优先于传送门', pickInteractTarget(true, P, 24, 1, [
    { id: 31, pos: { x: 2.5, y: 0 }, reachBonus: 10, bias: 0.7 },
    { id: 32, pos: { x: 2, y: 0 }, reachBonus: 10, bias: 1.5 },
  ]) === 31],
  ['武器远很多时让位传送门', pickInteractTarget(true, P, 24, 1, [
    { id: 31, pos: { x: 8, y: 0 }, reachBonus: 10, bias: 0.7 },
    { id: 32, pos: { x: 2, y: 0 }, reachBonus: 10, bias: 1.5 },
  ]) === 32],
];
const iaFail = iaCases.filter(([, pass]) => !pass).map(([name]) => name);

// ---------------------------------------------------------------- 天赋系统
// 1) 抽取策略：优先未拥有、同批不重复、池子拿光后仍能补足。
//    rev 作为确定性的「shuffle」，让断言不依赖具体随机序列。
const rev = (a) => a.slice().reverse();
const ownedTwo = ['vigor', 'plating'];
const freshPick = rollTalentChoices(ownedTwo, 4, rev).map((t) => t.id);
const freshAllNew = freshPick.every((id) => !ownedTwo.includes(id));
const freshNoDup = new Set(freshPick).size === freshPick.length;
const allTake = rollTalentChoices([...TALENT_IDS], 4, rev);
const allValid = allTake.length === 4 && allTake.every((t) => TALENT_IDS.includes(t.id));

// 2) 每条天赋必须真的改变 RunState 字段 —— 抓「声明了 stat 但 applyTalent 忘了接」
//    的摆设参数。之前踩过的坑是反过来的（参数被赋值没人读），这里两边都锁。
const SNAP = ['maxHp', 'hp', 'maxArmor', 'armor', 'maxEnergy', 'energy', 'crit', 'speed',
  'damageMul', 'fireRateMul', 'energyRegenMul', 'armorRegenMul', 'coinGainMul',
  'pickupRangeMul', 'rollCdMul', 'critDamageMul', 'hpRegen', 'shopDiscountMul'];
const char = getCharacter('knight');
const inert = [];
for (const id of TALENT_IDS) {
  const r = new RunState();
  r.reset(char, 1);
  const before = SNAP.map((k) => r[k]);
  r.applyTalent(TALENTS[id]);
  const after = SNAP.map((k) => r[k]);
  if (!before.some((v, i) => v !== after[i])) inert.push(id);
  if (r.talents.length !== 1 || r.talents[0] !== id) inert.push(`${id}:未记录`);
}

// 3) 新增 stat 必须在业务代码里被真实读取（防止以后删掉消费者，又变回玩具参数）。
const consumerChecks = [
  ['critDamageMul', 'src/weapons/Weapon.ts'],
  ['hpRegen', 'src/entities/Player.ts'],
  ['shopDiscountMul', 'src/core/Game.ts'],
];
const missingConsumers = consumerChecks
  .filter(([stat, file]) => !readFileSync(resolve(root, file), 'utf8').includes(`run.${stat}`))
  .map(([stat, file]) => `${stat} 未在 ${file} 被读取`);

// 4) 候选数不能把卡片挤出视口（CARD.w=108，4 张刚好，5 张就溢出 480）。
const firstCard = cardRect(0, BALANCE.talentChoices);
const lastCard = cardRect(BALANCE.talentChoices - 1, BALANCE.talentChoices);
const layoutOk = firstCard.x >= 0 && lastCard.x + lastCard.w <= BAL_VIEW_W;

const talentCases = [
  ['候选优先给没拿过的', freshAllNew],
  ['同批候选不重复', freshNoDup],
  [`池子拿光后仍补足 ${BALANCE.talentChoices} 个`, allValid],
  [`${TALENT_IDS.length} 条天赋都真实改变字段`, inert.length === 0],
  ['新增 stat 均有真实消费者', missingConsumers.length === 0],
  [`${BALANCE.talentChoices} 张卡片不溢出视口`, layoutOk],
];
const talentFail = talentCases.filter(([, pass]) => !pass).map(([name]) => name);

// ---------------------------------------------------------------- 相机跟随
// 三种房间外框尺寸（含外墙环）17/23/27 格 × 16px。原点故意取非零，
// 抓「拿屏幕坐标当世界坐标」这类 off-by-one。
const VIEW_W = 480, VIEW_H = 270, MARGIN = 14, TILE = 16;
const camRooms = [17, 23, 27].map((n) => {
  const worldW = n * TILE;
  const origin = { x: 1000, y: -500 };
  const center = { x: origin.x + worldW / 2, y: origin.y + worldW / 2 };
  const doors = [
    { x: center.x, y: origin.y + 8 },           // 北
    { x: center.x, y: origin.y + worldW - 8 },  // 南
    { x: origin.x + 8, y: center.y },           // 西
    { x: origin.x + worldW - 8, y: center.y },  // 东
  ];
  return { origin, worldW, center, doors };
});

const inView = (p, t) =>
  Math.abs(p.x - t.x) <= VIEW_W / 2 && Math.abs(p.y - t.y) <= VIEW_H / 2;

let camSamples = 0, playerOffscreen = 0, doorHidden = 0, bleed = 0, narrowNotCentered = 0;
for (const room of camRooms) {
  // 房间内 9×9 采样 + 四个门内侧 2 格（玩家真正会站的位置）
  const pts = [];
  for (let i = 1; i <= 9; i++) {
    for (let j = 1; j <= 9; j++) {
      pts.push({
        x: room.origin.x + (room.worldW * i) / 10,
        y: room.origin.y + (room.worldW * j) / 10,
      });
    }
  }
  for (const d of room.doors) {
    const dx = d.x - room.center.x, dy = d.y - room.center.y;
    const l = Math.hypot(dx, dy) || 1;
    pts.push({ x: d.x - (dx / l) * 2 * TILE, y: d.y - (dy / l) * 2 * TILE });
  }

  for (const p of pts) {
    camSamples++;
    const t = cameraTarget(p, room, VIEW_W, VIEW_H, MARGIN);
    // 1) 玩家始终在视口内，且留至少 4px 余量（不能贴边）
    if (Math.abs(p.y - t.y) > VIEW_H / 2 - 4 || Math.abs(p.x - t.x) > VIEW_W / 2 - 4) playerOffscreen++;
    // 2) 站到门口时，那扇门必须看得见 —— 用户报的「看不到出口」
    for (const d of room.doors) {
      if (Math.hypot(d.x - p.x, d.y - p.y) <= 2 * TILE + 1 && !inView(d, t)) doorHidden++;
    }
    // 3) 房间比视口大的轴（纵向）：视口不越出房间边界超过 margin
    if (t.y - VIEW_H / 2 < room.origin.y - MARGIN - 1
      || t.y + VIEW_H / 2 > room.origin.y + room.worldW + MARGIN + 1) bleed++;
    // 4) 房间比视口小的轴（横向）：锁中心，别把房间推向一侧
    if (room.worldW < VIEW_W && t.x !== room.center.x) narrowNotCentered++;
  }
}

// 对照：旧实现「房间中心 + 12% 玩家偏移」在 27 格房间南门内侧会把玩家推出屏幕。
const big = camRooms[2];
const southInner = { x: big.center.x, y: big.origin.y + big.worldW - 2 * TILE - 8 };
const oldCamY = big.center.y + (southInner.y - big.center.y) * 0.12;
const oldBugReproduced = Math.abs(southInner.y - oldCamY) > VIEW_H / 2;

const camCases = [
  ['玩家始终在视口内', playerOffscreen === 0, `${playerOffscreen}/${camSamples} 出屏`],
  ['站门口时该门可见', doorHidden === 0, `${doorHidden} 次门出屏`],
  ['视口不穿帮', bleed === 0, `${bleed} 次越界`],
  ['窄轴锁房间中心', narrowNotCentered === 0, `${narrowNotCentered} 次偏移`],
  ['旧 12% 跟随确实会丢人（对照）', oldBugReproduced, '旧逻辑未复现'],
];
const camFail = camCases.filter(([, pass]) => !pass).map(([name, , detail]) => `${name} (${detail})`);

// ---------------------------------------------------------------- 武器与品质
// 武器是纯数据，最怕的是「加了武器但字段写漏」——比如爆炸弹没写爆炸伤害，
// 运行时只会表现为「打到人不掉血」，不报错。这里把每条机制的自洽性锁死。
const weaponIssues = [];
for (const [key, w] of Object.entries(WEAPONS)) {
  if (w.id !== key) weaponIssues.push(`${key}: id 不一致`);
  if (!w.name || !w.desc) weaponIssues.push(`${key}: 名称/描述为空`);
  if (!RARITIES[w.rarity]) weaponIssues.push(`${key}: 未知品质 ${w.rarity}`);
  if (!(w.damage >= 0) || !(w.fireRate > 0) || w.pellets < 1) weaponIssues.push(`${key}: 数值非法`);
  if (w.kind === 'melee' && !(w.range > 0)) weaponIssues.push(`${key}: 近战缺 range`);
  if (w.kind === 'ranged' && !(w.speed > 0)) weaponIssues.push(`${key}: 远程缺弹速`);
  if (w.explode && !(w.explodeDamage > 0)) weaponIssues.push(`${key}: 爆炸弹没有爆炸伤害`);
  if ((w.burst ?? 1) > 1 && !(w.burstGap > 0)) weaponIssues.push(`${key}: 连发缺 burstGap`);
}
// 每档品质至少 3 把：否则抽到该档后要一路降级，品质分布就名存实亡
for (const r of RARITY_ORDER) {
  if (weaponsOfRarity(r).length < 3) weaponIssues.push(`${r}: 可掉落武器不足 3 把`);
}
const dupColor = RARITY_ORDER.length !== new Set(RARITY_ORDER.map(rarityColor)).size;
const mechanics = {
  连发: Object.values(WEAPONS).filter((w) => (w.burst ?? 1) > 1).length,
  弹墙: Object.values(WEAPONS).filter((w) => (w.bounce ?? 0) > 0).length,
  爆炸: Object.values(WEAPONS).filter((w) => (w.explode ?? 0) > 0).length,
  追踪: Object.values(WEAPONS).filter((w) => (w.homing ?? 0) > 0).length,
  吸血: Object.values(WEAPONS).filter((w) => (w.lifesteal ?? 0) > 0).length,
};
for (const [name, n] of Object.entries(mechanics)) {
  if (n < 1) weaponIssues.push(`机制「${name}」没有任何武器在用`);
}

// 掉落门槛：1 层不出稀有以上，深层能出传说；minRarity 高于解锁上限时必须降级而不是崩溃
const rngLoot = new RNG(0xC0FFEE);
const sample = (level, minRarity, n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(rollWeapon(rngLoot, level, minRarity));
  return out;
};
const lv1 = sample(1, 'common', 2000);
const lv12 = sample(12, 'common', 3000);
const lowGate = sample(3, 'legendary', 1000);
const minEpic = sample(12, 'epic', 1000);
const badId = (ids) => ids.filter((id) => !LOOT_WEAPONS.includes(id));
const lv1TooHigh = lv1.filter((id) => rarityIndex(WEAPONS[id].rarity) > 1);
const lv12Top = lv12.filter((id) => rarityIndex(WEAPONS[id].rarity) >= 3);
const lv12Legend = lv12.filter((id) => WEAPONS[id].rarity === 'legendary');
const gateOk = lowGate.every((id) => rarityIndex(WEAPONS[id].rarity) <= 2);
const epicOnly = minEpic.every((id) => rarityIndex(WEAPONS[id].rarity) >= 3);

const weaponCases = [
  [`${Object.keys(WEAPONS).length} 把武器配置合法`, weaponIssues.length === 0],
  ['5 档品质名字颜色互不相同', !dupColor],
  ['1 层不会掉稀有以上', lv1TooHigh.length === 0],
  ['12 层能掉史诗与传说', lv12Top.length > 0 && lv12Legend.length > 0],
  ['minRarity 超出解锁层数时降级而非崩溃', gateOk && lowGate.length === 1000],
  ['minRarity=epic 只出史诗以上', epicOnly],
  ['抽取结果始终在掉落池内', badId([...lv1, ...lv12, ...lowGate, ...minEpic]).length === 0],
];
const weaponFail = weaponCases.filter(([, pass]) => !pass).map(([name]) => name);

// ---------------------------------------------------------------- 敌人与攻击
const enemyIssues = [];
for (const [key, e] of Object.entries(ENEMIES)) {
  if (e.id !== key) enemyIssues.push(`${key}: id 不一致`);
  if (!(e.hp > 0) || !(e.cooldown > 0) || !(e.radius > 0)) enemyIssues.push(`${key}: 数值非法`);
  if (!e.attacks.length) { enemyIssues.push(`${key}: 没有攻击`); continue; }
  for (const a of e.attacks) {
    // 前摇为 0 = 无法躲避的伤害，属于设计事故
    if (!(a.windup > 0)) enemyIssues.push(`${key}/${a.kind}: 缺少前摇`);
    if (!(a.range > 0)) enemyIssues.push(`${key}/${a.kind}: 缺少攻击距离`);
    if (a.kind === 'laser') {
      if (!(a.length > 0) || !(a.width > 0) || !(a.duration > 0)) enemyIssues.push(`${key}: 激光参数不全`);
      if (a.windup < 0.5) enemyIssues.push(`${key}: 激光前摇 ${a.windup}s 太短`);
    }
    if (a.kind === 'grenade' && !(a.blast > 0)) enemyIssues.push(`${key}: 榴弹缺爆炸半径`);
    if (a.kind === 'summon') {
      if (!a.summonId || !ENEMIES[a.summonId]) enemyIssues.push(`${key}: 召唤目标不存在`);
      else if (ENEMIES[a.summonId].ai === 'sentinel') enemyIssues.push(`${key}: 召唤了炮台，会形成永动机`);
    }
  }
  if (e.splitInto) {
    if (!ENEMIES[e.splitInto]) enemyIssues.push(`${key}: 分裂目标不存在`);
    // 只允许分裂一层，否则是数量爆炸
    else if (ENEMIES[e.splitInto].splitInto) enemyIssues.push(`${key}: 分裂链未终止`);
  }
}
for (const s of SPAWN_TABLE) {
  if (!ENEMIES[s.id]) enemyIssues.push(`刷怪表引用了不存在的 ${s.id}`);
  if (s.id.startsWith('boss')) enemyIssues.push(`刷怪表混入 BOSS ${s.id}`);
  if (!(s.minLevel >= 1) || !(s.weight > 0)) enemyIssues.push(`刷怪表 ${s.id} 参数非法`);
}
const rngEnemy = new RNG(0xBADF00D);
const lv1Enemies = new Set();
for (let i = 0; i < 3000; i++) lv1Enemies.add(rollEnemy(rngEnemy, 1));
const lv10Enemies = new Set();
for (let i = 0; i < 3000; i++) lv10Enemies.add(rollEnemy(rngEnemy, 10));
const lowGateEnemies = [...lv1Enemies].every((id) => SPAWN_TABLE.find((s) => s.id === id).minLevel <= 1);
const bossIds = new Set();
for (let lv = 1; lv <= 12; lv++) bossIds.add(bossForLevel(lv));
const allBossValid = [...bossIds].every((id) => id.startsWith('boss') && ENEMIES[id]);

const enemyCases = [
  [`${ENEMY_IDS.length} 种敌人配置合法`, enemyIssues.length === 0],
  ['1 层只刷低层怪', lowGateEnemies],
  ['10 层能刷出后期怪', ['sentinel', 'necromancer'].every((id) => lv10Enemies.has(id))],
  ['BOSS 三套轮换且都存在', bossIds.size === 3 && allBossValid],
];
const enemyFail = enemyCases.filter(([, pass]) => !pass).map(([name]) => name);

// ---------------------------------------------------------------- 精灵覆盖
// sprite() 找不到 id 会画一个洋红圆，不会报错。用静态清单把「加了新怪忘了画」
// 变成回归失败，而不是上线后靠肉眼发现画面里有品红色块。
const pickupKinds = ['coin', 'energy', 'weapon', 'chest', 'portal', 'heal', 'armor', 'shrine', 'shopkeeper'];
const missingSprites = [...ENEMY_IDS, ...pickupKinds, 'player'].filter((id) => !SPRITE_IDS.includes(id));

const contentCases = [
  ['敌人 / 掉落物 / 玩家都有精灵', missingSprites.length === 0],
];
const contentFail = contentCases.filter(([, pass]) => !pass).map(([name]) => name);

// ---------------------------------------------------------------- 开始界面与设置
// 菜单/设置/图鉴的命中检测是纯函数，可以不开浏览器就单测。这里锁三件事：
//   1) 按钮矩形不重叠、不越界、中心点必然命中自己（防止「看得见点不到」）；
//   2) 设置的下标循环与坏档钳制（老档缺字段、手改 localStorage 不能崩）；
//   3) 每个设置项都有真实消费者（不做存了没人读的假开关）。
const ui = await loadTs('src/ui/StartMenu.ts');
const st = await loadTs('src/data/settings.ts');
const {
  MENU_ITEMS, menuItemRect, hitMenuItem,
  CODEX_TABS, codexTabRect, hitCodexTab, codexEntries, codexOffset, hitCodexRow, CODEX_LAYOUT,
} = ui;
const {
  SETTINGS, defaultSettings, normalizeSettings, cycleSetting, optionIndex,
  cameraLerpOf, CAMERA_LERP,
} = st;

const menuRects = MENU_ITEMS.map((_, i) => menuItemRect(i));
const menuInView = menuRects.every((b) => b.x >= 0 && b.y >= 0
  && b.x + b.w <= BAL_VIEW_W && b.y + b.h <= 270);
const menuOverlap = menuRects.some((a, i) => menuRects.some((b, j) => i < j
  && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
const menuHitSelf = menuRects.every((b, i) => hitMenuItem(b.x + b.w / 2, b.y + b.h / 2) === i);
const menuUnique = new Set(MENU_ITEMS.map((m) => m.action)).size === MENU_ITEMS.length;
const menuMiss = hitMenuItem(2, 2) === -1 && hitMenuItem(BAL_VIEW_W / 2, 269) === -1;

const optionSettings = SETTINGS.filter((s) => s.kind !== 'action');
const defSettings = defaultSettings();
const defValid = optionSettings.every((s) => defSettings[s.id] >= 0
  && defSettings[s.id] < s.options.length);
const settingIdsUnique = new Set(SETTINGS.map((s) => s.id)).size === SETTINGS.length;
// 循环 n 次必然回到原点，正反两个方向都要成立
const cycleWraps = optionSettings.every((s) => {
  let fwd = defSettings;
  for (let i = 0; i < s.options.length; i++) fwd = cycleSetting(fwd, s, 1);
  let back = defSettings;
  for (let i = 0; i < s.options.length; i++) back = cycleSetting(back, s, -1);
  return optionIndex(fwd, s) === optionIndex(defSettings, s)
    && optionIndex(back, s) === optionIndex(defSettings, s);
});
const camDef = SETTINGS.find((s) => s.id === 'camera');
const wrapBack = cycleSetting({ ...defSettings, camera: 0 }, camDef, -1).camera === camDef.options.length - 1;
// 坏档：越界 / 负数 / 字符串 / null / 缺字段，全部退回默认而不是把 NaN 传下去
const badSettings = normalizeSettings({
  camera: 99, screenShake: -3, crosshair: 'yes', minimap: null,
});
const badClamped = optionSettings.every((s) => badSettings[s.id] === s.def);
const emptyClamped = optionSettings.every((s) => normalizeSettings(undefined)[s.id] === s.def);
const noActionInSave = !('reset' in defSettings);
const lerpSteps = ['slow', 'normal', 'fast'].map((k) => CAMERA_LERP[k]);
const lerpOk = cameraLerpOf(defSettings) === CAMERA_LERP.normal
  && lerpSteps[0] < lerpSteps[1] && lerpSteps[1] < lerpSteps[2];

const settingConsumers = [
  ['camera', 'src/core/Game.ts', 'cameraLerpOf'],
  ['screenShake', 'src/render/Renderer.ts', 'shakeEnabled'],
  ['crosshair', 'src/ui/HUD.ts', 'showCrosshair'],
  ['minimap', 'src/ui/HUD.ts', 'showMinimap'],
];
const missingSettingConsumers = settingConsumers
  .filter(([, file, token]) => !readFileSync(resolve(root, file), 'utf8').includes(token))
  .map(([id, file]) => `${id} 未在 ${file} 被读取`);

const codexExpected = {
  weapon: LOOT_WEAPONS.length, enemy: ENEMY_IDS.length, talent: TALENT_IDS.length,
};
const codexCountOk = CODEX_TABS.every((t) => codexEntries(t.id).length === codexExpected[t.id]);
const codexEntriesOk = CODEX_TABS.every((t) => codexEntries(t.id)
  .every((e) => e.name.length > 0 && /^#[0-9a-f]{6}$/i.test(e.color)));
// 无论选中哪一项，它都必须落在窗口内 —— 否则「选了却看不到」
const codexScrollOk = CODEX_TABS.every((t) => {
  const total = codexEntries(t.id).length;
  const max = Math.max(0, total - CODEX_LAYOUT.rows);
  let covered = 0;
  for (let s = 0; s < total; s++) {
    const off = codexOffset(s, total);
    if (off < 0 || off > max) return false;
    if (s >= off && s < off + CODEX_LAYOUT.rows) covered++;
  }
  return covered === total;
});
const codexRowHitOk = hitCodexRow(CODEX_LAYOUT.listX + 4, CODEX_LAYOUT.listY + 3, 20, 5) === 0
  && hitCodexRow(CODEX_LAYOUT.listX + 4, CODEX_LAYOUT.listY + CODEX_LAYOUT.rowH * 3 + 3, 20, 5) === 3
  && hitCodexRow(6, 6, 20, 5) === -1;
const tabRects = CODEX_TABS.map((_, i) => codexTabRect(i));
const tabInView = tabRects.every((b) => b.x >= 0 && b.x + b.w <= BAL_VIEW_W);
const tabHitSelf = tabRects.every((b, i) => hitCodexTab(b.x + b.w / 2, b.y + b.h / 2) === i);

const startUiCases = [
  [`主菜单 ${MENU_ITEMS.length} 项且不重叠不越界`, menuInView && !menuOverlap && menuUnique],
  ['菜单按钮中心点必然命中自己', menuHitSelf],
  ['点空白处不会误触菜单', menuMiss],
  [`${SETTINGS.length} 项设置默认值合法且 id 唯一`, defValid && settingIdsUnique],
  ['设置正向 / 反向循环都能绕回', cycleWraps && wrapBack],
  ['坏档与缺字段的存档被钳制回默认', badClamped && emptyClamped && noActionInSave],
  ['镜头三档严格递增且默认标准', lerpOk],
  ['每个设置项都有真实消费者', missingSettingConsumers.length === 0],
  [`图鉴三页条目数与数据一致（${Object.values(codexExpected).join(' / ')}）`,
    codexCountOk && codexEntriesOk],
  ['滚动窗口始终包住选中项', codexScrollOk],
  ['列表行命中与偏移一致', codexRowHitOk],
  ['图鉴标签页不越界且可点中', tabInView && tabHitSelf],
];
const startUiFail = startUiCases.filter(([, pass]) => !pass).map(([name]) => name);

// ---------------------------------------------------------------- 武器机制实跑
// 配置合法 ≠ 逻辑正确：弹墙会不会原地卡死、爆炸有没有按阵营过滤、追踪会不会
// 真的转向，这些只能让 Projectile 真跑一遍。这里用最小假世界，不碰 Canvas。
const { Projectile } = await loadTs('src/entities/Projectile.ts');
const fakeEnemy = (x, y) => ({
  id: 1, roomId: 1, alive: true, faction: 'enemy',
  pos: { x, y }, radius: 6, hp: 10,
  applyDamage(info) { this.hp -= info.amount; },
});
const fakePlayer = (x, y) => ({
  alive: true, state: 'idle', pos: { x, y }, radius: 6, hp: 10,
  applyDamage(info) { this.hp -= info.amount; },
});
const fakeCtx = (enemies, player, solid) => ({
  room: { plan: { id: 1 }, isSolid: solid },
  enemies: {
    forEachActive(fn) { for (const e of enemies) if (e.alive) fn(e); },
  },
  player,
  rng: new RNG(1),
  spawnParticle() {},
  renderer: { shake() {} },
});
const launch = (opts) => {
  const p = new Projectile();
  p.launch({
    x: 10, y: 20, angle: 0, speed: 200, damage: 3, faction: 'player',
    color: '#fff', radius: 3, life: 2, ...opts,
  });
  // 直接 new 出来的对象 alive=false，池里 spawn 时才置 true
  p.alive = true;
  return p;
};
const step = (p, ctx, seconds) => {
  const dt = 1 / 60;
  for (let t = 0; t < seconds && p.alive; t += dt) p.update(dt, ctx);
  return p;
};

// 1) 弹墙：右墙在 x>60，反弹后角度应变成 π 左右
const wallCtx = fakeCtx([], fakePlayer(0, 0), (x) => x > 60 || x < 0);
const bouncer = launch({ angle: 0, speed: 240, bounce: 1, life: 1.2 });
step(bouncer, wallCtx, 0.6);
const bounced = Math.abs(Math.abs(bouncer.angle) - Math.PI) < 0.2;

// 2) 爆炸：命中即引爆，只结算一次 AoE
const target = fakeEnemy(40, 20);
const boomCtx = fakeCtx([target], fakePlayer(0, 0), () => false);
const bomber = launch({ angle: 0, speed: 200, damage: 0, explodeRadius: 30, explodeDamage: 5, life: 2 });
step(bomber, boomCtx, 0.4);
const exploded = !bomber.alive && target.hp === 5;

// 3) 引信：没打到任何东西，到时也要自爆
const fuseCtx = fakeCtx([], fakePlayer(0, 0), () => false);
const fused = launch({ angle: 0, speed: 0, explodeRadius: 20, explodeDamage: 4, life: 0.1 });
step(fused, fuseCtx, 0.2);
const fuseExploded = !fused.alive;

// 4) 追踪：目标在正下方，初始朝右，0.5 秒后应明显转向下
const homingCtx = fakeCtx([fakeEnemy(10, 70)], fakePlayer(0, 0), () => false);
const seeker = launch({ angle: 0, speed: 120, homing: 6, life: 2 });
step(seeker, homingCtx, 0.5);
const homed = seeker.angle > 0.9;

// 5) 阵营：敌人榴弹只伤玩家，玩家爆炸只伤敌人
const victim = fakePlayer(10, 20);
const enemyBomb = launch({
  x: 10, y: 20, angle: 0, speed: 0, damage: 0, faction: 'enemy',
  explodeRadius: 25, explodeDamage: 3, life: 0.1,
});
step(enemyBomb, fakeCtx([], victim, () => false), 0.2);
const friendlyFireOk = victim.hp === 7 && target.hp === 5;

const mechanicCases = [
  ['弹墙后方向反转', bounced],
  ['爆炸弹命中只结算一次 AoE', exploded],
  ['引信到时在空中自爆', fuseExploded],
  ['追踪弹会转向目标', homed],
  ['爆炸只伤对方阵营', friendlyFireOk],
];
const mechanicFail = mechanicCases.filter(([, pass]) => !pass).map(([name]) => name);

// ---------------------------------------------------------------- 运行时冒烟
// 上面的测试都停留在「纯函数 / 单个实体」。真正会炸的是整条主循环：
// 某把武器开火时读了不存在的字段、某个 AI 状态机走不到出口、HUD 画到空对象。
// 这里用最小 Canvas 2D 存根把真实 Game 跑起来，24 把武器逐把开火，
// 再把新 AI（激光 / 召唤 / 榴弹 / 分裂 / BOSS）放进同一间房跑 20 秒。
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
const smoke = [];
let game;
try {
  game = new Game(makeCanvas());
} catch (e) {
  smoke.push(`构造失败: ${e.message}`);
}
const weaponRuntimeIssues = [];
if (game) {
  game.mode = 'playing';
  // 统计「生成过多少子弹」而不是「当前池里还有几发」：高速弹在 0.4 秒窗口内
  // 可能已经打到墙上被 sweep 掉，看池子会误判成「没开火」。
  let spawnCount = 0;
  const spawnOriginal = game.spawnProjectile.bind(game);
  game.spawnProjectile = (o) => {
    spawnCount++;
    return spawnOriginal(o);
  };
  for (const id of LOOT_WEAPONS) {
    const w = WEAPONS[id];
    game.run.weapons = [id];
    game.run.weaponIndex = 0;
    game.run.energy = 1e9;
    game.input.firing = true;
    spawnCount = 0;
    try {
      for (let i = 0; i < 24; i++) {
        game.input.aim = { x: game.player.pos.x + 50, y: game.player.pos.y };
        game.update(1 / 60);
        game.draw();
      }
    } catch (e) {
      weaponRuntimeIssues.push(`${id}: ${e.message}`);
      continue;
    }
    if (w.kind === 'ranged' && spawnCount === 0) weaponRuntimeIssues.push(`${id}: 远程武器没生成子弹`);
  }

  // 新 AI 同房混战：激光 / 召唤 / 榴弹 / 分裂 / BOSS
  game.run.weapons = ['pistol'];
  game.run.maxHp = 9999;
  game.run.hp = 9999;
  game.run.armor = game.run.maxArmor;
  const px = game.player.pos.x;
  const py = game.player.pos.y;
  for (const [id, dx, dy] of [
    ['sentinel', 76, 0], ['necromancer', -80, 40], ['bomber', 30, -70],
    ['slime', -40, -60], ['boss_laser', 0, 90], ['eye', -90, -30],
  ]) {
    const e = game.spawnEnemy(id, px + dx, py + dy);
    e.roomId = game.room.plan.id;
  }
  const initialVital = game.run.hp + game.run.armor;
  let minVital = initialVital;
  let sawLaser = false;
  let sawSummon = false;
  let loopError = null;
  for (let i = 0; i < 1200; i++) {
    game.input.firing = i % 180 < 140;
    game.input.aim = { x: px + Math.cos(i * 0.05) * 90, y: py + Math.sin(i * 0.05) * 90 };
    try {
      game.update(1 / 60);
      game.draw();
    } catch (e) {
      loopError = e;
      break;
    }
    minVital = Math.min(minVital, game.run.hp + game.run.armor);
    if (!sawLaser && game.enemies.all.some((e) => e.laserActive)) sawLaser = true;
    if (!sawSummon && game.enemies.all.some((e) => e.data.id === 'bat')) sawSummon = true;
  }
  smoke.push(['整局主循环跑 1200 帧不抛异常', !loopError, loopError?.message]);
  smoke.push(['24 把武器逐把开火不抛异常', weaponRuntimeIssues.length === 0, weaponRuntimeIssues.join('; ')]);
  smoke.push(['激光 AI 真的开出了光束', sawLaser]);
  smoke.push(['召唤 AI 真的召出了蝙蝠', sawSummon]);
  smoke.push(['敌人攻击真的打掉了玩家护盾/生命', minVital < initialVital]);

  // 贴脸开火：开火点在玩家身侧 10px，敌人贴到身上时枪口直接落在它体内。
  // 自动试玩抓到过「磁暴炮贴脸连打 2 发、伤害 0」——子弹第一步位移就跳过了目标。
  const pbIssues = [];
  const aimAt = (wx, wy) => {
    const r = game.renderer;
    game.input.mouseX = (wx - r.camX) * r.scale + r.canvas.width / 2;
    game.input.mouseY = (wy - r.camY) * r.scale + r.canvas.height / 2;
  };
  for (const id of ['storm_rail', 'flamethrower', 'pistol', 'katana']) {
    game.run.weapons = [id];
    game.run.weaponIndex = 0;
    game.run.energy = 1e9;
    const e = game.spawnEnemy('boar', game.player.pos.x + 2, game.player.pos.y + 1);
    e.roomId = game.room.plan.id;
    // spawnEnemy 会吸附到合法落点，直接搬到玩家身上才能测「贴脸」
    e.pos.x = game.player.pos.x + 2;
    e.pos.y = game.player.pos.y + 1;
    const hp0 = e.hp;
    aimAt(e.pos.x, e.pos.y);
    game.input.firing = true;
    for (let i = 0; i < 90; i++) {
      aimAt(e.pos.x, e.pos.y);
      game.update(1 / 60);
    }
    game.input.firing = false;
    if (e.hp >= hp0) pbIssues.push(`${id}: 贴脸 1.5 秒掉血 0`);
    e.alive = false;
  }
  smoke.push(['贴脸开火能打中（枪口嵌在敌人体内）', pbIssues.length === 0, pbIssues.join('; ')]);
}

// 开始界面的运行时冒烟：走真实的点击入口（onPointerDown 在运行时只是普通方法），
// 确认「点菜单 → 进设置 → 改一项 → 进图鉴翻三页 → 点开始」整条链路都不炸，
// 并且设置确实作用到了渲染层，而不是只写进存档。
if (game) {
  const tryRun = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
  const flow = [];

  game.mode = 'menu';
  game.menuIndex = 2;
  game.activateMenu(2);
  flow.push(['点「设置」进入设置页', game.mode === 'settings', game.mode]);

  const before = game.meta.data.settings.screenShake;
  game.activateSetting(1);
  const after = game.meta.data.settings.screenShake;
  flow.push(['设置项切换会写回存档', before !== after, `${before} → ${after}`]);

  // 关掉震动后 shake() 必须是空操作，否则「设置存了但没用」
  game.applySettingValues({ ...game.meta.data.settings, screenShake: 0 });
  game.renderer.shakeAmp = 0;
  game.renderer.shake(9);
  flow.push(['关掉震动后 shake 真的不生效', game.renderer.shakeAmp === 0]);

  game.applySettingValues({ ...game.meta.data.settings, screenShake: 1, crosshair: 0, minimap: 0 });
  const drawNoHud = tryRun(() => game.draw());
  flow.push(['关掉准星 / 小地图后画面不抛异常', drawNoHud === null, drawNoHud]);
  game.applySettingValues({ ...game.meta.data.settings, crosshair: 1, minimap: 1 });

  game.mode = 'codex';
  let codexErr = null;
  for (const t of CODEX_TABS) {
    game.codexTab = t.id;
    for (const sel of [0, codexEntries(t.id).length - 1]) {
      game.codexIndex = sel;
      codexErr = codexErr ?? tryRun(() => game.draw());
    }
  }
  flow.push(['图鉴三页首尾都能画出来', codexErr === null, codexErr]);

  game.mode = 'help';
  const helpErr = tryRun(() => game.draw());
  flow.push(['操作说明能画出来', helpErr === null, helpErr]);

  game.mode = 'menu';
  game.activateMenu(0);
  flow.push(['点「开始游戏」进入对局', game.mode === 'playing', game.mode]);

  game.mode = 'paused';
  game.backToMenu();
  flow.push(['Esc 回主菜单会重置本局', game.mode === 'menu' && game.run.elapsed === 0, game.mode]);

  for (const [name, pass, detail] of flow) smoke.push([name, pass, detail]);
}

const smokeCases = smoke.map((s) => (Array.isArray(s) ? [s[0], s[1], s[2]] : [s, false]));
const smokeFail = smokeCases.filter(([, pass]) => !pass)
  .map(([name, , detail]) => (detail ? `${name} (${detail})` : name));

// ---------------------------------------------------------------- 平衡再调优（P0~P3）常驻回归
// 把「精英词条 / 天赋递减 / 多波次 / 定价曲线 / 武器跨度」的性质锁死，
// 避免以后改数值又悄悄退化成「后期倒挂 / 四件套霸榜 / 金币白送 / 十倍跨度」。
const bot = await loadTs('scripts/bot-core.mjs');
const { weaponScore } = bot;
const balCases = [];

// P0-1 精英概率随层单调递增、低层为 0、有上限
{
  const lvs = [1, 5, 6, 10, 20, 30, 50];
  const cs = lvs.map(eliteChance);
  const lowZero = eliteChance(1) === 0 && eliteChance(5) === 0;
  const monotonic = cs.every((c, i) => i === 0 || c >= cs[i - 1]);
  const capped = eliteChance(100) <= 0.7 + 1e-9;
  const dualLow = dualAffixChance(10) === 0 && dualAffixChance(30) > 0;
  balCases.push(['P0 精英概率低层为 0 / 单调递增 / 有上限', lowZero && monotonic && capped && dualLow]);
}
// P0-2 词条抽取：低层恒空、深层能出精英且词条合法、可复现
{
  const r1 = new RNG(1234), r2 = new RNG(1234);
  let lowNonEmpty = 0, deepElite = 0, badId = 0, tooMany = 0;
  for (let i = 0; i < 4000; i++) {
    if (rollAffixes(r1, 3).length > 0) lowNonEmpty++;
    const a = rollAffixes(r1, 28);
    if (a.length > 0) deepElite++;
    if (a.length > 2) tooMany++;
    for (const id of a) if (!AFFIX_IDS.includes(id)) badId++;
  }
  const seqA = [], seqB = [];
  for (let i = 0; i < 50; i++) { seqA.push(rollAffixes(r1, 20).join(',')); seqB.push(rollAffixes(r2, 20).join(',')); }
  // r2 从头开始、r1 已消耗很多，这里只验证「同起点可复现」：另起一对
  const ra = new RNG(999), rb = new RNG(999);
  const same = Array.from({ length: 100 }, () => rollAffixes(ra, 25).join(',') === rollAffixes(rb, 25).join(',')).every(Boolean);
  balCases.push(['P0 低层不出精英 / 深层大量精英 / 词条合法', lowNonEmpty === 0 && deepElite > 0 && badId === 0 && tooMany === 0]);
  balCases.push(['P0 精英词条同种子可复现', same]);
  balCases.push(['P0 四种词条配置齐全且都有机制', AFFIX_IDS.length === 4 && AFFIX_IDS.every((id) => {
    const a = AFFIXES[id];
    return a.shieldRatio || a.speedMul || a.takenMul || a.deathBullets;
  })]);
}
// P0-3 多波次阈值：低层 1 波、中层 2 波、深层 3 波，且间隔 > 0
{
  const waves = (lv) => lv >= BALANCE.waveThreeFrom ? 3 : lv >= BALANCE.waveTwoFrom ? 2 : 1;
  balCases.push(['P0 多波次随层 1→2→3 且间隔为正',
    waves(1) === 1 && waves(BALANCE.waveTwoFrom) === 2 && waves(BALANCE.waveThreeFrom) === 3
    && BALANCE.waveGap > 0 && BALANCE.waveTwoFrom < BALANCE.waveThreeFrom]);
}
// P2-1 天赋递减：严格递减、恒正、边界
{
  const d0 = talentDecay(0), d1 = talentDecay(1), d2 = talentDecay(2), d10 = talentDecay(10);
  balCases.push(['P2 天赋递减严格递减且恒正', d0 === 1 && d1 < d0 && d2 < d1 && d10 > 0 && d10 < d2]);
}
// P2-2 RunState 真的吃到递减：连拿伤害天赋，每次的「等效倍率」严格递减且仍 >1。
// 注意：乘法叠加下「绝对增量」会先随基数变大而升、后收敛到 0，不单调；
// 真正该锁的是「边际倍率递减」+「成长收敛于有限天花板」（∑等比衰减收敛）。
{
  const r = new RunState(); r.reset(getCharacter('knight'), 1);
  const t = TALENTS.berserk; // damageMul ×1.4
  const ratios = [];
  for (let i = 0; i < 4; i++) { const b = r.damageMul; r.applyTalent(t); ratios.push(r.damageMul / b); }
  balCases.push(['P2 同类天赋等效倍率逐次递减且恒 >1',
    ratios[0] > ratios[1] && ratios[1] > ratios[2] && ratios[2] > ratios[3] && ratios[3] > 1]);
  balCases.push(['P2 statStacks 逐次累加', r.statStacks.damageMul === 4]);

  // 天花板：连拿 30 次 damageMul 仍应收敛到有限值，远小于不递减的线性/指数增长
  const r2 = new RunState(); r2.reset(getCharacter('knight'), 1);
  for (let i = 0; i < 30; i++) r2.applyTalent(t);
  balCases.push([`P2 成长有天花板（30 次 damageMul=${r2.damageMul.toFixed(2)} < 8）`,
    r2.damageMul < 8 && r2.damageMul < 1 + 0.4 * 30]);
}
// P2-3 候选跨类：4 张候选覆盖 >= 3 个不同 tag（打破四张同类）
{
  let minTags = 9;
  for (let s = 0; s < 200; s++) {
    const owned = new RNG(s).shuffle([...TALENT_IDS]).slice(0, 5);
    const picks = rollTalentChoices(owned, BALANCE.talentChoices, (a) => new RNG(s * 7 + 1).shuffle(a));
    const tags = new Set(picks.map((t) => t.tag));
    minTags = Math.min(minTags, tags.size);
  }
  balCases.push(['P2 同批 4 张候选覆盖 >= 3 类', minTags >= 3]);
}
// P1-1 定价随层严格递增、前期温和、后期明显更贵
{
  const item = SHOP_ITEMS.talent_scroll;
  const p1 = priceOf(item, 1), p10 = priceOf(item, 10), p30 = priceOf(item, 30);
  let mono = true;
  for (let lv = 2; lv <= 40; lv++) if (priceOf(item, lv) < priceOf(item, lv - 1)) mono = false;
  balCases.push(['P1 商店定价随层严格递增且后期翻倍', mono && p1 === item.price && p10 > p1 && p30 > p10 * 2]);
}
// P1-2 能量回能落在合理区间（不熄火、也不无限）
{
  balCases.push(['P1 回能落在 8~12 的收敛区间', BALANCE.energyRegen >= 8 && BALANCE.energyRegen <= 12]);
}
// P1-3 能量池收敛：200 点大池 + 满地补给球曾让战斗中能量条 97.6% 贴满、
// 饥饿率（连一发都扣不起的帧）结构性为 0 —— 能量从不是决策变量。
// 缩池是 P1 主杠杆（骑士 200→110），锁区间防止以后又悄悄调回大池。
{
  const pools = ['knight', 'ranger', 'wizard'].map((id) => getCharacter(id).energy);
  balCases.push([`P1 能量池收敛 60~160 且法师相对高蓝（实测 ${pools.join('/')}）`,
    pools.every((e) => e >= 60 && e <= 160) && pools[0] < pools[2]]);
}
// P1-4 能量球与 heal/armor 同语义：有缺口才吸附。原来 energy 漏了缺口判断，
// 满蓝也把球吸走白费 —— P1 收紧后补给球稀缺，语义必须对齐（文本契约）。
{
  const pickupSrc = readFileSync(resolve(root, 'src/entities/Pickup.ts'), 'utf8');
  balCases.push(['P1 能量球缺口吸附（满蓝不浪费）',
    pickupSrc.includes("this.kind === 'energy' ? ctx.run.energy < ctx.run.maxEnergy")]);
}
// P3 武器跨度：修口径后应 <= 4 倍（旧 10.3x）
{
  const scores = Object.values(WEAPONS).map((w) => weaponScore(w));
  const span = Math.max(...scores) / Math.min(...scores);
  balCases.push([`P3 武器评分跨度 <= 4x（实测 ${span.toFixed(1)}x）`, span <= 4]);
}
// P3 弱势武器确实被补强：弹射短弓不再垫底区间
{
  const ric = weaponScore(WEAPONS.ricochet_bow);
  const rocket = weaponScore(WEAPONS.rocket_launcher);
  balCases.push(['P3 弹射短弓 / 火箭筒脱离垫底', ric >= 9 && rocket >= 9]);
}
const balFail = balCases.filter(([, pass]) => !pass).map(([name]) => name);

// ---------------------------------------------------------------- 本轮 UX 修复回归
// 1) 局内设置：暂停菜单命中同源 + 从暂停进设置 Esc 返回不重建本局
// 2) 换枪旧枪落地：addWeapon 返回被顶替者 / giveWeapon 掉回地面 / 交互锁防无限对换
const ov = await loadTs('src/ui/Overlay.ts');
const { PAUSE_ITEMS, pauseItemRect, hitPauseItem } = ov;
const uxCases = [];

// 暂停菜单布局：不重叠、不越界、中心命中自己、空白不命中
{
  const rects = PAUSE_ITEMS.map((_, i) => pauseItemRect(i));
  const inView = rects.every((b) => b.x >= 0 && b.y >= 0
    && b.x + b.w <= BAL_VIEW_W && b.y + b.h <= 270);
  const overlap = rects.some((a, i) => rects.some((b, j) => i < j
    && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
  const hitSelf = rects.every((b, i) => hitPauseItem(b.x + b.w / 2, b.y + b.h / 2) === i);
  const miss = hitPauseItem(2, 2) === -1;
  uxCases.push(['暂停菜单三项不重叠/不越界/中心命中/空白不命中',
    inView && !overlap && hitSelf && miss && PAUSE_ITEMS.length === 3]);
  const actions = PAUSE_ITEMS.map((x) => x.action).join(',');
  uxCases.push(['暂停菜单含 继续/设置/返回主菜单', actions === 'resume,settings,menu', actions]);
}

// RunState.addWeapon：未满填副槽返回 null；满 2 把替换当前手持并返回被顶替的 id
{
  const r = new RunState();
  r.reset(getCharacter('knight'), 1);
  const a = r.addWeapon('katana');                 // ['pistol','katana']
  const b = r.addWeapon('railgun');                // 替换 index0 → ['railgun','katana']
  const c = (r.switchWeapon(), r.addWeapon('smg')); // 切到 index1，替换 katana → 'smg'
  uxCases.push(['addWeapon 未满填副槽返回 null',
    a === null && r.weapons.length === 2]);
  uxCases.push(['addWeapon 满栏替换当前并返回被顶替 id',
    b === 'pistol' && c === 'katana'
    && r.weapons.join(',') === 'railgun,smg'
    && r.currentWeaponId === 'smg']);
}

// 文本契约：三处换枪来源统一走 giveWeapon、落地枪带交互保护期且被仲裁排除
{
  const pkSrc = readFileSync(resolve(root, 'src/entities/Pickup.ts'), 'utf8');
  const gmSrc = readFileSync(resolve(root, 'src/core/Game.ts'), 'utf8');
  uxCases.push(['地面/宝箱/商店三处换枪统一走 giveWeapon',
    (pkSrc.match(/ctx\.giveWeapon\(/g) || []).length === 2
    && gmSrc.includes('this.giveWeapon(')
    && !pkSrc.includes('ctx.run.addWeapon')]);
  uxCases.push(['落地枪保护期：update 拦截 + 仲裁排除',
    pkSrc.includes('this.dropGrace <= 0') && gmSrc.includes('pk.dropGrace > 0')]);
  uxCases.push(['局内设置返回按来源分流（不无条件 backToMenu）',
    gmSrc.includes("this.settingsReturn === 'pause'")
    && gmSrc.includes('closeSettings()')]);
}

// 运行时：用真实 Game 实例验证「换枪落地 + 交互锁」和「局内设置不丢本局」
if (game) {
  try {
    // --- 换枪落地 ---
    game.mode = 'playing';
    game.run.weapons = ['pistol', 'katana'];
    game.run.weaponIndex = 0;
    game.pickups.clear();
    game.giveWeapon('railgun', game.player.pos.x, game.player.pos.y);
    const drop = game.pickups.all.find((p) => p.alive && p.kind === 'weapon'
      && p.payload === 'pistol');
    uxCases.push(['giveWeapon 把被顶替的旧枪掉回地面且带保护期',
      game.run.weapons[0] === 'railgun' && !!drop && drop.dropGrace > 0]);
    uxCases.push(['落地旧枪不嵌墙（safeSpawn 校验）',
      !!drop && !game.room.isSolid(drop.pos.x, drop.pos.y)]);
    // 保护期内按 E：落地枪不参与仲裁，interactTargetId 不能指向它
    game.input.pressed.add('KeyE');
    game.resolveInteractTarget();
    const excluded = !drop || game.interactTargetId !== drop.id;
    game.input.pressed.delete('KeyE');
    uxCases.push(['保护期内落地枪不抢占交互目标（防无限对换）', excluded]);
    // 保护期走完后则重新可被选中
    if (drop) {
      drop.dropGrace = 0;
      game.input.pressed.add('KeyE');
      game.resolveInteractTarget();
      const selectable = game.interactTargetId === drop.id;
      game.input.pressed.delete('KeyE');
      uxCases.push(['保护期结束后落地枪可再次被捡回', selectable]);
    }

    // --- 局内设置不丢本局 ---
    game.mode = 'playing';
    game.run.hp = 5;
    game.run.level = 7;
    game.run.coins = 123;
    game.run.elapsed = 42;
    game.run.levelElapsed = 9;
    game.run.weapons = ['pistol', 'katana'];
    game.run.weaponIndex = 0;
    const seed = game.run.seed;
    game.openSettings('pause');
    const entered = game.mode === 'settings' && game.settingsReturn === 'pause';
    const camBefore = game.meta.data.settings.camera;
    game.activateSetting(0);
    const changed = game.meta.data.settings.camera !== camBefore;
    game.closeSettings(); // 模拟 Esc
    const back = game.mode === 'paused';
    const kept = game.run.hp === 5 && game.run.level === 7 && game.run.coins === 123
      && game.run.elapsed === 42 && game.run.levelElapsed === 9
      && game.run.seed === seed && game.run.weapons.join(',') === 'pistol,katana';
    uxCases.push(['局内进设置改一项后回到暂停菜单', entered && changed && back]);
    uxCases.push(['局内设置返回后本局进度完整保留（未 newRun）', kept]);
    // 从主菜单进的设置，返回时才回主菜单
    game.openSettings('menu');
    game.closeSettings();
    uxCases.push(['从主菜单进设置 Esc 仍回主菜单', game.mode === 'menu']);
    // paused 下按 Esc 应「继续本局」而不是丢弃进度
    game.mode = 'paused';
    const pausedSeed = game.run.seed;
    game.input.pressed.add('Escape');
    game.update(1 / 60);
    game.input.pressed.delete('Escape');
    uxCases.push(['paused 按 Esc 继续本局而非回主菜单',
      game.mode !== 'menu' && game.run.seed === pausedSeed]);
    // 暂停菜单 / 局内设置页都要能整帧画出来（含 drawPause 新签名）
    let drawErr = null;
    try {
      game.mode = 'paused';
      game.draw();
      game.openSettings('pause');
      game.draw();
    } catch (e) { drawErr = e.message; }
    uxCases.push(['暂停菜单 + 局内设置页整帧绘制不抛异常', drawErr === null, drawErr]);
    game.closeSettings();
  } catch (e) {
    uxCases.push(['局内设置/换枪落地运行时冒烟', false, e.message]);
  }
}
const uxFail = uxCases.filter(([, pass]) => !pass).map(([name]) => name);

const ok = issueCount === 0 && missing === 0 && badExit === 0
  && reproducible && iaFail.length === 0 && camFail.length === 0
  && talentFail.length === 0 && stressFallback > 0
  && weaponFail.length === 0 && enemyFail.length === 0 && contentFail.length === 0
  && startUiFail.length === 0
  && mechanicFail.length === 0 && smokeFail.length === 0
  && balFail.length === 0 && uxFail.length === 0;

console.log('=== 生成器压测 ===');
console.log(`关卡总数        ${plans}  (常规 ${SEEDS * LEVELS} + 压力 ${STRESS.length * 40 * 4})`);
console.log(`自检异常        ${issueCount}`);
console.log(`保证房缺失/重复 ${missing}`);
console.log(`出口异常        ${badExit}`);
console.log(`走降级兜底      ${normalFallback + stressFallback}  (常规 ${normalFallback} / 压力 ${stressFallback})`);
console.log(`同种子可复现    ${reproducible ? 'OK' : 'FAIL'}`);
console.log('=== 交互仲裁 ===');
for (const [name, pass] of iaCases) console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}`);
console.log('=== 相机跟随 ===');
for (const [name, pass] of camCases) console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}`);
console.log(`  采样点 ${camSamples}（3 种房间尺寸 × 85 位置）`);
console.log('=== 天赋系统 ===');
for (const [name, pass] of talentCases) console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}`);
console.log('=== 武器与品质 ===');
for (const [name, pass] of weaponCases) console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}`);
console.log(`  武器 ${Object.keys(WEAPONS).length} 把｜`
  + RARITY_ORDER.map((r) => `${RARITIES[r].name}:${weaponsOfRarity(r).length}`).join(' '));
console.log(`  机制使用 ${Object.entries(mechanics).map(([k, v]) => `${k}:${v}`).join(' ')}`);
console.log(`  12 层 3000 次抽样：史诗+ ${lv12Top.length} 次，其中传说 ${lv12Legend.length} 次`);
console.log('=== 敌人与攻击 ===');
for (const [name, pass] of enemyCases) console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}`);
console.log(`  刷怪层数解锁 ${SPAWN_TABLE.map((s) => `${s.id}@${s.minLevel}`).join(' ')}`);
console.log('=== 精灵覆盖 ===');
for (const [name, pass] of contentCases) console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}`);
console.log('=== 开始界面与设置 ===');
for (const [name, pass] of startUiCases) console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}`);
console.log(`  设置项 ${SETTINGS.length}（${optionSettings.length} 项可切换 + 1 项恢复默认）`
  + `｜图鉴 ${codexExpected.weapon}/${codexExpected.enemy}/${codexExpected.talent}`);
console.log('=== 武器机制实跑 ===');
for (const [name, pass] of mechanicCases) console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}`);
console.log('=== 运行时冒烟 ===');
for (const [name, pass] of smokeCases) console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}`);
console.log('=== 平衡再调优 P0~P3 ===');
for (const [name, pass] of balCases) console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}`);
console.log('=== 本轮 UX 修复（局内设置 / 换枪落地）===');
for (const [name, pass, detail] of uxCases) {
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}${!pass && detail ? ` (${detail})` : ''}`);
}
if (samples.length) console.log('异常样本:\n  ' + samples.join('\n  '));
if (iaFail.length) console.log('交互仲裁失败: ' + iaFail.join('; '));
if (camFail.length) console.log('相机跟随失败: ' + camFail.join('; '));
if (talentFail.length) console.log('天赋系统失败: ' + talentFail.join('; '));
if (weaponFail.length) console.log('武器与品质失败: ' + weaponFail.join('; '));
if (enemyFail.length) console.log('敌人与攻击失败: ' + enemyFail.join('; '));
if (contentFail.length) console.log('精灵覆盖失败: ' + contentFail.join('; '));
if (startUiFail.length) console.log('开始界面失败: ' + startUiFail.join('; '));
if (missingSettingConsumers.length) console.log('  设置缺消费者: ' + missingSettingConsumers.join('; '));
if (mechanicFail.length) console.log('武器机制失败: ' + mechanicFail.join('; '));
if (smokeFail.length) console.log('运行时冒烟失败: ' + smokeFail.join('; '));
if (uxFail.length) console.log('本轮 UX 修复失败: ' + uxFail.join('; '));
if (inert.length) console.log('  未生效天赋: ' + inert.join(', '));
if (missingConsumers.length) console.log('  缺消费者: ' + missingConsumers.join('; '));
if (weaponIssues.length) console.log('  武器配置问题: ' + weaponIssues.join('; '));
if (enemyIssues.length) console.log('  敌人配置问题: ' + enemyIssues.join('; '));
if (missingSprites.length) console.log('  缺精灵: ' + missingSprites.join(', '));
if (!stressFallback) console.log('注意：压力用例未触发降级兜底，该路径未被覆盖');
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
