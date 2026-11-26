import { clamp, type Vec2 } from '../core/math';
import { BALANCE, COLORS, VIEW_H, VIEW_W } from '../data/balance';
import { cameraTarget, type CameraRoom } from './camera';
import { SpriteAtlas } from './SpriteAtlas';

/**
 * 像素完美渲染器：逻辑分辨率 480×270，整数倍缩放，imageSmoothing 关闭。
 * 世界绘制在 begin()/end() 之间（已应用相机变换），UI 绘制在 ui() 里（逻辑屏幕坐标）。
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly atlas = new SpriteAtlas();

  scale = 2;
  camX = 0;
  camY = 0;
  /** 屏幕震动总开关：设置页关掉后，所有 shake() 调用都变成空操作。 */
  shakeEnabled = true;
  private shakeAmp = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const c = canvas.getContext('2d', { alpha: false });
    if (!c) throw new Error('Canvas 2D 上下文不可用');
    this.ctx = c;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const maxW = window.innerWidth - 40;
    const maxH = window.innerHeight - 110;
    const s = clamp(Math.floor(Math.min(maxW / VIEW_W, maxH / VIEW_H)), 1, 4);
    this.scale = s;
    this.canvas.width = VIEW_W * s;
    this.canvas.height = VIEW_H * s;
    this.canvas.style.width = `${VIEW_W * s}px`;
    this.canvas.style.height = `${VIEW_H * s}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  snapCamera(x: number, y: number): void {
    this.camX = x;
    this.camY = y;
  }

  /**
   * 房间内跟随玩家：目标由 cameraTarget 算好（含边界钳制），这里只做平滑。
   * 视口尺寸与 margin 都收在渲染层，Game 不需要知道相机几何。
   */
  followRoom(player: Vec2, room: CameraRoom, dt: number, lerpK: number = BALANCE.cameraLerp): void {
    const t = cameraTarget(player, room, VIEW_W, VIEW_H, BALANCE.cameraEdgeMargin);
    const k = Math.min(1, lerpK * dt);
    this.camX += (t.x - this.camX) * k;
    this.camY += (t.y - this.camY) * k;
  }

  /**
   * 切层 / 换种子 / 过门时立刻对齐。过门是「把玩家传送到对侧门」，
   * 若相机还从旧位置插值，要飞近半个网格（~300px），期间玩家会跑出屏幕。
   * 房间内的「缓慢」由 followRoom 提供，这里只负责不丢人。
   */
  snapToRoom(player: Vec2, room: CameraRoom): void {
    const t = cameraTarget(player, room, VIEW_W, VIEW_H, BALANCE.cameraEdgeMargin);
    this.snapCamera(t.x, t.y);
  }

  shake(a: number): void {
    if (!this.shakeEnabled) return;
    this.shakeAmp = Math.max(this.shakeAmp, a);
  }

  update(dt: number): void {
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 18);
  }

  /** 屏幕(client)坐标 → 世界坐标。鼠标瞄准必须用这个，不能用屏幕坐标直接当方向。 */
  toWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (this.canvas.width / Math.max(rect.width, 1));
    const py = (clientY - rect.top) * (this.canvas.height / Math.max(rect.height, 1));
    return {
      x: (px - this.canvas.width / 2) / this.scale + this.camX,
      y: (py - this.canvas.height / 2) / this.scale + this.camY,
    };
  }

  /** 世界坐标 → 逻辑屏幕坐标（480×270 空间），给 HUD 画准星用。 */
  toLogical(wx: number, wy: number): Vec2 {
    return { x: wx - this.camX + VIEW_W / 2, y: wy - this.camY + VIEW_H / 2 };
  }

  /** 屏幕(client)坐标 → 逻辑 UI 坐标（0..480 / 0..270），给面板点击命中使用。 */
  toUI(clientX: number, clientY: number): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (this.canvas.width / Math.max(rect.width, 1));
    const py = (clientY - rect.top) * (this.canvas.height / Math.max(rect.height, 1));
    return { x: px / this.scale, y: py / this.scale };
  }

  begin(): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = COLORS.bg;
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const jx = this.shakeAmp > 0 ? (Math.random() - 0.5) * this.shakeAmp : 0;
    const jy = this.shakeAmp > 0 ? (Math.random() - 0.5) * this.shakeAmp : 0;
    const ox = Math.round(this.canvas.width / 2 - this.camX * this.scale) + jx * this.scale;
    const oy = Math.round(this.canvas.height / 2 - this.camY * this.scale) + jy * this.scale;
    c.setTransform(this.scale, 0, 0, this.scale, ox, oy);
    c.imageSmoothingEnabled = false;
  }

  end(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** UI 阶段：变换设为逻辑坐标，HUD 可以直接用 0..480 / 0..270。 */
  ui(fn: () => void): void {
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    fn();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  strokeRect(x: number, y: number, w: number, h: number, color: string, width = 1): void {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  }

  circle(x: number, y: number, r: number, color: string): void {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
    const c = this.ctx;
    c.strokeStyle = color;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  }

  text(t: string, x: number, y: number, color = '#ffffff', size = 8, align: CanvasTextAlign = 'left'): void {
    const c = this.ctx;
    c.font = `${size}px "Courier New", "Microsoft YaHei", monospace`;
    c.textAlign = align;
    c.textBaseline = 'top';
    c.fillStyle = color;
    c.fillText(t, Math.round(x), Math.round(y));
    c.textAlign = 'left';
  }

  sprite(id: string, x: number, y: number, scale = 1, flipX = false): void {
    const i = this.atlas.cell(id);
    if (i < 0) { this.circle(x, y, 5, '#ff00ff'); return; }
    const c = this.ctx;
    c.save();
    c.translate(Math.round(x), Math.round(y));
    if (flipX) c.scale(-1, 1);
    c.drawImage(this.atlas.canvas, i * 16, 0, 16, 16,
      -8 * scale, -8 * scale, 16 * scale, 16 * scale);
    c.restore();
  }
}
