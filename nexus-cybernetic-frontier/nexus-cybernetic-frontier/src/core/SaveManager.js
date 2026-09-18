const DB_NAME = 'nexus-cybernetic-frontier';
const DB_VERSION = 1;
const STORE_NAME = 'saves';

/** Bump this whenever the shape of saved data changes, and add a
 *  branch inside `_migrate()` to upgrade older saves in place
 *  instead of wiping the player's progress. */
export const SAVE_SCHEMA_VERSION = 1;

/**
 * IndexedDB-backed save system. Each save "slot" is a string key
 * (e.g. "slot-1", "autosave") mapping to a versioned JSON-safe blob.
 */
export class SaveManager {
  constructor() {
    this._dbPromise = null;
  }

  _openDb() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'slot' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this._dbPromise;
  }

  async save(slot, data) {
    const db = await this._openDb();
    const payload = {
      slot,
      schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: Date.now(),
      data
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(payload);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return payload;
  }

  async load(slot) {
    const db = await this._openDb();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(slot);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    return record ? this._migrate(record) : null;
  }

  async delete(slot) {
    const db = await this._openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(slot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async list() {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  _migrate(record) {
    const { schemaVersion } = record;

    // Example for the future:
    // if (schemaVersion === 1) { record.data = upgradeV1ToV2(record.data); record.schemaVersion = 2; }

    if (schemaVersion !== SAVE_SCHEMA_VERSION) {
      console.warn(
        `[SaveManager] Save "${record.slot}" is schema v${schemaVersion}, ` +
        `engine expects v${SAVE_SCHEMA_VERSION}. No migration defined yet - loading as-is.`
      );
    }

    return record;
  }
}
