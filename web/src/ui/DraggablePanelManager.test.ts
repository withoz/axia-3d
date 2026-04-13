import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DraggablePanelManager } from './DraggablePanelManager';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

// Mock localStorage
const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
});

describe('DraggablePanelManager', () => {
  let manager: DraggablePanelManager;

  beforeEach(() => {
    document.body.innerHTML = '';
    Object.keys(store).forEach(k => delete store[k]);
    manager = new DraggablePanelManager();
  });

  describe('constructor', () => {
    it('creates manager without throwing', () => {
      expect(manager).toBeDefined();
    });

    it('initializes default panels', () => {
      // xia-inspector should be floating by default
      expect(manager.getPanelState('xia-inspector')).toBe('floating');
      expect(manager.getPanelState('style-panel')).toBe('floating');
      expect(manager.getPanelState('osnap-panel')).toBe('hidden');
    });
  });

  describe('getPanelState', () => {
    it('returns null for unknown panel', () => {
      expect(manager.getPanelState('nonexistent')).toBeNull();
    });

    it('returns state for known panel', () => {
      expect(manager.getPanelState('xia-inspector')).toBe('floating');
    });
  });

  describe('transition - DockRequest', () => {
    it('floating → docked is valid', () => {
      const result = manager.transition('xia-inspector', 'dock-request' as any, 'right' as any);
      expect(result).toBe(true);
      expect(manager.getPanelState('xia-inspector')).toBe('docked');
    });

    it('hidden → docked is invalid', () => {
      const result = manager.transition('osnap-panel', 'dock-request' as any);
      expect(result).toBe(false);
      expect(manager.getPanelState('osnap-panel')).toBe('hidden');
    });
  });

  describe('transition - UndockRequest', () => {
    it('docked → floating is valid', () => {
      manager.transition('xia-inspector', 'dock-request' as any, 'right' as any);
      const result = manager.transition('xia-inspector', 'undock-request' as any);
      expect(result).toBe(true);
      expect(manager.getPanelState('xia-inspector')).toBe('floating');
    });

    it('floating → undock is invalid', () => {
      const result = manager.transition('xia-inspector', 'undock-request' as any);
      expect(result).toBe(false);
    });
  });

  describe('transition - AutoHideRequest', () => {
    it('floating → auto-hide is valid', () => {
      const result = manager.transition('xia-inspector', 'auto-hide-request' as any);
      expect(result).toBe(true);
      expect(manager.getPanelState('xia-inspector')).toBe('auto-hide');
    });

    it('docked → auto-hide is valid', () => {
      manager.transition('xia-inspector', 'dock-request' as any);
      const result = manager.transition('xia-inspector', 'auto-hide-request' as any);
      expect(result).toBe(true);
      expect(manager.getPanelState('xia-inspector')).toBe('auto-hide');
    });
  });

  describe('transition - HideRequest', () => {
    it('floating → hidden is valid', () => {
      const result = manager.transition('xia-inspector', 'hide-request' as any);
      expect(result).toBe(true);
      expect(manager.getPanelState('xia-inspector')).toBe('hidden');
    });

    it('hidden → hidden is invalid (no-op)', () => {
      const result = manager.transition('osnap-panel', 'hide-request' as any);
      expect(result).toBe(false);
    });
  });

  describe('transition - ShowRequest', () => {
    it('hidden → floating is valid', () => {
      const result = manager.transition('osnap-panel', 'show-request' as any);
      expect(result).toBe(true);
      expect(manager.getPanelState('osnap-panel')).toBe('floating');
    });

    it('floating → show is invalid', () => {
      const result = manager.transition('xia-inspector', 'show-request' as any);
      expect(result).toBe(false);
    });
  });

  describe('transition - unknown panel', () => {
    it('returns false for unknown panel', () => {
      const result = manager.transition('nonexistent', 'hide-request' as any);
      expect(result).toBe(false);
    });
  });

  describe('registerAllPanels', () => {
    it('does not throw for missing DOM elements', () => {
      expect(() => manager.registerAllPanels(['xia-inspector', 'nonexistent'])).not.toThrow();
    });

    it('applies floating styles to panel element', () => {
      const el = document.createElement('div');
      el.id = 'xia-inspector';
      document.body.appendChild(el);

      manager.registerAllPanels(['xia-inspector']);

      expect(el.classList.contains('draggable-panel')).toBe(true);
      expect(el.classList.contains('state-floating')).toBe(true);
      expect(el.style.position).toBe('fixed');
    });
  });

  describe('expandAutoHidePanel / collapseAutoHidePanel', () => {
    it('adds expanded class', () => {
      const el = document.createElement('div');
      el.id = 'xia-inspector';
      document.body.appendChild(el);

      manager.expandAutoHidePanel('xia-inspector');
      expect(el.classList.contains('expanded')).toBe(true);
    });

    it('removes expanded class on collapse', () => {
      const el = document.createElement('div');
      el.id = 'xia-inspector';
      document.body.appendChild(el);

      manager.expandAutoHidePanel('xia-inspector');
      manager.collapseAutoHidePanel('xia-inspector');
      expect(el.classList.contains('expanded')).toBe(false);
    });

    it('collapseAutoHidePanel ignores different panel', () => {
      const el = document.createElement('div');
      el.id = 'xia-inspector';
      document.body.appendChild(el);

      manager.expandAutoHidePanel('xia-inspector');
      manager.collapseAutoHidePanel('style-panel'); // different panel
      expect(el.classList.contains('expanded')).toBe(true);
    });

    it('expanding new panel collapses previous', () => {
      const el1 = document.createElement('div');
      el1.id = 'xia-inspector';
      const el2 = document.createElement('div');
      el2.id = 'style-panel';
      document.body.appendChild(el1);
      document.body.appendChild(el2);

      manager.expandAutoHidePanel('xia-inspector');
      manager.expandAutoHidePanel('style-panel');

      expect(el1.classList.contains('expanded')).toBe(false);
      expect(el2.classList.contains('expanded')).toBe(true);
    });
  });

  describe('layout persistence', () => {
    it('saves layout to localStorage on state change', () => {
      const el = document.createElement('div');
      el.id = 'xia-inspector';
      document.body.appendChild(el);

      manager.transition('xia-inspector', 'hide-request' as any);
      expect(localStorage.setItem).toHaveBeenCalledWith('axia-panel-layout', expect.any(String));
    });

    it('loads layout from localStorage', () => {
      const layoutData = {
        version: 1,
        panels: [
          { id: 'xia-inspector', state: 'hidden', isVisible: false, floatingRect: { x: 100, y: 100, width: 300, height: 400 } },
        ],
        lastModified: Date.now(),
      };
      store['axia-panel-layout'] = JSON.stringify(layoutData);

      const mgr = new DraggablePanelManager();
      expect(mgr.getPanelState('xia-inspector')).toBe('hidden');
    });
  });

  describe('destroy', () => {
    it('saves layout and cleans up without error', () => {
      expect(() => manager.destroy()).not.toThrow();
      expect(localStorage.setItem).toHaveBeenCalled();
    });
  });
});
