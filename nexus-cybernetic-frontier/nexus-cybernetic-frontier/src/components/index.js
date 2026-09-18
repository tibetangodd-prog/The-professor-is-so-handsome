/**
 * Components are plain data objects. Each factory just returns a
 * fresh object literal - no classes, no methods, so systems remain
 * the only place behaviour lives (see systems/).
 *
 * Everything lives in one file for now because there are only four
 * of them; once Gameplay phases start adding Health, Weapon,
 * Faction, etc. this should probably split into one file per
 * component (or per category) with this file re-exporting them.
 */

export function Transform(x = 0, y = 0, rotation = 0) {
  return { x, y, rotation };
}

export function Velocity(vx = 0, vy = 0) {
  return { vx, vy };
}

export function PlayerControlled(speed = 220) {
  return { speed };
}

export function Renderable({ shape = 'rect', color = '#00F0FF', width = 24, height = 24, radius = 12, glow = 12 } = {}) {
  return { shape, color, width, height, radius, glow };
}

export const ComponentTypes = Object.freeze({
  TRANSFORM: 'Transform',
  VELOCITY: 'Velocity',
  PLAYER_CONTROLLED: 'PlayerControlled',
  RENDERABLE: 'Renderable'
});
