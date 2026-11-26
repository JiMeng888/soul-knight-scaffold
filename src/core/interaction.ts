import type { Vec2 } from './math';
import { dist2 } from './math';

/** 参与交互仲裁的最小契约：只要 id、位置、额外交互距离和优先级权重。 */
export interface Interactable {
  id: number;
  pos: Vec2;
  /** 相对基础拾取半径的额外距离（商人柜台更宽，用 14；一般交互物用 10）。 */
  reachBonus: number;
  /**
   * 交互权重：score = 距离² × bias，越小越优先。默认 1。
   * 装备（weapon/chest）给小值、传送门给大值 —— 传送门是不可逆操作
   * （直接切层，没捡的武器就没了），玩家想拿装备时绝不能被它抢走。
   * 由 entities/Pickup.ts 的 interactBias() 按 kind 映射，数值在 balance.ts。
   */
  bias?: number;
}

/**
 * 交互仲裁：从所有落在交互范围内的候选里，选出「优先级最高」的唯一一个。
 * 返回其 id；没按 E 或范围内没有候选时返回 -1。
 *
 * 排序用 score = 距离² × bias：bias=1 时退化为纯「取最近」，完全兼容旧行为。
 * 加 bias 是因为只按距离会在武器与传送门贴在一起时误进下一层 —— 早期靠
 * 「把交互物拉到房间两端」规避，但拾取范围天赋会放大半径，间距随时失效。
 *
 * 为什么需要唯一目标：Input.justPressed('KeyE') 在同一个逻辑步里对**每一个**
 * pickup 都返回 true。若让 pickup 各自判断，一次按键会把范围内所有交互物
 * 全部消费。这里把它变成纯函数，可单测、与渲染无关、不依赖实体类型。
 */
export function pickInteractTarget(
  pressed: boolean,
  player: Vec2,
  baseRange: number,
  rangeMul: number,
  items: Iterable<Interactable>,
): number {
  if (!pressed) return -1;
  let bestId = -1;
  let bestScore = Infinity;
  for (const it of items) {
    const reach = baseRange * rangeMul + it.reachBonus;
    const d = dist2(it.pos.x, it.pos.y, player.x, player.y);
    if (d > reach * reach) continue;
    const score = d * (it.bias ?? 1);
    if (score < bestScore) {
      bestScore = score;
      bestId = it.id;
    }
  }
  return bestId;
}
