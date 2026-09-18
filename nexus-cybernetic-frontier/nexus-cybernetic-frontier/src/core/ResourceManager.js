/**
 * Loads and caches external assets (images / audio buffers).
 * Phase 1 ships with no real art or sound yet, but every later
 * phase should load assets through here rather than ad-hoc
 * `new Image()` calls, so caching and loading progress stay
 * centralised.
 */
export class ResourceManager {
  constructor() {
    this._images = new Map();
    this._audioBuffers = new Map();
    this._pending = 0;
    this._loaded = 0;
  }

  get progress() {
    if (this._pending === 0) return 1;
    return this._loaded / this._pending;
  }

  loadImage(key, url) {
    if (this._images.has(key)) return Promise.resolve(this._images.get(key));
    this._pending++;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this._images.set(key, img);
        this._loaded++;
        resolve(img);
      };
      img.onerror = (err) => {
        this._loaded++;
        reject(new Error(`Failed to load image "${key}" from ${url}: ${err}`));
      };
      img.src = url;
    });
  }

  getImage(key) {
    return this._images.get(key) ?? null;
  }

  async loadAudio(key, url, audioContext) {
    if (this._audioBuffers.has(key)) return this._audioBuffers.get(key);
    this._pending++;
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await audioContext.decodeAudioData(arrayBuffer);
      this._audioBuffers.set(key, buffer);
      this._loaded++;
      return buffer;
    } catch (err) {
      this._loaded++;
      throw new Error(`Failed to load audio "${key}" from ${url}: ${err.message}`);
    }
  }

  getAudioBuffer(key) {
    return this._audioBuffers.get(key) ?? null;
  }
}
