/**
 * 开始界面（主菜单）、设置面板与图鉴面板。
 *
 * 三块 UI 都遵循同一条约定：布局常量与命中检测一起导出，绘制端和输入端
 * 引用同一份坐标。天赋/商店面板当年就踩过「画的框和点的框不是同一个」，
 * 这里不重复。
 *
 * 纯函数为主，只有绘制会碰 Renderer；因此 npm run verify 可以不开浏览器
 * 直接单测命中检测与分页数学（见 scripts/verify-generator.mjs）。
 */
import type { Renderer } from '../render/Renderer';
import { COLORS, VIEW_H, VIEW_W } from '../data/balance';
import { ENEMIES, ENEMY_IDS, type EnemyAttack } from '../data/enemies';
import { TALENTS, TALENT_IDS } from '../data/talents';
import { LOOT_WEAPONS, WEAPONS } from '../data/weapons';
import { rarityColor, rarityOf } from '../data/rarity';
import { SETTINGS, optionIndex, settingLabel, type SettingValues } from '../data/settings';
import type { SaveData } from '../state/SaveManager';
import { wrapText } from './Panels';

export interface Rect { x: number; y: number; w: number; h: number }

const inRect = (x: number, y: number, r: Rect): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

const dim = (r: Renderer, alpha = 'e8'): void => {
  r.fillRect(0, 0, VIEW_W, VIEW_H, `#0d0f17${alpha}`);
};

// ---------------------------------------------------------------- 主菜单

export type MenuAction = 'start' | 'codex' | 'settings' | 'help';

export interface MenuItem {
  action: MenuAction;
  label: string;
  hint: string;
}

export const MENU_ITEMS: readonly MenuItem[] = [
  { action: 'start', label: '开始游戏', hint: '新开一局' },
  { action: 'codex', label: '图鉴', hint: '武器 / 敌人 / 天赋' },
  { action: 'settings', label: '设置', hint: '镜头 · 震动 · 界面' },
  { action: 'help', label: '操作说明', hint: '键位一览' },
];

export const MENU_LAYOUT = { x: 140, y: 78, w: 200, h: 26, gap: 5 } as const;

export function menuItemRect(i: number): Rect {
  const { x, y, w, h, gap } = MENU_LAYOUT;
  return { x, y: y + i * (h + gap), w, h };
}

export function hitMenuItem(x: number, y: number): number {
  for (let i = 0; i < MENU_ITEMS.length; i++) if (inRect(x, y, menuItemRect(i))) return i;
  return -1;
}

export function drawStartMenu(
  r: Renderer, meta: SaveData, selected: number, hover: number,
): void {
  dim(r, 'ee');

  r.text('ROGUE KNIGHT', VIEW_W / 2, 18, '#ffd479', 22, 'center');
  r.text('元气骑士式俯视角 Roguelike · 架构脚手架', VIEW_W / 2, 46, COLORS.text, 7, 'center');
  r.line(150, 62, VIEW_W - 150, 62, '#3a4155', 1);

  MENU_ITEMS.forEach((item, i) => {
    const b = menuItemRect(i);
    const active = i === selected || i === hover;
    const hot = i === hover;
    r.fillRect(b.x, b.y, b.w, b.h, active ? '#232c42' : '#1b2030');
    r.strokeRect(b.x, b.y, b.w, b.h, active ? '#ffd479' : '#4a5470', hot ? 2 : 1);
    if (active) r.fillRect(b.x + 1, b.y + 1, 2, b.h - 2, '#ffd479');
    r.text(`${i + 1}`, b.x + 10, b.y + 8, active ? '#ffd479' : COLORS.dim, 8);
    r.text(item.label, b.x + 26, b.y + 7, active ? '#ffffff' : COLORS.text, 10);
    r.text(item.hint, b.x + b.w - 9, b.y + 9, COLORS.dim, 6, 'right');
  });

  const best = meta.bestLevelTime;
  r.text(`宝石 ${meta.gems} · 最高 ${meta.bestLevel} 层 · 已玩 ${meta.runs} 局 · BOSS 击杀 ${meta.totalKills}`,
    VIEW_W / 2, 214, COLORS.text, 7, 'center');
  r.text(`最快单层 ${best > 0 ? clock(best) : '--:--'} · 总游戏时长 ${clock(meta.playTime)}`,
    VIEW_W / 2, 227, COLORS.dim, 7, 'center');
  r.text('↑↓ / W S 选择 · Enter 确认 · 也可直接点鼠标',
    VIEW_W / 2, 246, COLORS.dim, 6, 'center');
}

