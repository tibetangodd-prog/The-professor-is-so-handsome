/**
 * Base class for scenes managed by SceneManager. Subclasses
 * override the lifecycle hooks they need; all are optional.
 */
export class Scene {
  constructor(context) {
    this.context = context; // shared engine services (world, renderer, input, etc.)
  }

  onEnter() {}
  onExit() {}
  update(dt) {}
  render(renderer, interpolation) {}
}
