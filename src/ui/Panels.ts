/**
 * 通用选项面板：天赋三选一与商店购买共用一套卡片布局。
 *
 * 布局常量与命中检测都导出，绘制端和输入端用同一份坐标，
 * 避免「画的框和点的框不是同一个」这类静默错位。
 */
import type { GameCtx } from '../core/types';
import { COLORS, VIEW_H, VIEW_W } from '../data/balance';
import { getShopItem, shopPrice } from '../data/shop';
import type { TalentData } from '../data/talents';
import type { Renderer } from '../render/Renderer';

export interface ChoiceCard {
  title: string;
  desc: string;
  tag: string;
  color: string;
  price?: number;
  affordable?: boolean;
  disabled?: boolean;
}

export const CARD = { w: 108, h: 96, gap: 10, y: 100 } as const;

export function cardRect(i: number, count: number): { x: number; y: number; w: number; h: number } {
  const total = count * CARD.w + (count - 1) * CARD.gap;
  const x0 = (VIEW_W - total) / 2;
  return { x: x0 + i * (CARD.w + CARD.gap), y: CARD.y, w: CARD.w, h: CARD.h };
}

export function hitCard(x: number, y: number, count: number): number {
  for (let i = 0; i < count; i++) {
    const r = cardRect(i, count);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

/** 按近似字宽折行。中文按整字宽、ASCII 按 0.58 字宽估算，够面板用。 */
export function wrapText(text: string, maxW: number, size: number): string[] {
  const lines: string[] = [];
  let cur = '';
  let w = 0;
  for (const ch of text) {
    const cw = /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? size : size * 0.58;
    if (w + cw > maxW && cur) { lines.push(cur); cur = ''; w = 0; }
    cur += ch;
    w += cw;
  }
  if (cur) lines.push(cur);
  return lines;
}

interface PanelOpts {
  title: string;
  subtitle: string;
  cards: readonly ChoiceCard[];
  hover: number;
  footer: string;
}

export function drawChoicePanel(r: Renderer, o: PanelOpts): void {
  r.fillRect(0, 0, VIEW_W, VIEW_H, '#0d0f17e6');
  r.text(o.title, VIEW_W / 2, 44, '#ffd479', 18, 'center');
  r.text(o.subtitle, VIEW_W / 2, 68, COLORS.text, 7, 'center');

  o.cards.forEach((card, i) => {
    const b = cardRect(i, o.cards.length);
    const hot = i === o.hover && !card.disabled;
    r.fillRect(b.x, b.y, b.w, b.h, card.disabled ? '#151823' : '#1b2030');
    r.strokeRect(b.x, b.y, b.w, b.h, hot ? '#ffd479' : '#4a5470', hot ? 2 : 1);
    r.fillRect(b.x + 1, b.y + 1, b.w - 2, 3, card.disabled ? '#3a4155' : card.color);

    r.text(`[${i + 1}]`, b.x + 7, b.y + 9, card.disabled ? COLORS.dim : '#ffd479', 8);
    r.text(card.tag, b.x + b.w - 7, b.y + 10, COLORS.dim, 6, 'right');
    r.text(card.title, b.x + 7, b.y + 25, card.disabled ? COLORS.dim : COLORS.text, 9);

    const lines = wrapText(card.desc, b.w - 14, 7).slice(0, 3);
    lines.forEach((ln, k) => r.text(ln, b.x + 7, b.y + 40 + k * 10, '#b9c2d8', 7));

    r.line(b.x + 7, b.y + b.h - 22, b.x + b.w - 7, b.y + b.h - 22, '#3a4155', 1);
    if (card.disabled) {
      r.text('已售罄', b.x + b.w / 2, b.y + b.h - 17, COLORS.dim, 8, 'center');
    } else if (card.price !== undefined) {
      r.text(`${card.price} 金`, b.x + b.w / 2, b.y + b.h - 17,
        card.affordable ? '#f2c14e' : '#ff8a8a', 8, 'center');
    } else {
      r.text('选择', b.x + b.w / 2, b.y + b.h - 17, '#8fd6a0', 8, 'center');
    }
  });

  r.text(o.footer, VIEW_W / 2, VIEW_H - 34, COLORS.dim, 7, 'center');
}

export function drawTalentPanel(
  r: Renderer, choices: readonly TalentData[], hover: number, level: number,
): void {
  const n = choices.length;
  const keys = Array.from({ length: n }, (_, i) => String(i + 1)).join(' / ');
  drawChoicePanel(r, {
    title: '选择天赋',
    subtitle: `第 ${level} 层通过 · ${n} 选一 · 本局永久生效`,
    cards: choices.map((t) => ({
      title: t.name, desc: t.desc, tag: t.tag, color: t.color,
    })),
    hover,
    footer: `按 ${keys} 或点击卡片选择 · 必须选一项才能继续`,
  });
}

export function drawShopPanel(r: Renderer, ctx: GameCtx, hover: number): void {
  const level = ctx.run.level;
  const discount = ctx.run.shopDiscountMul;
  const cards: ChoiceCard[] = ctx.room.shopStock.map((slot) => {
    const item = getShopItem(slot.itemId);
    const price = shopPrice(item, level, discount);
    return {
      title: item.name,
      desc: item.desc,
      tag: item.tag,
      color: item.color,
      price,
      affordable: ctx.run.coins >= price,
      disabled: slot.sold,
    };
  });
  drawChoicePanel(r, {
    title: '商店',
    subtitle: `第 ${level} 层 · 金币 ${ctx.run.coins} · 售出的商品不会刷新`,
    cards,
    hover,
    footer: '按 1~4 或点击卡片购买 · E / Esc / P 离开',
  });
}
