/**
 * Simple publish/subscribe event bus used to decouple engine
 * systems from each other (Renderer never talks to Gameplay
 * directly, AI never touches the UI directly, etc).
 */
export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const wrapped = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }

  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    const handlers = this._listeners.get(event);
    if (!handlers) return;
    // Copy to an array so a handler can safely unsubscribe mid-emit.
    for (const handler of [...handlers]) {
      handler(payload);
    }
  }

  clear(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }
}
