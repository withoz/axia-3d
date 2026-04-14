import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MaterialPropertiesPanel } from './MaterialPropertiesPanel';
import { Material } from '../materials/MaterialLibrary';

function createMaterial(): Material {
  return {
    id: 'test-mat',
    rustId: 99,
    name: '테스트 재질',
    nameEn: 'Test Material',
    category: 'concrete',
    builtIn: false,
    physical: {
      density: 2400,
      friction: 0.6,
      restitution: 0.2,
      specificGravity: 2.4,
      thermalConductivity: 1.6,
      fireRating: 'incombustible',
    },
    visual: {
      color: 0xcccccc,
      roughness: 0.8,
      metalness: 0.0,
      opacity: 1.0,
    },
  };
}

describe('MaterialPropertiesPanel', () => {
  let container: HTMLElement;
  let panel: MaterialPropertiesPanel;

  beforeEach(() => {
    document.body.innerHTML = '<div id="mat-panel"></div>';
    container = document.getElementById('mat-panel')!;
    panel = new MaterialPropertiesPanel('mat-panel');
  });

  describe('constructor', () => {
    it('creates panel from container ID', () => {
      expect(container.className).toBe('material-properties-panel');
    });

    it('throws when container not found', () => {
      expect(() => new MaterialPropertiesPanel('nonexistent')).toThrow('not found');
    });
  });

  describe('showMaterial', () => {
    it('renders material name', () => {
      const mat = createMaterial();
      panel.showMaterial(mat);
      const header = container.querySelector('.mat-panel-header h3')!;
      expect(header.textContent).toBe('테스트 재질');
    });

    it('renders built-in label for custom material', () => {
      const mat = createMaterial();
      panel.showMaterial(mat);
      const label = container.querySelector('.mat-panel-built-in')!;
      expect(label.textContent).toBe('사용자정의');
    });

    it('renders built-in label for built-in material', () => {
      const mat = createMaterial();
      mat.builtIn = true;
      panel.showMaterial(mat);
      const label = container.querySelector('.mat-panel-built-in')!;
      expect(label.textContent).toBe('내장');
    });

    it('renders name input with value', () => {
      const mat = createMaterial();
      panel.showMaterial(mat);
      const input = container.querySelector('[data-field="name"]') as HTMLInputElement;
      expect(input.value).toBe('테스트 재질');
    });

    it('renders category select with correct value', () => {
      const mat = createMaterial();
      panel.showMaterial(mat);
      const select = container.querySelector('[data-field="category"]') as HTMLSelectElement;
      expect(select.value).toBe('concrete');
    });

    it('renders density input', () => {
      const mat = createMaterial();
      panel.showMaterial(mat);
      const input = container.querySelector('[data-field="density"]') as HTMLInputElement;
      expect(input.value).toBe('2400');
    });

    it('renders color picker with hex value', () => {
      const mat = createMaterial();
      panel.showMaterial(mat);
      const input = container.querySelector('[data-field="color"]') as HTMLInputElement;
      expect(input.value).toBe('#cccccc');
    });

    it('renders roughness slider', () => {
      const mat = createMaterial();
      panel.showMaterial(mat);
      const slider = container.querySelector('[data-field="roughness"]') as HTMLInputElement;
      expect(slider.value).toBe('0.8');
    });
  });

  describe('hide', () => {
    it('clears container content', () => {
      const mat = createMaterial();
      panel.showMaterial(mat);
      panel.hide();
      expect(container.innerHTML).toBe('');
    });
  });

  describe('property change events', () => {
    it('name change triggers callback', () => {
      const mat = createMaterial();
      const cb = vi.fn();
      panel.showMaterial(mat, cb);

      const input = container.querySelector('[data-field="name"]') as HTMLInputElement;
      input.value = '새 이름';
      input.dispatchEvent(new Event('change'));
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].name).toBe('새 이름');
    });

    it('category change triggers callback', () => {
      const mat = createMaterial();
      const cb = vi.fn();
      panel.showMaterial(mat, cb);

      const select = container.querySelector('[data-field="category"]') as HTMLSelectElement;
      select.value = 'metal';
      select.dispatchEvent(new Event('change'));
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].category).toBe('metal');
    });

    it('density change updates physical property', () => {
      const mat = createMaterial();
      const cb = vi.fn();
      panel.showMaterial(mat, cb);

      const input = container.querySelector('[data-field="density"]') as HTMLInputElement;
      input.value = '7800';
      input.dispatchEvent(new Event('change'));
      expect(cb.mock.calls[0][0].physical.density).toBe(7800);
    });

    it('color change updates visual property', () => {
      const mat = createMaterial();
      const cb = vi.fn();
      panel.showMaterial(mat, cb);

      const input = container.querySelector('[data-field="color"]') as HTMLInputElement;
      input.value = '#ff0000';
      input.dispatchEvent(new Event('change'));
      expect(cb.mock.calls[0][0].visual.color).toBe(0xff0000);
    });

    it('roughness change updates visual property', () => {
      const mat = createMaterial();
      const cb = vi.fn();
      panel.showMaterial(mat, cb);

      const slider = container.querySelector('[data-field="roughness"]') as HTMLInputElement;
      slider.value = '0.5';
      slider.dispatchEvent(new Event('change'));
      expect(cb.mock.calls[0][0].visual.roughness).toBe(0.5);
    });

    it('fire rating change updates physical property', () => {
      const mat = createMaterial();
      const cb = vi.fn();
      panel.showMaterial(mat, cb);

      const select = container.querySelector('[data-field="fireRating"]') as HTMLSelectElement;
      select.value = 'retardant';
      select.dispatchEvent(new Event('change'));
      expect(cb.mock.calls[0][0].physical.fireRating).toBe('retardant');
    });
  });

  describe('slider value display', () => {
    it('updates percentage label on slider input', () => {
      const mat = createMaterial();
      panel.showMaterial(mat);

      const slider = container.querySelector('[data-field="roughness"]') as HTMLInputElement;
      slider.value = '0.6';
      slider.dispatchEvent(new Event('input'));

      const valueSpan = slider.closest('.mat-input-unit')?.querySelector('.mat-value');
      expect(valueSpan?.textContent).toBe('60%');
    });
  });
});
