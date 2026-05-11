/**
 * CommandInput — CAD-style command line for direct geometry input
 * Usage: "L 100" (line length), "P 10,20,30" (point), etc.
 */

import { debugLog } from '../utils/debug';

export interface CommandHandler {
  name: string;
  /** Optional — 없으면 primary name만 등록 */
  aliases?: string[];
  execute: (args: string[]) => void;
  help: string;
}

export class CommandInput {
  private container: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private output: HTMLElement | null = null;
  private handlers: Map<string, CommandHandler> = new Map();
  private history: string[] = [];
  private historyIndex: number = -1;
  private isVisible: boolean = false;

  constructor() {
    this.createUI();
  }

  private createUI(): void {
    // Container
    this.container = document.createElement('div');
    this.container.id = 'command-input-panel';
    this.container.className = 'command-input-panel';
    this.container.innerHTML = `
      <div class="command-input-header">명령어 입력 (Command)</div>
      <div class="command-input-body">
        <input
          type="text"
          class="command-input-field"
          placeholder="예: L 100 (라인), R 50,50,100 (상자), C 50 (원)"
          autocomplete="off"
        />
        <div class="command-output"></div>
      </div>
    `;

    this.input = this.container.querySelector('.command-input-field') as HTMLInputElement;
    this.output = this.container.querySelector('.command-output') as HTMLElement;

    this.setupEventListeners();
    this.addToDOM();
  }

  private setupEventListeners(): void {
    if (!this.input) return;

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.executeCommand(this.input!.value);
        this.history.push(this.input!.value);
        this.historyIndex = this.history.length;
        this.input!.value = '';
      } else if (e.key === 'Escape') {
        this.hide();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.historyIndex = Math.max(0, this.historyIndex - 1);
        if (this.history[this.historyIndex]) {
          this.input!.value = this.history[this.historyIndex];
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.historyIndex = Math.min(this.history.length, this.historyIndex + 1);
        if (this.historyIndex < this.history.length) {
          this.input!.value = this.history[this.historyIndex];
        } else {
          this.input!.value = '';
        }
      }
    });
  }

  private addToDOM(): void {
    if (this.container && !this.container.parentElement) {
      document.body.appendChild(this.container);
      this.addStyles();
    }
  }

  private addStyles(): void {
    if (document.getElementById('command-input-styles')) return;

    const style = document.createElement('style');
    style.id = 'command-input-styles';
    style.textContent = `
      #command-input-panel {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: #2a2a2a;
        border-top: 1px solid #444;
        color: #e0e0e0;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        z-index: 8000;
        display: none;
        box-shadow: 0 -2px 8px rgba(0,0,0,0.3);
      }

      #command-input-panel.visible {
        display: flex;
        flex-direction: column;
      }

      .command-input-header {
        padding: 8px 12px;
        background: #1a1a1a;
        border-bottom: 1px solid #444;
        font-weight: bold;
        color: #5b9bd5;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .command-input-body {
        display: flex;
        flex-direction: column;
        padding: 8px 12px;
        gap: 8px;
      }

      .command-input-field {
        background: #1a1a1a;
        border: 1px solid #444;
        color: #e0e0e0;
        padding: 8px 12px;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        outline: none;
      }

      .command-input-field:focus {
        border-color: #5b9bd5;
        box-shadow: 0 0 4px rgba(91, 155, 213, 0.3);
      }

      .command-output {
        max-height: 60px;
        overflow-y: auto;
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 2px;
        padding: 6px 8px;
        font-size: 11px;
        color: #aaa;
        white-space: pre-wrap;
        word-break: break-all;
      }

      .command-output.error {
        color: #ff6b6b;
        border-color: #ff6b6b;
      }

      .command-output.success {
        color: #51cf66;
        border-color: #51cf66;
      }

      .command-output.info {
        color: #5b9bd5;
      }
    `;
    document.head.appendChild(style);
  }

  registerHandler(handler: CommandHandler): void {
    this.handlers.set(handler.name.toLowerCase(), handler);
    // aliases는 optional — 없으면 skip
    if (Array.isArray(handler.aliases)) {
      handler.aliases.forEach((alias) => {
        this.handlers.set(alias.toLowerCase(), handler);
      });
    }
    debugLog(`[CommandInput] Registered: ${handler.name}`);
  }

  private executeCommand(input: string): void {
    const trimmed = input.trim();
    if (!trimmed) return;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    const handler = this.handlers.get(cmd);
    if (!handler) {
      this.printError(`알 수 없는 명령: ${cmd}`);
      return;
    }

    try {
      handler.execute(args);
      this.printSuccess(`실행됨: ${handler.name}`);
    } catch (err) {
      this.printError(`오류: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  show(): void {
    if (this.container) {
      this.container.classList.add('visible');
      this.isVisible = true;
      this.input?.focus();
      this.output!.textContent = '';
    }
  }

  hide(): void {
    if (this.container) {
      this.container.classList.remove('visible');
      this.isVisible = false;
      this.input!.value = '';
    }
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  printError(msg: string): void {
    if (this.output) {
      this.output.textContent = msg;
      this.output.className = 'command-output error';
    }
  }

  printSuccess(msg: string): void {
    if (this.output) {
      this.output.textContent = msg;
      this.output.className = 'command-output success';
    }
  }

  printInfo(msg: string): void {
    if (this.output) {
      this.output.textContent = msg;
      this.output.className = 'command-output info';
    }
  }

  isOpen(): boolean {
    return this.isVisible;
  }
}
