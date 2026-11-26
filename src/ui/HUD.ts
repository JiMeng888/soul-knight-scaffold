import type { GameCtx } from '../core/types';
import { COLORS, VIEW_H, VIEW_W } from '../data/balance';
import { getWeapon, rarityLabel } from '../data/weapons';
import { rarityColor } from '../data/rarity';
import type { Renderer } from '../render/Renderer';
import { DIRS, RoomType } from '../world/DungeonGenerator';

export type GameMode =
  | 'menu' | 'settings' | 'codex' | 'help'
  | 'playing' | 'paused' | 'dead' | 'talent' | 'shop';

/** 秒 → mm:ss，可选一位小数（本层计时用）。 */
export const formatTime = (sec: number, tenths = false): string => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const base = `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return tenths ? `${base}.${Math.floor((s % 1) * 10)}` : base;
};

export interface HudInfo {
  mode: GameMode;
  fps: number;
  debug: boolean;
  notices: readonly { text: string; color?: string }[];
  templateIssues: readonly string[];
  levelIssues: readonly string[];
  seed: number;
  /** 设置项开关由 Game 从存档读出来后传入，HUD 不直接依赖 SaveManager。 */
  showCrosshair: boolean;
  showMinimap: boolean;
}

const bar = (
  r: Renderer, x: number, y: number, w: number, h: number,
  value: number, max: number, color: string, label: string,
): void => {
  r.fillRect(x, y, w, h, '#11131c');
  r.strokeRect(x, y, w, h, '#3a4155', 1);
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  r.fillRect(x + 1, y + 1, (w - 2) * ratio, h - 2, color);
  r.text(`${label} ${Math.ceil(value)}/${max}`, x + 3, y + 1, '#ffffff', 6);
};

/** HUD 只读逻辑层状态，不反向修改任何数据。小地图由 room:enter 事件驱动刷新，不轮询。 */
export class HUD {
  draw(r: Renderer, ctx: GameCtx, info: HudInfo): void {
    const run = ctx.run;

    // 左上：血 / 护盾 / 能量
    bar(r, 8, 8, 92, 9, run.hp, run.maxHp, COLORS.hp, 'HP');
    bar(r, 8, 19, 92, 7, run.armor, run.maxArmor, COLORS.armor, '盾');
    bar(r, 8, 28, 92, 7, run.energy, run.maxEnergy, COLORS.energy, '蓝');

    // 左下：武器。名字颜色 = 品质色，来源只有 rarity.ts，不在页面里硬编码。
    const w = getWeapon(run.currentWeaponId);
    const wc = rarityColor(w.rarity);
    const bx = 6;
    const by = VIEW_H - 34;
    const bw = 176;
    r.fillRect(bx, by, bw, 30, '#11131ccc');
    r.strokeRect(bx, by, bw, 30, '#3a4155', 1);
    r.fillRect(bx + 1, by + 1, bw - 2, 2, wc);
    r.text(w.name, bx + 4, by + 5, wc, 8);
    r.text(rarityLabel(w.rarity), bx + bw - 4, by + 6, wc, 6, 'right');
    const cost = w.energy > 0 ? `${w.energy} 蓝/发` : '不耗能';
    r.text(`${w.desc} · ${cost}`, bx + 4, by + 15, COLORS.dim, 6);
    if (run.weapons.length > 1) {
      const other = getWeapon(run.weapons[(run.weaponIndex + 1) % run.weapons.length]);
      r.text(`Q → ${other.name}`, bx + 4, by + 22, rarityColor(other.rarity), 6);
    }

    // 顶部中间：层数 / 金币 / 击杀
    r.text(`第 ${run.level} 层  ·  ${run.coins} 金  ·  ${run.kills} 杀`,
      VIEW_W / 2, 6, COLORS.text, 8, 'center');

    this.drawTimer(r, ctx);
    if (info.showMinimap) this.drawMinimap(r, ctx);
    if (info.showCrosshair) this.drawCrosshair(r, ctx);

    if (info.notices.length) {
      const t = info.notices[info.notices.length - 1];
      r.text(t.text, VIEW_W / 2, VIEW_H - 48, t.color ?? '#ffd479', 8, 'center');
    }
    // 局内常驻入口提示：暂停菜单里能改设置。暂停时菜单自带标题，这里不再重复画「已暂停」。
    if (info.mode === 'playing') {
      r.text('P / Esc 菜单 · 设置', VIEW_W - 6, VIEW_H - 7, COLORS.dim, 6, 'right');
    }
  }

  /** 右上角小地图左侧的计时面板：本层 / 总计 / 永久最佳 / 天赋数。 */
  private drawTimer(r: Renderer, ctx: GameCtx): void {
    const run = ctx.run;
    const x = 300;
    const y = 8;
    const w = 100;
    const h = 44;
    r.fillRect(x, y, w, h, '#11131ccc');
    r.strokeRect(x, y, w, h, '#3a4155', 1);
    r.text('本层用时', x + 4, y + 3, COLORS.dim, 6);
    r.text(formatTime(run.levelElapsed, true), x + 4, y + 12, '#ffd479', 12);
    r.text(`总 ${formatTime(run.elapsed)}`, x + 4, y + 28, COLORS.text, 6);
    const best = ctx.meta.data.bestLevelTime;
    r.text(`佳 ${best > 0 ? formatTime(best) : '--:--'}`, x + 4, y + 36, COLORS.dim, 6);
    r.text(`天赋 ${run.talents.length}`, x + 58, y + 36, COLORS.shrine, 6);
  }

  private drawMinimap(r: Renderer, ctx: GameCtx): void {
    const plan = ctx.level.plan;
    const step = 11;
    const ox = VIEW_W - 5 * step - 10;
    const oy = 12;
    r.fillRect(ox - 6, oy - 6, 5 * step + 8, 5 * step + 8, '#11131ccc');
    r.strokeRect(ox - 6, oy - 6, 5 * step + 8, 5 * step + 8, '#3a4155', 1);

    // 门连线
    for (const rp of plan.rooms) {
      for (const dir of DIRS) {
        const id = rp.doors[dir];
        if (id === undefined) continue;
        const other = plan.rooms[id];
        if (!other) continue;
        r.line(ox + rp.gx * step + 4, oy + rp.gy * step + 4,
          ox + other.gx * step + 4, oy + other.gy * step + 4, '#6b7590', 1);
      }
    }

    // 房间格
    for (const rp of plan.rooms) {
      const room = ctx.level.roomById(rp.id);
      const x = ox + rp.gx * step;
      const y = oy + rp.gy * step;
      let color = '#39405a';
      if (room?.state === 'cleared') color = '#7d89a8';
      if (rp.type === RoomType.START) color = '#5aa0a0';
      if (rp.type === RoomType.TREASURE) color = '#c9a45b';
      if (rp.type === RoomType.BONUS) color = COLORS.bonus;
      if (rp.type === RoomType.SHOP) color = COLORS.shop;
      if (rp.type === RoomType.EXIT) color = '#e0a04a';
      r.fillRect(x, y, 8, 8, color);
      if (rp.id === ctx.level.currentRoomId) r.strokeRect(x - 2, y - 2, 12, 12, '#ffffff', 1);
      if (rp.id === plan.exitId) r.strokeRect(x - 1, y - 1, 10, 10, '#ffd479', 1);
    }
    // 标签原本写在 oy-15（负 y，会被裁掉），改到框下方
    r.text('地图', ox - 6, oy + 5 * step + 4, COLORS.dim, 6);
    r.text('绿商店 粉奖励', 300, oy + 5 * step + 4, COLORS.dim, 6);
  }

  private drawCrosshair(r: Renderer, ctx: GameCtx): void {
    const s = r.toLogical(ctx.input.aim.x, ctx.input.aim.y);
    if (s.x < 0 || s.y < 0 || s.x > VIEW_W || s.y > VIEW_H) return;
    r.line(s.x - 5, s.y, s.x + 5, s.y, '#ffffffcc', 1);
    r.line(s.x, s.y - 5, s.x, s.y + 5, '#ffffffcc', 1);
    r.strokeRect(s.x - 2, s.y - 2, 4, 4, '#ffffff', 1);
  }
}
