import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initMenuBar, MenuBarDeps } from './MenuBar';

// Mock debug
vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

// Mock timestampedName
vi.mock('../export/ExportUtils', () => ({
  timestampedName: vi.fn().mockReturnValue('AXiA_3D_test.dxf'),
}));

// Mock BooleanHandler
vi.mock('./BooleanHandler', () => ({
  startBooleanOp: vi.fn(),
}));

function createMenuBarDOM(): void {
  document.body.innerHTML = `
    <div id="menubar">
      <div class="menu-item">
        <span>File</span>
        <div class="menu-dropdown">
          <div class="menu-action" data-action="file-new">New</div>
          <div class="menu-action" data-action="file-open">Open</div>
          <div class="menu-action" data-action="file-save">Save</div>
          <div class="menu-action" data-action="file-saveas">Save As</div>
        </div>
      </div>
      <div class="menu-item">
        <span>Edit</span>
        <div class="menu-dropdown">
          <div class="menu-action" data-action="undo">Undo</div>
          <div class="menu-action" data-action="redo">Redo</div>
          <div class="menu-action" data-action="delete">Delete</div>
          <div class="menu-action" data-action="select-all">Select All</div>
          <div class="menu-action" data-action="deselect">Deselect</div>
        </div>
      </div>
      <div class="menu-item">
        <span>View</span>
        <div class="menu-dropdown">
          <div class="menu-action" data-action="view-3d">3D</div>
          <div class="menu-action" data-action="view-top">Top</div>
          <div class="menu-action" data-action="view-home">Home</div>
          <div class="menu-action" data-action="view-grid">Grid</div>
        </div>
      </div>
      <div class="menu-item">
        <span>Draw</span>
        <div class="menu-dropdown">
          <div class="menu-action" data-action="tool-line">Line</div>
          <div class="menu-action" data-action="tool-rect">Rectangle</div>
          <div class="menu-action" data-action="tool-circle">Circle</div>
        </div>
      </div>
      <div class="menu-item">
        <span>Format</span>
        <div class="menu-dropdown">
          <div class="menu-action" data-action="format-osnap">OSNAP</div>
        </div>
      </div>
    </div>
    <div id="toolbar">
      <button class="tool-btn" data-tool="select">Select</button>
      <button class="tool-btn" data-tool="line">Line</button>
      <button class="tool-btn" data-tool="rect">Rect</button>
    </div>
    <div id="tool-label">Select</div>
    <div id="view-mode-bar">
      <button class="view-btn" data-view="3d">3D</button>
      <button class="view-btn" data-view="top">Top</button>
    </div>
  `;
}

function mockDeps(): MenuBarDeps {
  return {
    viewport: {
      scene: { children: [] },
      setViewMode: vi.fn(),
      resetCamera: vi.fn(),
      getStyleSettings: vi.fn().mockReturnValue({ gridVisible: true, axisVisible: true }),
      setGridVisible: vi.fn(),
      setAxisVisible: vi.fn(),
    } as any,
    bridge: {} as any,
    toolManager: {
      setTool: vi.fn(),
      executeAction: vi.fn(),
      selection: { clearSelection: vi.fn() },
    } as any,
    scene: { children: [] } as any,
    fileManager: {
      saveAsProject: vi.fn(),
    } as any,
    saveProject: vi.fn(),
    openProject: vi.fn(),
    openOsnapPanel: vi.fn(),
  };
}

