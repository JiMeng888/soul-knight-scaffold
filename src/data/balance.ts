/** 全局数值。所有可调参数集中在这里，改一处即可调手感（M1 阶段只动这个文件 + 配置表）。 */
export const TILE = 16;
export const VIEW_W = 480;
export const VIEW_H = 270;

/** 房间内部尺寸固定集合，对标原作 15 / 21 / 25。尺寸已知，门的对齐计算才是精确的。 */
export const ROOM_SIZES = [15, 21, 25] as const;
export type RoomSize = (typeof ROOM_SIZES)[number];

export const GRID = 5;
export const CORRIDOR_TILES = 4;
/** 网格单元间距，按最大房间尺寸算，保证任意两间相邻房之间都留得下走廊。 */
export const CELL = (25 + 2 + CORRIDOR_TILES) * TILE;

export const BALANCE = {
  playerSpeed: 120,
  rollSpeed: 268,
  rollDuration: 0.28,
  /** 无敌帧刻意比翻滚略长：有延迟的输入才不会「明明滚了却挨打」。 */
  rollInvuln: 0.34,
  rollCooldown: 0.55,
  hurtStun: 0.16,
  hurtInvuln: 0.5,
  /**
   * 每秒回能 —— 能量供给的安全地板，不轻易动。
   *
   * 历史教训（两次，方向相反）：
   *   1. 回能 9 + 原始 35~48/s 能耗 → 40% 帧熄火、BOSS 房整层超时 —— 修掉；
   *   2. 回能 11 时饥饿率 0.7%、收回 9.5 后饥饿率反而归零 —— 曾以为再拧回能能让
   *      能量重新紧张，8 局水位实测（战斗中能量条 97.6% 贴满、一局捡 448 个能量球）
   *      证明这个判断是错的：饥饿率只统计「连一发都扣不起」的极端帧，在
   *      200 点大池 + 满地补给球下结构性为 0，它照不出能量经济。
   *
   * P1 的真正杠杆在别处：缩小能量池（characters.ts 200→110）+ 削减补给球产出
   * （Enemy.die / Room.clear），让持续开火能把条子打下去、清房间隙回满 ——
   * 能量重新成为「泼水 vs 留蓝」的节奏决策。回能 9.5 保持不动：它是玩家
   * 空蓝后 1 秒内攒够一发单发的保底，动它就会回到熄火死锁。
   */
  energyRegen: 9.5,
  armorRegenDelay: 3,
  /** 每秒恢复点数，有真实消费者（Player.update），不是摆设参数。 */
  armorRegenRate: 0.65,
  critMultiplier: 2,
  pickupRange: 24,
  /**
   * 换枪落地保护期（秒）。被顶替下来的旧武器掉回地面后，这段时间内不参与按 E 拾取，
   * 防止连按 E 时「捡 A→掉 B→捡 B→掉 A」无限对换，也不让落地枪抢占交互仲裁。
   */
  weaponDropGrace: 0.6,
  /** 镜头跟随平滑系数：越小越「缓慢」。4.5 ≈ 0.22s 时间常数，房间内缓缓跟上玩家。 */
  cameraLerp: 4.5,
  /** 相机可越过房间边界的像素，让门/玩家别贴屏幕边（走廊正好画在这里）。 */
  cameraEdgeMargin: 14,
  doorCooldown: 0.45,
  bulletLife: 2.2,
  maxDelta: 1 / 30,
  fixedStep: 1 / 60,
  /** 天赋间隔：每通过 N 层弹一次选择面板。1 = 每层结束都能自选（本次需求）。 */
  talentInterval: 1,
  /** 每次天赋面板的候选数；4 张卡刚好铺满 480 宽视口，5 张会溢出。 */
  talentChoices: 4,
  /** 商店房货位数。 */
  shopStockSize: 4,
  /** 奖励房金币堆数量。 */
  bonusCoinPiles: 10,
  /**
   * P0 多波次：深层战斗房把一波怪拆成 2~3 波分批出，制造持续压力、
   * 打断「一波 AOE 全清」。波间隔（秒）—— 太短玩家无喘息，太长机器人会误判卡死。
   */
  waveGap: 0.4,
  /** 从第几层起战斗房分 2 波 / 3 波。低层保持单波，不打扰新手。 */
  waveTwoFrom: 10,
  waveThreeFrom: 18,
  /**
   * 交互仲裁的距离权重（越小越优先）：score = 距离² × bias。
   * 传送门给最大的 1.5 —— 它是不可逆操作（直接切层，没捡的武器就没了），
   * 玩家想拿装备时绝不能被它抢走；装备 0.7 / 服务 0.85 依次优先。
   * 由 entities/Pickup.ts 的 interactBias() 把 kind 映射到这三项。
   */
  interactBias: { gear: 0.7, service: 0.85, portal: 1.5 },
} as const;

export const COLORS = {
  bg: '#14161f',
  floor: '#2b3040',
  floorAlt: '#30364a',
  wall: '#4a5470',
  wallTop: '#62708f',
  wallShadow: '#1d2230',
  door: '#c9a45b',
  doorLocked: '#8b4a4a',
  corridor: '#222737',
  hp: '#e05a5a',
  armor: '#6fa8dc',
  energy: '#5ec8c8',
  coin: '#f2c14e',
  text: '#e8eaf2',
  dim: '#8b93a8',
  bonus: '#e07ad0',
  shop: '#6fd0a0',
  shrine: '#c9a0ff',
} as const;
