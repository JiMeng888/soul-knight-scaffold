import { RNG, hashSeed } from '../core/RNG';
import { GRID, ROOM_SIZES, type RoomSize } from '../data/balance';

export type Dir = 'n' | 'e' | 's' | 'w';
export const DIRS: readonly Dir[] = ['n', 'e', 's', 'w'];
export const DELTA: Record<Dir, readonly [number, number]> = {
  n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0],
};
export const OPPOSITE: Record<Dir, Dir> = { n: 's', s: 'n', e: 'w', w: 'e' };

export enum RoomType {
  START = 'start',
  COMBAT = 'combat',
  TREASURE = 'treasure',
  /** 奖励房：无敌人，满地金币 / 回复 / 宝箱 / 免费天赋神龛 */
  BONUS = 'bonus',
  /** 商店房：无敌人，靠近商人打开购买面板 */
  SHOP = 'shop',
  EXIT = 'exit',
}

/**
 * 每层必须「恰好一个」的非战斗房。单一事实源：生成器、validatePlan、
 * npm run verify 压测脚本都读它 —— 三处各写一份名单会悄悄漂移，正是这类
 * 静默 bug 的温床。
 */
export const GUARANTEED_TYPES: readonly RoomType[] = [RoomType.SHOP, RoomType.BONUS];

export interface RoomPlan {
  id: number;
  gx: number;
  gy: number;
  type: RoomType;
  size: RoomSize;
  /** 方向 -> 邻居房间 id。门只开在物理相邻的房间之间。 */
  doors: Partial<Record<Dir, number>>;
  depth: number;
}

export interface LevelPlan {
  seed: number;
  level: number;
  roomSize: RoomSize;
  rooms: RoomPlan[];
  startId: number;
  exitId: number;
  requiredBattles: number;
  /** 保证房因空位不足而走「就地改类型」降级的次数。压测会专门统计它。 */
  fallbackCount: number;
}

/** 仅用于压测：拉长主干或缩小网格，逼出极端布局以验证降级路径。正常调用不传。 */
export interface GeneratorConfig {
  grid?: number;
  mainLen?: number;
}

interface Slot { parent: RoomPlan; dir: Dir; gx: number; gy: number; }

/**
 * 5×5 网格，中心入口，主干只走正交步，门图严格是一棵树。
 *
 * 三个踩过的坑（跨种子压力测试验证过）：
 *  - 允许斜向步进 → 连续两房在网格里斜对角、没有共享墙 → 挖不出门 → 楼层不可通关。
 *  - 新格子触碰主干上「非前驱」的格子 → 会在那里多开一道门，形成绕过战斗的捷径，
 *    游戏照跑不报错，只是楼层变短、requiredBattles 形同虚设。
 *    所以候选格必须满足：除来源格外，其它正交邻居都没有房间。
 *  - 保证房（商店 / 奖励）混在普通分支里按序抢位置 → 受上面这条约束，超过一半
 *    的层会静默地一个都不生成（200 种子 × 8 层：商店缺 53%、奖励缺 66%），
 *    且 validatePlan 不检查它们、F3 永远显示 OK。
 */
