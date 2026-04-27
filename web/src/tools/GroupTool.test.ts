import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GroupTool } from './GroupTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../ui/Toast', () => ({
  Toast: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

function mockToolContext() {
  return {
    bridge: {
      createGroup: vi.fn().mockReturnValue(1),
      deleteGroup: vi.fn(),
    },
    viewport: {
      pick: vi.fn().mockReturnValue(null),
    },
    selection: {
      getSelectedFaces: vi.fn().mockReturnValue([1, 2, 3]),
      handleClick: vi.fn(),
      handleGroupEditClick: vi.fn().mockReturnValue(true),
      selectGroup: vi.fn(),
      groupSelected: vi.fn().mockReturnValue(1),
      ungroupSelected: vi.fn().mockReturnValue(true),
      clearSelection: vi.fn(),
      isInGroupEditMode: vi.fn().mockReturnValue(false),
      exitGroupEdit: vi.fn(),
      enterGroupEdit: vi.fn().mockReturnValue(true),
      getGroupId: vi.fn().mockReturnValue(1),
      setHover: vi.fn(),
      clearHover: vi.fn(),
    },
    faceMap: [0, 1, 2, 3, 4, 5],
    getFaceId: vi.fn().mockReturnValue(2),
  } as any;
}

describe('GroupTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: GroupTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new GroupTool(ctx);
  });

  describe('name', () => {
    it('is "group"', () => {
      expect(tool.name).toBe('group');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onActivate', () => {
    it('does not throw when faces are selected', () => {
      expect(() => tool.onActivate()).not.toThrow();
    });

    it('does not throw when no faces selected', () => {
      ctx.selection.getSelectedFaces.mockReturnValue([]);
      expect(() => tool.onActivate()).not.toThrow();
    });
  });

  describe('createGroupFromSelection', () => {
    it('creates group via WASM bridge', () => {
      const result = tool.createGroupFromSelection();
      expect(ctx.bridge.createGroup).toHaveBeenCalledWith('Group', [1, 2, 3]);
      expect(result).toBe(1);
    });

    it('returns null when fewer than 2 faces selected', () => {
      ctx.selection.getSelectedFaces.mockReturnValue([1]);
      const result = tool.createGroupFromSelection();
      expect(result).toBeNull();
    });

    it('falls back to local grouping when WASM returns 0', () => {
      ctx.bridge.createGroup.mockReturnValue(0);
      const result = tool.createGroupFromSelection();
      expect(ctx.selection.groupSelected).toHaveBeenCalled();
      expect(result).toBe(1); // from groupSelected mock
    });

    it('returns null when both WASM and local fail', () => {
      ctx.bridge.createGroup.mockReturnValue(0);
      ctx.selection.groupSelected.mockReturnValue(null);
      const result = tool.createGroupFromSelection();
      expect(result).toBeNull();
    });
  });

  describe('ungroupSelection', () => {
    it('deletes group via bridge and local', () => {
      const result = tool.ungroupSelection();
      expect(ctx.bridge.deleteGroup).toHaveBeenCalledWith(1);
      expect(ctx.selection.ungroupSelected).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('returns false when no faces selected', () => {
      ctx.selection.getSelectedFaces.mockReturnValue([]);
      const result = tool.ungroupSelection();
      expect(result).toBe(false);
    });
  });

  describe('enterEditMode', () => {
    it('enters edit mode for grouped face', () => {
      const result = tool.enterEditMode(2);
      expect(ctx.selection.enterGroupEdit).toHaveBeenCalledWith(1);
      expect(result).toBe(true);
    });

    it('returns false when face has no group', () => {
      ctx.selection.getGroupId.mockReturnValue(undefined);
      const result = tool.enterEditMode(2);
      expect(result).toBe(false);
    });
  });

  describe('onMouseDown - normal mode', () => {
    it('selects group when clicking grouped face', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 2 });
      ctx.getFaceId.mockReturnValue(5);
      ctx.selection.getGroupId.mockReturnValue(3);

      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      expect(ctx.selection.selectGroup).toHaveBeenCalledWith(3);
    });

    it('handles click normally with shift key', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 2 });
      ctx.selection.getGroupId.mockReturnValue(3);
      // GroupTool uses private getFaceId which reads faceMap[faceIndex]
      // faceMap[2] = 2

      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: true, ctrlKey: false } as MouseEvent, null);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(2, true, false, false);
    });

    it('clears selection on empty space click', () => {
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(-1, false, false);
    });
  });

  describe('onMouseDown - group edit mode', () => {
    it('delegates to handleGroupEditClick', () => {
      ctx.selection.isInGroupEditMode.mockReturnValue(true);
      ctx.viewport.pick.mockReturnValue({ faceIndex: 2 });
      ctx.getFaceId.mockReturnValue(5);

      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      // Uses private getFaceId which looks up faceMap
      expect(ctx.selection.handleGroupEditClick).toHaveBeenCalled();
    });
  });

  describe('onMouseMove', () => {
    it('sets hover on face hit', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 2 });
      ctx.getFaceId.mockReturnValue(5);

      tool.onMouseMove({ clientX: 100, clientY: 200 } as MouseEvent, null);
      // Uses private getFaceId → faceMap[2] = 2
      expect(ctx.selection.setHover).toHaveBeenCalled();
    });

    it('clears hover on empty space', () => {
      tool.onMouseMove({ clientX: 100, clientY: 200 } as MouseEvent, null);
      expect(ctx.selection.clearHover).toHaveBeenCalled();
    });
  });

  describe('onKeyDown', () => {
    it('Enter creates group', () => {
      const e = { key: 'Enter', preventDefault: vi.fn() } as any;
      tool.onKeyDown(e);
      expect(ctx.bridge.createGroup).toHaveBeenCalled();
      expect(e.preventDefault).toHaveBeenCalled();
    });

    it('Delete ungroups selection', () => {
      const e = { key: 'Delete', preventDefault: vi.fn() } as any;
      tool.onKeyDown(e);
      expect(ctx.selection.ungroupSelected).toHaveBeenCalled();
      expect(e.preventDefault).toHaveBeenCalled();
    });

    it('Escape exits group edit mode', () => {
      ctx.selection.isInGroupEditMode.mockReturnValue(true);
      const e = { key: 'Escape', preventDefault: vi.fn() } as any;
      tool.onKeyDown(e);
      expect(ctx.selection.exitGroupEdit).toHaveBeenCalled();
    });

    it('Escape clears selection in normal mode', () => {
      const e = { key: 'Escape', preventDefault: vi.fn() } as any;
      tool.onKeyDown(e);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });
  });
});
