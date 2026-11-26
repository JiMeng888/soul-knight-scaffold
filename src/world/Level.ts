import type { Vec2 } from '../core/math';
import { RNG, hashSeed } from '../core/RNG';
import { BALANCE, CELL, TILE } from '../data/balance';
import type { Renderer } from '../render/Renderer';
import { Room } from './Room';
import type { TemplateLibrary } from './RoomTemplate';
import type { Dir, LevelPlan } from './DungeonGenerator';

/**
 * 一层 = 一个场景，所有房间同时实例化并物理相邻。
 * 房间的世界原点按网格单元对齐，同一层共用一种尺寸，
 * 这样任意相邻房间的门中心线重合，走廊可以直连（尺寸混用会让门错位）。
 */
export class Level {
  readonly plan: LevelPlan;
  readonly rooms: Room[] = [];
  readonly library: TemplateLibrary;
  currentRoomId: number;
  private byId = new Map<number, Room>();

  constructor(plan: LevelPlan, library: TemplateLibrary) {
    this.plan = plan;
    this.library = library;
    const rng = new RNG(hashSeed(plan.seed, plan.level, 0x5eed));

    for (const rp of plan.rooms) {
      const roomW = (rp.size + 2) * TILE;
      const origin: Vec2 = {
        x: (rp.gx - 2) * CELL + (CELL - roomW) / 2,
        y: (rp.gy - 2) * CELL + (CELL - roomW) / 2,
      };
      // 同 (layerSeed, roomId) 永远选到同一张模板
      const template = library.pick(rp.size, rng.fork(rp.id + 1));
      const room = new Room(rp, template, origin);
      this.rooms.push(room);
      this.byId.set(rp.id, room);
    }

    this.currentRoomId = plan.startId;
  }

  get current(): Room {
    return this.byId.get(this.currentRoomId)!;
  }

  get startRoom(): Room {
    return this.byId.get(this.plan.startId)!;
  }

  roomById(id: number): Room | undefined {
    return this.byId.get(id);
  }

  /** 切房：只做数据切换 + 返回落点，没有加载。相机在 Game 里直接对齐到新房间的跟随位置 —— 过门是「传送玩家到对侧门」，插值平移会让玩家在飞行期间跑出屏幕。 */
  enter(id: number, entryDir?: Dir): Vec2 {
    this.currentRoomId = id;
    const room = this.current;
    room.doorCooldown = BALANCE.doorCooldown;
    return entryDir ? room.innerSpawn(entryDir, 2) : room.center;
  }

  draw(r: Renderer): void {
    this.current.draw(r);
  }
}