export function generateLevel(seed: number, level: number, config: GeneratorConfig = {}): LevelPlan {
  const rng = new RNG(hashSeed(seed, level * 7919 + 13));
  const roomSize = rng.pick(ROOM_SIZES) as RoomSize;
  const grid = config.grid ?? GRID;
  const center = Math.floor(grid / 2);
  const rooms: RoomPlan[] = [];
  const occupied = new Set<string>();
  let fallbackCount = 0;

  const key = (gx: number, gy: number): string => `${gx},${gy}`;
  const inBounds = (gx: number, gy: number): boolean =>
    gx >= 0 && gy >= 0 && gx < grid && gy < grid;

  /** 除来源格外，还有多少个已占用邻居。必须为 0。 */
  const foreignNeighbours = (gx: number, gy: number, fromX: number, fromY: number): number => {
    let n = 0;
    for (const d of DIRS) {
      const [dx, dy] = DELTA[d];
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx === fromX && ny === fromY) continue;
      if (occupied.has(key(nx, ny))) n++;
    }
    return n;
  };

  /** 一个可挂新房子的合法空位；不合法返回 null。集中定义，主干与分支共用同一套规则。 */
  const legalSlot = (parent: RoomPlan, dir: Dir): Slot | null => {
    const [dx, dy] = DELTA[dir];
    const gx = parent.gx + dx;
    const gy = parent.gy + dy;
    if (!inBounds(gx, gy) || occupied.has(key(gx, gy))) return null;
    if (foreignNeighbours(gx, gy, parent.gx, parent.gy) > 0) return null;
    return { parent, dir, gx, gy };
  };

  const add = (gx: number, gy: number, type: RoomType, depth: number): RoomPlan => {
    const r: RoomPlan = { id: rooms.length, gx, gy, type, size: roomSize, doors: {}, depth };
    rooms.push(r);
    occupied.add(key(gx, gy));
    return r;
  };

  const link = (a: RoomPlan, b: RoomPlan, dir: Dir): void => {
    a.doors[dir] = b.id;
    b.doors[OPPOSITE[dir]] = a.id;
  };

  const start = add(center, center, RoomType.START, 0);
  let cur = start;
  let lastDir: Dir = 'e';
  const mainLen = config.mainLen ?? Math.min(3 + Math.ceil(level / 2), 6);

  for (let step = 0; step < mainLen; step++) {
    const options: Array<{ dir: Dir; slot: Slot; score: number }> = [];
    for (const dir of DIRS) {
      const slot = legalSlot(cur, dir);
      if (!slot) continue;
      const { gx: nx, gy: ny } = slot;
      const edgeBonus = nx === 0 || ny === 0 || nx === grid - 1 || ny === grid - 1 ? 2 : 0;
      options.push({
        dir, slot,
        score: edgeBonus + (dir === lastDir ? 1 : 0) + rng.next(),
      });
    }
    if (!options.length) break;
    options.sort((a, b) => b.score - a.score);
    const best = options[0];
    const next = add(best.slot.gx, best.slot.gy, RoomType.COMBAT, step + 1);
    link(cur, next, best.dir);
    lastDir = best.dir;
    cur = next;
  }

  // 主干末端即出口（BOSS 房）。中心入口 + 边缘出口，靠小地图补方向感。
  cur.type = RoomType.EXIT;
  const exitId = cur.id;

  // ── 保证房：结构性保证，不是「尽力而为」 ─────────────────────────────
  // 早期两版都栽在同一个点：把 SHOP/BONUS 混进普通分支按序抢位置，受
  // foreignNeighbours 约束，超过一半的层静默缺失，而且完全不报错。
  // 这一版三层防线：
  //   1) 一次性收集全部合法空位并打乱 → 两个保证房公平取位，不串行抢，
  //      每次取位前重新校验（前一个放置可能改变了邻居占用情况）；
  //   2) 所有房间生成完后统一兜底：挂不上的保证房，把一个普通战斗/宝箱房
  //      「就地改类型」补上，不新增格子、不新增门，树形门图完全不变；
  //   3) 末尾 fail-fast 断言 + validatePlan 硬契约 + npm run verify 常驻压测。
  const trunk = rooms.slice();
  // 整条主干都作为挂点（含起点 / 出口）：中段战斗房被主干链夹住，四周
  // 正交空格往往因 foreignNeighbours>0 全被排除，只挂中段会让
  // placeFromSlots 几乎必然失败、退化成「全量改类型」，保证房全压在
  // 必经路径上。链的两端与边缘才留得下合法叶子。
  const slots: Slot[] = rng.shuffle(
    trunk.flatMap((parent) => DIRS.map((dir) => legalSlot(parent, dir)).filter((s): s is Slot => s !== null)),
  );

  const placeFromSlots = (type: RoomType): boolean => {
    while (slots.length) {
      const s = slots.pop()!;
      // 同一个 (parent, dir) 的格子固定，但前面的放置可能已占掉它或它的邻居。
      if (!legalSlot(s.parent, s.dir)) continue;
      const leaf = add(s.gx, s.gy, type, s.parent.depth + 1);
      link(s.parent, leaf, s.dir);
      return true;
    }
    return false;
  };

  // 先尽力挂；挂不上的留给末尾的统一兜底 —— 那时所有分支房都已生成，
  // 可改类型的候选池最大。这里不抛错，避免把可降级的情况误判成失败。
  for (const type of GUARANTEED_TYPES) placeFromSlots(type);

  // 普通分支只挂主干战斗房，避免挂到商店/奖励房上形成「分支的分支」。
  // 非战斗房都不计入 requiredBattles（通关判定只看出口房 + 传送门）。
  const candidates = rooms.filter((r) => r.type === RoomType.COMBAT);
  const parents = candidates.length ? rng.shuffle(candidates) : [start];
  const extraTypes: readonly RoomType[] = [
    RoomType.TREASURE, RoomType.COMBAT, RoomType.TREASURE,
  ];
  const extraCount = Math.min(2 + Math.floor(level / 2), extraTypes.length);
  for (let i = 0; i < extraCount; i++) {
    const parent = parents[i % parents.length];
    for (const dir of rng.shuffle([...DIRS])) {
      const slot = legalSlot(parent, dir);
      if (!slot) continue;
      const leaf = add(slot.gx, slot.gy, extraTypes[i], parent.depth + 1);
      link(parent, leaf, dir);
      break;
    }
  }

  // 最终兜底 + fail-fast：所有房间都在了，缺哪个保证房就「就地改类型」补上。
  // 不新增格子、不新增门 → 树形门图不变；优先挑支线的普通战斗/宝箱房，
  // 尽量不动主干必经路径。改完仍缺席就立刻炸，绝不静默吞掉。
  for (const t of GUARANTEED_TYPES) {
    if (rooms.some((r) => r.type === t)) continue;
    const victim = rooms.find((r) =>
      r.id !== start.id && r.id !== exitId
      && (r.type === RoomType.COMBAT || r.type === RoomType.TREASURE),
    );
    if (!victim) {
      throw new Error(`[DungeonGenerator] 保证房 ${t} 无可用兜底房 seed=${seed} level=${level}`);
    }
    victim.type = t;
    fallbackCount++;
  }

  return {
    seed, level, roomSize, rooms,
    startId: start.id,
    exitId,
    fallbackCount,
    requiredBattles: rooms.filter((r) => r.type === RoomType.COMBAT || r.type === RoomType.EXIT).length,
  };
}