const clock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- 设置面板

export const SETTINGS_LAYOUT = { x: 110, y: 68, w: 260, h: 26, gap: 6 } as const;

export function settingRowRect(i: number): Rect {
  const { x, y, w, h, gap } = SETTINGS_LAYOUT;
  return { x, y: y + i * (h + gap), w, h };
}

export function hitSettingRow(x: number, y: number, count: number): number {
  for (let i = 0; i < count; i++) if (inRect(x, y, settingRowRect(i))) return i;
  return -1;
}

export function drawSettingsPanel(
  r: Renderer, values: SettingValues, selected: number, hover: number,
): void {
  dim(r, 'f2');
  r.text('设置', VIEW_W / 2, 20, '#ffd479', 16, 'center');
  r.text('改动立即生效并写入存档', VIEW_W / 2, 44, COLORS.dim, 7, 'center');

  SETTINGS.forEach((def, i) => {
    const b = settingRowRect(i);
    const active = i === selected || i === hover;
    const isReset = def.kind === 'action';
    r.fillRect(b.x, b.y, b.w, b.h, active ? '#232c42' : '#1b2030');
    r.strokeRect(b.x, b.y, b.w, b.h, active ? '#ffd479' : '#4a5470', 1);
    if (active) r.fillRect(b.x + 1, b.y + 1, 2, b.h - 2, isReset ? '#e05a5a' : '#ffd479');

    r.text(def.name, b.x + 12, b.y + 5, isReset ? '#ff9d9d' : COLORS.text, 9);
    r.text(def.desc, b.x + 12, b.y + 16, COLORS.dim, 6);

    if (isReset) {
      r.text('执行', b.x + b.w - 12, b.y + 7, active ? '#ff9d9d' : COLORS.dim, 9, 'right');
      return;
    }
    const label = settingLabel(values, def);
    if (def.kind === 'toggle') {
      const on = optionIndex(values, def) > 0;
      r.text(on ? '开' : '关', b.x + b.w - 12, b.y + 7,
        on ? '#8fd6a0' : COLORS.dim, 9, 'right');
    } else {
      r.text(`‹ ${label} ›`, b.x + b.w - 12, b.y + 7, '#ffd479', 9, 'right');
    }
  });

  r.text('↑↓ 选择 · ←→ / 点击 切换 · Esc 返回',
    VIEW_W / 2, 244, COLORS.dim, 7, 'center');
}

// ---------------------------------------------------------------- 图鉴

export type CodexTab = 'weapon' | 'enemy' | 'talent';

export const CODEX_TABS: readonly { id: CodexTab; label: string }[] = [
  { id: 'weapon', label: '武器' },
  { id: 'enemy', label: '敌人' },
  { id: 'talent', label: '天赋' },
];

export const CODEX_LAYOUT = {
  listX: 14, listY: 60, listW: 206, rowH: 17, rows: 11,
  detailX: 232, detailY: 60, detailW: 234, detailH: 187,
} as const;

const TAB_W = 88;
const TAB_H = 17;
const TAB_GAP = 6;

export function codexTabRect(i: number): Rect {
  const total = CODEX_TABS.length * TAB_W + (CODEX_TABS.length - 1) * TAB_GAP;
  return { x: (VIEW_W - total) / 2 + i * (TAB_W + TAB_GAP), y: 32, w: TAB_W, h: TAB_H };
}

export function hitCodexTab(x: number, y: number): number {
  for (let i = 0; i < CODEX_TABS.length; i++) if (inRect(x, y, codexTabRect(i))) return i;
  return -1;
}

export interface CodexEntry {
  id: string;
  name: string;
  color: string;
  tag: string;
}

