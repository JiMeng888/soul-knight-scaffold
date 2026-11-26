/**
 * 轻量事件总线。逻辑层只发事件，表现层（HUD / 音效 / 特效）订阅，
 * 单向依赖：表现层可以读逻辑层，逻辑层永远不知道谁在听。
 */
export interface GameEvents {
  'room:enter': { roomId: number };
  'room:clear': { roomId: number };
  'enemy:dead': { x: number; y: number; kind: string };
  'player:hurt': { amount: number };
  'player:dead': { kills: number; level: number };
  'level:next': { level: number };
  'pickup': { kind: string; amount: number };
  'weapon:switch': { id: string };
  /** 换枪时被顶替下来的旧武器已掉回地面，可再次捡回 */
  'weapon:drop': { id: string; x: number; y: number };
  'shot': { id: string };
  'door:locked': { roomId: number };
  'level:clear': { level: number; seconds: number };
  'talent:offer': { level: number };
  'talent:grant': { id: string; name: string };
  'shop:open': { roomId: number };
  'shop:buy': { id: string; price: number };
  'shop:denied': { reason: string };
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

/** 泛型映射类型在 Set 上无法安全地收窄，这里用 any 做一次类型擦除，对外 API 仍是强类型的。 */
type ErasedHandler = (payload: any) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<ErasedHandler>>();

  on<K extends keyof GameEvents>(key: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set<ErasedHandler>();
      this.handlers.set(key, set);
    }
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  emit<K extends keyof GameEvents>(key: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(key);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
