import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initVCB, VCBDeps, vcbTools } from './VCB';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn(), debugWarn: vi.fn() }));

function createDOM(): void {
  document.body.innerHTML = `
    <div id="commandbar">
      <span id="cmd-label">치수:</span>
      <input id="cmd-input" type="text" placeholder="숫자 입력 후 Enter (mm)" />
    </div>
  `;
}

function mockDeps(): VCBDeps {
  return {
    toolManager: {
      currentTool: 'line',
      applyVCBValue: vi.fn(),
      isToolBusy: vi.fn().mockReturnValue(true),
    } as any,
    units: {
      parseInput: vi.fn((s: string) => {
        const n = parseFloat(s);
        return isNaN(n) ? null : n;
      }),
      format: vi.fn((mm: number) => `${mm.toFixed(4)} mm`),
      config: { label: 'mm' },
      onChange: vi.fn(),
    } as any,
  };
}

describe('VCB', () => {
  let deps: ReturnType<typeof mockDeps>;

  beforeEach(() => {
    createDOM();
    deps = mockDeps();
    initVCB(deps);
  });

  describe('vcbTools set', () => {
    it('contains expected tools', () => {
      expect(vcbTools.has('line')).toBe(true);
      expect(vcbTools.has('rect')).toBe(true);
      expect(vcbTools.has('circle')).toBe(true);
      expect(vcbTools.has('pushpull')).toBe(true);
      expect(vcbTools.has('offset')).toBe(true);
      expect(vcbTools.has('move')).toBe(true);
      expect(vcbTools.has('rotate')).toBe(true);
      expect(vcbTools.has('scale')).toBe(true);
    });

    it('does not contain non-VCB tools', () => {
      expect(vcbTools.has('select')).toBe(false);
      expect(vcbTools.has('erase')).toBe(false);
      expect(vcbTools.has('group')).toBe(false);
    });
  });

  describe('Enter key confirms value', () => {
    it('parses numeric input and calls applyVCBValue', () => {
      const input = document.getElementById('cmd-input') as HTMLInputElement;
      input.value = '100';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(deps.toolManager.applyVCBValue).toHaveBeenCalledWith(100);
    });

    it('clears input after confirm', () => {
      const input = document.getElementById('cmd-input') as HTMLInputElement;
      input.value = '50';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(input.value).toBe('');
    });

    it('empty input deactivates VCB', () => {
      const input = document.getElementById('cmd-input') as HTMLInputElement;
      input.value = '';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(deps.toolManager.applyVCBValue).not.toHaveBeenCalled();
    });

    it('invalid input clears value', () => {
      const input = document.getElementById('cmd-input') as HTMLInputElement;
      input.value = 'abc';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(deps.toolManager.applyVCBValue).not.toHaveBeenCalled();
      expect(input.value).toBe('');
    });
  });

  describe('rect two-value input', () => {
    it('parses "100,200" for rect tool', () => {
      (deps.toolManager as any).currentTool = 'rect';
      const input = document.getElementById('cmd-input') as HTMLInputElement;
      input.value = '100,200';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(deps.toolManager.applyVCBValue).toHaveBeenCalledWith(100, 200);
    });

    it('parses "100 200" with space separator for rect', () => {
      (deps.toolManager as any).currentTool = 'rect';
      const input = document.getElementById('cmd-input') as HTMLInputElement;
      input.value = '100 200';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(deps.toolManager.applyVCBValue).toHaveBeenCalledWith(100, 200);
    });
  });

  describe('Escape deactivates', () => {
    it('Escape clears and blurs input', () => {
      const input = document.getElementById('cmd-input') as HTMLInputElement;
      input.value = '50';
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(input.value).toBe('');
    });
  });

  describe('auto-activate on numeric key', () => {
    it('numeric key activates VCB for line tool', () => {
      (deps.toolManager as any).currentTool = 'line';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));

      const input = document.getElementById('cmd-input') as HTMLInputElement;
      // Input should be focused and contain the key
      expect(input.value).toBe('5');
    });

    it('does not activate for select tool', () => {
      (deps.toolManager as any).currentTool = 'select';
      const input = document.getElementById('cmd-input') as HTMLInputElement;
      input.value = '';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));

      // Should not be activated (select is not in vcbTools)
      expect(input.value).toBe('');
    });

    it('does not activate with Ctrl key', () => {
      (deps.toolManager as any).currentTool = 'line';
      const input = document.getElementById('cmd-input') as HTMLInputElement;
      input.value = '';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }));

      expect(input.value).toBe('');
    });
  });

  describe('label updates', () => {
    it('updates placeholder on init', () => {
      const input = document.getElementById('cmd-input') as HTMLInputElement;
      // Placeholder should be set
      expect(input.placeholder).toContain('mm');
    });
  });
});
