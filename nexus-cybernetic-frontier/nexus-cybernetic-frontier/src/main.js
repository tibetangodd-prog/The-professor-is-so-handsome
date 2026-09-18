import { EventBus } from './core/EventBus.js';
import { GameLoop } from './core/GameLoop.js';
import { InputManager } from './core/InputManager.js';
import { ResourceManager } from './core/ResourceManager.js';
import { AudioManager } from './core/AudioManager.js';
import { SaveManager } from './core/SaveManager.js';
import { DebugManager } from './core/DebugManager.js';
import { SceneManager } from './core/SceneManager.js';
import { Renderer } from './rendering/Renderer.js';
import { World } from './ecs/World.js';
import { BootScene } from './scenes/BootScene.js';
import { DemoScene } from './scenes/DemoScene.js';

function bootstrap() {
  const canvas = document.getElementById('game-canvas');

  const eventBus = new EventBus();
  const input = new InputManager();
  input.attach(canvas);

  const resources = new ResourceManager();
  const audio = new AudioManager(resources);
  const save = new SaveManager();
  const renderer = new Renderer(canvas);
  const world = new World(eventBus);

  const debug = new DebugManager({
    statsElement: document.getElementById('debug-overlay'),
    consoleElement: document.getElementById('dev-console'),
    consoleLogElement: document.getElementById('dev-console-log'),
    consoleInputElement: document.getElementById('dev-console-input'),
    inputManager: input
  });

  const sceneManager = new SceneManager();

  const loop = new GameLoop({
    update: (dt) => sceneManager.update(dt),
    render: (interpolation) => {
      sceneManager.render(renderer, interpolation);
      input.endFrame();
    }
  });

  const context = {
    eventBus,
    input,
    resources,
    audio,
    save,
    renderer,
    world,
    debug,
    loop,
    sceneManager,
    hud: document.getElementById('hud'),
    hpFill: document.getElementById('hp-fill'),
    energyFill: document.getElementById('energy-fill'),
    bootOverlay: document.getElementById('boot-overlay')
  };
  context.createDemoScene = () => new DemoScene(context);

  // Single namespaced escape hatch for poking at live state from the
  // browser console - not used by any gameplay code.
  window.__NEXUS_DEBUG__ = { world, save, context };

  sceneManager.change(new BootScene(context));
  loop.start();
}

document.addEventListener('DOMContentLoaded', bootstrap);
