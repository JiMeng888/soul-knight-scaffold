import { CHARACTER_IDS } from '../data/characters';
import { defaultSettings, normalizeSettings, type SettingValues } from '../data/settings';
import type { RunState } from './RunState';

/**
 * 永久成长（元数据）。只存「单局之外」的东西：宝石、升级、解锁、统计、设置。
 * 单局进度一律不落盘 —— roguelike 死亡本来就该损失本局。
 */
export interface SaveData {
  version: number;
  gems: number;
  upgrades: Record<string, number>;
  unlocked: string[];
  bestLevel: number;
  runs: number;
  totalKills: number;
  playTime: number;
  /** 最快单层用时（秒），0 = 尚无纪录 */
  bestLevelTime: number;
  /** 设置项：存的是「选项下标」，见 data/settings.ts */
  settings: SettingValues;
}

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'sks.save';
const TMP_KEY = `${SAVE_KEY}.tmp`;
const BAK_KEY = `${SAVE_KEY}.bak`;

const hasStorage = (): boolean => {
  try { return typeof localStorage !== 'undefined'; } catch { return false; }
};

export class GameState {
  data: SaveData;

  constructor() {
    this.data = this.load();
  }

  private defaults(): SaveData {
    return {
      version: SAVE_VERSION,
      gems: 0,
      upgrades: {},
      unlocked: [CHARACTER_IDS[0]],
      bestLevel: 1,
      runs: 0,
      totalKills: 0,
      playTime: 0,
      bestLevelTime: 0,
      settings: defaultSettings(),
    };
  }

  load(): SaveData {
    if (!hasStorage()) return this.defaults();
    for (const key of [SAVE_KEY, BAK_KEY, TMP_KEY]) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as SaveData;
        return this.migrate(parsed);
      } catch { /* 坏档继续回退下一个副本 */ }
    }
    return this.defaults();
  }

  /** 版本迁移分支。加字段时在这里补，不要直接改 defaults 后覆盖老档。 */
  private migrate(d: SaveData): SaveData {
    const base = this.defaults();
    const merged: SaveData = { ...base, ...d, version: SAVE_VERSION };
    merged.upgrades = { ...base.upgrades, ...(d.upgrades ?? {}) };
    merged.unlocked = Array.from(new Set([...base.unlocked, ...(d.unlocked ?? [])]));
    // 老档没有 settings 字段，手改坏档也可能塞进非法下标 —— 统一钳制回默认。
    merged.settings = normalizeSettings(d.settings);
    return merged;
  }

  /** 原子写入：tmp → 旧档改 bak → 正式档 → 清 tmp。中途崩溃不会毁档。 */
  save(): void {
    if (!hasStorage()) return;
    const json = JSON.stringify(this.data);
    try {
      localStorage.setItem(TMP_KEY, json);
      const prev = localStorage.getItem(SAVE_KEY);
      if (prev) localStorage.setItem(BAK_KEY, prev);
      localStorage.setItem(SAVE_KEY, json);
      localStorage.removeItem(TMP_KEY);
    } catch { /* 隐私模式 / 配额满：不影响本局 */ }
  }

  addGems(n: number): void {
    this.data.gems += n;
  }

  /** 设置统一从这里写回：钳制 + 落盘，调用方不用关心合法性。 */
  setSettings(values: SettingValues): void {
    this.data.settings = normalizeSettings(values);
    this.save();
  }

  recordRun(run: RunState): void {
    this.data.runs += 1;
    this.data.totalKills += run.kills;
    this.data.playTime += run.elapsed;
    this.data.bestLevel = Math.max(this.data.bestLevel, run.level);
    this.data.gems += run.coins;
    this.save();
  }

  /** 记录通过一层的用时。返回是否刷新了最佳纪录。 */
  recordLevelTime(seconds: number): boolean {
    if (seconds <= 0) return false;
    const best = this.data.bestLevelTime;
    if (best > 0 && seconds >= best) return false;
    this.data.bestLevelTime = seconds;
    this.save();
    return true;
  }

  buyUpgrade(id: string, cost: number): boolean {
    if (this.data.gems < cost) return false;
    this.data.gems -= cost;
    this.data.upgrades[id] = (this.data.upgrades[id] ?? 0) + 1;
    this.save();
    return true;
  }
}