/** 三类数据统一成「名字 + 颜色 + 右侧小标签」，列表渲染不用按类型分支。 */
export function codexEntries(tab: CodexTab): CodexEntry[] {
  if (tab === 'weapon') {
    return LOOT_WEAPONS.map((id) => {
      const w = WEAPONS[id];
      return { id, name: w.name, color: rarityColor(w.rarity), tag: rarityOf(w.rarity).name };
    });
  }
  if (tab === 'enemy') {
    return ENEMY_IDS.map((id) => {
      const e = ENEMIES[id];
      return { id, name: e.name, color: e.color, tag: `${e.hp} HP` };
    });
  }
  return TALENT_IDS.map((id) => {
    const t = TALENTS[id];
    return { id, name: t.name, color: t.color, tag: t.tag };
  });
}

/**
 * 滚动窗口起点：让选中项尽量停在窗口中间，避免翻页时列表「跳一下」。
 * 返回可用作 offset 的值，调用方不必再夹一次。
 */
export function codexOffset(selected: number, total: number): number {
  const { rows } = CODEX_LAYOUT;
  const max = Math.max(0, total - rows);
  return Math.min(max, Math.max(0, selected - Math.floor(rows / 2)));
}

export function codexRowRect(i: number): Rect {
  const { listX, listY, listW, rowH } = CODEX_LAYOUT;
  return { x: listX, y: listY + i * rowH, w: listW, h: rowH - 1 };
}

/** 返回窗口内的行下标（0..rows-1），不是数据下标；调用方自行加 offset。 */
export function hitCodexRow(x: number, y: number, count: number, offset: number): number {
  for (let i = 0; i < Math.min(CODEX_LAYOUT.rows, count - offset); i++) {
    if (inRect(x, y, codexRowRect(i))) return i;
  }
  return -1;
}

const AI_LABEL: Record<string, string> = {
  chaser: '追击', charger: '冲锋', shooter: '远程', orbiter: '绕圈', sentinel: '哨戒',
};

const ATTACK_LABEL: Record<EnemyAttack['kind'], string> = {
  melee: '近战', shot: '单发', spread: '扇形', grenade: '投掷', laser: '激光', summon: '召唤',
};

export function drawCodexPanel(
  r: Renderer, tab: CodexTab, selected: number, hoverRow: number,
): void {
  dim(r, 'f2');
  r.text('图 鉴', VIEW_W / 2, 8, '#ffd479', 12, 'center');

  CODEX_TABS.forEach((t, i) => {
    const b = codexTabRect(i);
    const on = t.id === tab;
    r.fillRect(b.x, b.y, b.w, b.h, on ? '#2c3550' : '#1b2030');
    r.strokeRect(b.x, b.y, b.w, b.h, on ? '#ffd479' : '#4a5470', 1);
    r.text(`${i + 1} ${t.label}`, b.x + b.w / 2, b.y + 5,
      on ? '#ffffff' : COLORS.dim, 8, 'center');
  });

  const list = codexEntries(tab);
  const offset = codexOffset(selected, list.length);
  const rows = Math.min(CODEX_LAYOUT.rows, list.length - offset);

  // 列表
  r.fillRect(CODEX_LAYOUT.listX, CODEX_LAYOUT.listY - 2, CODEX_LAYOUT.listW,
    CODEX_LAYOUT.rows * CODEX_LAYOUT.rowH + 3, '#141824cc');
  for (let i = 0; i < rows; i++) {
    const index = offset + i;
    const entry = list[index];
    if (!entry) break;
    const b = codexRowRect(i);
    const on = index === selected;
    const hot = i === hoverRow;
    if (on || hot) r.fillRect(b.x, b.y, b.w, b.h, on ? '#2c3550' : '#222a3c');
    r.text(entry.name, b.x + 7, b.y + 5, entry.color, 7);
    r.text(entry.tag, b.x + b.w - 7, b.y + 6, COLORS.dim, 6, 'right');
  }
  // 滚动条：条目数少于窗口时画满，视觉上比空着更清楚「到底还有没有」
  const barX = CODEX_LAYOUT.listX + CODEX_LAYOUT.listW + 3;
  const barH = CODEX_LAYOUT.rows * CODEX_LAYOUT.rowH;
  const thumbH = Math.max(12, (rows / list.length) * barH);
  const thumbY = CODEX_LAYOUT.listY - 2 + (list.length > rows
    ? (offset / (list.length - rows)) * (barH - thumbH) : 0);
  r.fillRect(barX, CODEX_LAYOUT.listY - 2, 3, barH, '#1b2030');
  r.fillRect(barX, thumbY, 3, thumbH, '#4a5470');

  const entry = list[Math.min(selected, list.length - 1)];
  if (entry) drawCodexDetail(r, tab, entry);

  r.text('1/2/3 或 ←→ 切页 · ↑↓ 翻条目 · Esc 返回',
    VIEW_W / 2, VIEW_H - 14, COLORS.dim, 6, 'center');
}

