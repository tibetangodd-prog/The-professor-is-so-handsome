/**
 * Tracks keyboard + mouse state for the current frame and the
 * previous frame, so systems can ask both "is this held" and
 * "was this just pressed" (edge-triggered) without keeping their
 * own state. Ignores key events while a text field (e.g. the dev
 * console) has focus, so typing "help" doesn't nudge the player.
 */
export class InputManager {
  constructor() {
    this._keysDown = new Set();
    this._keysPressedThisFrame = new Set();
    this._keysReleasedThisFrame = new Set();

    this._mouse = { x: 0, y: 0, buttons: new Set() };
    this._mousePressedThisFrame = new Set();
    this._mouseReleasedThisFrame = new Set();

    this._canvas = null;
    this._bound = false;
  }

  attach(canvas) {
    if (this._bound) return;
    this._bound = true;
    this._canvas = canvas;

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _isTypingInField() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  _onKeyDown = (e) => {
    if (this._isTypingInField()) return;
    if (!this._keysDown.has(e.code)) {
      this._keysPressedThisFrame.add(e.code);
    }
    this._keysDown.add(e.code);
  };

  _onKeyUp = (e) => {
    if (this._isTypingInField()) return;
    this._keysDown.delete(e.code);
    this._keysReleasedThisFrame.add(e.code);
  };

  _onMouseMove = (e) => {
    const rect = this._canvas.getBoundingClientRect();
    this._mouse.x = e.clientX - rect.left;
    this._mouse.y = e.clientY - rect.top;
  };

  _onMouseDown = (e) => {
    if (!this._mouse.buttons.has(e.button)) {
      this._mousePressedThisFrame.add(e.button);
    }
    this._mouse.buttons.add(e.button);
  };

  _onMouseUp = (e) => {
    this._mouse.buttons.delete(e.button);
    this._mouseReleasedThisFrame.add(e.button);
  };

  isKeyDown(code) {
    return this._keysDown.has(code);
  }

  wasKeyPressed(code) {
    return this._keysPressedThisFrame.has(code);
  }

  wasKeyReleased(code) {
    return this._keysReleasedThisFrame.has(code);
  }

  isMouseDown(button = 0) {
    return this._mouse.buttons.has(button);
  }

  wasMousePressed(button = 0) {
    return this._mousePressedThisFrame.has(button);
  }

  getMousePosition() {
    return { x: this._mouse.x, y: this._mouse.y };
  }

  /** Drops all "held" state. Called when a text field steals focus
   *  so a key held down before that moment doesn't get stuck "on"
   *  forever (its keyup event never reaches us while typing). */
  releaseAll() {
    this._keysDown.clear();
    this._mouse.buttons.clear();
  }

  /** Call once per rendered frame, after all systems have read input. */
  endFrame() {
    this._keysPressedThisFrame.clear();
    this._keysReleasedThisFrame.clear();
    this._mousePressedThisFrame.clear();
    this._mouseReleasedThisFrame.clear();
  }
}
