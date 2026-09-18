import { ComponentTypes } from '../components/index.js';

/** Draws every entity that has both a Transform and a Renderable.
 *  Called from a Scene's render() (variable-rate), never from the
 *  fixed-timestep gameplay update - rendering must never mutate
 *  gameplay state. */
export class RenderSystem {
  draw(world, renderer) {
    const entities = world.query(ComponentTypes.TRANSFORM, ComponentTypes.RENDERABLE);
    for (const id of entities) {
      const transform = world.getComponent(id, ComponentTypes.TRANSFORM);
      const renderable = world.getComponent(id, ComponentTypes.RENDERABLE);

      if (renderable.shape === 'circle') {
        renderer.drawCircle(transform.x, transform.y, renderable.radius, {
          color: renderable.color,
          glow: renderable.glow
        });
      } else {
        renderer.drawRect(transform.x, transform.y, renderable.width, renderable.height, {
          color: renderable.color,
          glow: renderable.glow,
          rotation: transform.rotation
        });
      }
    }
  }
}
