import type { GameCtx } from '../core/types';
import { COLORS, VIEW_H, VIEW_W } from '../data/balance';
import { formatTime } from './HUD';
import { getWeapon } from '../data/weapons';
import type { Renderer } from '../render/Renderer';
import type { GameState } from '../state/SaveManager';
import type { RunState } from '../state/RunState';
import type { HudInfo } from './HUD';

const dim = (r: Renderer, alpha = 'dd'): void => {
  r.fillRect(0, 0, VIEW_W, VIEW_H, `#0d0f17${alpha}`);
};

export function drawDead(r: Renderer, run: RunState, meta: GameState): void {
  dim(r, 'e0');
  r.text('本局结束', VIEW_W / 2, 82, '#ff8a8a', 20, 'center');
  const lines = [
    `到达第 ${run.level} 层 · 击杀 ${run.kills} · 金币 ${run.coins}`,
    `用时 ${Math.floor(run.elapsed / 60)} 分 ${Math.floor(run.elapsed % 60)} 秒`,
    `本层 ${formatTime(run.levelElapsed, true)} · 最快单层 ${meta.data.bestLevelTime > 0 ? formatTime(meta.data.bestLevelTime) : '--:--'}`,
    `获得天赋 ${run.talents.length} 个 · 永久宝石已结算：${meta.data.gems}`,
  ];
  lines.forEach((t, i) => r.text(t, VIEW_W / 2, 120 + i * 16, COLORS.text, 8, 'center'));
  r.text('按 R 或点击画面再来一局 · Esc 回主菜单', VIEW_W / 2, 196, '#ffd479', 9, 'center');
}

// ---------------------------------------------------------------- 暂停菜单
// 布局与命中检测同源（和主菜单 / 面板同一约定）：pauseItemRect 同时被绘制端和
// Game.onPointerDown 使用，避免「画的框和点的框不是同一个」。
export type PauseAction = 'resume' | 'settings' | 'menu';
export const PAUSE_ITEMS: readonly { action: PauseAction; label: string; hint: string }[] = [
  { action: 'resume', label: '继续游戏', hint: 'P / Esc' },
  { action: 'settings', label: '设置', hint: '镜头 · 震动 · 界面' },
  { action: 'menu', label: '返回主菜单', hint: '放弃本局' },
];
export const PAUSE_LAYOUT = { x: 140, y: 96, w: 200, h: 26, gap: 6 } as const;

export function pauseItemRect(i: number): { x: number; y: number; w: number; h: number } {
  const { x, y, w, h, gap } = PAUSE_LAYOUT;
  return { x, y: y + i * (h + gap), w, h };
}

export function hitPauseItem(x: number, y: number): number {
  for (let i = 0; i < PAUSE_ITEMS.length; i++) {
    const b = pauseItemRect(i);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
  }
  return -1;
}

/** 局内暂停菜单：继续 / 设置 / 返回主菜单。selected 键盘选中，hover 鼠标悬停。 */
export function drawPause(r: Renderer, selected: number, hover: number): void {
  dim(r, 'cc');
  r.text('暂 停', VIEW_W / 2, 58, '#ffd479', 18, 'center');
  r.text('设置改动立即生效，本局进度会保留', VIEW_W / 2, 78, COLORS.dim, 7, 'center');
  PAUSE_ITEMS.forEach((item, i) => {
    const b = pauseItemRect(i);
    const active = i === selected || i === hover;
    const danger = item.action === 'menu';
    r.fillRect(b.x, b.y, b.w, b.h, active ? '#232c42' : '#1b2030');
    r.strokeRect(b.x, b.y, b.w, b.h, active ? (danger ? '#e05a5a' : '#ffd479') : '#4a5470', 1);
    if (active) r.fillRect(b.x + 1, b.y + 1, 2, b.h - 2, danger ? '#e05a5a' : '#ffd479');
    r.text(`${i + 1}`, b.x + 10, b.y + 8, active ? '#ffd479' : COLORS.dim, 8);
    r.text(item.label, b.x + 26, b.y + 7, danger ? '#ff9d9d' : (active ? '#ffffff' : COLORS.text), 10);
    r.text(item.hint, b.x + b.w - 9, b.y + 9, COLORS.dim, 6, 'right');
  });
  r.text('↑↓ / W S 选择 · Enter 确认 · P / Esc 继续 · 也可直接点鼠标',
    VIEW_W / 2, VIEW_H - 12, COLORS.dim, 6, 'center');
}

/** F3 调试浮层：把「参数有没有被读」「关卡自检过不过」这类静默问题显性化。 */
export function drawDebug(r: Renderer, ctx: GameCtx, info: HudInfo): void {
  const x = 8;
  const y = 42;
  r.fillRect(x, y, 176, 142, '#0d0f17e8');
  r.strokeRect(x, y, 176, 142, '#4a5470', 1);

  const room = ctx.room;
  const lines = [
    `FPS ${info.fps.toFixed(0)}   seed ${info.seed}`,
    `level ${ctx.run.level}  rooms ${ctx.level.plan.rooms.length}  battles ${ctx.level.plan.requiredBattles}`,
    `room #${room.plan.id} ${room.plan.type} / ${room.state}`,
    `player ${ctx.player.state}  inv ${ctx.player.invuln.toFixed(2)}`,
    `hp ${ctx.run.hp.toFixed(1)} 盾 ${ctx.run.armor.toFixed(1)} 蓝 ${ctx.run.energy.toFixed(0)}`,
    `weapon ${getWeapon(ctx.run.currentWeaponId).id}`,
    `pool: e${ctx.enemies.activeCount}/p${ctx.projectiles.activeCount}`,
    `      d${ctx.pickups.activeCount}/fx${ctx.particles.activeCount}`,
    `本层 ${formatTime(ctx.run.levelElapsed, true)} 总 ${formatTime(ctx.run.elapsed)}`,
    `talents ${ctx.run.talents.length} [${ctx.run.talents.slice(-3).join(' ') || '-'}]`,
    `shop stock ${ctx.room.shopStock.length}`,
    `模板自检 ${info.templateIssues.length ? `${info.templateIssues.length} 项异常` : 'OK'}`,
    `关卡自检 ${info.levelIssues.length ? `${info.levelIssues.length} 项异常` : 'OK'}`,
  ];
  lines.forEach((t, i) => r.text(t, x + 5, y + 5 + i * 10,
    t.includes('异常') ? '#ff8a8a' : '#b9c2d8', 7));
}
