import { EntityManager } from './EntityManager.js';
import { ComponentManager } from './ComponentManager.js';
import { SystemManager } from './SystemManager.js';

/**
 * Composition root for the ECS - this is "world" in the
 * Entity-Component-System sense (the container of all entities),
 * not the game's city/world-state. The Phase 3+ Gameplay layer
 * will own city/district/faction state separately and read/write
 * it through components and systems registered on this World.
 */
export class World {
  constructor(eventBus) {
    this.entities = new EntityManager();
    this.components = new ComponentManager();
    this.systems = new SystemManager();
    this.events = eventBus;
  }

  createEntity() {
    return this.entities.create();
  }

  destroyEntity(id) {
    this.components.removeAll(id);
    this.entities.destroy(id);
  }

  addComponent(id, type, data) {
    return this.components.add(id, type, data);
  }

  getComponent(id, type) {
    return this.components.get(id, type);
  }

  hasComponent(id, type) {
    return this.components.has(id, type);
  }

  removeComponent(id, type) {
    this.components.remove(id, type);
  }

  query(...types) {
    return this.components.query(...types);
  }

  addSystem(system) {
    this.systems.add(system);
    return this;
  }

  update(dt) {
    this.systems.update(dt, this);
  }

  get entityCount() {
    return this.entities.count;
  }
}
