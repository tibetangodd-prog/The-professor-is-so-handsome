import { Camera } from './Camera.js';

/**
 * Thin Canvas2D wrapper. Keeps a `clear()` plus a handful of
 * camera-aware draw helpers; nothing here knows about gameplay
 * state, per the "renderer must not manage gameplay state" rule.
 */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = new Camera();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth, clientHeight } = this.canvas;
    this.canvas.width = clientWidth * dpr;
    this.canvas.height = clientHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.setViewport(clientWidth, clientHeight);
  }

  clear(color = '#0A0A12') {
    const { clientWidth, clientHeight } = this.canvas;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, clientWidth, clientHeight);
  }

  drawGrid(spacing = 64, color = 'rgba(0, 240, 255, 0.08)') {
    const { clientWidth, clientHeight } = this.canvas;
    const { x: camX, y: camY } = this.camera;
    const ctx = this.ctx;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();

    const startX = -((camX % spacing) + spacing) % spacing;
    for (let x = startX; x < clientWidth; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, clientHeight);
    }
    const startY = -((camY % spacing) + spacing) % spacing;
    for (let y = startY; y < clientHeight; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(clientWidth, y);
    }
    ctx.stroke();
  }

  drawRect(worldX, worldY, width, height, { color = '#00F0FF', glow = 0, rotation = 0 } = {}) {
    const { x, y } = this.camera.worldToScreen(worldX, worldY);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    if (glow > 0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
    }
    ctx.fillStyle = color;
    ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.restore();
  }

  drawCircle(worldX, worldY, radius, { color = '#FF007A', glow = 0 } = {}) {
    const { x, y } = this.camera.worldToScreen(worldX, worldY);
    const ctx = this.ctx;
    ctx.save();
    if (glow > 0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawText(text, worldX, worldY, { color = '#E5E7EB', font = '12px monospace', align = 'center' } = {}) {
    const { x, y } = this.camera.worldToScreen(worldX, worldY);
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  }
}
