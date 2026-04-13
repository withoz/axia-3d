import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initOsnapPanel, OsnapPanelDeps } from './OsnapPanel';

// Mock debug
vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

// jsdom doesn't support canvas 2d context, so we mock it
const mockCtx = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
};
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as any;

// Mock SnapManager
function mockSnapManager() {
  return {
    enabled: true,
    setMode: vi.fn(),
    isActive: vi.fn().mockReturnValue(true),
  } as any;
}

// Mock SnapVisual
function mockSnapVisual() {
  return {
    setMarkerSize: vi.fn(),
    getMarkerSize: vi.fn().mockReturnValue(8),
  } as any;
}

function createOsnapDOM(): void {
  document.body.innerHTML = `
    <div id="osnap-panel" class="state-hidden">
      <input type="checkbox" id="osnap-master" checked />
      <input type="checkbox" data-mode="endpoint" checked />
      <input type="checkbox" data-mode="midpoint" />
      <input type="checkbox" data-mode="center" checked />
      <input type="checkbox" data-mode="intersection" />
      <input id="osnap-size-slider" type="range" min="4" max="20" value="8" />
      <canvas id="osnap-size-preview" width="60" height="60"></canvas>
      <button id="osnap-ok">OK</button>
      <button id="osnap-cancel">Cancel</button>
      <button id="osnap-panel-close">X</button>
      <button id="osnap-select-all">Select All</button>
      <button id="osnap-clear-all">Clear All</button>
    </div>
    <div id="osnap-toggle"></div>
  `;
}

describe('OsnapPanel', () => {
  let deps: OsnapPanelDeps;

  beforeEach(() => {
    createOsnapDOM();
    deps = {
      snap: mockSnapManager(),
      snapVisual: mockSnapVisual(),
      updateOsnapUI: vi.fn(),
    };
  });

  describe('initOsnapPanel', () => {
    it('returns openOsnapPanel function', () => {
      const api = initOsnapPanel(deps);
      expect(api.openOsnapPanel).toBeInstanceOf(Function);
    });

    it('returns noop when panel element missing', () => {
      document.body.innerHTML = '';
      const api = initOsnapPanel(deps);
      // Should not throw
      expect(() => api.openOsnapPanel()).not.toThrow();
    });

    it('syncs initial checkbox state to snap manager', () => {
      initOsnapPanel(deps);
      // 4 mode checkboxes → setMode called 4 times
      expect(deps.snap.setMode).toHaveBeenCalledTimes(4);
      expect(deps.snap.setMode).toHaveBeenCalledWith('endpoint', true);
      expect(deps.snap.setMode).toHaveBeenCalledWith('midpoint', false);
      expect(deps.snap.setMode).toHaveBeenCalledWith('center', true);
      expect(deps.snap.setMode).toHaveBeenCalledWith('intersection', false);
    });
  });

  describe('openOsnapPanel', () => {
    it('makes panel visible', () => {
      const api = initOsnapPanel(deps);
      api.openOsnapPanel();
      const panel = document.getElementById('osnap-panel')!;
      expect(panel.classList.contains('visible')).toBe(true);
      expect(panel.classList.contains('state-hidden')).toBe(false);
    });

    it('syncs master checkbox from snap.enabled', () => {
      deps.snap.enabled = false;
      const api = initOsnapPanel(deps);
      api.openOsnapPanel();
      const master = document.getElementById('osnap-master') as HTMLInputElement;
      expect(master.checked).toBe(false);
    });

    it('syncs slider to current marker size', () => {
      (deps.snapVisual.getMarkerSize as any).mockReturnValue(12);
      const api = initOsnapPanel(deps);
      api.openOsnapPanel();
      const slider = document.getElementById('osnap-size-slider') as HTMLInputElement;
      expect(slider.value).toBe('12');
    });
  });

  describe('OK button', () => {
    it('applies settings and closes panel', () => {
      const api = initOsnapPanel(deps);
      api.openOsnapPanel();

      document.getElementById('osnap-ok')!.click();

      const panel = document.getElementById('osnap-panel')!;
      expect(panel.classList.contains('visible')).toBe(false);
      expect(deps.updateOsnapUI).toHaveBeenCalled();
    });
  });

  describe('Cancel button', () => {
    it('closes panel without applying', () => {
      const api = initOsnapPanel(deps);
      api.openOsnapPanel();

      // Reset the call count after open
      (deps.updateOsnapUI as any).mockClear();

      document.getElementById('osnap-cancel')!.click();

      const panel = document.getElementById('osnap-panel')!;
      expect(panel.classList.contains('visible')).toBe(false);
      expect(deps.updateOsnapUI).not.toHaveBeenCalled();
    });
  });

  describe('Close button', () => {
    it('closes panel', () => {
      const api = initOsnapPanel(deps);
      api.openOsnapPanel();

      document.getElementById('osnap-panel-close')!.click();

      const panel = document.getElementById('osnap-panel')!;
      expect(panel.classList.contains('visible')).toBe(false);
    });
  });

  describe('Select All / Clear All', () => {
    it('select all checks all mode checkboxes', () => {
      initOsnapPanel(deps);
      document.getElementById('osnap-select-all')!.click();

      const checks = document.querySelectorAll<HTMLInputElement>('input[data-mode]');
      checks.forEach(cb => {
        expect(cb.checked).toBe(true);
      });
      expect(deps.updateOsnapUI).toHaveBeenCalled();
    });

    it('clear all unchecks all mode checkboxes', () => {
      initOsnapPanel(deps);
      document.getElementById('osnap-clear-all')!.click();

      const checks = document.querySelectorAll<HTMLInputElement>('input[data-mode]');
      checks.forEach(cb => {
        expect(cb.checked).toBe(false);
      });
      expect(deps.updateOsnapUI).toHaveBeenCalled();
    });
  });

  describe('master checkbox', () => {
    it('toggling master calls updateOsnapUI', () => {
      initOsnapPanel(deps);
      const master = document.getElementById('osnap-master') as HTMLInputElement;
      master.checked = false;
      master.dispatchEvent(new Event('change'));
      expect(deps.updateOsnapUI).toHaveBeenCalled();
    });
  });

  describe('mode checkbox change', () => {
    it('individual mode change applies settings immediately', () => {
      initOsnapPanel(deps);
      const endpointCb = document.querySelector('input[data-mode="endpoint"]') as HTMLInputElement;
      endpointCb.checked = false;
      endpointCb.dispatchEvent(new Event('change'));
      expect(deps.updateOsnapUI).toHaveBeenCalled();
    });
  });

  describe('ESC key', () => {
    it('closes panel on Escape', () => {
      const api = initOsnapPanel(deps);
      api.openOsnapPanel();

      const panel = document.getElementById('osnap-panel')!;
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(panel.classList.contains('visible')).toBe(false);
    });
  });
});
