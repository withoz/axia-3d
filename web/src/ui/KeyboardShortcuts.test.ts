import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initKeyboardShortcuts, KeyboardShortcutsDeps } from './KeyboardShortcuts';

// Mock VCB
vi.mock('./VCB', () => ({ vcbTools: new Set(['line', 'rect', 'circle', 'pushpull']) }));

function createDOM(): void {
  document.body.innerHTML = `
    <div id="toolbar">
      <button class="tool-btn" data-tool="select">Select</button>
      <button class="tool-btn" data-tool="line">Line</button>
      <button class="tool-btn" data-tool="rect">Rect</button>
      <button class="tool-btn" data-tool="undo">Undo</button>
      <button class="tool-btn" data-tool="redo">Redo</button>
    </div>
    <div id="tool-label">Select</div>
    <div id="view-mode-bar">
      <button class="view-btn" data-view="3d">3D</button>
      <button class="view-btn" data-view="top">Top</button>
      <button class="view-btn" data-view="front">Front</button>
    </div>
    <div id="home-btn">Home</div>
    <div id="stat-osnap">ON</div>
  `;
}

function mockDeps(): KeyboardShortcutsDeps {
  return {
    toolManager: {
      setTool: vi.fn(),
      executeAction: vi.fn(),
      cancelCurrentTool: vi.fn(),
      isToolBusy: vi.fn().mockReturnValue(false),
      currentTool: 'select',
      snap: { toggle: vi.fn(), enabled: true },
      setAxisLock: vi.fn(),
      selection: {
        isInGroupEditMode: vi.fn().mockReturnValue(false),
        exitGroupEdit: vi.fn(),
        clearSelection: vi.fn(),
      },
    } as any,
    viewport: {
      setViewMode: vi.fn(),
      resetCamera: vi.fn(),
      viewMode: '3d',
    } as any,
    toolbar: document.getElementById('toolbar')!,
    viewModeBar: document.getElementById('view-mode-bar'),
    saveProject: vi.fn(),
    openProject: vi.fn(),
  };
}

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    ...opts,
  }));
}

describe('KeyboardShortcuts', () => {
  let deps: ReturnType<typeof mockDeps>;

  beforeEach(() => {
    createDOM();
    deps = mockDeps();
    initKeyboardShortcuts(deps);
  });

  describe('tool shortcuts', () => {
    it('V switches to select', () => {
      fireKey('v');
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('select');
    });

    it('L switches to line', () => {
      fireKey('l');
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('line');
    });

    it('R switches to rect', () => {
      fireKey('r');
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('rect');
    });

    it('C switches to circle', () => {
      fireKey('c');
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('circle');
    });

    it('P switches to pushpull', () => {
      fireKey('p');
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('pushpull');
    });

    it('M switches to move', () => {
      fireKey('m');
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('move');
    });

    it('Q switches to rotate', () => {
      fireKey('q');
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('rotate');
    });

    it('S switches to scale', () => {
      fireKey('s');
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('scale');
    });

    it('O switches to offset', () => {
      fireKey('o');
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('offset');
    });

    it('E switches to erase', () => {
      fireKey('e');
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('erase');
    });

    it('tool switch blocked when tool is busy', () => {
      (deps.toolManager.isToolBusy as any).mockReturnValue(true);
      fireKey('r');
      expect(deps.toolManager.setTool).not.toHaveBeenCalled();
    });

    it('updates tool label on switch', () => {
      fireKey('l');
      const label = document.getElementById('tool-label')!;
      expect(label.textContent).toBe('Line');
    });
  });

  describe('Shift combos', () => {
    it('Shift+L switches to polyline', () => {
      fireKey('L', { shiftKey: true });
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('polyline');
    });

    it('Shift+F switches to freehand', () => {
      fireKey('F', { shiftKey: true });
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('freehand');
    });
  });

  describe('Ctrl combos', () => {
    it('Ctrl+S calls saveProject', () => {
      fireKey('s', { ctrlKey: true });
      expect(deps.saveProject).toHaveBeenCalled();
    });

    it('Ctrl+O calls openProject', () => {
      fireKey('o', { ctrlKey: true });
      expect(deps.openProject).toHaveBeenCalled();
    });

    it('Ctrl+G calls group action', () => {
      fireKey('g', { ctrlKey: true });
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('group');
    });

    it('Ctrl+Shift+G calls ungroup action', () => {
      fireKey('G', { ctrlKey: true, shiftKey: true });
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('ungroup');
    });

    it('Ctrl+A calls select-all', () => {
      fireKey('a', { ctrlKey: true });
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('select-all');
    });
  });

  describe('special keys', () => {
    it('Delete calls delete action', () => {
      fireKey('Delete');
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('delete');
    });

    it('F3 toggles snap', () => {
      fireKey('F3');
      expect(deps.toolManager.snap.toggle).toHaveBeenCalled();
    });

    it('Spacebar cancels busy tool', () => {
      (deps.toolManager.isToolBusy as any).mockReturnValue(true);
      fireKey(' ');
      expect(deps.toolManager.cancelCurrentTool).toHaveBeenCalled();
    });

    it('H resets camera', () => {
      fireKey('h');
      expect(deps.viewport.resetCamera).toHaveBeenCalled();
    });
  });

  describe('axis lock', () => {
    it('ArrowRight locks X axis', () => {
      fireKey('ArrowRight');
      expect(deps.toolManager.setAxisLock).toHaveBeenCalledWith('x');
    });

    it('ArrowUp locks Y axis', () => {
      fireKey('ArrowUp');
      expect(deps.toolManager.setAxisLock).toHaveBeenCalledWith('y');
    });

    it('ArrowLeft locks Z axis', () => {
      fireKey('ArrowLeft');
      expect(deps.toolManager.setAxisLock).toHaveBeenCalledWith('z');
    });

    it('ArrowDown clears axis lock', () => {
      fireKey('ArrowDown');
      expect(deps.toolManager.setAxisLock).toHaveBeenCalledWith(null);
    });
  });

  describe('Escape key', () => {
    it('exits group edit mode if active', () => {
      (deps.toolManager.selection.isInGroupEditMode as any).mockReturnValue(true);
      fireKey('Escape');
      expect(deps.toolManager.selection.exitGroupEdit).toHaveBeenCalled();
    });

    it('switches to select tool in 3D mode', () => {
      fireKey('Escape');
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('select');
    });
  });

  describe('view shortcuts', () => {
    it('T switches to top view', () => {
      fireKey('t');
      expect(deps.viewport.setViewMode).toHaveBeenCalledWith('top');
    });

    it('F switches to front view', () => {
      fireKey('f');
      expect(deps.viewport.setViewMode).toHaveBeenCalledWith('front');
    });

    it('B switches to bottom view', () => {
      fireKey('b');
      expect(deps.viewport.setViewMode).toHaveBeenCalledWith('bottom');
    });
  });

  describe('input field bypass', () => {
    it('ignores shortcuts when input is focused', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      // Simulate keydown with target being the input
      const event = new KeyboardEvent('keydown', { key: 'l', bubbles: true });
      Object.defineProperty(event, 'target', { value: input });
      window.dispatchEvent(event);
      expect(deps.toolManager.setTool).not.toHaveBeenCalled();
    });
  });

  describe('home button', () => {
    it('clicking home button resets camera', () => {
      document.getElementById('home-btn')!.click();
      expect(deps.viewport.resetCamera).toHaveBeenCalled();
    });
  });
});
