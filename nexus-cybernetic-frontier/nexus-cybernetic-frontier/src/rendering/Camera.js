/**
 * 2D camera: a world-space position plus zoom. Renderer asks it
 * to convert world coordinates into screen coordinates.
 */
export class Camera {
  constructor({ x = 0, y = 0, zoom = 1 } = {}) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
    this.viewportWidth = 0;
    this.viewportHeight = 0;
  }

  setViewport(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  follow(worldX, worldY, smoothing = 0.1) {
    this.x += (worldX - this.x) * smoothing;
    this.y += (worldY - this.y) * smoothing;
  }

  worldToScreen(worldX, worldY) {
    return {
      x: (worldX - this.x) * this.zoom + this.viewportWidth / 2,
      y: (worldY - this.y) * this.zoom + this.viewportHeight / 2
    };
  }
}
