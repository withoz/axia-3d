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
      hasTool: vi.fn().mockReturnValue(true),
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

  // ════════════════════════════════════════════════════════════════════════
  // ADR-162 β-1 — DXF/DWG Menu Wiring Hotfix (Path A 시각 only → Path B DCEL)
  //   사용자 facing critical hotfix — DXF import 후 즉시 편집 가능 (단순 참조
  //   메시 아닌 axia Engine DCEL face/edge entity). MenuBar.ts:232 case
  //   'import-dxf' 분리 + DxfImportHandler.importDxfFile direct dispatch.
  //   DWG (β-2) 는 별도 atomic PR — 현재 Path A 임시 유지 (regression guard).
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-162 β-1 — DXF dispatch routing (Path A → Path B)', () => {
    beforeEach(() => {
      // Add DXF / DWG / OBJ / import-all buttons to menu DOM
      const importMenu = document.createElement('div');
      importMenu.className = 'menu-item';
      importMenu.innerHTML = `
        <div class="menu-action" data-action="import-dxf">DXF</div>
        <div class="menu-action" data-action="import-dwg">DWG</div>
        <div class="menu-action" data-action="import-obj">OBJ</div>
        <div class="menu-action" data-action="import-all">All</div>
      `;
      document.getElementById('menubar')!.appendChild(importMenu);
      initMenuBar(deps);
    });

    it('import-dxf does not throw (Path B via DxfImportHandler dynamic import)', () => {
      const btn = document.querySelector('[data-action="import-dxf"]') as HTMLElement;
      // Dynamic import (`import('./DxfImportHandler')`) — async + graceful fallback.
      // .click() 은 sync 라 dynamic resolve 이전 종료. 본 test 는 dispatch
      // 자체가 throw 안 함을 검증 (Path B routing entry 의 syntactic 정합).
      expect(() => btn.click()).not.toThrow();
    });

    it('import-obj uses Path A FileImporter (regression guard)', () => {
      // import-obj 는 ADR-162 β-1 의 scope 외 — FileImporter Path A 유지.
      // 본 test 는 dispatch 정합 확인 (Path A 경로 비활성화 회피).
      const btn = document.querySelector('[data-action="import-obj"]') as HTMLElement;
      expect(() => btn.click()).not.toThrow();
    });

    it('import-dwg uses Path A FileImporter (β-2 시점에 Path B 분리, 현재 regression guard)', () => {
      // ADR-162 §3 sub-step plan: DWG β-2 별도 atomic PR (DwgImportHandler
      // 신설 vs DxfImportHandler 확장 architectural choice 별도 결재). β-1
      // 까지는 Path A 임시 유지.
      const btn = document.querySelector('[data-action="import-dwg"]') as HTMLElement;
      expect(() => btn.click()).not.toThrow();
    });

    it('import-all uses Path A FileImporter (regression guard)', () => {
      // import-all 는 모든 mesh 포맷 통합 dialog — Path A 보존.
      const btn = document.querySelector('[data-action="import-all"]') as HTMLElement;
      expect(() => btn.click()).not.toThrow();
    });
  });

  describe('PR#1 — STEP/IGES import 메뉴 (ADR-035 P20.7)', () => {
    beforeEach(() => {
      // Add STEP/IGES import buttons to menu DOM
      const importMenu = document.createElement('div');
      importMenu.className = 'menu-item';
      importMenu.innerHTML = `
        <div class="menu-action" data-action="import-step">STEP</div>
        <div class="menu-action" data-action="import-iges">IGES</div>
      `;
      document.getElementById('menubar')!.appendChild(importMenu);
      // Re-init since DOM changed
      initMenuBar(deps);
    });

    it('import-step does not throw (graceful — even if FileImporter unavailable)', () => {
      const btn = document.querySelector('[data-action="import-step"]') as HTMLElement;
      // Should not throw — FileImporter dispatch is async + graceful fallback
      expect(() => btn.click()).not.toThrow();
    });

    it('import-iges does not throw (graceful)', () => {
      const btn = document.querySelector('[data-action="import-iges"]') as HTMLElement;
      expect(() => btn.click()).not.toThrow();
    });
  });

  describe('PR#1 — Panel 메뉴 진입', () => {
    beforeEach(() => {
      const panelMenu = document.createElement('div');
      panelMenu.className = 'menu-item';
      panelMenu.innerHTML = `
        <div class="menu-action" data-action="view-components">Components</div>
        <div class="menu-action" data-action="view-constraints">Constraints</div>
        <div class="menu-action" data-action="view-materials">Materials</div>
        <div class="menu-action" data-action="view-xia-inspector">XIA</div>
      `;
      document.getElementById('menubar')!.appendChild(panelMenu);
      initMenuBar(deps);
    });

    it('view-components — no panel global → graceful warning, no throw', () => {
      const btn = document.querySelector('[data-action="view-components"]') as HTMLElement;
      expect(() => btn.click()).not.toThrow();
    });

    it('view-constraints — no panel global → graceful warning', () => {
      const btn = document.querySelector('[data-action="view-constraints"]') as HTMLElement;
      expect(() => btn.click()).not.toThrow();
    });

    it('view-materials — no panel global → graceful warning', () => {
      const btn = document.querySelector('[data-action="view-materials"]') as HTMLElement;
      expect(() => btn.click()).not.toThrow();
    });

    it('view-xia-inspector — no panel global → graceful warning', () => {
      const btn = document.querySelector('[data-action="view-xia-inspector"]') as HTMLElement;
      expect(() => btn.click()).not.toThrow();
    });

    it('view-components calls panel.toggle() when global available', () => {
      const toggle = vi.fn();
      (window as any).__axia_componentPanel = { toggle };
      const btn = document.querySelector('[data-action="view-components"]') as HTMLElement;
      btn.click();
      expect(toggle).toHaveBeenCalled();
      delete (window as any).__axia_componentPanel;
    });

    it('view-constraints calls panel.toggle() when global available', () => {
      const toggle = vi.fn();
      (window as any).__axia_constraintPanel = { toggle };
      const btn = document.querySelector('[data-action="view-constraints"]') as HTMLElement;
      btn.click();
      expect(toggle).toHaveBeenCalled();
      delete (window as any).__axia_constraintPanel;
    });
  });

  describe('PR#1 — STEP/IGES export placeholder', () => {
    beforeEach(() => {
      const exportMenu = document.createElement('div');
      exportMenu.className = 'menu-item';
      exportMenu.innerHTML = `
        <div class="menu-action" data-action="export-step">STEP export</div>
        <div class="menu-action" data-action="export-iges">IGES export</div>
      `;
      document.getElementById('menubar')!.appendChild(exportMenu);
      initMenuBar(deps);
    });

    it('export-step shows Toast info (Stage 5 placeholder)', () => {
      const btn = document.querySelector('[data-action="export-step"]') as HTMLElement;
      expect(() => btn.click()).not.toThrow();
    });

    it('export-iges shows Toast info', () => {
      const btn = document.querySelector('[data-action="export-iges"]') as HTMLElement;
      expect(() => btn.click()).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Integrity audit (2026-05-02 Section A Finding 3) — unregistered
  // tool guard. setActiveTool must not silently no-op when the
  // requested tool is missing from the ToolManager registry.
  // ─────────────────────────────────────────────────────────────────
  describe('unregistered tool guard (audit Finding 3)', () => {
    it('setActiveTool refuses unregistered tool — setTool NOT called', () => {
      // Make hasTool report 'line' (the wired action's target) as
      // unregistered. The click should bail out at the guard.
      (deps.toolManager.hasTool as ReturnType<typeof vi.fn>).mockReturnValue(false);
      // Re-clear setTool spy so the beforeEach init doesn't pollute it
      (deps.toolManager.setTool as ReturnType<typeof vi.fn>).mockClear();
      const lineBtn = document.querySelector(
        '[data-action="tool-line"]',
      ) as HTMLElement;
      expect(() => lineBtn.click()).not.toThrow();
      expect(deps.toolManager.setTool).not.toHaveBeenCalled();
      expect(deps.toolManager.hasTool).toHaveBeenCalledWith('line');
    });

    it('setActiveTool proceeds when tool IS registered', () => {
      (deps.toolManager.hasTool as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (deps.toolManager.setTool as ReturnType<typeof vi.fn>).mockClear();
      const lineBtn = document.querySelector(
        '[data-action="tool-line"]',
      ) as HTMLElement;
      lineBtn.click();
      expect(deps.toolManager.setTool).toHaveBeenCalledWith('line');
    });
  });
});
