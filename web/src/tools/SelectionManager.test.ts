import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use the project's Three.js mock, augmented with missing attributes
vi.mock('three', async () => {
  const mock = await import('../__mocks__/three');
  class Float32BufferAttribute extends mock.BufferAttribute {
    constructor(array: any, itemSize: number) { super(array, itemSize); }
  }
  class Uint32BufferAttribute extends mock.BufferAttribute {
    constructor(array: any, itemSize: number) { super(array, itemSize); }
  }
  class PointsMaterial extends mock.Material {}
  class LineDashedMaterial extends mock.Material {
    computeLineDistances?: () => any;
  }
  class Line extends mock.Object3D {
    geometry: any;
    material: any;
    constructor(geometry?: any, material?: any) {
      super();
      this.geometry = geometry || new mock.BufferGeometry();
      this.material = material || new mock.Material();
    }
    computeLineDistances() { return this; }
  }
  return {
    ...mock,
    Float32BufferAttribute,
    Uint32BufferAttribute,
    PointsMaterial,
    LineDashedMaterial,
    Line,
  };
});
vi.mock('../utils/debug', () => ({
  debugLog: vi.fn(),
  debugWarn: vi.fn(),
}));

import { SelectionManager } from './SelectionManager';
import { Scene } from 'three';

describe('SelectionManager', () => {
  let scene: Scene;
  let sm: SelectionManager;

  beforeEach(() => {
    scene = new Scene();
    sm = new SelectionManager(scene);
  });

  // ── handleClick ──

  it('handleClick single select — clears previous and selects new face', () => {
    sm.handleClick(3, false, false);
    expect(sm.getSelectedFaces()).toEqual([3]);

    // clicking another face replaces selection
    sm.handleClick(7, false, false);
    expect(sm.getSelectedFaces()).toEqual([7]);
    expect(sm.isSelected(3)).toBe(false);
  });

  it('handleClick with shift adds to selection', () => {
    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);

    const faces = sm.getSelectedFaces().sort((a, b) => a - b);
    expect(faces).toEqual([1, 2]);
  });

  it('handleClick with ctrl toggles selection', () => {
    sm.handleClick(5, false, false);
    expect(sm.isSelected(5)).toBe(true);

    // ctrl+click on already-selected face removes it
    sm.handleClick(5, false, true);
    expect(sm.isSelected(5)).toBe(false);
    expect(sm.getSelectedFaces()).toEqual([]);

    // ctrl+click on unselected face adds it
    sm.handleClick(5, false, true);
    expect(sm.isSelected(5)).toBe(true);
  });

  it('handleClick with negative faceId clears selection', () => {
    sm.handleClick(10, false, false);
    expect(sm.getSelectedFaces()).toEqual([10]);

    sm.handleClick(-1, false, false);
    expect(sm.getSelectedFaces()).toEqual([]);
  });

  // ── clearSelection ──

  it('clearSelection empties all selections', () => {
    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);
    sm.handleEdgeClick(100, false, false);

    sm.clearSelection();

    expect(sm.getSelectedFaces()).toEqual([]);
    expect(sm.getSelectedEdges()).toEqual([]);
  });

  // ── selectAll ──

  it('selectAll selects from seed face', () => {
    // With empty buffers, selectAll uses findConnectedFaces which
    // falls back to the seed face when no triangles are present
    sm.selectAll(5);
    expect(sm.isSelected(5)).toBe(true);
    expect(sm.getSelectedFaces().length).toBeGreaterThanOrEqual(1);
  });

  // ── getSelectedFaces ──

  it('getSelectedFaces returns array of selected face IDs', () => {
    sm.handleClick(3, false, false);
    sm.handleClick(1, true, false);
    sm.handleClick(7, true, false);

    const faces = sm.getSelectedFaces().sort((a, b) => a - b);
    expect(faces).toEqual([1, 3, 7]);
  });

  // ── onChange ──

  it('onChange fires callback on selection change', () => {
    const cb = vi.fn();
    sm.onChange(cb);

    sm.handleClick(4, false, false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith([4]);
  });

  // ── updateBuffers ──

  it('updateBuffers prunes deleted faces from selection', () => {
    sm.handleClick(10, false, false);
    sm.handleClick(20, true, false);
    expect(sm.getSelectedFaces().sort((a, b) => a - b)).toEqual([10, 20]);

    // Provide a faceMap that only contains face 10 (face 20 is gone)
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const faceMap = new Uint32Array([10]); // only face 10 exists

    sm.updateBuffers(positions, indices, faceMap);

    expect(sm.isSelected(10)).toBe(true);
    expect(sm.isSelected(20)).toBe(false);
    expect(sm.getSelectedFaces()).toEqual([10]);
  });
});
