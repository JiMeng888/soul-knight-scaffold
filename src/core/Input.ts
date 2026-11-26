import type { Vec2 } from './math';

/** 原始输入抽象。只记录键鼠状态，不解释游戏语义 —— 语义在 Player / WeaponSystem 里。 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private el: HTMLElement | null = null;

  mouseX = 0;
  mouseY = 0;
  firing = false;
  /** 世界坐标下的瞄准点，由 Game 每帧通过 renderer.toWorld() 写入。 */
  aim: Vec2 = { x: 0, y: 0 };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (BLOCKED.has(e.code)) e.preventDefault();
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
  };
  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.firing = true;
  };
  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.firing = false;
  };
  private readonly onBlur = (): void => {
    this.down.clear();
    this.pressed.clear();
    this.firing = false;
  };
  private readonly onContext = (e: Event): void => e.preventDefault();

  attach(el: HTMLElement): void {
    this.el = el;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('mousedown', this.onMouseDown);
    el.addEventListener('contextmenu', this.onContext);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onBlur);
    this.el?.removeEventListener('mousedown', this.onMouseDown);
    this.el?.removeEventListener('contextmenu', this.onContext);
    this.el = null;
  }

  isDown(code: string): boolean { return this.down.has(code); }
  justPressed(code: string): boolean { return this.pressed.has(code); }

  /** 八向移动向量，已归一化。 */
  moveAxis(): Vec2 {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y += 1;
    const l = Math.hypot(x, y);
    return l > 0 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  }

  endFrame(): void {
    this.pressed.clear();
  }
}

const BLOCKED = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3', 'F9']);