function drawCodexDetail(r: Renderer, tab: CodexTab, entry: CodexEntry): void {
  const { detailX: x, detailY: y, detailW: w, detailH: h } = CODEX_LAYOUT;
  r.fillRect(x, y - 2, w, h + 3, '#141824cc');
  r.strokeRect(x, y - 2, w, h + 3, '#3a4155', 1);
  r.fillRect(x + 1, y - 1, 3, h + 1, entry.color);

  r.text(entry.name, x + 10, y + 8, entry.color, 11);
  const cols = x + 10;
  const colW = (w - 20) / 2;

  if (tab === 'weapon') {
    const wp = WEAPONS[entry.id];
    r.text(`${rarityOf(wp.rarity).name} · ${wp.kind === 'melee' ? '近战' : '远程'}`,
      x + 10, y + 24, COLORS.dim, 6);
    r.line(x + 10, y + 35, x + w - 10, y + 35, '#3a4155', 1);

    const pairs: [string, string][] = [
      ['伤害', `${wp.damage}`],
      ['射速', `${wp.fireRate.toFixed(1)}/秒`],
      ['弹数', `${wp.pellets}`],
      ['耗能', wp.energy > 0 ? `${wp.energy}/发` : '不耗能'],
      ['弹速', wp.kind === 'melee' ? '—' : `${wp.speed}`],
      ['穿透', `${wp.pierce}`],
    ];
    pairs.forEach(([k, v], i) => {
      const cx = cols + (i % 2) * colW;
      const cy = y + 42 + Math.floor(i / 2) * 11;
      r.text(`${k}`, cx, cy, COLORS.dim, 6);
      r.text(v, cx + 34, cy, COLORS.text, 6);
    });

    const mech: string[] = [];
    if ((wp.burst ?? 1) > 1) mech.push(`连发×${wp.burst}`);
    if ((wp.bounce ?? 0) > 0) mech.push(`弹墙 ${wp.bounce}`);
    if ((wp.explode ?? 0) > 0) mech.push(`爆炸 ${wp.explode}px`);
    if ((wp.homing ?? 0) > 0) mech.push('追踪');
    if ((wp.lifesteal ?? 0) > 0) mech.push(`吸血 ${wp.lifesteal}`);
    if (wp.bulletLife) mech.push(`射程 ${wp.bulletLife}s`);
    r.text(`机制 ${mech.length ? mech.join(' · ') : '无'}`, x + 10, y + 80, '#8fb4ff', 6);

    wrapText(wp.desc, w - 22, 7).slice(0, 4).forEach((ln, i) => {
      r.text(ln, x + 10, y + 94 + i * 10, '#b9c2d8', 7);
    });
    return;
  }

  if (tab === 'enemy') {
    const e = ENEMIES[entry.id];
    r.text(`${AI_LABEL[e.ai] ?? e.ai} · ${e.hp} HP · 速度 ${e.speed} · 半径 ${e.radius}`,
      x + 10, y + 24, COLORS.dim, 6);
    r.line(x + 10, y + 35, x + w - 10, y + 35, '#3a4155', 1);

    r.text('攻击方式', x + 10, y + 41, COLORS.dim, 6);
    e.attacks.slice(0, 4).forEach((a, i) => {
      const parts = [`${ATTACK_LABEL[a.kind]}${a.count && a.count > 1 ? `×${a.count}` : ''}`,
        `前摇 ${a.windup}s`, `伤害 ${a.damage}`];
      if (a.kind === 'laser') parts.push(`宽 ${a.width}`);
      if (a.kind === 'grenade') parts.push(`爆 ${a.blast}`);
      r.text(`· ${parts.join('  ')}`, x + 12, y + 53 + i * 11, COLORS.text, 6);
    });

    let extraY = y + 53 + Math.min(4, e.attacks.length) * 11 + 4;
    if (e.touchDamage) {
      r.text(`· 接触伤害 ${e.touchDamage}`, x + 12, extraY, '#ff9d9d', 6);
      extraY += 11;
    }
    if (e.splitInto) {
      r.text(`· 死亡分裂 ${e.splitCount ?? 2} 只 ${ENEMIES[e.splitInto]?.name ?? ''}`,
        x + 12, extraY, '#8fd6a0', 6);
      extraY += 11;
    }
    if (e.attacks[0]?.summonId) {
      r.text(`· 召唤 ${ENEMIES[e.attacks[0].summonId]?.name ?? e.attacks[0].summonId}`,
        x + 12, extraY, '#c9a0ff', 6);
    }
    r.text(entry.id.startsWith('boss') ? 'BOSS · 每两层轮换一次' : '普通怪 · 按层数解锁',
      x + 10, y + h - 16, COLORS.dim, 6);
    return;
  }

  const t = TALENTS[entry.id];
  r.text(t.tag, x + 10, y + 24, COLORS.dim, 6);
  r.line(x + 10, y + 35, x + w - 10, y + 35, '#3a4155', 1);
  wrapText(t.desc, w - 22, 7).slice(0, 5).forEach((ln, i) => {
    r.text(ln, x + 10, y + 42 + i * 10, '#b9c2d8', 7);
  });

  const eff = t.effects.map((ef) => (ef.add !== undefined
    ? `${ef.stat} +${ef.add}` : `${ef.stat} ×${ef.mul}`));
  r.text('生效字段', x + 10, y + 96, COLORS.dim, 6);
  eff.slice(0, 4).forEach((s, i) => {
    r.text(s, x + 12, y + 107 + i * 10, '#8fd6a0', 6);
  });
  r.text(`图鉴共 ${TALENT_IDS.length} 条天赋`, x + 10, y + h - 16, COLORS.dim, 6);
}

