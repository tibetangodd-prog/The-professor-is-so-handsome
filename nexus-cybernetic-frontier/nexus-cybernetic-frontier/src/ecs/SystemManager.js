/**
 * Runs registered systems in registration order every fixed
 * update. Systems are plain objects/classes exposing an
 * `update(dt, world)` method - see systems/ for examples.
 */
export class SystemManager {
  constructor() {
    this._systems = [];
  }

  add(system) {
    this._systems.push(system);
    return this;
  }

  update(dt, world) {
    for (const system of this._systems) {
      system.update(dt, world);
    }
  }
}
