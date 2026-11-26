import type { Poolable } from './types';

/**
 * 泛型对象池。子弹 / 敌人 / 掉落 / 粒子这类高频生成销毁的对象全部走这里，
 * 用「失活标记 + 每帧 sweep 原地压缩」代替 destroy/new，避免弹幕场景下 GC 抖动。
 */
export class Pool<T extends Poolable> {
  private free: T[] = [];
  private items: T[] = [];

  constructor(private readonly factory: () => T, prewarm = 0) {
    for (let i = 0; i < prewarm; i++) this.free.push(factory());
  }

  spawn(): T {
    const o = this.free.pop() ?? this.factory();
    o.reset();
    o.alive = true;
    this.items.push(o);
    return o;
  }

  /** 遍历期间允许把对象标记为 !alive，不会破坏迭代。 */
  forEachActive(fn: (o: T) => void): void {
    for (let i = 0; i < this.items.length; i++) {
      const o = this.items[i];
      if (o.alive) fn(o);
    }
  }

  /** 每帧末调用：回收失活对象、原地压缩活跃数组（不 splice）。 */
  sweep(): void {
    let w = 0;
    for (let i = 0; i < this.items.length; i++) {
      const o = this.items[i];
      if (o.alive) this.items[w++] = o;
      else this.free.push(o);
    }
    this.items.length = w;
  }

  clear(): void {
    for (const o of this.items) o.alive = false;
    this.sweep();
  }

  get activeCount(): number { return this.items.length; }
  get freeCount(): number { return this.free.length; }
  get all(): readonly T[] { return this.items; }
}
