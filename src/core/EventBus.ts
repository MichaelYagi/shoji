export type EventMap = Record<string, unknown>;

export type Unsubscribe = () => void;

type Listener<T> = (detail: T) => void;

/**
 * Typed pub/sub used by Gallery and every plugin (`ctx.on`). Plugin
 * subscriptions are unsubscribed automatically on destroy by the caller
 * that owns the PluginContext, not by this class.
 */
export class EventBus<Events extends EventMap> {
  private listeners = new Map<keyof Events, Set<Listener<unknown>>>();

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<unknown>);
    return () => this.off(event, fn);
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(fn as Listener<unknown>);
  }

  emit<K extends keyof Events>(event: K, detail: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) (fn as Listener<Events[K]>)(detail);
  }

  clear(): void {
    this.listeners.clear();
  }
}
