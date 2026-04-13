import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentPanel, ComponentPanelCallbacks } from './ComponentPanel';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockBridge() {
  return {
    getAllGroups: vi.fn().mockReturnValue([]),
    toggleGroupVisibility: vi.fn(),
    toggleGroupLock: vi.fn(),
    deleteGroup: vi.fn(),
  } as any;
}

function mockSelection() {
  return {
    getAllGroups: vi.fn().mockReturnValue(new Map()),
    selectGroup: vi.fn(),
    ungroupSelected: vi.fn(),
  } as any;
}

describe('ComponentPanel', () => {
  let container: HTMLElement;
  let bridge: ReturnType<typeof mockBridge>;
  let selection: ReturnType<typeof mockSelection>;
  let callbacks: ComponentPanelCallbacks;
  let panel: ComponentPanel;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    bridge = mockBridge();
    selection = mockSelection();
    callbacks = {
      onGroupSelect: vi.fn(),
      onGroupDoubleClick: vi.fn(),
      onGroupDelete: vi.fn(),
      onRefresh: vi.fn(),
    };
    panel = new ComponentPanel(container, bridge, selection, callbacks);
  });

  describe('constructor', () => {
    it('creates panel element', () => {
      const el = container.querySelector('#component-panel');
      expect(el).not.toBeNull();
    });

    it('panel starts hidden', () => {
      const el = container.querySelector('#component-panel') as HTMLElement;
      expect(el.style.display).toBe('none');
    });

    it('has tree and empty elements', () => {
      expect(container.querySelector('.cp-tree')).not.toBeNull();
      expect(container.querySelector('.cp-empty')).not.toBeNull();
    });

    it('injects styles', () => {
      expect(document.getElementById('cp-styles')).not.toBeNull();
    });
  });

  describe('toggle', () => {
    it('shows panel on first toggle', () => {
      panel.toggle();
      const el = container.querySelector('#component-panel') as HTMLElement;
      expect(el.style.display).toBe('flex');
    });

    it('hides panel on second toggle', () => {
      panel.toggle();
      panel.toggle();
      const el = container.querySelector('#component-panel') as HTMLElement;
      expect(el.style.display).toBe('none');
    });

    it('calls refresh when showing', () => {
      panel.toggle();
      expect(bridge.getAllGroups).toHaveBeenCalled();
    });
  });

  describe('show/hide', () => {
    it('show displays panel', () => {
      panel.show();
      const el = container.querySelector('#component-panel') as HTMLElement;
      expect(el.style.display).toBe('flex');
    });

    it('hide hides panel', () => {
      panel.show();
      panel.hide();
      const el = container.querySelector('#component-panel') as HTMLElement;
      expect(el.style.display).toBe('none');
    });
  });

  describe('refresh with WASM groups', () => {
    it('renders group nodes from WASM', () => {
      bridge.getAllGroups.mockReturnValue([
        { id: 1, name: 'Box', faceCount: 6, faceIds: [0,1,2,3,4,5], parent: null, children: [], visible: true, locked: false, isComponent: false },
        { id: 2, name: 'Cylinder', faceCount: 10, faceIds: [], parent: null, children: [], visible: true, locked: false, isComponent: false },
      ]);
      panel.show();
      const nodes = container.querySelectorAll('.cp-node');
      expect(nodes.length).toBe(2);
    });

    it('hides empty message when groups exist', () => {
      bridge.getAllGroups.mockReturnValue([
        { id: 1, name: 'G1', faceCount: 3, faceIds: [], parent: null, children: [], visible: true, locked: false, isComponent: false },
      ]);
      panel.show();
      const empty = container.querySelector('.cp-empty') as HTMLElement;
      expect(empty.style.display).toBe('none');
    });

    it('shows empty message when no groups', () => {
      panel.show();
      const empty = container.querySelector('.cp-empty') as HTMLElement;
      expect(empty.style.display).toBe('block');
    });
  });

  describe('refresh with local groups', () => {
    it('falls back to local SelectionManager groups', () => {
      bridge.getAllGroups.mockReturnValue([]);
      const localMap = new Map<number, Set<number>>();
      localMap.set(1, new Set([0, 1, 2]));
      selection.getAllGroups.mockReturnValue(localMap);
      panel.show();
      const nodes = container.querySelectorAll('.cp-node');
      expect(nodes.length).toBe(1);
    });
  });

  describe('group rendering', () => {
    it('shows component icon for components', () => {
      bridge.getAllGroups.mockReturnValue([
        { id: 1, name: 'Comp', faceCount: 3, faceIds: [], parent: null, children: [], visible: true, locked: false, isComponent: true },
      ]);
      panel.show();
      const icon = container.querySelector('.cp-icon')!;
      expect(icon.textContent).toBe('◆');
    });

    it('shows group icon for regular groups', () => {
      bridge.getAllGroups.mockReturnValue([
        { id: 1, name: 'Grp', faceCount: 3, faceIds: [], parent: null, children: [], visible: true, locked: false, isComponent: false },
      ]);
      panel.show();
      const icon = container.querySelector('.cp-icon')!;
      expect(icon.textContent).toBe('▣');
    });

    it('shows face count', () => {
      bridge.getAllGroups.mockReturnValue([
        { id: 1, name: 'G', faceCount: 12, faceIds: [], parent: null, children: [], visible: true, locked: false, isComponent: false },
      ]);
      panel.show();
      const count = container.querySelector('.cp-face-count')!;
      expect(count.textContent).toBe('(12)');
    });

    it('renders nested groups with indent', () => {
      bridge.getAllGroups.mockReturnValue([
        { id: 1, name: 'Parent', faceCount: 6, faceIds: [], parent: null, children: [2], visible: true, locked: false, isComponent: false },
        { id: 2, name: 'Child', faceCount: 3, faceIds: [], parent: 1, children: [], visible: true, locked: false, isComponent: false },
      ]);
      panel.show();
      const nodes = container.querySelectorAll('.cp-node');
      // Parent contains child, so 2 nodes but child is nested inside parent
      expect(nodes.length).toBe(2);
    });
  });

  describe('interactions', () => {
    beforeEach(() => {
      bridge.getAllGroups.mockReturnValue([
        { id: 1, name: 'G1', faceCount: 6, faceIds: [0,1,2,3,4,5], parent: null, children: [], visible: true, locked: false, isComponent: false },
      ]);
      panel.show();
    });

    it('clicking row selects group', () => {
      const row = container.querySelector('.cp-row') as HTMLElement;
      row.click();
      expect(callbacks.onGroupSelect).toHaveBeenCalledWith(1);
      expect(selection.selectGroup).toHaveBeenCalledWith(1);
    });

    it('double-clicking row triggers edit callback', () => {
      const row = container.querySelector('.cp-row') as HTMLElement;
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      expect(callbacks.onGroupDoubleClick).toHaveBeenCalledWith(1);
    });

    it('clicking delete button calls deleteGroup', () => {
      const deleteBtn = container.querySelector('.cp-btn-delete') as HTMLElement;
      deleteBtn.click();
      expect(callbacks.onGroupDelete).toHaveBeenCalledWith(1);
      expect(bridge.deleteGroup).toHaveBeenCalledWith(1);
    });

    it('clicking vis toggle calls toggleGroupVisibility', () => {
      const visToggle = container.querySelector('.cp-vis') as HTMLElement;
      visToggle.click();
      expect(bridge.toggleGroupVisibility).toHaveBeenCalledWith(1);
    });

    it('clicking lock toggle calls toggleGroupLock', () => {
      const lockToggle = container.querySelector('.cp-lock') as HTMLElement;
      lockToggle.click();
      expect(bridge.toggleGroupLock).toHaveBeenCalledWith(1);
    });
  });

  describe('refresh button', () => {
    it('refresh button triggers refresh', () => {
      panel.show();
      const refreshBtn = container.querySelector('.cp-btn-refresh') as HTMLElement;
      refreshBtn.click();
      // getAllGroups should be called twice: once on show, once on refresh click
      expect(bridge.getAllGroups).toHaveBeenCalledTimes(2);
    });
  });

  describe('dispose', () => {
    it('removes panel from DOM', () => {
      panel.dispose();
      expect(container.querySelector('#component-panel')).toBeNull();
    });
  });
});
