import { ComponentTypes } from '../components/index.js';

/**
 * Reads InputManager state and turns it into a Velocity for every
 * entity tagged PlayerControlled. Combat/dash/hack inputs get their
 * own systems in later phases - this one only owns movement.
 */
export class PlayerInputSystem {
  constructor(inputManager) {
    this.input = inputManager;
  }

  update(dt, world) {
    const entities = world.query(ComponentTypes.PLAYER_CONTROLLED, ComponentTypes.VELOCITY);

    let dx = 0;
    let dy = 0;
    if (this.input.isKeyDown('KeyW') || this.input.isKeyDown('ArrowUp')) dy -= 1;
    if (this.input.isKeyDown('KeyS') || this.input.isKeyDown('ArrowDown')) dy += 1;
    if (this.input.isKeyDown('KeyA') || this.input.isKeyDown('ArrowLeft')) dx -= 1;
    if (this.input.isKeyDown('KeyD') || this.input.isKeyDown('ArrowRight')) dx += 1;

    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;

    for (const id of entities) {
      const controlled = world.getComponent(id, ComponentTypes.PLAYER_CONTROLLED);
      const velocity = world.getComponent(id, ComponentTypes.VELOCITY);
      velocity.vx = dx * controlled.speed;
      velocity.vy = dy * controlled.speed;
    }
  }
}
