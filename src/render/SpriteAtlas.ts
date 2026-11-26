/**
 * 精灵图集。所有占位素材运行时程序化绘制到一张离屏 canvas，
 * 绘制时按 cell 做一次 drawImage —— 对应原作的 Sprite Atlas / 合批思路，
 * 也保证这个脚手架不携带任何第三方或原作美术资源。
 */
type Painter = (c: CanvasRenderingContext2D) => void;

const px = (c: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void => {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
};

const humanoid = (skin: string, cloth: string, hat?: string): Painter => (c) => {
  px(c, '#1b1e29', 4, 13, 3, 2);
  px(c, '#1b1e29', 9, 13, 3, 2);
  px(c, cloth, 4, 7, 8, 6);
  px(c, cloth, 3, 8, 2, 4);
  px(c, cloth, 11, 8, 2, 4);
  px(c, skin, 5, 2, 6, 5);
  px(c, '#2a2436', 5, 2, 6, 2);
  px(c, '#ffffff', 6, 4, 1, 1);
  px(c, '#ffffff', 9, 4, 1, 1);
  if (hat) px(c, hat, 4, 0, 8, 2);
};

const PAINTERS: Record<string, Painter> = {
  player: humanoid('#f2d6a0', '#4d78b8'),
  goblin: humanoid('#8fc26a', '#5a7a3c'),
  shaman: humanoid('#b58ce0', '#6b4b96', '#d9c2ff'),
  bomber: (c) => {
    humanoid('#d8b06a', '#7a5a2a', '#5a3a1e')(c);
    px(c, '#3a3a3a', 11, 9, 4, 4);
    px(c, '#ff8a4a', 12, 8, 1, 1);
  },
  sniper: (c) => {
    humanoid('#c9a06a', '#6a5a3a')(c);
    px(c, '#8a6a3a', 10, 6, 5, 2);
    px(c, '#d8d8c0', 11, 7, 4, 1);
  },
  necromancer: (c) => {
    humanoid('#9a7ac8', '#3a2a5a', '#4a3a6a')(c);
    px(c, '#c9a0ff', 12, 3, 3, 3);
    px(c, '#ffffff', 13, 4, 1, 1);
  },
  bat: (c) => {
    px(c, '#6b4b96', 1, 6, 4, 3);
    px(c, '#6b4b96', 11, 6, 4, 3);
    px(c, '#a98bd8', 4, 4, 8, 8);
    px(c, '#2a2038', 5, 6, 2, 2);
    px(c, '#2a2038', 9, 6, 2, 2);
    px(c, '#ffffff', 5, 6, 1, 1);
    px(c, '#ffffff', 9, 6, 1, 1);
    px(c, '#6b4b96', 3, 12, 2, 2);
    px(c, '#6b4b96', 11, 12, 2, 2);
  },
  eye: (c) => {
    px(c, '#3a5a7a', 3, 4, 10, 8);
    px(c, '#8fe3ff', 4, 5, 8, 6);
    px(c, '#ffffff', 6, 6, 4, 4);
    px(c, '#1a2a3a', 7, 7, 2, 2);
    px(c, '#5ab0d0', 3, 3, 10, 2);
  },
  sentinel: (c) => {
    px(c, '#5a6070', 3, 10, 10, 5);
    px(c, '#8a8fa8', 3, 3, 10, 8);
    px(c, '#b0b6c8', 4, 1, 3, 3);
    px(c, '#b0b6c8', 9, 1, 3, 3);
    px(c, '#ff7b7b', 5, 6, 2, 2);
    px(c, '#ff7b7b', 9, 6, 2, 2);
    px(c, '#c8cede', 4, 8, 8, 2);
    px(c, '#5a6070', 1, 6, 2, 6);
    px(c, '#5a6070', 13, 6, 2, 6);
  },
  slime: (c) => {
    px(c, '#4a9a78', 3, 7, 10, 7);
    px(c, '#7ad0a8', 4, 5, 8, 8);
    px(c, '#9fe0c0', 5, 6, 4, 3);
    px(c, '#1a3a2a', 6, 8, 1, 1);
    px(c, '#1a3a2a', 9, 8, 1, 1);
    px(c, '#1a3a2a', 7, 11, 2, 1);
  },
  slimelet: (c) => {
    px(c, '#4a9a78', 5, 9, 6, 4);
    px(c, '#9fe0c0', 5, 7, 6, 5);
    px(c, '#1a3a2a', 6, 9, 1, 1);
    px(c, '#1a3a2a', 9, 9, 1, 1);
  },
  boar: (c) => {
    px(c, '#8a5a38', 3, 12, 3, 3);
    px(c, '#8a5a38', 10, 12, 3, 3);
    px(c, '#d2905f', 2, 5, 12, 8);
    px(c, '#b87648', 2, 3, 12, 3);
    px(c, '#fff2d0', 4, 8, 2, 2);
    px(c, '#fff2d0', 10, 8, 2, 2);
    px(c, '#3a2418', 5, 9, 1, 1);
    px(c, '#3a2418', 11, 9, 1, 1);
  },
  boss: (c) => {
    px(c, '#5a2020', 2, 12, 4, 3);
    px(c, '#5a2020', 10, 12, 4, 3);
    px(c, '#e36a6a', 2, 4, 12, 9);
    px(c, '#8f3030', 1, 2, 14, 3);
    px(c, '#ffd479', 4, 6, 3, 2);
    px(c, '#ffd479', 9, 6, 3, 2);
    px(c, '#3a1010', 5, 7, 1, 1);
    px(c, '#3a1010', 10, 7, 1, 1);
    px(c, '#ffffff', 4, 10, 2, 1);
    px(c, '#ffffff', 10, 10, 2, 1);
  },
  boss_laser: (c) => {
    px(c, '#7a2a10', 2, 11, 4, 4);
    px(c, '#7a2a10', 10, 11, 4, 4);
    px(c, '#ff7b4a', 2, 4, 12, 9);
    px(c, '#ffb46a', 4, 2, 8, 3);
    px(c, '#7a2a10', 1, 5, 2, 6);
    px(c, '#7a2a10', 13, 5, 2, 6);
    px(c, '#fff3a0', 5, 6, 2, 2);
    px(c, '#fff3a0', 9, 6, 2, 2);
    px(c, '#ffd06a', 6, 10, 4, 1);
    px(c, '#ffd06a', 3, 8, 1, 1);
    px(c, '#ffd06a', 12, 9, 1, 1);
  },
  boss_summon: (c) => {
    px(c, '#2a1a3a', 2, 12, 4, 3);
    px(c, '#2a1a3a', 10, 12, 4, 3);
    px(c, '#9a7ac8', 2, 4, 12, 9);
    px(c, '#4a2a6a', 1, 3, 14, 3);
    px(c, '#c9a0ff', 4, 1, 2, 3);
    px(c, '#c9a0ff', 7, 1, 2, 3);
    px(c, '#c9a0ff', 10, 1, 2, 3);
    px(c, '#ffffff', 5, 6, 2, 2);
    px(c, '#ffffff', 9, 6, 2, 2);
    px(c, '#1a0a2a', 5, 9, 6, 2);
  },
  coin: (c) => {
    px(c, '#8a6a1e', 5, 3, 6, 10);
    px(c, '#f2c14e', 4, 4, 8, 8);
    px(c, '#ffe9a0', 6, 5, 3, 3);
  },
  energy: (c) => {
    px(c, '#2b7a7a', 5, 2, 6, 12);
    px(c, '#5ec8c8', 4, 4, 8, 8);
    px(c, '#d8ffff', 6, 5, 3, 3);
  },
  weapon: (c) => {
    px(c, '#6c7488', 2, 7, 11, 3);
    px(c, '#aab3c8', 2, 6, 7, 2);
    px(c, '#4a5162', 5, 10, 3, 4);
    px(c, '#ffd479', 11, 7, 2, 2);
  },
  chest: (c) => {
    px(c, '#5a3a1e', 2, 5, 12, 8);
    px(c, '#8b5a2b', 2, 4, 12, 4);
    px(c, '#f2c14e', 7, 7, 2, 3);
    px(c, '#c9922f', 2, 8, 12, 1);
  },
  portal: (c) => {
    px(c, '#4a3fa8', 4, 2, 8, 12);
    px(c, '#8f7dff', 5, 3, 6, 10);
    px(c, '#ffffff', 7, 5, 2, 6);
  },
  heal: (c) => {
    px(c, '#7a2020', 6, 2, 4, 3);
    px(c, '#c94040', 5, 5, 6, 9);
    px(c, '#ff9a9a', 5, 5, 2, 8);
    px(c, '#ffffff', 7, 7, 2, 5);
    px(c, '#ffffff', 6, 8, 4, 2);
  },
  armor: (c) => {
    px(c, '#3a5a8a', 3, 3, 10, 9);
    px(c, '#6fa8dc', 4, 4, 8, 7);
    px(c, '#a8d0f0', 6, 5, 4, 2);
    px(c, '#3a5a8a', 5, 12, 6, 2);
  },
  shrine: (c) => {
    px(c, '#4a3a6a', 4, 12, 8, 3);
    px(c, '#7a5aa8', 5, 5, 6, 7);
    px(c, '#c9a0ff', 6, 3, 4, 3);
    px(c, '#ffffff', 7, 3, 2, 1);
    px(c, '#e8d8ff', 3, 2, 1, 1);
    px(c, '#e8d8ff', 12, 4, 1, 1);
  },
  shopkeeper: humanoid('#e8c9a0', '#6a9a70', '#f2c14e'),
};

/** 所有可绘制精灵 id。回归脚本用它检查「敌人 / 掉落物是否都有贴图」，避免运行时洋红圆。 */
export const SPRITE_IDS: readonly string[] = Object.keys(PAINTERS);

const CELL = 16;

export class SpriteAtlas {
  readonly canvas: HTMLCanvasElement;
  private index = new Map<string, number>();

  constructor() {
    const ids = Object.keys(PAINTERS);
    this.canvas = document.createElement('canvas');
    this.canvas.width = ids.length * CELL;
    this.canvas.height = CELL;
    const c = this.canvas.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    ids.forEach((id, i) => {
      c.save();
      c.translate(i * CELL, 0);
      PAINTERS[id](c);
      c.restore();
      this.index.set(id, i);
    });
  }

  cell(id: string): number {
    return this.index.get(id) ?? -1;
  }
}
