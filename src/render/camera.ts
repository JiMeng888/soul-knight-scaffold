import { clamp, type Vec2 } from '../core/math';

/**
 * 房间的最小几何契约。Room 天然满足（origin / worldW / center），
 * 这里刻意不 import Room：让相机目标成为与实体无关的纯函数，
 * npm run verify 里能用普通对象直接构造用例，不需要 DOM / Canvas。
 */
export interface CameraRoom {
  /** 外墙环左上角的世界坐标。 */
  origin: Vec2;
  /** 房间外框边长（正方形，含外墙环）。 */
  worldW: number;
  center: Vec2;
}

/**
 * 相机跟随目标：以玩家为中心，但把视口钳制在房间内。
 *
 * 为什么要跟随 + 钳制，而不是二选一：
 *  - 只锁房间中心：房间高 272~432px，视口只有 270px 高，玩家走到
 *    南/北门时连人带门都跑出屏幕 —— 这就是「看不到出口」的根因。
 *  - 完全自由跟随：本作一层只绘制当前房间（Level.draw → current.draw），
 *    镜头会把大片房间外的空背景带进画面。
 *
 * 分轴处理（房间是正方形，但视口 480×270 不是）：
 *  - 房间比视口大的轴（本项目只有纵向）：相机允许在
 *      [origin + half - margin, origin + worldW - half + margin]
 *    之间移动，玩家贴到哪边，视口就跟到哪边，门随之进入画面。
 *  - 房间比视口小的轴（本项目只有横向）：lo > hi，此时锁房间中心。
 *    整间房本来就在画面里，追人只会把房间推到一侧、露出更多空白。
 *
 * margin 让门和玩家不要贴着屏幕边（代价是露出极窄一条房间外背景，
 * 那里本来就画着走廊），由 BALANCE.cameraEdgeMargin 提供。
 */
export function cameraTarget(
  player: Vec2,
  room: CameraRoom,
  viewW: number,
  viewH: number,
  margin = 0,
): Vec2 {
  return {
    x: followAxis(player.x, room.origin.x, room.worldW, room.center.x, viewW / 2, margin),
    y: followAxis(player.y, room.origin.y, room.worldW, room.center.y, viewH / 2, margin),
  };
}

function followAxis(
  value: number,
  origin: number,
  size: number,
  center: number,
  half: number,
  margin: number,
): number {
  const lo = origin + half - margin;
  const hi = origin + size - half + margin;
  return lo <= hi ? clamp(value, lo, hi) : center;
}
