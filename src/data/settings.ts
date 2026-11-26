/**
 * 设置项配置表 —— 每一项都必须有真实消费者，不做「存了但没人读」的假开关。
 *
 * 值的存储方式刻意用「选项下标」而不是布尔/字符串：
 *   - 存档只存数字，改文案、加选项都不需要写迁移；
 *   - 读档时统一 normalizeSettings() 钳制，坏档（手改 localStorage、旧版本
 *     少一项）只会退回默认值，不会让某个设置变成 undefined 传到渲染层；
 *   - cycle 与 toggle 走同一套切换逻辑，设置面板不需要按类型写分支。
 *
 * 消费者对照（由 npm run verify 的源码检查锁住，删掉消费点会失败）：
 *   camera      → core/Game.ts 传 lerp 给 Renderer.followRoom
 *   screenShake → render/Renderer.shake() 的总开关
 *   crosshair   → ui/HUD.drawCrosshair
 *   minimap     → ui/HUD.drawMinimap
 */
export type SettingKind = 'cycle' | 'toggle' | 'action';

export interface SettingOption {
  /** 语义值，用于把下标翻译成实际参数 */
  value: string;
  label: string;
}

export interface SettingDef {
  id: string;
  name: string;
  desc: string;
  kind: SettingKind;
  options: readonly SettingOption[];
  /** 默认选项下标；action 行为 -1 */
  def: number;
  /** action 行的执行动作 */
  action?: 'reset';
}

export const SETTINGS: readonly SettingDef[] = [
  {
    id: 'camera',
    name: '镜头跟随',
    desc: '房间内镜头追人的速度。慢一点更容易看清门口的出口',
    kind: 'cycle',
    options: [
      { value: 'slow', label: '缓慢' },
      { value: 'normal', label: '标准' },
      { value: 'fast', label: '迅捷' },
    ],
    def: 1,
  },
  {
    id: 'screenShake',
    name: '屏幕震动',
    desc: '受击、爆炸、重武器开火时的镜头抖动',
    kind: 'toggle',
    options: [{ value: 'off', label: '关' }, { value: 'on', label: '开' }],
    def: 1,
  },
  {
    id: 'crosshair',
    name: '鼠标准星',
    desc: '在瞄准点画十字准星；关掉后靠子弹方向判断朝向',
    kind: 'toggle',
    options: [{ value: 'off', label: '关' }, { value: 'on', label: '开' }],
    def: 1,
  },
  {
    id: 'minimap',
    name: '小地图',
    desc: '右上角房间图，能看出入口、商店和 BOSS 房位置',
    kind: 'toggle',
    options: [{ value: 'off', label: '关' }, { value: 'on', label: '开' }],
    def: 1,
  },
  {
    id: 'reset',
    name: '恢复默认',
    desc: '把上面所有项恢复为出厂设置',
    kind: 'action',
    options: [],
    def: -1,
    action: 'reset',
  },
];

/** 镜头平滑系数：数值越大跟得越紧。BALANCE.cameraLerp 仍是「标准」档的基准。 */
export const CAMERA_LERP: Record<string, number> = { slow: 3, normal: 4.5, fast: 7 };

export type SettingValues = Record<string, number>;

const CYCLABLE = SETTINGS.filter((s) => s.kind !== 'action');

export const findSetting = (id: string): SettingDef | undefined =>
  SETTINGS.find((s) => s.id === id);

/** 出厂设置：只包含可循环/可切换的项，action 行不入档。 */
export function defaultSettings(): SettingValues {
  const out: SettingValues = {};
  for (const s of CYCLABLE) out[s.id] = s.def;
  return out;
}

/** 读档钳制：非数字、越界、缺失一律退回默认。返回新对象，不改入参。 */
export function normalizeSettings(raw: unknown): SettingValues {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: SettingValues = {};
  for (const s of CYCLABLE) {
    const v = src[s.id];
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : s.def;
    out[s.id] = n >= 0 && n < s.options.length ? n : s.def;
  }
  return out;
}

export function optionIndex(values: SettingValues, def: SettingDef): number {
  const v = values[def.id];
  return typeof v === 'number' && v >= 0 && v < def.options.length ? v : Math.max(0, def.def);
}

export function settingLabel(values: SettingValues, def: SettingDef): string {
  if (def.kind === 'action') return '执行';
  return def.options[optionIndex(values, def)]?.label ?? '—';
}

/** 循环切换（含反向）。返回新对象，方便直接塞回存档并触发一次比较。 */
export function cycleSetting(values: SettingValues, def: SettingDef, dir = 1): SettingValues {
  if (def.kind === 'action' || def.options.length === 0) return { ...values };
  const n = def.options.length;
  const i = (optionIndex(values, def) + dir + n) % n;
  return { ...values, [def.id]: i };
}

/** 把 toggle 的下标翻译成布尔。 */
export function flagOf(values: SettingValues, id: string): boolean {
  const def = findSetting(id);
  if (!def || def.options.length === 0) return false;
  return optionIndex(values, def) > 0;
}

/** camera 设置 → Renderer.followRoom 的 lerp 参数。未知值回落标准档。 */
export function cameraLerpOf(values: SettingValues): number {
  const def = findSetting('camera');
  if (!def) return CAMERA_LERP.normal;
  const key = def.options[optionIndex(values, def)]?.value ?? 'normal';
  return CAMERA_LERP[key] ?? CAMERA_LERP.normal;
}
