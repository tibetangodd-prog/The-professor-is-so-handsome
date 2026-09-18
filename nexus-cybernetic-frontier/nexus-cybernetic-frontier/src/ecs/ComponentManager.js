/**
 * Holds one Map<entityId, componentData> per component type.
 * Deliberately just plain objects for component data (no base
 * "Component" class to extend) - it keeps gameplay code able to
 * treat components as cheap, serialisable data.
 */
export class ComponentManager {
  constructor() {
    this._stores = new Map(); // type -> Map<entityId, data>
  }

  _storeFor(type) {
    if (!this._stores.has(type)) {
      this._stores.set(type, new Map());
    }
    return this._stores.get(type);
  }

  add(entityId, type, data) {
    this._storeFor(type).set(entityId, data);
    return data;
  }

  get(entityId, type) {
    return this._stores.get(type)?.get(entityId);
  }

  has(entityId, type) {
    return this._stores.get(type)?.has(entityId) ?? false;
  }

  remove(entityId, type) {
    this._stores.get(type)?.delete(entityId);
  }

  removeAll(entityId) {
    for (const store of this._stores.values()) {
      store.delete(entityId);
    }
  }

  /** Returns entity IDs that have every one of `types`. Fine for
   *  Phase 1 entity counts; Phase 16 (performance) is the place to
   *  swap this for archetype tables if profiling calls for it. */
  query(...types) {
    if (types.length === 0) return [];
    const [firstType, ...rest] = types;
    const first = this._stores.get(firstType);
    if (!first) return [];

    const result = [];
    outer: for (const entityId of first.keys()) {
      for (const type of rest) {
        if (!this.has(entityId, type)) continue outer;
      }
      result.push(entityId);
    }
    return result;
  }
}
