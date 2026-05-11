import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initContextMenu, ContextMenuDeps } from './ContextMenu';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

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
});