describe('MenuBar', () => {
  let deps: ReturnType<typeof mockDeps>;

  beforeEach(() => {
    createMenuBarDOM();
    deps = mockDeps();
    initMenuBar(deps);
  });

  describe('initialization', () => {
    it('does not throw when menubar element exists', () => {
      expect(() => initMenuBar(deps)).not.toThrow();
    });

    it('does not throw when menubar element is missing', () => {
      document.body.innerHTML = '';
      expect(() => initMenuBar(deps)).not.toThrow();
    });
  });

  describe('menu open/close', () => {
    it('clicking menu item opens it', () => {
      const menuItem = document.querySelector('.menu-item') as HTMLElement;
      menuItem.click();
      expect(menuItem.classList.contains('open')).toBe(true);
    });

    it('clicking outside closes all menus', () => {
      const menuItem = document.querySelector('.menu-item') as HTMLElement;
      menuItem.click();
      document.dispatchEvent(new Event('click'));
      expect(menuItem.classList.contains('open')).toBe(false);
    });
  });

  describe('edit actions', () => {
    it('undo dispatches to toolManager', () => {
      const undoBtn = document.querySelector('[data-action="undo"]') as HTMLElement;
      undoBtn.click();
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('undo');
    });

    it('redo dispatches to toolManager', () => {
      const redoBtn = document.querySelector('[data-action="redo"]') as HTMLElement;
      redoBtn.click();
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('redo');
    });

    it('delete dispatches to toolManager', () => {
      const deleteBtn = document.querySelector('[data-action="delete"]') as HTMLElement;
      deleteBtn.click();
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('delete');
    });

    it('select-all dispatches to toolManager', () => {
      const btn = document.querySelector('[data-action="select-all"]') as HTMLElement;
      btn.click();
      expect(deps.toolManager.executeAction).toHaveBeenCalledWith('select-all');
    });

    it('deselect calls selection.clearSelection', () => {
      const btn = document.querySelector('[data-action="deselect"]') as HTMLElement;
      btn.click();
      expect(deps.toolManager.selection.clearSelection).toHaveBeenCalled();
    });
  });

  describe('draw tools', () => {
    it('tool-line sets line tool', () => {
      const btn = document.querySelector('[data-action="tool-line"]') as HTMLElement;
      btn.click();
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('line');
    });

    it('tool-rect sets rect tool', () => {
      const btn = document.querySelector('[data-action="tool-rect"]') as HTMLElement;
      btn.click();
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('rect');
    });

    it('tool-circle sets circle tool', () => {
      const btn = document.querySelector('[data-action="tool-circle"]') as HTMLElement;
      btn.click();
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('circle');
    });
  });

  describe('view actions', () => {
    it('view-3d sets 3d view mode', () => {
      const btn = document.querySelector('[data-action="view-3d"]') as HTMLElement;
      btn.click();
      expect(deps.viewport.setViewMode).toHaveBeenCalledWith('3d');
    });

    it('view-top sets top view mode', () => {
      const btn = document.querySelector('[data-action="view-top"]') as HTMLElement;
      btn.click();
      expect(deps.viewport.setViewMode).toHaveBeenCalledWith('top');
    });

    it('view-home resets camera', () => {
      const btn = document.querySelector('[data-action="view-home"]') as HTMLElement;
      btn.click();
      expect(deps.viewport.resetCamera).toHaveBeenCalled();
    });

    it('view-grid toggles grid visibility', () => {
      const btn = document.querySelector('[data-action="view-grid"]') as HTMLElement;
      btn.click();
      expect(deps.viewport.setGridVisible).toHaveBeenCalledWith(false); // was true, toggled
    });
  });

  describe('file actions', () => {
    it('file-save calls saveProject callback', () => {
      const btn = document.querySelector('[data-action="file-save"]') as HTMLElement;
      btn.click();
      expect(deps.saveProject).toHaveBeenCalled();
    });

    it('file-open calls openProject callback', () => {
      const btn = document.querySelector('[data-action="file-open"]') as HTMLElement;
      btn.click();
      expect(deps.openProject).toHaveBeenCalled();
    });

    it('file-saveas calls fileManager.saveAsProject', () => {
      const btn = document.querySelector('[data-action="file-saveas"]') as HTMLElement;
      btn.click();
      expect(deps.fileManager.saveAsProject).toHaveBeenCalled();
    });
  });

  describe('format actions', () => {
    it('format-osnap opens osnap panel', () => {
      const btn = document.querySelector('[data-action="format-osnap"]') as HTMLElement;
      btn.click();
      expect(deps.openOsnapPanel).toHaveBeenCalled();
    });
  });
});
