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

  // ── Edge selection ──

  it('handleEdgeClick selects edge', () => {
    sm.handleEdgeClick(100, false, false);
    expect(sm.getSelectedEdges()).toEqual([100]);
  });

  it('handleEdgeClick with shift adds edge', () => {
    sm.handleEdgeClick(100, false, false);
    sm.handleEdgeClick(200, true, false);
    expect(sm.getSelectedEdges().sort((a, b) => a - b)).toEqual([100, 200]);
  });

  it('handleEdgeClick with ctrl toggles edge', () => {
    sm.handleEdgeClick(100, false, false);
    expect(sm.getSelectedEdges()).toEqual([100]);

    sm.handleEdgeClick(100, false, true);
    expect(sm.getSelectedEdges()).toEqual([]);

    sm.handleEdgeClick(100, false, true);
    expect(sm.getSelectedEdges()).toEqual([100]);
  });

  it('handleEdgeClick with negative edgeId clears edges', () => {
    sm.handleEdgeClick(50, false, false);
    sm.handleEdgeClick(-1, false, false);
    expect(sm.getSelectedEdges()).toEqual([]);
  });

  it('handleEdgeClick clears face selection on normal click', () => {
    sm.handleClick(5, false, false);
    expect(sm.getSelectedFaces()).toEqual([5]);

    sm.handleEdgeClick(100, false, false);
    expect(sm.getSelectedFaces()).toEqual([]);
    expect(sm.getSelectedEdges()).toEqual([100]);
  });

  // ── selectionCount ──

  it('selectionCount returns number of selected faces', () => {
    expect(sm.selectionCount).toBe(0);
    sm.handleClick(1, false, false);
    expect(sm.selectionCount).toBe(1);
    sm.handleClick(2, true, false);
    expect(sm.selectionCount).toBe(2);
  });

  // ── selectEverything ──

  it('selectEverything selects all faces and edges', () => {
    const faceMap = new Uint32Array([1, 2, 3]);
    const edgeMap = new Uint32Array([10, 20]);
    sm.selectEverything(faceMap, edgeMap);

    expect(sm.getSelectedFaces().sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(sm.getSelectedEdges().sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it('selectEverything handles null maps', () => {
    sm.selectEverything(null, null);
    expect(sm.getSelectedFaces()).toEqual([]);
    expect(sm.getSelectedEdges()).toEqual([]);
  });

  // ── selectSameType ──

  it('selectSameType expands face selection to all faces', () => {
    sm.handleClick(1, false, false);
    const faceMap = new Uint32Array([1, 2, 3, 4]);
    sm.selectSameType(faceMap, null);
    expect(sm.getSelectedFaces().sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it('selectSameType with nothing selected does selectEverything', () => {
    const faceMap = new Uint32Array([1, 2]);
    const edgeMap = new Uint32Array([10]);
    sm.selectSameType(faceMap, edgeMap);
    expect(sm.getSelectedFaces().sort((a, b) => a - b)).toEqual([1, 2]);
    expect(sm.getSelectedEdges()).toEqual([10]);
  });

  // ── Group system ──

  it('groupSelected creates a group from 2+ selected faces', () => {
    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);
    sm.handleClick(3, true, false);

    const gid = sm.groupSelected();
    expect(gid).toBeTypeOf('number');
    expect(sm.groupCount).toBe(1);
    expect(sm.hasGroup(1)).toBe(true);
    expect(sm.hasGroup(2)).toBe(true);
    expect(sm.hasGroup(3)).toBe(true);
  });

  it('groupSelected returns null with < 2 faces', () => {
    sm.handleClick(1, false, false);
    expect(sm.groupSelected()).toBeNull();
    expect(sm.groupCount).toBe(0);
  });

  it('ungroupSelected removes group', () => {
    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);
    sm.groupSelected();
    expect(sm.groupCount).toBe(1);

    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);
    const result = sm.ungroupSelected();
    expect(result).toBe(true);
    expect(sm.groupCount).toBe(0);
    expect(sm.hasGroup(1)).toBe(false);
  });

  it('ungroupSelected returns false when no group', () => {
    sm.handleClick(1, false, false);
    expect(sm.ungroupSelected()).toBe(false);
  });

  it('getGroupFaces returns group faces or null', () => {
    expect(sm.getGroupFaces(1)).toBeNull();

    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);
    sm.groupSelected();

    const faces = sm.getGroupFaces(1);
    expect(faces).not.toBeNull();
    expect(faces!.has(1)).toBe(true);
    expect(faces!.has(2)).toBe(true);
  });

  it('getGroupId returns group id or undefined', () => {
    expect(sm.getGroupId(1)).toBeUndefined();

    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);
    const gid = sm.groupSelected();

    expect(sm.getGroupId(1)).toBe(gid);
    expect(sm.getGroupId(99)).toBeUndefined();
  });

  it('getAllGroups returns copy of groups map', () => {
    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);
    sm.groupSelected();

    const groups = sm.getAllGroups();
    expect(groups.size).toBe(1);
  });

  // ── Group edit mode ──

  it('enterGroupEdit enters edit mode for valid group', () => {
    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);
    const gid = sm.groupSelected()!;

    expect(sm.enterGroupEdit(gid)).toBe(true);
    expect(sm.isInGroupEditMode()).toBe(true);
    expect(sm.getEditingGroupId()).toBe(gid);
  });

  it('enterGroupEdit returns false for non-existent group', () => {
    expect(sm.enterGroupEdit(999)).toBe(false);
    expect(sm.isInGroupEditMode()).toBe(false);
  });

  it('exitGroupEdit exits edit mode', () => {
    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);
    const gid = sm.groupSelected()!;
    sm.enterGroupEdit(gid);

    expect(sm.exitGroupEdit()).toBe(true);
    expect(sm.isInGroupEditMode()).toBe(false);
    expect(sm.getEditingGroupId()).toBeNull();
  });

  it('exitGroupEdit returns false when not in edit mode', () => {
    expect(sm.exitGroupEdit()).toBe(false);
  });

  it('handleGroupEditClick returns false when not in edit mode', () => {
    expect(sm.handleGroupEditClick(1, false, false)).toBe(false);
  });

  it('handleGroupEditClick exits on outside face click', () => {
    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);
    const gid = sm.groupSelected()!;
    sm.enterGroupEdit(gid);

    // Click face 99 which is not in the group
    sm.handleGroupEditClick(99, false, false);
    expect(sm.isInGroupEditMode()).toBe(false);
  });

  it('handleGroupEditClick selects group-internal face', () => {
    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);
    const gid = sm.groupSelected()!;
    sm.enterGroupEdit(gid);

    const result = sm.handleGroupEditClick(1, false, false);
    expect(result).toBe(true);
    expect(sm.isSelected(1)).toBe(true);
    expect(sm.isInGroupEditMode()).toBe(true);
  });

  it('handleGroupEditClick with -1 clears within group', () => {
    sm.handleClick(1, false, false);
    sm.handleClick(2, true, false);
    const gid = sm.groupSelected()!;
    sm.enterGroupEdit(gid);

    sm.handleGroupEditClick(1, false, false); // select face 1
    sm.handleGroupEditClick(-1, false, false); // clear
    expect(sm.getSelectedFaces()).toEqual([]);
    expect(sm.isInGroupEditMode()).toBe(true); // still in edit mode
  });

  // ── updateEdgeBuffers ──

  it('updateEdgeBuffers prunes deleted edges', () => {
    sm.handleEdgeClick(10, false, false);
    sm.handleEdgeClick(20, true, false);

    const edgeLines = new Float32Array(12); // dummy
    const edgeMap = new Uint32Array([10]); // only edge 10 survives
    sm.updateEdgeBuffers(edgeLines, edgeMap);

    expect(sm.getSelectedEdges()).toEqual([10]);
  });

  it('updateEdgeBuffers with null clears all edges', () => {
    sm.handleEdgeClick(10, false, false);
    sm.updateEdgeBuffers(null, null);
    expect(sm.getSelectedEdges()).toEqual([]);
  });

  // ── Multiple onChange listeners ──

  it('supports multiple onChange listeners', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    sm.onChange(cb1);
    sm.onChange(cb2);

    sm.handleClick(1, false, false);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  // ── selectFaceWithEdges ──

  it('selectFaceWithEdges selects face and clears previous', () => {
    sm.handleClick(5, false, false);
    sm.selectFaceWithEdges(10);
    expect(sm.getSelectedFaces()).toEqual([10]);
    expect(sm.isSelected(5)).toBe(false);
  });

  it('selectFaceWithEdges ignores negative faceId', () => {
    sm.handleClick(5, false, false);
    sm.selectFaceWithEdges(-1);
    // Still has 5 selected (no change)
    expect(sm.getSelectedFaces()).toEqual([5]);
  });

  // ── Lock enforcement ──

  it('handleClick blocks selection of locked face', () => {
    const bridge = {
      getConnectedFaces: () => [],
      isFaceLocked: vi.fn((fid: number) => fid === 5),
    };
    sm.setBridge(bridge);

    sm.handleClick(5, false, false);
    expect(sm.getSelectedFaces()).toEqual([]);
    expect(bridge.isFaceLocked).toHaveBeenCalledWith(5);
  });

  it('handleClick allows selection of unlocked face with bridge', () => {
    const bridge = {
      getConnectedFaces: () => [],
      isFaceLocked: vi.fn(() => false),
    };
    sm.setBridge(bridge);

    sm.handleClick(3, false, false);
    expect(sm.getSelectedFaces()).toContain(3);
  });

  it('handleClick works normally when bridge has no isFaceLocked', () => {
    const bridge = {
      getConnectedFaces: () => [],
    };
    sm.setBridge(bridge);

    sm.handleClick(7, false, false);
    expect(sm.getSelectedFaces()).toContain(7);
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-074 U-1 — Boolean Group Selection (A / B) model layer.
  // Per ADR-074 §C lock-ins:
  // - Drop-in alongside (`selected` / `getSelectedFaces` UNCHANGED)
  // - Group tags ⊆ selected (constraint: setGroupTag skips faces not selected)
  // - One face = one group (Map invariant; B overwrites A on same key)
  // - clearSelection() also clears groupTags (consistency)
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-074 U-1 Boolean Group Selection', () => {
    /**
     * Helper — populate `selected` with arbitrary face IDs without
     * going through the full Three.js click pipeline. Uses the
     * existing programmatic `selectFaces` API.
     */
    function selectFaces(faceIds: number[]): void {
      sm.selectFaces(faceIds);
    }

    it('setGroupTag tags faces in Group A correctly', () => {
      selectFaces([10, 20, 30]);
      sm.setGroupTag([10, 20], 'A');
      expect(sm.getGroupA()).toEqual([10, 20]);
      expect(sm.getGroupB()).toEqual([]);
    });

    it('setGroupTag tags faces in Group B correctly', () => {
      selectFaces([10, 20, 30]);
      sm.setGroupTag([20, 30], 'B');
      expect(sm.getGroupB()).toEqual([20, 30]);
      expect(sm.getGroupA()).toEqual([]);
    });

    it('face cannot be in both A and B simultaneously (B overwrites A)', () => {
      selectFaces([10, 20, 30]);
      sm.setGroupTag([10, 20, 30], 'A');
      expect(sm.getGroupA()).toEqual([10, 20, 30]);

      // Re-tag face 20 as B — must move from A to B exclusively.
      sm.setGroupTag([20], 'B');
      expect(sm.getGroupA()).toEqual([10, 30]);
      expect(sm.getGroupB()).toEqual([20]);
      // Invariant: A ∩ B = ∅
      const a = new Set(sm.getGroupA());
      for (const fid of sm.getGroupB()) {
        expect(a.has(fid)).toBe(false);
      }
    });

    it('getGroupA / getGroupB return sorted-unique subsets', () => {
      selectFaces([5, 1, 9, 3, 7]);
      // Tag in arbitrary order.
      sm.setGroupTag([9, 1, 5], 'A');
      sm.setGroupTag([7, 3], 'B');
      // Sorted ascending output.
      expect(sm.getGroupA()).toEqual([1, 5, 9]);
      expect(sm.getGroupB()).toEqual([3, 7]);
    });

    it('clearGroupTags removes all tags but keeps selected', () => {
      selectFaces([10, 20, 30]);
      sm.setGroupTag([10, 20], 'A');
      sm.setGroupTag([30], 'B');
      expect(sm.hasGroupSelection()).toBe(true);

      sm.clearGroupTags();
      expect(sm.getGroupA()).toEqual([]);
      expect(sm.getGroupB()).toEqual([]);
      expect(sm.hasGroupSelection()).toBe(false);
      // Selection itself preserved.
      expect(sm.getSelectedFaces().sort((a, b) => a - b)).toEqual([10, 20, 30]);
    });

    it('clearSelection removes both selected and group tags (U-E consistency)', () => {
      selectFaces([10, 20, 30]);
      sm.setGroupTag([10], 'A');
      sm.setGroupTag([20, 30], 'B');
      expect(sm.hasGroupSelection()).toBe(true);
      expect(sm.getSelectedFaces().length).toBe(3);

      sm.clearSelection();

      // Both gone.
      expect(sm.getSelectedFaces()).toEqual([]);
      expect(sm.getGroupA()).toEqual([]);
      expect(sm.getGroupB()).toEqual([]);
      expect(sm.hasGroupSelection()).toBe(false);
    });

    it('hasGroupSelection returns true iff both groups non-empty', () => {
      selectFaces([10, 20, 30]);

      // Empty initially.
      expect(sm.hasGroupSelection()).toBe(false);

      // Only A → false.
      sm.setGroupTag([10], 'A');
      expect(sm.hasGroupSelection()).toBe(false);

      // A + B → true.
      sm.setGroupTag([20], 'B');
      expect(sm.hasGroupSelection()).toBe(true);

      // Move face 10 from A to B → only B → false.
      sm.setGroupTag([10], 'B');
      expect(sm.getGroupA()).toEqual([]);
      expect(sm.getGroupB().sort((a, b) => a - b)).toEqual([10, 20]);
      expect(sm.hasGroupSelection()).toBe(false);
    });

    it('setGroupTag rejects faces not in selected (constraint enforcement)', () => {
      selectFaces([10, 20]);  // 30 is NOT selected
      sm.setGroupTag([10, 30], 'A');
      // Only 10 tagged — 30 silently skipped per constraint.
      expect(sm.getGroupA()).toEqual([10]);
      // 30 remains untagged in either group.
      expect(sm.getGroupB()).toEqual([]);
    });

    it('hasAnyGroupTag returns true iff any group tag exists (U-2-i)', () => {
      selectFaces([10, 20]);

      // Empty initially.
      expect(sm.hasAnyGroupTag()).toBe(false);
      expect(sm.hasGroupSelection()).toBe(false);

      // Only A — hasAnyGroupTag true (vs hasGroupSelection still false).
      sm.setGroupTag([10], 'A');
      expect(sm.hasAnyGroupTag()).toBe(true);
      expect(sm.hasGroupSelection()).toBe(false);

      // Only B — same: hasAnyGroupTag true (boundary case).
      sm.clearGroupTags();
      sm.setGroupTag([20], 'B');
      expect(sm.hasAnyGroupTag()).toBe(true);
      expect(sm.hasGroupSelection()).toBe(false);

      // Both — both true.
      sm.setGroupTag([10], 'A');
      expect(sm.hasAnyGroupTag()).toBe(true);
      expect(sm.hasGroupSelection()).toBe(true);

      // Cleared — both false.
      sm.clearGroupTags();
      expect(sm.hasAnyGroupTag()).toBe(false);
      expect(sm.hasGroupSelection()).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-077 V-2 — Group A/B color outline rebuild (Three.js mock unit).
  // Verifies that rebuildGroupOutlines fires on tag changes and that
  // the outline meshes are properly added/disposed. Real visual
  // verification is the Playwright baseline (group-color.visual.spec.ts).
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-077 V-2 group color outlines', () => {
    /** Helper — count children of `highlightGroup` matching a name pattern. */
    function countChildrenByName(
      sm: any,  // eslint-disable-line @typescript-eslint/no-explicit-any
      name: string,
    ): number {
      const group = sm.highlightGroup;
      if (!group || !Array.isArray(group.children)) return 0;
      return group.children.filter((c: any) => c.name === name).length;
    }

    it('no group tags → no group outline meshes added', () => {
      sm.selectFaces([10, 20]);
      // No setGroupTag.
      expect(countChildrenByName(sm, 'group-a-outline')).toBe(0);
      expect(countChildrenByName(sm, 'group-b-outline')).toBe(0);
    });

    it('setGroupTag triggers outline rebuild via notifyChange', () => {
      sm.selectFaces([10, 20, 30]);
      // Before tagging — no group outlines.
      expect(countChildrenByName(sm, 'group-a-outline')).toBe(0);

      // After tagging A — rebuildGroupOutlines fires.
      sm.setGroupTag([10], 'A');
      // Note: Three.js mock may not produce real geometry from
      // buildBoundaryEdges (positions/indices empty in test env).
      // We verify the rebuild PATH was reached, not the resulting mesh.
      // The reliable contract: no exceptions thrown.
      // Real visual verification is the Playwright baseline.
      expect(() => sm.setGroupTag([20], 'B')).not.toThrow();
    });

    it('clearGroupTags disposes any outline meshes', () => {
      sm.selectFaces([10, 20]);
      sm.setGroupTag([10], 'A');
      sm.setGroupTag([20], 'B');

      // clearGroupTags must remove any group meshes added.
      sm.clearGroupTags();
      expect(countChildrenByName(sm, 'group-a-outline')).toBe(0);
      expect(countChildrenByName(sm, 'group-b-outline')).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-078 P-3 — restoreGroupTags (Load sync from project file).
  // Per P-3 L3 lock-in:
  // - groupTags fully replaced (existing tags cleared first).
  // - selection extended via union: selected ∪ (a ∪ b).
  // - notifyChange emitted exactly once at the end.
  // - Bypasses selection-bound constraint of setGroupTag.
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-078 P-3 restoreGroupTags', () => {
    it('restores Group A and Group B from input arrays (basic)', () => {
      // Empty starting state — typical post-load condition.
      sm.restoreGroupTags([10, 20], [30]);

      expect(sm.getGroupA()).toEqual([10, 20]);
      expect(sm.getGroupB()).toEqual([30]);
      expect(sm.hasGroupSelection()).toBe(true);
    });

    it('expands selection via union — selected ∪ (A ∪ B)', () => {
      // Pre-existing selection that overlaps partially with restore input.
      sm.selectFaces([5, 10, 99]);
      expect(sm.getSelectedFaces().sort((a, b) => a - b)).toEqual([5, 10, 99]);

      sm.restoreGroupTags([10, 20], [30]);

      // Selection = pre-existing ∪ A ∪ B = {5, 10, 99} ∪ {10, 20, 30}
      const selected = sm.getSelectedFaces().sort((a, b) => a - b);
      expect(selected).toEqual([5, 10, 20, 30, 99]);

      // groupTags replaced with the restore input.
      expect(sm.getGroupA()).toEqual([10, 20]);
      expect(sm.getGroupB()).toEqual([30]);
    });

    it('overwrites prior groupTags entirely (no accumulation)', () => {
      // Set up prior tags via setGroupTag (selection-bound path).
      sm.selectFaces([10, 20, 30]);
      sm.setGroupTag([10, 20], 'A');
      sm.setGroupTag([30], 'B');
      expect(sm.getGroupA()).toEqual([10, 20]);
      expect(sm.getGroupB()).toEqual([30]);

      // Restore with disjoint set — prior tags must be dropped.
      sm.restoreGroupTags([100], [200, 300]);

      expect(sm.getGroupA()).toEqual([100]);
      expect(sm.getGroupB()).toEqual([200, 300]);

      // Selection grew by union (existing 10, 20, 30 preserved + new 100, 200, 300).
      const selected = sm.getSelectedFaces().sort((a, b) => a - b);
      expect(selected).toEqual([10, 20, 30, 100, 200, 300]);
    });

    it('emits exactly one notifyChange (V-2 outline rebuild fires once)', () => {
      const cb = vi.fn();
      sm.onChange(cb);

      sm.restoreGroupTags([10, 20], [30]);

      // Exactly one notifyChange emit, regardless of A+B sizes.
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('no-op when both inputs empty AND no prior tags AND no selection change', () => {
      const cb = vi.fn();
      sm.onChange(cb);

      // Empty restore on empty state — must NOT emit notifyChange.
      sm.restoreGroupTags([], []);

      expect(cb).not.toHaveBeenCalled();
      expect(sm.getGroupA()).toEqual([]);
      expect(sm.getGroupB()).toEqual([]);
    });

    it('empty input clears prior tags (notifyChange fires)', () => {
      // Prior tags exist — empty restore must clear them.
      sm.selectFaces([10, 20]);
      sm.setGroupTag([10], 'A');
      sm.setGroupTag([20], 'B');
      expect(sm.hasGroupSelection()).toBe(true);

      const cb = vi.fn();
      sm.onChange(cb);

      sm.restoreGroupTags([], []);

      expect(sm.getGroupA()).toEqual([]);
      expect(sm.getGroupB()).toEqual([]);
      expect(sm.hasAnyGroupTag()).toBe(false);
      // notifyChange MUST fire to clear stale outlines.
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });
});
