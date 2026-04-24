import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { DimensionLabel, DimLine } from './DimensionLabel';

// Mock canvas context for jsdom
const mockCtx = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  setTransform: vi.fn(),
  scale: vi.fn(),
  setLineDash: vi.fn(),
  measureText: vi.fn().mockReturnValue({ width: 50 }),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  font: '',
  textAlign: '',
  textBaseline: '',
  globalAlpha: 1,
  lineCap: '',
  lineJoin: '',
};
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as any;

// Mock ResizeObserver
globalThis.ResizeObserver = vi.fn().mockImplementation((_cb: any) => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

describe('DimensionLabel', () => {
  let container: HTMLElement;
  let dimLabel: DimensionLabel;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
    document.body.appendChild(container);
    dimLabel = new DimensionLabel(container);
  });

  describe('constructor', () => {
    it('creates overlay and canvas elements', () => {
      const overlay = container.querySelector('#dim-overlay');
      const canvas = container.querySelector('#dim-canvas');
      expect(overlay).not.toBeNull();
      expect(canvas).not.toBeNull();
    });

    it('overlay has pointer-events: none', () => {
      const overlay = container.querySelector('#dim-overlay') as HTMLElement;
      expect(overlay.style.pointerEvents).toBe('none');
    });

    it('sets up ResizeObserver', () => {
      expect(ResizeObserver).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('hides all labels and clears canvas', () => {
      // First add some labels
      const camera = new THREE.PerspectiveCamera();
      const lines: DimLine[] = [
        { from: new THREE.Vector3(0, 0, 0), to: new THREE.Vector3(10, 0, 0), text: '10mm' },
      ];
      dimLabel.update(camera, lines);

      // Then clear — labels are hidden (display:none), not removed
      dimLabel.clear();
      const labels = container.querySelectorAll('.dim-label') as NodeListOf<HTMLElement>;
      labels.forEach(lbl => {
        expect(lbl.style.display).toBe('none');
      });
    });
  });

  describe('update', () => {
    it('creates label elements matching line count', () => {
      const camera = new THREE.PerspectiveCamera();
      const lines: DimLine[] = [
        { from: new THREE.Vector3(0, 0, 0), to: new THREE.Vector3(10, 0, 0), text: '10mm' },
        { from: new THREE.Vector3(0, 0, 0), to: new THREE.Vector3(0, 10, 0), text: '10mm' },
      ];
      dimLabel.update(camera, lines);

      const overlay = container.querySelector('#dim-overlay') as HTMLElement;
      const labels = overlay.querySelectorAll('.dim-label');
      expect(labels.length).toBe(2);
    });

    it('adjusts label count when lines change', () => {
      const camera = new THREE.PerspectiveCamera();

      // First: 3 lines
      dimLabel.update(camera, [
        { from: new THREE.Vector3(), to: new THREE.Vector3(1, 0, 0), text: 'A' },
        { from: new THREE.Vector3(), to: new THREE.Vector3(0, 1, 0), text: 'B' },
        { from: new THREE.Vector3(), to: new THREE.Vector3(0, 0, 1), text: 'C' },
      ]);
      let labels = container.querySelectorAll('.dim-label');
      expect(labels.length).toBe(3);

      // Then: 1 line
      dimLabel.update(camera, [
        { from: new THREE.Vector3(), to: new THREE.Vector3(1, 0, 0), text: 'A' },
      ]);
      labels = container.querySelectorAll('.dim-label');
      expect(labels.length).toBe(1);
    });

    it('handles empty lines array', () => {
      const camera = new THREE.PerspectiveCamera();
      dimLabel.update(camera, []);
      const labels = container.querySelectorAll('.dim-label');
      expect(labels.length).toBe(0);
    });

    it('uses default color when not specified', () => {
      const camera = new THREE.PerspectiveCamera();
      dimLabel.update(camera, [
        { from: new THREE.Vector3(), to: new THREE.Vector3(1, 0, 0), text: 'test' },
      ]);
      // Should not throw — default color '#4ac1ff' is used internally
    });
  });
});
