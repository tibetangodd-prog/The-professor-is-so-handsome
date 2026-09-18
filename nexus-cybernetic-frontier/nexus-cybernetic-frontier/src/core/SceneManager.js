/**
 * Stack-based scene manager. `change()` replaces the current
 * scene outright (Boot -> Demo); `push`/`pop` are there for future
 * phases that need overlays (a pause menu on top of gameplay, etc).
 */
export class SceneManager {
  constructor() {
    this._stack = [];
  }

  get current() {
    return this._stack[this._stack.length - 1] ?? null;
  }

  /** Replace the whole stack with a single new scene. */
  change(scene) {
    while (this._stack.length) {
      this._stack.pop().onExit();
    }
    this._stack.push(scene);
    scene.onEnter();
  }

  /** Push an overlay scene (e.g. a future pause menu) on top of the
   *  current one without discarding it. Full pause/resume semantics
   *  belong to a later phase - for now the scene underneath simply
   *  stops receiving update()/render() calls while covered. */
  push(scene) {
    this._stack.push(scene);
    scene.onEnter();
  }

  pop() {
    this._stack.pop()?.onExit();
  }

  update(dt) {
    this.current?.update(dt);
  }

  render(renderer, interpolation) {
    this.current?.render(renderer, interpolation);
  }
}
