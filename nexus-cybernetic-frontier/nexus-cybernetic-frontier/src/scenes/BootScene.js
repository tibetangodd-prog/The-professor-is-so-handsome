import { Scene } from '../core/Scene.js';

/**
 * Shows the DOM boot overlay (see index.html #boot-overlay) and
 * waits for a user gesture. The click/keypress both dismisses the
 * overlay and unlocks the AudioContext, which browsers refuse to
 * start without one.
 */
export class BootScene extends Scene {
  onEnter() {
    const { bootOverlay, audio, sceneManager, createDemoScene } = this.context;

    this._onStart = () => {
      audio.unlock();
      bootOverlay.classList.add('hidden');
      sceneManager.change(createDemoScene());
    };

    bootOverlay.classList.remove('hidden');
    window.addEventListener('keydown', this._onStart, { once: true });
    bootOverlay.addEventListener('click', this._onStart, { once: true });
  }

  onExit() {
    window.removeEventListener('keydown', this._onStart);
    this.context.bootOverlay.removeEventListener('click', this._onStart);
  }
}
