/**
 * Entities are just numeric IDs. All entity "data" lives in
 * ComponentManager instances, not on the entity itself - that's
 * the data-oriented part of ECS that keeps systems fast even with
 * thousands of enemies/particles/NPCs in later phases.
 */
export class EntityManager {
  constructor() {
    this._nextId = 1;
    this._alive = new Set();
    this._freed = [];
  }

  create() {
    const id = this._freed.pop() ?? this._nextId++;
    this._alive.add(id);
    return id;
  }

  destroy(id) {
    this._alive.delete(id);
    this._freed.push(id);
  }

  isAlive(id) {
    return this._alive.has(id);
  }

  get count() {
    return this._alive.size;
  }

  all() {
    return this._alive;
  }
}
