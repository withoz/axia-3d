import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initContextMenu, ContextMenuDeps } from './ContextMenu';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('./Toast', () => ({
  Toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

function createDOM(): void {
  document.body.innerHTML = `
    <div id="context-menu">
      <div class="ctx-item" data-action="undo">Undo</div>
      <div class="ctx-item" data-action="redo">Redo</div>
      <div class="ctx-item" data-action="delete">Delete</div>
      <div class="ctx-item" data-action="select-all">Select All</div>
      <div class="ctx-item" data-action="deselect">Deselect</div>
      <div class="ctx-item ctx-group-item" data-action="group">Group</div>
      <div class="ctx-item ctx-group-item" data-action="ungroup">Ungroup</div>
      <div class="ctx-item ctx-group-item" data-action="group-edit">Edit Group</div>
      <div class="ctx-item ctx-group-item" data-action="make-component">Make Component</div>
      <div class="ctx-item ctx-group-item" data-action="group-lock">Lock</div>
      <div class="ctx-item ctx-group-item" data-action="group-hide">Hide</div>
      <div class="ctx-group-sep"></div>
      <!-- ADR-074 U-2 — Boolean Group A/B selection items -->
      <div class="ctx-item ctx-bool-group-item" data-action="set-group-a">Set Group A</div>
      <div class="ctx-item ctx-bool-group-item" data-action="set-group-b">Set Group B</div>
      <div class="ctx-item ctx-bool-group-clear" data-action="clear-group-tags">Clear Group Tags</div>
      <!-- ADR-145 β-4 — Annulus 만들기 -->
      <div class="ctx-item ctx-annulus-item" data-action="promote-circles-to-annulus">Annulus 만들기</div>
      <!-- ADR-149 β-4 — T-junction 정리 -->
      <div class="ctx-item" data-action="heal-t-junctions">T-junction 정리</div>
      <!-- ADR-150 β-4 — Coplanar Face Merge Sweep -->
      <div class="ctx-item" data-action="heal-coplanar-pairs">Coplanar 일괄 정리</div>
      <!-- ADR-151 β-4 — Connected Inner Merge -->
      <div class="ctx-item ctx-p7-resolver-item" data-action="enforce-p7-canonical">Connected Inner Merge</div>
      <div class="ctx-item" data-action="view-top">Top</div>
      <div class="ctx-item" data-action="view-front">Front</div>
      <div class="ctx-item" data-action="view-3d">3D</div>
      <div class="ctx-item ctx-submenu-trigger" data-action="snap-override">Snap Override ▸</div>
    </div>
    <div id="snap-submenu">
      <div class="snap-ov" data-snap="endpoint">Endpoint</div>
      <div class="snap-ov" data-snap="midpoint">Midpoint</div>
      <div class="snap-ov" data-snap="none">None</div>
      <div class="snap-ov" data-snap="settings">Settings...</div>
    </div>
    <div id="view-mode-bar">
      <button class="view-btn" data-view="3d">3D</button>
      <button class="view-btn" data-view="top">Top</button>
    </div>
    <div id="tool-label">Select</div>
  `;
}

function mockDeps(): ContextMenuDeps {
  return {
    viewport: {
      setViewMode: vi.fn(),
      onContextMenu: vi.fn(),
    } as any,
    bridge: {
      toggleGroupLock: vi.fn(),
      toggleGroupVisibility: vi.fn(),
      // ADR-145 β-4 — Engine 4-validation 통과 시 success (default).
      promoteCirclesToAnnulus: vi.fn(),
      // ADR-149 β-4 — T-junction Sweep (default empty = clean mesh).
      detectTJunctions: vi.fn().mockReturnValue([]),
      healTJunction: vi.fn().mockReturnValue({
        healedCount: 1,
        newVertexId: 100,
        newEdgeA: 200,
        newEdgeB: 201,
      }),
      // ADR-150 β-4 — Coplanar Face Merge Sweep (default empty = clean mesh).
      sweepCoplanarPairs: vi.fn().mockReturnValue([]),
      mergeCoplanarPairBatch: vi.fn().mockReturnValue({
        mergedCount: 1,
        skippedCount: 0,
        newFaceIds: [100],
      }),
      // ADR-151 β-4 — Connected Inner Merge (default canonical success).
      enforceP7Canonical: vi.fn().mockReturnValue({
        componentCount: 1,
        isValid: true,
        violationCount: 0,
      }),
    } as any,
    toolManager: {
      currentTool: 'select',
      isToolBusy: vi.fn().mockReturnValue(false),
      cancelCurrentTool: vi.fn(),
      executeAction: vi.fn(),
      syncMesh: vi.fn(),
      snap: {
        setOverride: vi.fn(),
      },
      selection: {
        getSelectedFaces: vi.fn().mockReturnValue([]),
        getSelectedEdges: vi.fn().mockReturnValue([]),
        getGroupId: vi.fn().mockReturnValue(undefined),
        isInGroupEditMode: vi.fn().mockReturnValue(false),
        clearSelection: vi.fn(),
        enterGroupEdit: vi.fn(),
        // ADR-074 U-2 — Boolean Group selection methods
        setGroupTag: vi.fn(),
        clearGroupTags: vi.fn(),
        hasAnyGroupTag: vi.fn().mockReturnValue(false),
      },
    } as any,
    viewModeBar: null,
    openOsnapPanel: vi.fn(),
  };
}

describe('ContextMenu', () => {
  let deps: ReturnType<typeof mockDeps>;

  beforeEach(() => {
    createDOM();
    deps = mockDeps();
    deps.viewModeBar = document.getElementById('view-mode-bar');
    initContextMenu(deps);
  });

  describe('initialization', () => {
    it('does not throw when context-menu exists', () => {
      expect(() => initContextMenu(deps)).not.toThrow();
    });

    it('does not throw when context-menu is missing', () => {
      document.body.innerHTML = '';
      expect(() => initContextMenu(deps)).not.toThrow();
    });

    it('registers onContextMenu callback', () => {
      expect(deps.viewport.onContextMenu).toHaveBeenCalled();
    });
  });

  describe('action dispatch', () => {
    it('undo dispatches to toolManager', () => {
      const item = document.querySelector('[data-action="undo"]') as HTMLElement;
      item.click();
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('undo');
    });

    it('redo dispatches to toolManager', () => {
      const item = document.querySelector('[data-action="redo"]') as HTMLElement;
      item.click();
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('redo');
    });

    it('delete dispatches to toolManager', () => {
      const item = document.querySelector('[data-action="delete"]') as HTMLElement;
      item.click();
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('delete');
    });

    it('select-all dispatches to toolManager', () => {
      const item = document.querySelector('[data-action="select-all"]') as HTMLElement;
      item.click();
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('select-all');
    });

    it('deselect calls clearSelection', () => {
      const item = document.querySelector('[data-action="deselect"]') as HTMLElement;
      item.click();
      expect(deps.toolManager.selection.clearSelection).toHaveBeenCalled();
    });
  });

  describe('view actions', () => {
    it('view-top sets top view', () => {
      const item = document.querySelector('[data-action="view-top"]') as HTMLElement;
      item.click();
      expect(deps.viewport.setViewMode).toHaveBeenCalledWith('top');
    });

    it('view-front sets front view', () => {
      const item = document.querySelector('[data-action="view-front"]') as HTMLElement;
      item.click();
      expect(deps.viewport.setViewMode).toHaveBeenCalledWith('front');
    });

    it('view-3d sets 3d view', () => {
      const item = document.querySelector('[data-action="view-3d"]') as HTMLElement;
      item.click();
      expect(deps.viewport.setViewMode).toHaveBeenCalledWith('3d');
    });
  });

  describe('group actions', () => {
    it('group dispatches group action', () => {
      const item = document.querySelector('[data-action="group"]') as HTMLElement;
      item.click();
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('group');
    });

    it('ungroup dispatches ungroup action', () => {
      const item = document.querySelector('[data-action="ungroup"]') as HTMLElement;
      item.click();
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('ungroup');
    });

    it('make-component dispatches action', () => {
      const item = document.querySelector('[data-action="make-component"]') as HTMLElement;
      item.click();
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('make-component');
    });
  });

  describe('menu closes on action', () => {
    it('menu loses visible class after click', () => {
      const menu = document.getElementById('context-menu')!;
      menu.classList.add('visible');

      const item = document.querySelector('[data-action="undo"]') as HTMLElement;
      item.click();

      expect(menu.classList.contains('visible')).toBe(false);
    });
  });

  describe('outside click closes menu', () => {
    it('mousedown outside closes context menu', () => {
      const menu = document.getElementById('context-menu')!;
      menu.classList.add('visible');

      // Create a click target outside the menu
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(menu.classList.contains('visible')).toBe(false);
    });
  });

  describe('snap submenu', () => {
    it('snap none sets override to none', () => {
      const snapSub = document.getElementById('snap-submenu')!;
      const noneItem = snapSub.querySelector('[data-snap="none"]') as HTMLElement;
      noneItem.click();
      expect(deps.toolManager.snap.setOverride).toHaveBeenCalledWith('none');
    });

    it('snap endpoint sets override', () => {
      const snapSub = document.getElementById('snap-submenu')!;
      const item = snapSub.querySelector('[data-snap="endpoint"]') as HTMLElement;
      item.click();
      expect(deps.toolManager.snap.setOverride).toHaveBeenCalledWith('endpoint');
    });

    it('snap settings opens osnap panel', () => {
      const snapSub = document.getElementById('snap-submenu')!;
      const item = snapSub.querySelector('[data-snap="settings"]') as HTMLElement;
      item.click();
      expect(deps.openOsnapPanel).toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-074 U-2 — Boolean Group A/B selection ContextMenu actions.
  // Per ADR-074 §B U-2-e=(b) — direct SelectionManager calls (bypass
  // ToolManager.executeAction) since this is pure selection-state mutation.
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-074 U-2 Boolean Group A/B actions', () => {
    it('set-group-a calls selection.setGroupTag with selected faces and "A"', () => {
      // Arrange — selection has 3 faces.
      (deps.toolManager.selection.getSelectedFaces as any)
        .mockReturnValue([10, 20, 30]);

      const item = document.querySelector(
        '[data-action="set-group-a"]',
      ) as HTMLElement;
      item.click();

      // Direct SelectionManager call (NOT toolManager.executeAction).
      expect((deps.toolManager.selection as any).setGroupTag)
        .toHaveBeenCalledWith([10, 20, 30], 'A');
      // executeAction NOT called for this action.
      expect(deps.toolManager.executeAction).not.toHaveBeenCalled();
    });

    it('set-group-b calls selection.setGroupTag with selected faces and "B"', () => {
      (deps.toolManager.selection.getSelectedFaces as any)
        .mockReturnValue([5, 15]);

      const item = document.querySelector(
        '[data-action="set-group-b"]',
      ) as HTMLElement;
      item.click();

      expect((deps.toolManager.selection as any).setGroupTag)
        .toHaveBeenCalledWith([5, 15], 'B');
      expect(deps.toolManager.executeAction).not.toHaveBeenCalled();
    });

    it('clear-group-tags calls selection.clearGroupTags', () => {
      const item = document.querySelector(
        '[data-action="clear-group-tags"]',
      ) as HTMLElement;
      item.click();

      expect((deps.toolManager.selection as any).clearGroupTags)
        .toHaveBeenCalled();
      expect(deps.toolManager.executeAction).not.toHaveBeenCalled();
    });

    it('set-group-a is no-op when selection is empty', () => {
      // Empty selection → setGroupTag must NOT be called (defensive).
      (deps.toolManager.selection.getSelectedFaces as any)
        .mockReturnValue([]);

      const item = document.querySelector(
        '[data-action="set-group-a"]',
      ) as HTMLElement;
      item.click();

      expect((deps.toolManager.selection as any).setGroupTag)
        .not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-145 β-4 — Circle annulus 명시 promote (메타-원칙 #16 정합).
  //
  // 사용자 우클릭 → "Annulus 만들기" → bridge.promoteCirclesToAnnulus.
  // Visibility: exactly 2 face 선택. Engine 4-validation 최종 검증.
  // InnerNotContained 시 swap 후 retry — 두 ordering 모두 실패 → Toast.error.
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-145 β-4 Annulus 만들기', () => {
    it('visibility — promote-circles-to-annulus item shown only when 2 faces selected', async () => {
      const { Toast } = await import('./Toast');

      // Path 1: 2 face selected → item shown
      (deps.toolManager.selection.getSelectedFaces as any)
        .mockReturnValue([10, 20]);

      // Trigger context menu callback to apply visibility logic.
      const cb = (deps.viewport.onContextMenu as any).mock.calls[0][0];
      cb(100, 100);

      const item = document.querySelector(
        '[data-action="promote-circles-to-annulus"]',
      ) as HTMLElement;
      expect(item.style.display).not.toBe('none');

      // Path 2: 1 face selected → item hidden
      (deps.toolManager.selection.getSelectedFaces as any)
        .mockReturnValue([10]);
      cb(100, 100);
      expect(item.style.display).toBe('none');

      // Path 3: 0 face selected → item hidden
      (deps.toolManager.selection.getSelectedFaces as any)
        .mockReturnValue([]);
      cb(100, 100);
      expect(item.style.display).toBe('none');

      // Path 4: 3 face selected → item hidden (exactly 2 required)
      (deps.toolManager.selection.getSelectedFaces as any)
        .mockReturnValue([10, 20, 30]);
      cb(100, 100);
      expect(item.style.display).toBe('none');

      void Toast; // silence unused
    });

    it('dispatch — click promotes (outer, inner) via bridge with selected face IDs', async () => {
      const { Toast } = await import('./Toast');
      (Toast.success as any).mockClear();

      // 2 face selected.
      (deps.toolManager.selection.getSelectedFaces as any)
        .mockReturnValue([10, 20]);
      // Bridge succeeds on first ordering — no swap retry.
      (deps.bridge.promoteCirclesToAnnulus as any).mockImplementation(() => {
        /* success: no throw */
      });

      const item = document.querySelector(
        '[data-action="promote-circles-to-annulus"]',
      ) as HTMLElement;
      item.click();

      // Bridge called exactly once with selected face IDs.
      expect(deps.bridge.promoteCirclesToAnnulus).toHaveBeenCalledWith(10, 20);
      expect(deps.bridge.promoteCirclesToAnnulus).toHaveBeenCalledTimes(1);
      // Success Toast + selection cleared + mesh sync.
      expect(Toast.success).toHaveBeenCalledWith('Annulus 생성 완료');
      expect(deps.toolManager.selection.clearSelection).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
    });

    it('InnerNotContained swap retry — first call (A,B) fails, second (B,A) succeeds', async () => {
      const { Toast } = await import('./Toast');
      (Toast.success as any).mockClear();
      (Toast.error as any).mockClear();

      (deps.toolManager.selection.getSelectedFaces as any)
        .mockReturnValue([10, 20]);

      // First call (10, 20) fails with InnerNotContained — swap retry succeeds.
      let callCount = 0;
      (deps.bridge.promoteCirclesToAnnulus as any).mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('promoteCirclesToAnnulus: InnerNotContained');
        }
        // Second call (20, 10) succeeds.
      });

      const item = document.querySelector(
        '[data-action="promote-circles-to-annulus"]',
      ) as HTMLElement;
      item.click();

      // Two calls: (10,20) then (20,10).
      expect(deps.bridge.promoteCirclesToAnnulus).toHaveBeenCalledTimes(2);
      expect(deps.bridge.promoteCirclesToAnnulus).toHaveBeenNthCalledWith(1, 10, 20);
      expect(deps.bridge.promoteCirclesToAnnulus).toHaveBeenNthCalledWith(2, 20, 10);
      expect(Toast.success).toHaveBeenCalledWith('Annulus 생성 완료');
      expect(Toast.error).not.toHaveBeenCalled();
    });

    it('error toast — bridge throws non-InnerNotContained → Toast.error (no swap retry)', async () => {
      const { Toast } = await import('./Toast');
      (Toast.error as any).mockClear();
      (Toast.success as any).mockClear();

      (deps.toolManager.selection.getSelectedFaces as any)
        .mockReturnValue([10, 20]);

      // NotCoplanar error — no swap retry (only InnerNotContained triggers swap).
      (deps.bridge.promoteCirclesToAnnulus as any).mockImplementation(() => {
        throw new Error('promoteCirclesToAnnulus: NotCoplanar');
      });

      const item = document.querySelector(
        '[data-action="promote-circles-to-annulus"]',
      ) as HTMLElement;
      item.click();

      // Bridge called once (no swap retry).
      expect(deps.bridge.promoteCirclesToAnnulus).toHaveBeenCalledTimes(1);
      expect(Toast.error).toHaveBeenCalledWith(
        expect.stringContaining('NotCoplanar'),
      );
      expect(Toast.success).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-149 β-4 — T-junction Sweep 명시 도구 (메타-원칙 #16 정합).
  //
  // 사용자 우클릭 → "T-junction 정리" → bridge.detectTJunctions →
  //   reports loop bridge.healTJunction → Toast 보고.
  // No selection-based visibility — menu always visible (clean mesh 안내 포함).
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-149 β-4 T-junction 정리', () => {
    it('zero T-junctions → Toast.info "T-junction 없음" + bridge.heal not called', async () => {
      const { Toast } = await import('./Toast');
      (Toast.info as any).mockClear();

      // Default mock: detectTJunctions returns [].
      (deps.bridge.detectTJunctions as any).mockReturnValue([]);

      const item = document.querySelector(
        '[data-action="heal-t-junctions"]',
      ) as HTMLElement;
      item.click();

      expect(deps.bridge.detectTJunctions).toHaveBeenCalledTimes(1);
      expect(deps.bridge.healTJunction).not.toHaveBeenCalled();
      expect(Toast.info).toHaveBeenCalledWith(expect.stringContaining('T-junction 없음'));
      // No mesh sync needed when nothing healed.
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
    });

    it('detect throws → Toast.error + bridge.heal not called', async () => {
      const { Toast } = await import('./Toast');
      (Toast.error as any).mockClear();

      (deps.bridge.detectTJunctions as any).mockImplementation(() => {
        throw new Error('detectTJunctions: WASM unavailable');
      });

      const item = document.querySelector(
        '[data-action="heal-t-junctions"]',
      ) as HTMLElement;
      item.click();

      expect(deps.bridge.healTJunction).not.toHaveBeenCalled();
      expect(Toast.error).toHaveBeenCalledWith(
        expect.stringContaining('T-junction 검출 실패'),
      );
    });

    it('canonical heal — 3 T-junctions all heal → Toast.success "3개 정리 완료"', async () => {
      const { Toast } = await import('./Toast');
      (Toast.success as any).mockClear();

      (deps.bridge.detectTJunctions as any).mockReturnValue([
        { faceId: 0, edgeId: 4, vertexId: 5, tAlongEdge: 0.5 },
        { faceId: 0, edgeId: 6, vertexId: 7, tAlongEdge: 0.25 },
        { faceId: 1, edgeId: 8, vertexId: 9, tAlongEdge: 0.75 },
      ]);
      (deps.bridge.healTJunction as any).mockReturnValue({
        healedCount: 1,
        newVertexId: 100,
        newEdgeA: 200,
        newEdgeB: 201,
      });

      const item = document.querySelector(
        '[data-action="heal-t-junctions"]',
      ) as HTMLElement;
      item.click();

      expect(deps.bridge.healTJunction).toHaveBeenCalledTimes(3);
      expect(Toast.success).toHaveBeenCalledWith(
        expect.stringContaining('3개 정리'),
      );
      // syncMesh + selection clear after healing.
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
      expect(deps.toolManager.selection.clearSelection).toHaveBeenCalled();
    });

    it('partial failure — some heal fail (stale report) → Toast.info "N 정리, M skip"', async () => {
      const { Toast } = await import('./Toast');
      (Toast.info as any).mockClear();

      (deps.bridge.detectTJunctions as any).mockReturnValue([
        { faceId: 0, edgeId: 4, vertexId: 5, tAlongEdge: 0.5 },
        { faceId: 0, edgeId: 6, vertexId: 7, tAlongEdge: 0.5 },
      ]);
      // First heal succeeds, second throws (stale after first split).
      let callCount = 0;
      (deps.bridge.healTJunction as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { healedCount: 1, newVertexId: 100, newEdgeA: 200, newEdgeB: 201 };
        }
        throw new Error('healTJunction: InvalidReport (...)');
      });

      const item = document.querySelector(
        '[data-action="heal-t-junctions"]',
      ) as HTMLElement;
      item.click();

      expect(deps.bridge.healTJunction).toHaveBeenCalledTimes(2);
      expect(Toast.info).toHaveBeenCalledWith(
        expect.stringMatching(/1개 정리.*1개 skip/),
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-150 β-4 — Coplanar Face Merge Sweep 명시 도구 (메타-원칙 #16 정합).
  //
  // 사용자 우클릭 → "🧹 Coplanar 면 일괄 자동 정리" → bridge.sweepCoplanarPairs
  //   → empty → Toast.info / non-empty → bridge.mergeCoplanarPairBatch.
  // ADR-149 β-4 패턴 1:1 mirror — single batch call (engine cascade handling).
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-150 β-4 Coplanar 일괄 정리', () => {
    it('zero pairs → Toast.info "정리 대상 없음" + bridge.merge not called', async () => {
      const { Toast } = await import('./Toast');
      (Toast.info as any).mockClear();

      (deps.bridge.sweepCoplanarPairs as any).mockReturnValue([]);

      const item = document.querySelector(
        '[data-action="heal-coplanar-pairs"]',
      ) as HTMLElement;
      item.click();

      expect(deps.bridge.sweepCoplanarPairs).toHaveBeenCalledTimes(1);
      expect(deps.bridge.mergeCoplanarPairBatch).not.toHaveBeenCalled();
      expect(Toast.info).toHaveBeenCalledWith(expect.stringContaining('정리 대상 없음'));
      // No mesh sync when nothing to merge.
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
    });

    it('sweep throws → Toast.error + bridge.merge not called', async () => {
      const { Toast } = await import('./Toast');
      (Toast.error as any).mockClear();

      (deps.bridge.sweepCoplanarPairs as any).mockImplementation(() => {
        throw new Error('sweepCoplanarPairs: WASM unavailable');
      });

      const item = document.querySelector(
        '[data-action="heal-coplanar-pairs"]',
      ) as HTMLElement;
      item.click();

      expect(deps.bridge.mergeCoplanarPairBatch).not.toHaveBeenCalled();
      expect(Toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Coplanar 검출 실패'),
      );
    });

    it('canonical batch — all pairs merge → Toast.success + syncMesh + selection clear', async () => {
      const { Toast } = await import('./Toast');
      (Toast.success as any).mockClear();

      (deps.bridge.sweepCoplanarPairs as any).mockReturnValue([
        { faceA: 0, faceB: 1, planeNormal: { x: 0, y: 1, z: 0 } },
        { faceA: 2, faceB: 3, planeNormal: { x: 0, y: 1, z: 0 } },
        { faceA: 4, faceB: 5, planeNormal: { x: 0, y: 1, z: 0 } },
      ]);
      (deps.bridge.mergeCoplanarPairBatch as any).mockReturnValue({
        mergedCount: 3,
        skippedCount: 0,
        newFaceIds: [100, 101, 102],
      });

      const item = document.querySelector(
        '[data-action="heal-coplanar-pairs"]',
      ) as HTMLElement;
      item.click();

      expect(deps.bridge.mergeCoplanarPairBatch).toHaveBeenCalledTimes(1);
      expect(Toast.success).toHaveBeenCalledWith(
        expect.stringContaining('3쌍 정리'),
      );
      // syncMesh + selection clear post-merge.
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
      expect(deps.toolManager.selection.clearSelection).toHaveBeenCalled();
    });

    it('partial failure — some pairs skip → Toast.info "N 정리, M skip"', async () => {
      const { Toast } = await import('./Toast');
      (Toast.info as any).mockClear();

      (deps.bridge.sweepCoplanarPairs as any).mockReturnValue([
        { faceA: 0, faceB: 1, planeNormal: { x: 0, y: 1, z: 0 } },
        { faceA: 2, faceB: 3, planeNormal: { x: 0, y: 1, z: 0 } },
      ]);
      (deps.bridge.mergeCoplanarPairBatch as any).mockReturnValue({
        mergedCount: 1,
        skippedCount: 1,
        newFaceIds: [100],
      });

      const item = document.querySelector(
        '[data-action="heal-coplanar-pairs"]',
      ) as HTMLElement;
      item.click();

      expect(Toast.info).toHaveBeenCalledWith(
        expect.stringMatching(/1쌍 정리.*1쌍 skip/),
      );
    });
  });

  // ── ADR-151 β-4 — Connected Stacked-inner Component-Merge Resolver ──
  // ADR-149/150 β-4 답습 패턴. 사용자 워크플로우:
  //   1. ≥2 face 선택 (1 container + ≥1 inner)
  //   2. 우클릭 → "Connected Inner Merge"
  //   3. β-4 MVP: first selected = container, 나머지 = inners
  //   4. bridge.enforceP7Canonical(container, inners) — engine 검증 + rebuild
  describe('ADR-151 β-4 Connected Inner Merge', () => {
    it('< 2 faces selected → Toast.error + bridge.enforce not called', async () => {
      const { Toast } = await import('./Toast');
      (Toast.error as any).mockClear();
      (deps.toolManager.selection.getSelectedFaces as any).mockReturnValue([42]); // only 1

      const item = document.querySelector(
        '[data-action="enforce-p7-canonical"]',
      ) as HTMLElement;
      item.click();

      expect(deps.bridge.enforceP7Canonical).not.toHaveBeenCalled();
      expect(Toast.error).toHaveBeenCalledWith(
        expect.stringContaining('container + ≥1 inner'),
      );
    });

    it('canonical — engine returns isValid=true → Toast.success + syncMesh + selection clear', async () => {
      const { Toast } = await import('./Toast');
      (Toast.success as any).mockClear();
      (deps.toolManager.selection.getSelectedFaces as any).mockReturnValue([0, 1, 2]);
      (deps.bridge.enforceP7Canonical as any).mockReturnValue({
        componentCount: 2,
        isValid: true,
        violationCount: 0,
      });

      const item = document.querySelector(
        '[data-action="enforce-p7-canonical"]',
      ) as HTMLElement;
      item.click();

      // First face = container, rest = inners
      expect(deps.bridge.enforceP7Canonical).toHaveBeenCalledWith(0, [1, 2]);
      expect(Toast.success).toHaveBeenCalledWith(
        expect.stringMatching(/2개 component.*ring-with-hole/),
      );
      // syncMesh + selection clear post-rebuild.
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
      expect(deps.toolManager.selection.clearSelection).toHaveBeenCalled();
    });

    it('partial valid — isValid=false with violations → Toast.info (ADR-051 §2.5 deferred boundary)', async () => {
      const { Toast } = await import('./Toast');
      (Toast.info as any).mockClear();
      (deps.toolManager.selection.getSelectedFaces as any).mockReturnValue([0, 1, 2, 3]);
      (deps.bridge.enforceP7Canonical as any).mockReturnValue({
        componentCount: 1,
        isValid: false,
        violationCount: 1,
      });

      const item = document.querySelector(
        '[data-action="enforce-p7-canonical"]',
      ) as HTMLElement;
      item.click();

      expect(Toast.info).toHaveBeenCalledWith(
        expect.stringMatching(/1개 component.*1개 violation.*deferred boundary/),
      );
      // syncMesh still called (mutation succeeded even with manifold warnings)
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
    });

    it('engine throws (P7EnforceError) → Toast.error + no syncMesh', async () => {
      const { Toast } = await import('./Toast');
      (Toast.error as any).mockClear();
      (deps.toolManager.syncMesh as any).mockClear();
      (deps.toolManager.selection.getSelectedFaces as any).mockReturnValue([0, 1]);
      (deps.bridge.enforceP7Canonical as any).mockImplementation(() => {
        throw new Error('enforceP7Canonical: InvalidInput (container_active=false)');
      });

      const item = document.querySelector(
        '[data-action="enforce-p7-canonical"]',
      ) as HTMLElement;
      item.click();

      expect(Toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Connected Inner Merge 실패'),
      );
      // syncMesh NOT called on error (silent skip 차단)
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
    });
  });
});