/**
 * 关卡自检：把「静默错误」显性化。F3 浮层与 npm run verify 都跑这一份。
 * 除了门图正确性，还把保证房契约写成硬不变量 —— 早期 bug 之所以「完全
 * 不报错」，根因就是自检里根本没有这一维。
 */
export function validatePlan(plan: LevelPlan): string[] {
  const issues: string[] = [];
  const byId = new Map(plan.rooms.map((r) => [r.id, r]));

  for (const r of plan.rooms) {
    for (const [dir, id] of Object.entries(r.doors) as Array<[Dir, number]>) {
      const other = byId.get(id);
      if (!other) { issues.push(`房间 ${r.id} 的 ${dir} 门指向不存在的 ${id}`); continue; }
      if (other.doors[OPPOSITE[dir]] !== r.id) issues.push(`房间 ${r.id} 与 ${id} 的门不成对`);
      // 门必须连到正交相邻格：斜向步进会挖不出门，且这一条不查就永远沉默。
      const [dx, dy] = DELTA[dir];
      if (other.gx !== r.gx + dx || other.gy !== r.gy + dy) {
        issues.push(`房间 ${r.id} 的 ${dir} 门连到非相邻格 ${id}`);
      }
    }
  }

  const seen = new Set<number>();
  const queue = [plan.startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const r = byId.get(id);
    if (r) for (const target of Object.values(r.doors)) queue.push(target);
  }
  if (seen.size !== plan.rooms.length) {
    issues.push(`只有 ${seen.size}/${plan.rooms.length} 个房间从起点可达`);
  }

  // 可达 + 边数 = n-1 ⟺ 门图是树。多一条边就是绕过战斗的捷径。
  const edges = plan.rooms.reduce((n, r) => n + Object.keys(r.doors).length, 0) / 2;
  if (edges !== plan.rooms.length - 1) {
    issues.push(`门图不是树：${edges} 条边 / ${plan.rooms.length} 个房间（应为 ${plan.rooms.length - 1} 条）`);
  }

  // 保证房契约：每层恰好一个，且不能是起点/出口。
  for (const t of GUARANTEED_TYPES) {
    const found = plan.rooms.filter((r) => r.type === t);
    if (found.length !== 1) issues.push(`保证房 ${t} 应恰好 1 个，实际 ${found.length} 个`);
    for (const r of found) {
      if (r.id === plan.startId || r.id === plan.exitId) {
        issues.push(`保证房 ${t}(#${r.id}) 不能是起点/出口房`);
      }
    }
  }

  const battles = plan.rooms.filter(
    (r) => r.type === RoomType.COMBAT || r.type === RoomType.EXIT,
  ).length;
  if (plan.requiredBattles !== battles) {
    issues.push(`requiredBattles=${plan.requiredBattles} 与实际战斗房 ${battles} 不一致`);
  }

  return issues;
}
