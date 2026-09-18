/**
 * Fixed-timestep game loop.
 *
 * Gameplay ("update") always advances in fixed 1/60s steps so
 * movement/combat/AI behave the same regardless of display refresh
 * rate. Rendering runs once per animation frame and reads whatever
 * state the last update left behind.
 */
export class GameLoop {
  constructor({ update, render, fixedStep = 1 / 60, maxFrameTime = 0.25 } = {}) {
    this._update = update;
    this._render = render;
    this._fixedStep = fixedStep;
    this._maxFrameTime = maxFrameTime;

    this._running = false;
    this._lastTime = 0;
    this._accumulator = 0;
    this._rafHandle = null;
    this._fpsSamples = [];

    // Consumed by DebugManager's stats overlay.
    this.stats = { fps: 0, frameTimeMs: 0, updateSteps: 0 };
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._accumulator = 0;
    this._rafHandle = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    if (this._rafHandle !== null) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }
  }

  // Arrow class field so it can be handed straight to requestAnimationFrame.
  _tick = (now) => {
    if (!this._running) return;

    const rawDeltaMs = now - this._lastTime;
    this._lastTime = now;

    let frameTime = rawDeltaMs / 1000;
    // Clamp so a backgrounded tab / breakpoint doesn't cause a huge
    // catch-up burst of updates on the next visible frame.
    if (frameTime > this._maxFrameTime) frameTime = this._maxFrameTime;

    this._accumulator += frameTime;

    let steps = 0;
    while (this._accumulator >= this._fixedStep) {
      this._update(this._fixedStep);
      this._accumulator -= this._fixedStep;
      steps++;
    }

    const interpolation = this._accumulator / this._fixedStep;
    this._render(interpolation);

    this._recordStats(rawDeltaMs, steps);
    this._rafHandle = requestAnimationFrame(this._tick);
  };

  _recordStats(rawDeltaMs, steps) {
    this._fpsSamples.push(rawDeltaMs);
    if (this._fpsSamples.length > 30) this._fpsSamples.shift();

    const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
    this.stats.frameTimeMs = avg;
    this.stats.fps = avg > 0 ? Math.round(1000 / avg) : 0;
    this.stats.updateSteps = steps;
  }
}
