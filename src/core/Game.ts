import { lerp, TAU } from './math';
import { pickInteractTarget, type Interactable } from './interaction';
import { RNG, hashSeed } from './RNG';
import { EventBus } from './Events';
import { Input } from './Input';
import { Pool } from './ObjectPool';
import type { GameCtx, ProjectileOptions } from './types';
import { BALANCE } from '../data/balance';
import { getCharacter } from '../data/characters';
import { getWeapon, rarityLabel } from '../data/weapons';
import { rarityColor } from '../data/rarity';
import { getTalent, rollTalentChoices, type TalentData } from '../data/talents';
import { getShopItem, shopPrice, type ShopEffect } from '../data/shop';
import { RunState } from '../state/RunState';
import { GameState } from '../state/SaveManager';
import { TemplateLibrary } from '../world/RoomTemplate';
import { generateLevel, validatePlan, OPPOSITE } from '../world/DungeonGenerator';
import type { Dir } from '../world/DungeonGenerator';
import { Level } from '../world/Level';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Projectile } from '../entities/Projectile';
import { Pickup, Particle, isInteractable, interactBias } from '../entities/Pickup';
import { Renderer } from '../render/Renderer';
import { WeaponSystem } from '../weapons/Weapon';
import { HUD, formatTime } from '../ui/HUD';
import type { GameMode, HudInfo } from '../ui/HUD';
import {
  drawDead, drawPause, drawDebug, hitPauseItem, PAUSE_ITEMS,
  type PauseAction,
} from '../ui/Overlay';
import { drawTalentPanel, drawShopPanel, hitCard } from '../ui/Panels';
import {
  MENU_ITEMS, CODEX_TABS, codexEntries, codexOffset, drawCodexPanel, drawHelpPanel,
  drawSettingsPanel, drawStartMenu, hitCodexRow, hitCodexTab, hitMenuItem,
  hitSettingRow, type CodexTab,
} from '../ui/StartMenu';
import { SETTINGS, cameraLerpOf, cycleSetting, defaultSettings, flagOf } from '../data/settings';

/**
 * 编排层：实现 GameCtx，把配置 → 状态 → 世界 → 实体 → 渲染 串成固定步长主循环。
 * 逻辑层拿到的是 GameCtx（接口），不知道 Game 的具体实现，也不直接依赖任何单例。
 */
export class Game implements GameCtx {
  dt = 0;
  time = 0;
  readonly input = new Input();
  readonly events = new EventBus();
  rng: RNG = new RNG(1);
  readonly run = new RunState();
  readonly meta = new GameState();
  level!: Level;
  readonly player: Player;
  readonly enemies = new Pool(() => new Enemy(), 16);
  readonly projectiles = new Pool(() => new Projectile(), 64);
  readonly pickups = new Pool(() => new Pickup(), 16);
  readonly particles = new Pool(() => new Particle(), 64);
  readonly renderer: Renderer;
  readonly weapons = new WeaponSystem();
  readonly library = new TemplateLibrary();
  readonly hud = new HUD();

  mode: GameMode = 'menu';
  debug = false;
  fps = 60;
  notices: Array<{ text: string; color?: string; life: number }> = [];

  /** 面板鼠标悬停的卡片下标 */
  panelHover = -1;
  /** 天赋面板的三个候选 */
  talentChoices: TalentData[] = [];
  /** 一次 E 只消费一个交互物：本逻辑步被选中的 pickup id（-1 = 本步无 E 交互）。 */
  interactTargetId = -1;

  // —— 开始界面 ——
  /** 主菜单当前项（键盘选中，和鼠标悬停分开记，避免鼠标一动就丢键盘焦点） */
  menuIndex = 0;
  menuHover = -1;
  /** 设置页当前行与悬停行 */
  settingsIndex = 0;
  settingsHover = -1;
  /**
   * 设置页从哪进来：'menu'（开始前）/ 'pause'（局内暂停）。
   * Esc 返回时据此决定回主菜单还是回暂停菜单 —— 局内改设置绝不重建本局、不丢进度。
   */
  settingsReturn: 'menu' | 'pause' = 'menu';
  /** 暂停菜单当前项与鼠标悬停项 */
  pauseIndex = 0;
  pauseHover = -1;
  /** 图鉴当前页 / 条目 / 鼠标所在行 */
  codexTab: CodexTab = 'weapon';
  codexIndex = 0;
  codexHover = -1;

