import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SnapVisual } from './SnapVisual';

// Mock canvas 2d context
const mockCtx = {
  clearRect: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
  beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  stroke: vi.fn(), fill: vi.fn(), arc: vi.fn(),
  save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), scale: vi.fn(),
  setLineDash: vi.fn(), measureText: vi.fn().mockReturnValue({ width: 50 }),
  fillText: vi.fn(), strokeText: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
  fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '',
  textBaseline: '', globalAlpha: 1, lineCap: '', lineJoin: '',
};
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as any;

// Mock ResizeObserver
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
}));

describe('SnapVisual', () => {
  let container: HTMLElement;
  let visual: SnapVisual;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
    container.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
    });
    document.body.appendChild(container);
    visual = new SnapVisual(container);
  });

  describe('constructor', () => {
    it('creates canvas overlay in container', () => {
      const canvas = container.querySelector('canvas');
      expect(canvas).not.toBeNull();
    });

    it('canvas has pointer-events none', () => {
      const canvas = container.querySelector('canvas') as HTMLElement;
      expect(canvas.style.pointerEvents).toBe('none');
    });

    it('canvas has z-index 50', () => {
      const canvas = container.querySelector('canvas') as HTMLElement;
      expect(canvas.style.zIndex).toBe('50');
    });

    it('sets up ResizeObserver', () => {
      expect(ResizeObserver).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('calls clearRect on canvas context', () => {
      visual.clear();
      expect(mockCtx.clearRect).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('clears when snap is null', () => {
      visual.update(null);
      expect(mockCtx.clearRect).toHaveBeenCalled();
    });

    it('clears when snap has no screenPos', () => {
      visual.update({ type: 'endpoint', position: new THREE.Vector3() } as any);
      expect(mockCtx.clearRect).toHaveBeenCalled();
    });

    it('draws marker when snap has screenPos', () => {
      visual.update({
        type: 'endpoint',
        position: new THREE.Vector3(10, 0, 0),
        screenPos: { x: 100, y: 200 },
      } as any);
      // Should have drawn something (stroke, fillRect, moveTo, etc.)
      const drawCalls = mockCtx.stroke.mock.calls.length +
                        mockCtx.fill.mock.calls.length +
                        mockCtx.strokeRect.mock.calls.length +
                        mockCtx.fillRect.mock.calls.length +
                        mockCtx.fillText.mock.calls.length;
      expect(drawCalls).toBeGreaterThan(0);
    });
  });

  describe('setTooltipVisible', () => {
    it('can toggle tooltip visibility', () => {
      visual.setTooltipVisible(false);
      // Should not throw, internal state change
      visual.update({
        type: 'endpoint',
        position: new THREE.Vector3(),
        screenPos: { x: 100, y: 200 },
      } as any);
    });
  });

  describe('marker size', () => {
    it('getMarkerSize returns default 8', () => {
      expect(visual.getMarkerSize()).toBe(8);
    });

    it('setMarkerSize changes size', () => {
      visual.setMarkerSize(12);
      expect(visual.getMarkerSize()).toBe(12);
    });
  });
});