// ---------------------------------------------------------------- 操作说明

const HELP_LINES = [
  ['WASD / 方向键', '八向移动'],
  ['鼠标', '独立瞄准，左键按住持续射击'],
  ['Space', '翻滚，带无敌帧，可穿过弹幕'],
  ['Q', '切换手持武器；换下的枪掉回地面可捡回'],
  ['E', '拾取 / 开门 / 商人 / 神龛（一次只吃一个目标）'],
  ['1 ~ 4', '天赋四选一 / 商店购买 / 暂停菜单选项'],
  ['P / Esc', '暂停菜单：继续 · 设置 · 返回主菜单（设置不丢本局）'],
  ['R / F3 / F9', '重开一局 / 调试浮层 / 换种子重建本层'],
];

export function drawHelpPanel(r: Renderer): void {
  dim(r, 'f2');
  r.text('操作说明', VIEW_W / 2, 22, '#ffd479', 16, 'center');
  r.text('键位都集中在 core/Input.ts，改一处即可改全局', VIEW_W / 2, 46, COLORS.dim, 7, 'center');

  HELP_LINES.forEach(([key, desc], i) => {
    const y = 68 + i * 17;
    r.fillRect(96, y - 3, 92, 15, '#1b2030');
    r.strokeRect(96, y - 3, 92, 15, '#4a5470', 1);
    r.text(key, 142, y, '#ffd479', 7, 'center');
    r.text(desc, 198, y, COLORS.text, 7);
  });

  r.text('Esc / Enter / 点击 返回', VIEW_W / 2, 232, COLORS.dim, 7, 'center');
}
