import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsPanel } from './SettingsPanel';
import { UnitSystem } from './UnitSystem';

describe('SettingsPanel', () => {
  let units: UnitSystem;
  let panel: SettingsPanel;

  beforeEach(() => {
    document.body.innerHTML = '';
    units = new UnitSystem();
    panel = new SettingsPanel(units);
  });

  describe('constructor', () => {
    it('creates panel element in DOM', () => {
      const el = document.getElementById('settings-panel');
      expect(el).not.toBeNull();
    });

    it('panel starts hidden', () => {
      const el = document.getElementById('settings-panel')!;
      expect(el.style.display).toBe('');
    });

    it('creates unit buttons for all unit types', () => {
      const btns = document.querySelectorAll('.sp-ubtn');
      expect(btns.length).toBe(UnitSystem.allUnits.length);
    });

    it('creates precision slider', () => {
      const slider = document.getElementById('sp-precision') as HTMLInputElement;
      expect(slider).not.toBeNull();
      expect(slider.type).toBe('range');
    });

    it('creates snap checkbox', () => {
      const check = document.getElementById('sp-snap') as HTMLInputElement;
      expect(check).not.toBeNull();
      expect(check.type).toBe('checkbox');
    });
  });

  describe('toggle', () => {
    it('opens panel on first toggle', () => {
      panel.toggle();
      const el = document.getElementById('settings-panel')!;
      expect(el.style.display).toBe('block');
    });

    it('closes panel on second toggle', () => {
      panel.toggle();
      panel.toggle();
      const el = document.getElementById('settings-panel')!;
      expect(el.style.display).toBe('none');
    });
  });

  describe('open/close', () => {
    it('open shows panel', () => {
      panel.open();
      const el = document.getElementById('settings-panel')!;
      expect(el.style.display).toBe('block');
    });

    it('close hides panel', () => {
      panel.open();
      panel.close();
      const el = document.getElementById('settings-panel')!;
      expect(el.style.display).toBe('none');
    });
  });

  describe('unit buttons', () => {
    it('clicking unit button changes unit system', () => {
      panel.open();
      const btns = document.querySelectorAll('.sp-ubtn') as NodeListOf<HTMLButtonElement>;
      // Find the 'cm' button
      const cmBtn = Array.from(btns).find(b => b.dataset.unit === 'cm');
      expect(cmBtn).toBeDefined();
      cmBtn!.click();
      expect(units.unit).toBe('cm');
    });

    it('active button reflects current unit', () => {
      units.unit = 'm';
      panel.open();
      const btns = document.querySelectorAll('.sp-ubtn') as NodeListOf<HTMLElement>;
      const mBtn = Array.from(btns).find(b => b.dataset.unit === 'm');
      expect(mBtn?.classList.contains('active')).toBe(true);
    });
  });

  describe('precision slider', () => {
    it('changing slider updates unit precision', () => {
      panel.open();
      const slider = document.getElementById('sp-precision') as HTMLInputElement;
      slider.value = '4';
      slider.dispatchEvent(new Event('input'));
      expect(units.precision).toBe(4);
    });

    it('displays current precision value', () => {
      units.precision = 3;
      panel.open();
      const val = document.getElementById('sp-precision-val')!;
      expect(val.textContent).toBe('3');
    });
  });

  describe('snap checkbox', () => {
    it('toggling checkbox updates gridSnap', () => {
      panel.open();
      const check = document.getElementById('sp-snap') as HTMLInputElement;
      check.checked = true;
      check.dispatchEvent(new Event('change'));
      expect(units.gridSnap).toBe(true);
    });
  });

  describe('snap interval', () => {
    it('changing interval updates unit system', () => {
      panel.open();
      const input = document.getElementById('sp-snap-interval') as HTMLInputElement;
      input.value = '5';
      input.dispatchEvent(new Event('change'));
      // toInternal converts display value to internal (mm * 1000 for mm unit)
      expect(units.snapInterval).toBe(units.toInternal(5));
    });

    it('invalid interval (NaN) is ignored', () => {
      panel.open();
      const oldInterval = units.snapInterval;
      const input = document.getElementById('sp-snap-interval') as HTMLInputElement;
      input.value = 'abc';
      input.dispatchEvent(new Event('change'));
      expect(units.snapInterval).toBe(oldInterval);
    });

    it('zero interval is ignored', () => {
      panel.open();
      const oldInterval = units.snapInterval;
      const input = document.getElementById('sp-snap-interval') as HTMLInputElement;
      input.value = '0';
      input.dispatchEvent(new Event('change'));
      expect(units.snapInterval).toBe(oldInterval);
    });
  });

  describe('outside click', () => {
    it('closes panel when clicking outside', () => {
      panel.open();
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      // Dispatch from a real DOM element so e.target.closest works
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const el = document.getElementById('settings-panel')!;
      expect(el.style.display).toBe('none');
    });
  });

  describe('unit change callback', () => {
    it('updates display when unit system changes', () => {
      panel.open();
      units.unit = 'in';
      // After unit change, the info should reflect the new unit
      const info = document.getElementById('sp-info')!;
      expect(info.textContent).toContain('in');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-087 K-ε — Draw Shape Mode flag deprecated. Kernel-aware path is
  // the only path now (no toggle in SettingsPanel).
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-087 K-ε — DrawShapeMode toggle removed', () => {
    it('SettingsPanel no longer renders sp-draw-shape-mode checkbox', () => {
      panel.open();
      const checkbox = document.getElementById('sp-draw-shape-mode');
      expect(checkbox).toBeNull();
    });
  });
});
