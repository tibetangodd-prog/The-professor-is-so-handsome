import { ResourceManager } from './ResourceManager.js';
import { MathUtils } from '../utils/MathUtils.js';

/**
 * Thin wrapper around the Web Audio API. Kept deliberately small
 * in Phase 1 - real sound design (music layers, ducking, buses per
 * category) will grow this out in a later UI/FX phase.
 */
export class AudioManager {
  constructor(resourceManager = new ResourceManager()) {
    this.resources = resourceManager;
    this._context = null;
    this._masterGain = null;
  }

  /** Must be called from inside a user-gesture handler (click/keydown)
   *  because browsers block audio contexts from auto-starting. */
  unlock() {
    if (this._context) return this._context;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this._context = new Ctx();
    this._masterGain = this._context.createGain();
    this._masterGain.gain.value = 0.8;
    this._masterGain.connect(this._context.destination);
    return this._context;
  }

  get context() {
    return this._context;
  }

  async load(key, url) {
    if (!this._context) this.unlock();
    return this.resources.loadAudio(key, url, this._context);
  }

  play(key, { volume = 1, loop = false } = {}) {
    if (!this._context) return null;
    const buffer = this.resources.getAudioBuffer(key);
    if (!buffer) {
      console.warn(`[AudioManager] "${key}" is not loaded yet.`);
      return null;
    }
    const source = this._context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;

    const gain = this._context.createGain();
    gain.gain.value = volume;

    source.connect(gain).connect(this._masterGain);
    source.start(0);
    return source;
  }

  setMasterVolume(value) {
    if (this._masterGain) {
      this._masterGain.gain.value = MathUtils.clamp(value, 0, 1);
    }
  }
}
