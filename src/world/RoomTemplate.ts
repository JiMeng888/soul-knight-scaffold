import type { Vec2 } from '../core/math';
import { RNG } from '../core/RNG';
import type { RoomSize } from '../data/balance';

/**
 * 房间地形模板。只描述「内部」，不含外墙环；'.' 可走，'#' 实心。
 *
 * 两条不变量由 problems() 强制，而不是靠人自觉 —— 它们出错都是静默的：
 *   1. 外圈必须留空：Level 会在墙环任意位置挖门，模板外圈若是实心就会堵死门。
 *   2. 内部必须全连通：封死的口袋会困住敌人 → 房间永远清不掉 → 楼层无法通关。
 */
export class RoomTemplate {
  readonly id: string;
  readonly size: number;
  /** walls[y][x] */
  readonly walls: boolean[][];

  constructor(id: string, size: number, walls: boolean[][]) {
    this.id = id;
    this.size = size;
    this.walls = walls;
  }

  static fromAscii(id: string, rows: string[]): RoomTemplate {
    const size = rows.length;
    if (rows.some((r) => r.length !== size)) {
      throw new Error(`模板 ${id} 不是正方形: ${rows.map((r) => r.length).join(',')}`);
    }
    const walls = rows.map((r) => Array.from(r, (c) => c === '#'));
    return new RoomTemplate(id, size, walls);
  }

  /** 程序化生成柱子房；生成后自检，不合规就重来，最终以空房保底。 */
  static generate(id: string, size: number, rng: RNG): RoomTemplate {
    const empty = (): boolean[][] =>
      Array.from({ length: size }, () => Array<boolean>(size).fill(false));

    for (let attempt = 0; attempt < 16; attempt++) {
      const walls = empty();
      const pads = rng.int(3, 6);
      for (let i = 0; i < pads; i++) {
        const w = rng.int(2, 4);
        const h = rng.int(1, 3);
        const x = rng.int(2, size - 3 - w);
        const y = rng.int(2, size - 3 - h);
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            if (rng.chance(0.82)) walls[y + dy][x + dx] = true;
          }
        }
      }
      const t = new RoomTemplate(id, size, walls);
      if (t.problems().length === 0) return t;
    }
    return new RoomTemplate(`${id}_empty`, size, empty());
  }

  problems(): string[] {
    const issues: string[] = [];
    const n = this.size;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if ((x === 0 || y === 0 || x === n - 1 || y === n - 1) && this.walls[y][x]) {
          issues.push(`外圈 (${x},${y}) 是墙，可能堵死门`);
        }
      }
    }

    let total = 0;
    let start: Vec2 | null = null;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!this.walls[y][x]) { total++; if (!start) start = { x, y }; }
      }
    }
    if (!start) { issues.push('没有可走格'); return issues; }

    const seen = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
    const queue: Vec2[] = [start];
    seen[start.y][start.x] = true;
    let visited = 0;
    while (queue.length) {
      const p = queue.pop()!;
      visited++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        if (seen[ny][nx] || this.walls[ny][nx]) continue;
        seen[ny][nx] = true;
        queue.push({ x: nx, y: ny });
      }
    }
    if (visited !== total) issues.push(`内部不连通：${total - visited} 个可走格被封死`);
    return issues;
  }

  isWall(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return true;
    return this.walls[y][x];
  }

  /** 距边界 >= minBorder 的可走格。敌人必须生在这些格上，且不能贴门（会秒杀刚进门的玩家）。 */
  walkableTiles(minBorder = 2): Vec2[] {
    const out: Vec2[] = [];
    for (let y = minBorder; y < this.size - minBorder; y++) {
      for (let x = minBorder; x < this.size - minBorder; x++) {
        if (!this.walls[y][x]) out.push({ x, y });
      }
    }
    return out;
  }
}

/** 手搭模板：15×15 对称柱厅。扩展示范 —— 换掉这个文件就能改房间地形。 */
export const HANDMADE_15: string[] = [
  '...............',
  '...............',
  '..##.....##....',
  '..##.....##....',
  '...............',
  '.....#####.....',
  '...............',
  '...............',
  '.....#####.....',
  '...............',
  '..##.....##....',
  '..##.....##....',
  '...............',
  '...............',
  '...............',
];

/** 模板目录：按尺寸挑选，同一 seed 选到同一张，保证可复现。 */
export class TemplateLibrary {
  private bySize = new Map<RoomSize, RoomTemplate[]>();

  constructor() {
    this.bySize.set(15, [RoomTemplate.fromAscii('hall_15', HANDMADE_15)]);
    const base = new RNG(0xc0ffee);
    for (const size of [21, 25] as RoomSize[]) {
      const list: RoomTemplate[] = [];
      for (let i = 0; i < 3; i++) {
        list.push(RoomTemplate.generate(`${size}_${i}`, size, base.fork(size * 10 + i)));
      }
      this.bySize.set(size, list);
    }
  }

  pick(size: RoomSize, rng: RNG): RoomTemplate {
    const list = this.bySize.get(size) ?? [];
    return list.length ? rng.pick(list) : RoomTemplate.fromAscii('fallback', HANDMADE_15);
  }

  validateAll(): string[] {
    const issues: string[] = [];
    for (const [size, list] of this.bySize) {
      for (const t of list) {
        for (const p of t.problems()) issues.push(`[${size}] ${t.id}: ${p}`);
      }
    }
    return issues;
  }
}
