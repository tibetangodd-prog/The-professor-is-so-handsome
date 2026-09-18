import { Scene } from '../core/Scene.js';
import { ComponentTypes, Transform, Velocity, PlayerControlled, Renderable } from '../components/index.js';
import { PlayerInputSystem } from '../systems/PlayerInputSystem.js';
import { MovementSystem } from '../systems/MovementSystem.js';
import { RenderSystem } from '../systems/RenderSystem.js';
import { MathUtils } from '../utils/MathUtils.js';

/**
 * Phase 1 vertical slice: one controllable entity, a camera that
 * follows it, and a HUD - just enough to prove GameLoop, World
 * (ECS), Renderer, InputManager and SceneManager all work together
 * end to end. Real gameplay (weapons, enemies, districts...) starts
 * arriving from Phase 2 onward.
 */
export class DemoScene extends Scene {
  constructor(context) {
    super(context);
    this._renderSystem = new RenderSystem();
  }

  onEnter() {
    const { world, input, hud } = this.context;

    // NOTE: `world` is created once in main.js and shared across
    // scenes. Adding systems here is safe for today's one-shot
    // Boot -> Demo transition. Once a later phase adds real scene
    // round-trips (base <-> district), this will need idempotent
    // system registration or a fresh World per scene - revisit then.
    world.addSystem(new PlayerInputSystem(input));
    world.addSystem(new MovementSystem());

    this.player = world.createEntity();
    world.addComponent(this.player, ComponentTypes.TRANSFORM, Transform(0, 0));
    world.addComponent(this.player, ComponentTypes.VELOCITY, Velocity());
    world.addComponent(this.player, ComponentTypes.PLAYER_CONTROLLED, PlayerControlled(220));
    world.addComponent(this.player, ComponentTypes.RENDERABLE, Renderable({
      shape: 'rect', color: '#00F0FF', width: 28, height: 28, glow: 16
    }));

    // Scattered markers so camera movement reads clearly against
    // something other than an infinite grid.
    for (let i = 0; i < 10; i++) {
      const marker = world.createEntity();
      const x = MathUtils.randInt(-400, 400);
      const y = MathUtils.randInt(-400, 400);
      world.addComponent(marker, ComponentTypes.TRANSFORM, Transform(x, y));
      world.addComponent(marker, ComponentTypes.RENDERABLE, Renderable({
        shape: 'circle', color: '#FF007A', radius: 8, glow: 10
      }));
    }

    hud.classList.remove('hidden');
    this._hp = 100;
    this._energy = 50;
    this._updateHudBars();

    this._registerDebugCommands();
  }

  onExit() {
    this.context.hud.classList.add('hidden');
  }

  update(dt) {
    this.context.world.update(dt);

    const transform = this.context.world.getComponent(this.player, ComponentTypes.TRANSFORM);
    this.context.renderer.camera.follow(transform.x, transform.y, 0.12);
  }

  render(renderer) {
    renderer.clear();
    renderer.drawGrid();
    this._renderSystem.draw(this.context.world, renderer);

    const { debug, loop, world } = this.context;
    debug.updateStats({
      fps: loop.stats.fps,
      frameTimeMs: loop.stats.frameTimeMs,
      entityCount: world.entityCount,
      extra: { Scene: 'DemoScene' }
    });
  }

  _updateHudBars() {
    const { hpFill, energyFill } = this.context;
    hpFill.style.width = `${Math.max(0, this._hp)}%`;
    energyFill.style.width = `${Math.max(0, this._energy)}%`;
  }

  _registerDebugCommands() {
    const { debug, world } = this.context;

    debug.registerCommand('teleport', ([x, y]) => {
      const transform = world.getComponent(this.player, ComponentTypes.TRANSFORM);
      transform.x = Number(x) || 0;
      transform.y = Number(y) || 0;
      debug.log(`Teleported to (${transform.x}, ${transform.y})`);
    }, 'usage: teleport <x> <y>');

    debug.registerCommand('hp', ([value]) => {
      this._hp = MathUtils.clamp(Number(value) || 0, 0, 100);
      this._updateHudBars();
    }, 'usage: hp <0-100>');

    debug.registerCommand('energy', ([value]) => {
      this._energy = MathUtils.clamp(Number(value) || 0, 0, 100);
      this._updateHudBars();
    }, 'usage: energy <0-100>');
  }
}
