import { ComponentTypes } from '../components/index.js';

/** Applies Velocity to Transform. This is the only system allowed
 *  to write to Transform.{x,y} during normal movement - keeping a
 *  single writer per field avoids order-of-systems bugs later. */
export class MovementSystem {
  update(dt, world) {
    const entities = world.query(ComponentTypes.TRANSFORM, ComponentTypes.VELOCITY);
    for (const id of entities) {
      const transform = world.getComponent(id, ComponentTypes.TRANSFORM);
      const velocity = world.getComponent(id, ComponentTypes.VELOCITY);
      transform.x += velocity.vx * dt;
      transform.y += velocity.vy * dt;
    }
  }
}