  private entityId = 0;
  private accumulator = 0;
  private lastTs = 0;
  private templateIssues: string[] = [];
  private levelIssues: string[] = [];
  private pendingNextLevel = false;
  /** 天赋面板阻塞进层时，暂存「选完要进入的层号」 */
  private pendingLevel: number | null = null;
  /**
   * 最近一次 giveWeapon 顶替下来的旧武器 id。换枪时「获得新枪」和「放下旧枪」
   * 是同一次操作的两面，HUD 只显示最后一条通知，故在这里合并成一条播报，
   * 免得「已放下 X」被随后的「获得 Y」盖掉、玩家以为旧枪又消失了。
   */
  private droppedWeaponId: string | null = null;

  get room() {
    return this.level.current;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.player = new Player(this.run);
    this.input.attach(canvas);
    this.templateIssues = this.library.validateAll();
    this.bindEvents();
    this.player.onHurt = (a) => {
      this.renderer.shake(3.2);
      this.pushNotice(`受到 ${a} 点伤害`);
    };
    this.player.onDead = () => this.gameOver();
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.onPointerDown(e.clientX, e.clientY);
    });
    // 设置先落地一次，避免首帧用默认值跑一帧再被改掉
    this.applySettings();
    // 菜单背后先铺一层真实关卡，点开始就是同一套数据，不做特殊分支
    this.newRun(undefined, true);
  }

  /**
   * 鼠标点击统一入口。各界面自己决定「点在哪算选中」，
   * 但命中检测一律来自 ui/StartMenu.ts 与 ui/Panels.ts 导出的同一份坐标。
   */
  private onPointerDown(clientX: number, clientY: number): void {
    const p = this.renderer.toUI(clientX, clientY);

    if (this.mode === 'menu') {
      const i = hitMenuItem(p.x, p.y);
      if (i >= 0) { this.menuIndex = i; this.activateMenu(i); }
      this.input.firing = false;
      return;
    }
    if (this.mode === 'dead') { this.start(); return; }
    if (this.mode === 'paused') {
      const i = hitPauseItem(p.x, p.y);
      if (i >= 0) { this.pauseIndex = i; this.activatePause(i); }
      this.input.firing = false;
      return;
    }
    if (this.mode === 'settings') {
      const i = hitSettingRow(p.x, p.y, SETTINGS.length);
      if (i >= 0) { this.settingsIndex = i; this.activateSetting(i); }
      this.input.firing = false;
      return;
    }
    if (this.mode === 'codex') {
      const tab = hitCodexTab(p.x, p.y);
      if (tab >= 0) { this.switchCodexTab(tab); this.input.firing = false; return; }
      const list = codexEntries(this.codexTab);
      const offset = codexOffset(this.codexIndex, list.length);
      const row = hitCodexRow(p.x, p.y, list.length, offset);
      if (row >= 0) this.codexIndex = offset + row;
      this.input.firing = false;
      return;
    }
    if (this.mode === 'help') { this.backToMenu(); return; }

    if (this.mode === 'talent' || this.mode === 'shop') {
      const count = this.mode === 'talent'
        ? this.talentChoices.length : this.room.shopStock.length;
      const i = hitCard(p.x, p.y, count);
      if (i >= 0) {
        if (this.mode === 'talent') this.chooseTalent(i);
        else this.buyShopItem(i);
      }
      // 面板上的点击不能被 Input 当成「按住开火」带进游戏
      this.input.firing = false;
    }
  }

  startLoop(): void {
    this.lastTs = performance.now();
    requestAnimationFrame(this.loop);
  }

  /** 开始新一局：清掉整个 RunState，永久成长不动。 */
  start(): void {
    this.newRun();
  }

  // ------------------------------------------------------------ 开始界面

  private isFrontEnd(): boolean {
    return this.mode === 'menu' || this.mode === 'settings'
      || this.mode === 'codex' || this.mode === 'help';
  }

  private activateMenu(i: number): void {
    const item = MENU_ITEMS[i];
    if (!item) return;
    switch (item.action) {
      case 'start': this.start(); break;
      case 'codex': this.openCodex(); break;
      case 'settings': this.openSettings(); break;
      case 'help':
        this.mode = 'help';
        this.input.firing = false;
        break;
    }
  }

  private openSettings(from: 'menu' | 'pause' = 'menu'): void {
    this.settingsReturn = from;
    this.settingsIndex = 0;
    this.settingsHover = -1;
    this.mode = 'settings';
    this.input.firing = false;
  }

  /**
   * 关闭设置页：从局内暂停进来的回暂停菜单（本局 hp / 武器 / 层 / 计时全部保留，
   * 不调用 newRun），从主菜单进来的才回主菜单。这是「局内设置不丢进度」的关键。
   */
  private closeSettings(): void {
    if (this.settingsReturn === 'pause') {
      this.mode = 'paused';
      this.pauseIndex = 0;
      this.pauseHover = -1;
    } else {
      this.backToMenu();
    }
    this.input.firing = false;
  }

  private activatePause(i: number): void {
    const item = PAUSE_ITEMS[i];
    if (!item) return;
    const action: PauseAction = item.action;
    switch (action) {
      case 'resume': this.mode = 'playing'; break;
      case 'settings': this.openSettings('pause'); break;
      case 'menu': this.backToMenu(); break;
    }
    this.input.firing = false;
  }

  /** 暂停菜单：世界与计时冻结，只处理键盘导航与鼠标悬停。 */
  private updatePauseMenu(): void {
    const input = this.input;
    const n = PAUSE_ITEMS.length;
    const p = this.renderer.toUI(input.mouseX, input.mouseY);
    this.pauseHover = hitPauseItem(p.x, p.y);
    if (input.justPressed('ArrowDown') || input.justPressed('KeyS')) {
      this.pauseIndex = (this.pauseIndex + 1) % n;
    }
    if (input.justPressed('ArrowUp') || input.justPressed('KeyW')) {
      this.pauseIndex = (this.pauseIndex + n - 1) % n;
    }
    for (let i = 0; i < n; i++) {
      if (input.justPressed(`Digit${i + 1}`) || input.justPressed(`Numpad${i + 1}`)) {
        this.pauseIndex = i;
        this.activatePause(i);
        return;
      }
    }
    if (input.justPressed('Enter') || input.justPressed('NumpadEnter')
      || input.justPressed('Space')) {
      this.activatePause(this.pauseIndex);
    }
  }

  private openCodex(): void {
    this.codexIndex = 0;
    this.codexHover = -1;
    this.mode = 'codex';
    this.input.firing = false;
  }

  /**
   * 回主菜单 = 重建一层「展示用」关卡当背景。
   * 顺带把本局状态清干净：暂停中放弃本局不回主菜单留着，重开会带着旧血量和武器。
   */
  private backToMenu(): void {
    this.newRun(undefined, true);
    this.menuHover = -1;
  }

  private switchCodexTab(tab: number): void {
    const t = CODEX_TABS[tab];
    if (!t) return;
    this.codexTab = t.id;
    this.codexIndex = 0;
    this.codexHover = -1;
  }

  /** 设置行激活：action 行执行动作，其余按方向循环一次。 */
  private activateSetting(i: number, dir = 1): void {
    const def = SETTINGS[i];
    if (!def) return;
    if (def.kind === 'action') {
      if (def.action === 'reset') this.applySettingValues(defaultSettings());
      return;
    }
    this.applySettingValues(cycleSetting(this.meta.data.settings, def, dir));
  }

  /** 设置唯一写入口：钳制、落盘、立刻应用到运行时。 */
  private applySettingValues(values: Record<string, number>): void {
    this.meta.setSettings(values);
    this.applySettings();
  }

  /** 把存档里的设置同步到真实消费者（目前只有渲染层的震动开关）。 */
  private applySettings(): void {
    this.renderer.shakeEnabled = flagOf(this.meta.data.settings, 'screenShake');
  }

  /** 前端界面只处理导航与鼠标悬停，不推进世界、不累加计时。 */
  private updateFrontEnd(): void {
    const input = this.input;
    const p = this.renderer.toUI(input.mouseX, input.mouseY);

    if (this.mode === 'menu') {
      const n = MENU_ITEMS.length;
      this.menuHover = hitMenuItem(p.x, p.y);
      if (input.justPressed('ArrowDown') || input.justPressed('KeyS')) {
        this.menuIndex = (this.menuIndex + 1) % n;
      }
      if (input.justPressed('ArrowUp') || input.justPressed('KeyW')) {
        this.menuIndex = (this.menuIndex + n - 1) % n;
      }
      for (let i = 0; i < n; i++) {
        if (input.justPressed(`Digit${i + 1}`) || input.justPressed(`Numpad${i + 1}`)) {
          this.menuIndex = i;
          this.activateMenu(i);
          return;
        }
      }
      if (input.justPressed('Enter') || input.justPressed('NumpadEnter')
        || input.justPressed('Space')) {
        this.activateMenu(this.menuIndex);
      }
      return;
    }

    if (this.mode === 'settings') {
      const n = SETTINGS.length;
      this.settingsHover = hitSettingRow(p.x, p.y, n);
      if (input.justPressed('ArrowDown') || input.justPressed('KeyS')) {
        this.settingsIndex = (this.settingsIndex + 1) % n;
      }
      if (input.justPressed('ArrowUp') || input.justPressed('KeyW')) {
        this.settingsIndex = (this.settingsIndex + n - 1) % n;
      }
      const left = input.justPressed('ArrowLeft') || input.justPressed('KeyA');
      const right = input.justPressed('ArrowRight') || input.justPressed('KeyD');
      if (left) this.activateSetting(this.settingsIndex, -1);
      if (right || input.justPressed('Enter') || input.justPressed('Space')) {
        this.activateSetting(this.settingsIndex, 1);
      }
      // 从局内暂停进来的设置，Esc 回暂停菜单继续本局；从主菜单进来的才回主菜单
      if (input.justPressed('Escape')) this.closeSettings();
      return;
    }

    if (this.mode === 'codex') {
      const list = codexEntries(this.codexTab);
      const offset = codexOffset(this.codexIndex, list.length);
      this.codexHover = hitCodexRow(p.x, p.y, list.length, offset);
      for (let i = 0; i < CODEX_TABS.length; i++) {
        if (input.justPressed(`Digit${i + 1}`) || input.justPressed(`Numpad${i + 1}`)) {
          this.switchCodexTab(i);
          return;
        }
      }
      if (input.justPressed('ArrowRight') || input.justPressed('KeyE')) {
        const i = CODEX_TABS.findIndex((t) => t.id === this.codexTab);
        this.switchCodexTab((i + 1) % CODEX_TABS.length);
        return;
      }
      if (input.justPressed('ArrowLeft') || input.justPressed('KeyQ')) {
        const i = CODEX_TABS.findIndex((t) => t.id === this.codexTab);
        this.switchCodexTab((i + CODEX_TABS.length - 1) % CODEX_TABS.length);
        return;
      }
      if (input.justPressed('ArrowDown') || input.justPressed('KeyS')) {
        this.codexIndex = Math.min(list.length - 1, this.codexIndex + 1);
      }
      if (input.justPressed('ArrowUp') || input.justPressed('KeyW')) {
        this.codexIndex = Math.max(0, this.codexIndex - 1);
      }
      if (input.justPressed('Escape')) this.backToMenu();
      return;
    }

    if (this.mode === 'help') {
      if (input.justPressed('Escape') || input.justPressed('Enter')
        || input.justPressed('Space')) this.backToMenu();
    }
  }

  // ------------------------------------------------------------ GameCtx 实现

  spawnProjectile(o: ProjectileOptions): Projectile {
    const b = this.projectiles.spawn();
    b.id = ++this.entityId;
    b.launch(o);
    return b;
  }

  spawnEnemy(kind: string, x: number, y: number): Enemy {
    const e = this.enemies.spawn();
    e.id = ++this.entityId;
    e.init(kind, x, y);
    e.applyLevelScale(this.run.level);
    return e;
  }

  spawnPickup(kind: string, x: number, y: number, amount = 1, payload = ''): Pickup {
    const p = this.pickups.spawn();
    p.id = ++this.entityId;
    p.init(kind, x, y, amount, payload);
    return p;
  }

  spawnParticle(x: number, y: number, color: string, speed = 60): Particle {
    const p = this.particles.spawn();
    const a = this.rng.next() * TAU;
    const v = speed * (0.4 + this.rng.next() * 0.6);
    p.init(x, y, color, Math.cos(a) * v, Math.sin(a) * v,
      0.22 + this.rng.next() * 0.3, 1.5 + this.rng.next() * 2);
    return p;
  }

  /**
   * 给玩家一把武器（地面拾取 / 宝箱 / 商店买枪统一入口）。
   * 武器栏满时 addWeapon 会顶替当前手持并返回被顶替的 id —— 这里把它掉回地面，
   * 而不是像旧版那样直接丢弃。落点走 room.safeSpawn 校验，避免掉进墙里（历史踩坑）。
   */
  giveWeapon(id: string, x: number, y: number): void {
    const replaced = this.run.addWeapon(id);
    if (!replaced) return;
    const at = this.room.safeSpawn({ x, y }, 6);
    const drop = this.spawnPickup('weapon', at.x, at.y, 0, replaced);
    drop.dropGrace = BALANCE.weaponDropGrace;
    this.droppedWeaponId = replaced;
    this.events.emit('weapon:drop', { id: replaced, x: at.x, y: at.y });
    for (let i = 0; i < 4; i++) {
      this.spawnParticle(at.x, at.y, rarityColor(getWeapon(replaced).rarity), 46);
    }
  }

  /** 取走并清空「刚放下的旧武器」标记，拼进获得播报。 */
  private takeDropNotice(): string {
    if (!this.droppedWeaponId) return '';
    const name = getWeapon(this.droppedWeaponId).name;
    this.droppedWeaponId = null;
    return ` · 已放下 ${name}（可捡回）`;
  }

  /** 延迟到帧末执行：pickup 的遍历过程中不能清空对象池。 */
  nextLevel(): void {
    this.pendingNextLevel = true;
  }

  gameOver(): void {
    if (this.mode === 'dead') return;
    // 面板开着时死亡也要收掉面板，避免死界面叠一层选择框
    this.mode = 'dead';
    this.talentChoices = [];
    this.pendingLevel = null;
    this.meta.recordRun(this.run);
    this.events.emit('player:dead', { kills: this.run.kills, level: this.run.level });
  }

  /** 授予天赋。逻辑只发事件，通知由表现层订阅产生，避免两处重复提示。 */
  grantTalent(id?: string): string {
    // 神龛 / 商店卷轴没指定 id 时，也优先给本局没拿过的（与天赋面板同一套策略）。
    const t = id
      ? getTalent(id)
      : rollTalentChoices(this.run.talents, 1, (a) => this.rng.shuffle(a))[0];
    const name = this.run.applyTalent(t);
    this.events.emit('talent:grant', { id: t.id, name });
    return name;
  }

  openShop(): void {
    if (this.mode !== 'playing' || this.room.shopStock.length === 0) return;
    this.mode = 'shop';
    this.input.firing = false;
    this.events.emit('shop:open', { roomId: this.room.plan.id });
  }

  // ------------------------------------------------------------ 内部流程

  private newRun(seed?: number, menuOnly = false): void {
    const s = seed ?? ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
    this.rng = new RNG(hashSeed(s, 0x1234));
    this.run.reset(getCharacter(this.meta.data.unlocked[0] ?? 'knight'), s);
    this.level = this.buildLevel(1);
    this.clearPools();
    this.player.reset();
    const spawn = this.level.enter(this.level.plan.startId);
    this.player.spawnAt(spawn.x, spawn.y);
    this.renderer.snapToRoom(this.player.pos, this.room);
    this.room.spawnContents(this);
    this.weapons.reset();
    this.notices = [];
    this.pendingNextLevel = false;
    this.pendingLevel = null;
    this.talentChoices = [];
    this.panelHover = -1;
    this.droppedWeaponId = null;
    this.mode = menuOnly ? 'menu' : 'playing';
    this.events.emit('room:enter', { roomId: this.room.plan.id });
  }

  private buildLevel(level: number): Level {
    this.run.level = level;
    const plan = generateLevel(this.run.seed, level);
    this.levelIssues = validatePlan(plan);
    return new Level(plan, this.library);
  }

  private clearPools(): void {
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.particles.clear();
    this.interactTargetId = -1;
  }

  /**
   * 交互仲裁：在每个逻辑步、pickup 更新之前，选出离玩家最近的可交互物。
   *
   * 根因是 Input.justPressed('KeyE') 对本步所有 pickup 都返回 true —— 只要
   * 两个交互物同时落在范围内，一次按键就会把两个都 collect 掉。早期靠
   * 「把宝箱和神龛拉到房间两端」规避，但拾取范围天赋会放大半径，间距随时
   * 可能失效，那只是缓解不是根治。这里从逻辑上保证一次 E 至多命中一个，
   * 具体选目标的纯函数在 core/interaction.ts，可被 npm run verify 单测。
   */
  private resolveInteractTarget(): void {
    const candidates: Interactable[] = [];
    this.pickups.forEachActive((pk) => {
      if (!isInteractable(pk.kind)) return;
      // 换枪刚落地的旧枪在保护期内不参与仲裁：它 bias=gear(0.7) 很优先，
      // 若混进候选会抢走 interactTargetId，玩家按 E 想进传送门/开箱却毫无反应。
      if (pk.dropGrace > 0) return;
      candidates.push({
        id: pk.id,
        pos: pk.pos,
        reachBonus: pk.kind === 'shopkeeper' ? 14 : 10,
        bias: interactBias(pk.kind),
      });
    });
    this.interactTargetId = pickInteractTarget(
      this.input.justPressed('KeyE'),
      this.player.pos,
      BALANCE.pickupRange,
      this.run.pickupRangeMul,
      candidates,
    );
  }

  private enterRoom(targetId: number, dir: Dir): void {
    const spawn = this.level.enter(targetId, OPPOSITE[dir]);
    this.player.spawnAt(spawn.x, spawn.y);
    // 过门是「传送到对侧门」，相机若从旧位置插值要飞近半个网格，
    // 期间玩家会跑出屏幕。直接对齐；房间内仍由 followRoom 缓慢跟随。
    this.renderer.snapToRoom(this.player.pos, this.room);
    this.room.spawnContents(this);
    this.events.emit('room:enter', { roomId: targetId });
  }

  /** 真正切层。天赋面板选完后才调用，所以计时在面板期间是冻结的。 */
  private doNextLevel(next: number): void {
    this.pendingNextLevel = false;
    this.pendingLevel = null;
    const seconds = this.run.levelElapsed;
    const clearedLevel = this.run.level;
    const record = this.meta.recordLevelTime(seconds);
    this.events.emit('level:clear', { level: clearedLevel, seconds });

    this.level = this.buildLevel(next);
    this.run.levelElapsed = 0;
    this.clearPools();
    const spawn = this.level.enter(this.level.plan.startId);
    this.player.spawnAt(spawn.x, spawn.y);
    this.renderer.snapToRoom(this.player.pos, this.room);
    this.room.spawnContents(this);
    this.events.emit('level:next', { level: next });
    this.events.emit('room:enter', { roomId: this.room.plan.id });
    if (record) this.pushNotice(`单层新纪录 ${formatTime(seconds, true)}`);
  }

  private openTalentPanel(next: number): void {
    this.pendingLevel = next;
    // 优先给本局没拿过的天赋，拿光后才允许重复叠加；候选数由 balance.ts 配置。
    this.talentChoices = rollTalentChoices(
      this.run.talents, BALANCE.talentChoices, (a) => this.rng.shuffle(a),
    );
    this.mode = 'talent';
    this.panelHover = -1;
    this.input.firing = false;
    this.events.emit('talent:offer', { level: next });
  }

  private chooseTalent(i: number): void {
    const t = this.talentChoices[i];
    if (!t) return;
    this.grantTalent(t.id);
    this.talentChoices = [];
    this.panelHover = -1;
    this.mode = 'playing';
    this.doNextLevel(this.pendingLevel ?? this.run.level + 1);
  }

  private buyShopItem(i: number): void {
    const slot = this.room.shopStock[i];
    if (!slot) return;
    if (slot.sold) { this.pushNotice('这件商品已售出'); return; }
    const item = getShopItem(slot.itemId);
    // 与面板显示共用 shopPrice，折扣天赋生效时不会出现「显示/扣款」不一致。
    const price = shopPrice(item, this.run.level, this.run.shopDiscountMul);
    if (this.run.coins < price) {
      this.events.emit('shop:denied', { reason: `需要 ${price} 金` });
      return;
    }
    this.run.coins -= price;
    this.applyShopEffect(item.effect);
    slot.sold = true;
    this.events.emit('shop:buy', { id: item.id, price });
  }

  /** 商品效果统一在这里落地，data/shop.ts 保持纯数据。 */
  private applyShopEffect(e: ShopEffect): void {
    const run = this.run;
    const v = e.value ?? 1;
    switch (e.kind) {
      case 'heal': run.hp = Math.min(run.maxHp, run.hp + v); break;
      case 'fullHeal': run.hp = run.maxHp; break;
      case 'fullArmor': run.armor = run.maxArmor; break;
      case 'fullEnergy': run.energy = run.maxEnergy; break;
      case 'maxHp':
        run.maxHp += v;
        run.hp = Math.min(run.maxHp, run.hp + v);
        break;
      case 'maxArmor':
        run.maxArmor += v;
        run.armor = Math.min(run.maxArmor, run.armor + v);
        break;
      // 商店买枪同样可能顶替手持武器，走 giveWeapon 统一把旧枪掉回地面。
      case 'weapon':
        this.giveWeapon(run.randomLoot(this.rng, run.level, 'fine'),
          this.player.pos.x, this.player.pos.y);
        break;
      case 'talent': this.grantTalent(); break;
    }
  }

  private closeShop(): void {
    this.mode = 'playing';
    this.panelHover = -1;
    this.input.firing = false;
  }

  /** 面板态只消费输入，不推进世界，也不累加计时。 */
  private updatePanel(): void {
    const talent = this.mode === 'talent';
    const count = talent ? this.talentChoices.length : this.room.shopStock.length;
    const p = this.renderer.toUI(this.input.mouseX, this.input.mouseY);
    this.panelHover = hitCard(p.x, p.y, count);

    for (let i = 0; i < count; i++) {
      if (this.input.justPressed(`Digit${i + 1}`) || this.input.justPressed(`Numpad${i + 1}`)) {
        if (talent) this.chooseTalent(i);
        else this.buyShopItem(i);
        return;
      }
    }
    if (!talent && (this.input.justPressed('KeyE')
      || this.input.justPressed('Escape') || this.input.justPressed('KeyP'))) {
      this.closeShop();
    }
  }

  /** F9：换种子重建本层，用来快速验证「任意种子都可通关」这条性质。 */
  private rebuildLevel(): void {
    this.run.seed = hashSeed(this.run.seed, Date.now() & 0xffff, 7);
    this.level = this.buildLevel(this.run.level);
    this.run.levelElapsed = 0;
    this.clearPools();
    const spawn = this.level.enter(this.level.plan.startId);
    this.player.spawnAt(spawn.x, spawn.y);
    this.renderer.snapToRoom(this.player.pos, this.room);
    this.room.spawnContents(this);
    this.pushNotice('已换种子重建本层');
  }

  private bindEvents(): void {
    this.events.on('room:clear', ({ roomId }) => {
      if (roomId === this.room.plan.id) this.pushNotice('房间已清空 · 门开了');
    });
    this.events.on('weapon:switch', ({ id }) => {
      const w = getWeapon(id);
      this.pushNotice(`切换武器：${w.name}`, rarityColor(w.rarity));
    });
    this.events.on('pickup', ({ kind }) => {
      if (kind !== 'weapon' && kind !== 'chest') return;
      // 拾取后当前武器可能已被替换，用当前手持的名字+品质播报，避免报错枪。
      // 换枪时把「放下旧枪」合并进同一条播报，否则会被「获得新枪」盖掉。
      const w = getWeapon(this.run.currentWeaponId);
      this.pushNotice(`获得 ${w.name} · ${rarityLabel(w.rarity)}${this.takeDropNotice()}`,
        rarityColor(w.rarity));
    });
    this.events.on('level:next', ({ level }) => this.pushNotice(`进入第 ${level} 层`));
    this.events.on('level:clear', ({ level, seconds }) => {
      this.pushNotice(`第 ${level} 层用时 ${formatTime(seconds, true)}`);
    });
    this.events.on('talent:offer', ({ level }) => {
      this.pushNotice(`进入第 ${level} 层前 · 选择天赋`);
    });
    this.events.on('talent:grant', ({ name }) => this.pushNotice(`获得天赋：${name}`));
    this.events.on('shop:open', () => this.pushNotice('商人：看看货？E 离开'));
    this.events.on('shop:buy', ({ id, price }) => {
      // 武器类商品会顶替手持枪，同样合并「放下旧枪」提示
      this.pushNotice(`购买 ${getShopItem(id).name} · ${price} 金${this.takeDropNotice()}`);
    });
    this.events.on('shop:denied', ({ reason }) => this.pushNotice(`金币不足 · ${reason}`));
  }

  /** 通知带颜色：掉落传说武器时用品质色，玩家不用盯着 HUD 找字。 */
  private pushNotice(text: string, color?: string): void {
    this.notices.push({ text, color, life: 2.2 });
    if (this.notices.length > 4) this.notices.shift();
  }

  // ------------------------------------------------------------ 主循环

  private update(dt: number): void {
    this.dt = dt;
    this.time += dt;
    this.input.aim = this.renderer.toWorld(this.input.mouseX, this.input.mouseY);

    if (this.input.justPressed('F3')) this.debug = !this.debug;

    // 开始界面（主菜单 / 设置 / 图鉴 / 操作说明）：只处理导航，世界与计时都冻结。
    if (this.isFrontEnd()) {
      this.updateFrontEnd();
      this.renderer.update(dt);
      this.decayNotices(dt);
      return;
    }

    if (this.input.justPressed('KeyR')) { this.start(); return; }

    // 天赋 / 商店面板的 Escape / E / P 由 updatePanel 自己消费，别在全局截胡。
    const inPanel = this.mode === 'talent' || this.mode === 'shop';
    if (!inPanel && (this.input.justPressed('KeyP') || this.input.justPressed('Escape'))) {
      if (this.mode === 'playing') {
        // 局内 P / Esc 打开暂停菜单（里面能进设置），世界与计时随即冻结
        this.mode = 'paused';
        this.pauseIndex = 0;
        this.pauseHover = -1;
        this.input.firing = false;
      } else if (this.mode === 'paused') {
        // Esc / P 直接继续本局；旧版 Esc 在这里 backToMenu() 会误触丢弃进度，
        // 现在「放弃本局」只能从暂停菜单里显式选择。
        this.mode = 'playing';
        this.input.firing = false;
      } else if (this.mode === 'dead' && this.input.justPressed('Escape')) {
        this.backToMenu();
        return;
      }
    }
    if (this.input.justPressed('F9') && this.mode === 'playing') this.rebuildLevel();

    // 暂停菜单：冻结世界与计时，只处理菜单导航
    if (this.mode === 'paused') {
      this.updatePauseMenu();
      this.renderer.update(dt);
      this.decayNotices(dt);
      return;
    }

    // 天赋 / 商店面板：冻结世界与计时，只处理选择
    if (this.mode === 'talent' || this.mode === 'shop') {
      this.updatePanel();
      this.renderer.update(dt);
      this.decayNotices(dt);
      return;
    }

    if (this.mode === 'playing') {
      this.run.elapsed += dt;
      this.run.levelElapsed += dt;
      this.player.update(dt, this);
      this.weapons.update(dt, this);
      this.enemies.forEachActive((e) => e.update(dt, this));
      this.projectiles.forEachActive((b) => b.update(dt, this));
      this.resolveInteractTarget();
      this.pickups.forEachActive((p) => p.update(dt, this));
      this.particles.forEachActive((p) => p.update(dt, this));
      this.room.update(dt, this);

      if (this.mode === 'playing' && !this.pendingNextLevel) {
        const door = this.room.doorAt(this.player.pos.x, this.player.pos.y, this);
        if (door) this.enterRoom(door.targetId, door.dir);
      }

      // 镜头缓缓跟随玩家：目标由 cameraTarget 按房间边界钳制，
      // 玩家走到门口时门仍在画面里；平滑系数来自设置页（默认标准档）。
      this.renderer.followRoom(this.player.pos, this.room, dt, cameraLerpOf(this.meta.data.settings));

      this.enemies.sweep();
      this.projectiles.sweep();
      this.pickups.sweep();
      this.particles.sweep();

      if (this.pendingNextLevel) {
        this.pendingNextLevel = false;
        const next = this.run.level + 1;
        // 每通过 talentInterval 层弹一次天赋面板，选完再真正切层。
        // 当前 talentInterval=1 → 每层结束都能自选；调回 3 即恢复「每三层一次」。
        if ((next - 1) % BALANCE.talentInterval === 0) this.openTalentPanel(next);
        else this.doNextLevel(next);
      }
    }

    this.renderer.update(dt);
    this.decayNotices(dt);
  }

  private decayNotices(dt: number): void {
    for (const n of this.notices) n.life -= dt;
    this.notices = this.notices.filter((n) => n.life > 0);
  }

  private draw(): void {
    const r = this.renderer;
    r.begin();
    this.level.draw(r);
    this.pickups.forEachActive((p) => p.draw(r));
    this.enemies.forEachActive((e) => e.draw(r));
    this.projectiles.forEachActive((b) => b.draw(r));
    this.particles.forEachActive((p) => p.draw(r));
    this.player.draw(r);
    r.end();

    const info: HudInfo = {
      mode: this.mode,
      fps: this.fps,
      debug: this.debug,
      notices: this.notices,
      templateIssues: this.templateIssues,
      levelIssues: this.levelIssues,
      seed: this.run.seed,
      showCrosshair: flagOf(this.meta.data.settings, 'crosshair'),
      showMinimap: flagOf(this.meta.data.settings, 'minimap'),
    };

    r.ui(() => {
      // 开始界面自带完整画面，HUD 会被盖住；干脆不画，省一次全量绘制。
      if (!this.isFrontEnd()) this.hud.draw(r, this, info);
      if (this.mode === 'menu') {
        drawStartMenu(r, this.meta.data, this.menuIndex, this.menuHover);
      } else if (this.mode === 'settings') {
        drawSettingsPanel(r, this.meta.data.settings, this.settingsIndex, this.settingsHover);
      } else if (this.mode === 'codex') {
        drawCodexPanel(r, this.codexTab, this.codexIndex, this.codexHover);
      } else if (this.mode === 'help') {
        drawHelpPanel(r);
      } else if (this.mode === 'dead') drawDead(r, this.run, this.meta);
      else if (this.mode === 'paused') drawPause(r, this.pauseIndex, this.pauseHover);
      else if (this.mode === 'talent') {
        drawTalentPanel(r, this.talentChoices, this.panelHover, this.run.level);
      } else if (this.mode === 'shop') drawShopPanel(r, this, this.panelHover);
      if (this.debug) drawDebug(r, this, info);
    });
  }

  private readonly loop = (ts: number): void => {
    const frameDt = Math.min((ts - this.lastTs) / 1000, BALANCE.maxDelta);
    this.lastTs = ts;
    this.fps = lerp(this.fps, 1 / Math.max(frameDt, 0.0001), 0.08);

    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= BALANCE.fixedStep && steps < 5) {
      this.update(BALANCE.fixedStep);
      // justPressed 只在第一个子步生效，避免一次按键被固定步长循环消费多次
      if (steps === 0) this.input.endFrame();
      this.accumulator -= BALANCE.fixedStep;
      steps++;
    }
    if (steps >= 5) this.accumulator = 0;

    this.draw();
    requestAnimationFrame(this.loop);
  };
}
