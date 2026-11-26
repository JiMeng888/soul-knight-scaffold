/**
 * 可复现随机数。关卡生成必须用注入的 RNG，不能用 Math.random：
 * 否则同一个 seed 重建不出同一张图（这是关卡生成器最隐蔽的一类 bug）。
 */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= p >>> 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class RNG {
  private s: number;
  readonly origin: number;

  constructor(seed: number) {
    this.origin = seed >>> 0;
    this.s = this.origin || 0x9e3779b9;
  }

  /** mulberry32 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 闭区间 [min, max] */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** 自带 Fisher-Yates，吃本实例的 rng —— 不要改用 Array.sort(() => Math.random())。 */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** 派生独立子流：房间内容用 (levelSeed, roomIndex) 决定，互不干扰。 */
  fork(salt: number): RNG {
    return new RNG(hashSeed(this.origin, salt));
  }
}
