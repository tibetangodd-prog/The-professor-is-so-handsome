/**
 * Developer tooling: an on-screen stats readout and a text
 * console for runtime commands (see registerCommand). Both are
 * plain DOM overlays so they never have to fight the game canvas
 * for draw order or coordinate transforms.
 */
export class DebugManager {
  constructor({ statsElement, consoleElement, consoleLogElement, consoleInputElement, inputManager } = {}) {
    this.statsElement = statsElement;
    this.consoleElement = consoleElement;
    this.consoleLogElement = consoleLogElement;
    this.consoleInputElement = consoleInputElement;
    this.inputManager = inputManager;

    this._commands = new Map();
    this._statsVisible = false;
    this._consoleVisible = false;

    this.registerCommand('help', () => {
      const lines = [...this._commands.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, { description }]) => (description ? `${name} - ${description}` : name));
      lines.forEach((line) => this.log(line));
    }, 'List all commands.');

    this._bindInput();
  }

  registerCommand(name, handler, description = '') {
    this._commands.set(name, { handler, description });
  }

  execute(rawLine) {
    const line = rawLine.trim();
    if (!line) return;
    this.log(`> ${line}`);

    const [name, ...args] = line.split(/\s+/);
    const command = this._commands.get(name);
    if (!command) {
      this.log(`Unknown command: "${name}". Type "help" for a list.`);
      return;
    }
    try {
      command.handler(args);
    } catch (err) {
      this.log(`Error running "${name}": ${err.message}`);
    }
  }

  log(message) {
    if (!this.consoleLogElement) return;
    const line = document.createElement('div');
    line.textContent = message;
    this.consoleLogElement.appendChild(line);
    this.consoleLogElement.scrollTop = this.consoleLogElement.scrollHeight;
  }

  toggleStats(force) {
    this._statsVisible = force ?? !this._statsVisible;
    this.statsElement?.classList.toggle('hidden', !this._statsVisible);
  }

  toggleConsole(force) {
    this._consoleVisible = force ?? !this._consoleVisible;
    this.consoleElement?.classList.toggle('hidden', !this._consoleVisible);
    if (this._consoleVisible) {
      this.inputManager?.releaseAll();
      this.consoleInputElement?.focus();
    } else {
      this.consoleInputElement?.blur();
    }
  }

  updateStats({ fps, frameTimeMs, entityCount = 0, extra = {} }) {
    if (!this._statsVisible || !this.statsElement) return;
    const extraLines = Object.entries(extra)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    this.statsElement.textContent =
      `FPS: ${fps}\n` +
      `Frame Time: ${frameTimeMs.toFixed(2)}ms\n` +
      `Entities: ${entityCount}` +
      (extraLines ? `\n${extraLines}` : '');
  }

  _bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggleStats();
      } else if (e.code === 'Backquote' && document.activeElement !== this.consoleInputElement) {
        e.preventDefault();
        this.toggleConsole();
      } else if (e.code === 'Escape' && this._consoleVisible) {
        this.toggleConsole(false);
      }
    });

    this.consoleInputElement?.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') {
        const value = this.consoleInputElement.value;
        this.consoleInputElement.value = '';
        this.execute(value);
      }
    });
  }
}
