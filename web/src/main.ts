/**
 * AXiA 3D — Main Entry Point
 *
 * Initializes WASM engine, Three.js viewport, and tool manager.
 * Phase 1 Refactor: Uses ServiceContainer for dependency injection instead of window.__axia_* globals.
 */

import { Viewport } from './viewport/Viewport';
import { ToolManager } from './tools/ToolManagerRefactored';
import { WasmBridge } from './bridge/WasmBridge';
import { UnitSystem } from './units/UnitSystem';
import { SettingsPanel } from './units/SettingsPanel';
import { FileImporter } from './import/FileImporter';
import { ComponentPanel } from './ui/ComponentPanel';
import { FileManager } from './file/FileManager';
import { MaterialLibrary } from './materials/MaterialLibrary';
import { DraggablePanelManager } from './ui/DraggablePanelManager';
import { CommandInput } from './ui/CommandInput';
import { ServiceContainer } from './core/ServiceContainer';
import { initCommandRegistry } from './ui/CommandRegistry';
import { initOsnapPanel } from './ui/OsnapPanel';
import { initStylePanel } from './ui/StylePanel';
import { initProjectSerializer } from './ui/ProjectSerializer';
import { initMenuBar } from './ui/MenuBar';
import { initVCB } from './ui/VCB';
import { initKeyboardShortcuts } from './ui/KeyboardShortcuts';
import { initContextMenu } from './ui/ContextMenu';
import { loadInitialScene } from './ui/InitialScene';
import { initXiaInspector } from './ui/XiaInspector';
import './ui/DraggablePanels.css';

async function main() {
  console.log('AXiA 3D starting...');

  // 1. Initialize WASM engine
  const bridge = new WasmBridge();
  await bridge.init();

  // Note: WASM is optional for basic Three.js rendering (e.g., Sphere tool)
  // Continue even if WASM fails to initialize
  if (!bridge.isReady()) {
    console.warn('⚠ WASM engine not ready - continuing with basic Three.js mode');
  } else {
    console.log('✓ WASM engine ready');
  }

  // 2. Initialize viewport (always required)
  const viewportEl = document.getElementById('viewport')!;
  const viewport = new Viewport(viewportEl);

  // 3. Initialize unit system & settings
  const units = new UnitSystem();
  const settingsPanel = new SettingsPanel(units);

  // Settings button
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsPanel.toggle();
    });
  }

  // 3b. Initialize file importer
  const fileImporter = new FileImporter(viewport.scene);

  // 3c. Initialize file manager
  const fileManager = new FileManager(bridge);

  // 3d. Initialize material library and link to file manager
  const materialLibrary = new MaterialLibrary();
  fileManager.setMaterialLibrary(materialLibrary);

  // 3e. Initialize draggable panel manager
  const panelManager = new DraggablePanelManager();
  panelManager.registerAllPanels([
    'xia-inspector',
    'style-panel',
    'osnap-panel',
  ]);

  // 4. Initialize service container (Phase 1: Dependency Injection)
  const container = new ServiceContainer();

  // Register core services
  container.register('bridge', bridge);
  container.register('viewport', viewport);
  container.register('units', units);
  container.register('panelManager', panelManager);
  container.register('fileManager', fileManager);
  container.register('materialLibrary', materialLibrary);
  container.register('fileImporter', fileImporter);

  // 파일명 상태바 업데이트 함수
  const updateFileStatus = (fileName: string) => {
    const statFileEl = document.getElementById('stat-file');
    if (statFileEl) {
      statFileEl.textContent = fileName;
    }
  };

  // FileManager 파일명 변경 콜백 등록
  fileManager.onFileChange(() => updateFileStatus(fileManager.getCurrentFileName()));

  // 초기 파일명 표시
  updateFileStatus(fileManager.getCurrentFileName());

  // 단위 변경 시 그리드 간격 업데이트
  const updateGridForUnit = () => {
    // 내부 단위는 항상 mm, 그리드는 단위에 맞게 조정
    // mm: 1mm / 5mm, cm: 10mm / 50mm, m: 1000mm / 5000mm
    // in: 25.4mm / 127mm, ft: 304.8mm / 1524mm
    // 건축 스케일: 내부 단위 mm
    const gridMap: Record<string, [number, number]> = {
      mm: [1000, 5000],      // 1m / 5m 간격
      cm: [1000, 5000],      // 1m / 5m 간격
      m:  [1000, 5000],      // 1m / 5m 간격
      in: [25.4 * 12, 25.4 * 60],  // 1ft / 5ft 간격
      ft: [304.8, 304.8 * 5],      // 1ft / 5ft 간격
    };
    const [small, big] = gridMap[units.unit] || [1, 5];
    viewport.updateGridSpacing(small, big);
  };
  units.onChange(updateGridForUnit);
  updateGridForUnit();

  // Initialize tool manager (connects bridge ↔ viewport ↔ units)
  const toolManager = new ToolManager(viewport, bridge, units);
  container.register('toolManager', toolManager);

  // Initialize command input (CAD-style commands)
  const commandInput = new CommandInput();
  container.register('commandInput', commandInput);

  // Export single container to window (replaces all window.__axia_* globals)
  (window as any).__axia = container;
  console.log('[Main] ServiceContainer initialized with services:', container.keys());

  // Register commands (line, help, backtick toggle)
  initCommandRegistry({ commandInput, bridge, toolManager });

  // ═══ 4-0. 초기 씬 로드 — see ui/InitialScene.ts ═══
  loadInitialScene({ bridge, fileManager, toolManager, updateFileStatus });

  // ═══ Selection status bar update ═══
  toolManager.selection.onChange((faces) => {
    const wrap = document.getElementById('stat-sel-wrap');
    const el = document.getElementById('stat-selected');
    if (wrap && el) {
      if (faces.length > 0) {
        wrap.style.display = '';
        el.textContent = String(faces.length);
      } else {
        wrap.style.display = 'none';
      }
    }
  });

  // 5a. OSNAP toggle (F3) and status bar click
  const osnapToggle = document.getElementById('osnap-toggle');
  const statOsnap = document.getElementById('stat-osnap');

  const updateOsnapUI = () => {
    const on = toolManager.snap.enabled;
    if (statOsnap) {
      statOsnap.textContent = on ? 'ON' : 'OFF';
      statOsnap.style.color = on ? '#44ff88' : '#ff4444';
    }
  };

  if (osnapToggle) {
    osnapToggle.addEventListener('click', () => {
      toolManager.snap.toggle();
      updateOsnapUI();
    });
  }

  // ═══ OSNAP 설정 패널 (제도 설정값) — MenuBar/ContextMenu보다 먼저 초기화 ═══
  const osnapAPI = initOsnapPanel({
    snap: toolManager.snap,
    snapVisual: toolManager.snapVisual,
    updateOsnapUI,
  });
  const { openOsnapPanel } = osnapAPI;

  // ═══ Project Save/Load (.xia) — MenuBar/KeyboardShortcuts보다 먼저 초기화 ═══
  const { saveProject, openProject } = initProjectSerializer({ bridge, viewport, toolManager, units });

  // ═══ 4a. CAD Menu Bar — see ui/MenuBar.ts ═══
  initMenuBar({ viewport, bridge, toolManager, fileImporter, fileManager, saveProject, openProject, openOsnapPanel });

  // 4b. Wire toolbar buttons
  const toolbar = document.getElementById('toolbar')!;
  toolbar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.tool-btn') as HTMLElement;
    if (!btn) return;

    const tool = btn.dataset.tool;
    if (!tool) return;

    if (tool === 'undo' || tool === 'redo') {
      toolManager.executeAction(tool);
      // 클릭 플래시 효과
      btn.classList.add('flash');
      btn.addEventListener('animationend', () => btn.classList.remove('flash'), { once: true });
      return;
    }

    toolbar.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    toolManager.setTool(tool);

    // Update tool label
    const toolLabel = document.getElementById('tool-label');
    if (toolLabel) {
      const names: Record<string, string> = {
        select: 'Select', line: 'Line', rect: 'Rectangle',
        circle: 'Circle', pushpull: 'Push/Pull', move: 'Move',
        rotate: 'Rotate', scale: 'Scale', offset: 'Offset',
        sphere: 'Sphere', cylinder: 'Cylinder', cone: 'Cone',
      };
      toolLabel.textContent = names[tool] || tool;
    }
  });

  // 5+6. Keyboard Shortcuts + View Mode — see ui/KeyboardShortcuts.ts
  const viewModeBar = document.getElementById('view-mode-bar');

  // 7. Start render loop
  viewport.start();

  // 8. Status bar updates
  const statUnit = document.getElementById('stat-unit')!;
  const statPrec = document.getElementById('stat-prec')!;
  units.onChange(() => {
    statUnit.textContent = units.config.label;
    statPrec.textContent = String(units.precision);
  });
  // 초기값 설정
  statUnit.textContent = units.config.label;
  statPrec.textContent = String(units.precision);

  const undoBtn = toolbar.querySelector('[data-tool="undo"]');
  const redoBtn = toolbar.querySelector('[data-tool="redo"]');

  setInterval(() => {
    const stats = bridge.getStats();
    document.getElementById('stat-verts')!.textContent = String(stats.verts);
    document.getElementById('stat-faces')!.textContent = String(stats.faces);
    document.getElementById('stat-tool')!.textContent = toolManager.currentTool;

    // Undo/Redo 버튼 활성/비활성 (canUndo/canRedo가 없으면 항상 활성)
    if (undoBtn) undoBtn.classList.toggle('disabled', stats.canUndo === false);
    if (redoBtn) redoBtn.classList.toggle('disabled', stats.canRedo === false);
  }, 200);

  // 9. VCB (Value Control Box) — see ui/VCB.ts
  initVCB({ toolManager, units });

  // ═══ Context Menu — see ui/ContextMenu.ts ═══
  initContextMenu({ viewport, bridge, toolManager, viewModeBar, openOsnapPanel });

  // Keyboard Shortcuts (depends on saveProject/openProject)
  initKeyboardShortcuts({ toolManager, viewport, toolbar, viewModeBar, saveProject, openProject });

  // ═══ 11. Style Side Panel — see ui/StylePanel.ts ═══
  initStylePanel({ viewport });

  // ═══ 12. XIA Inspector Panel — see ui/XiaInspector.ts ═══
  await initXiaInspector({ bridge, viewport, toolManager });

  // ═══ 13. Component Panel (그룹/컴포넌트 아웃라이너) ═══
  {
    const componentPanel = new ComponentPanel(
      viewportEl,
      bridge,
      toolManager.selection,
      {
        onGroupSelect: (groupId) => {
          toolManager.selection.selectGroup(groupId);
          console.log(`[ComponentPanel] Group-${groupId} selected`);
        },
        onGroupDoubleClick: (groupId) => {
          toolManager.selection.enterGroupEdit(groupId);
          console.log(`[ComponentPanel] Group-${groupId} edit mode`);
        },
        onGroupDelete: (groupId) => {
          console.log(`[ComponentPanel] Group-${groupId} deleted`);
        },
        onRefresh: () => {
          // 선택된 면으로 그룹 생성
          toolManager.executeAction('group');
          componentPanel.refresh();
        },
      },
    );

    // 키보드 O → Component Panel 토글
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'o' || e.key === 'O') {
        if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
          componentPanel.toggle();
        }
      }
    });

    // Selection 변경 시 패널 갱신
    toolManager.selection.onChange(() => {
      componentPanel.refresh();
    });
  }

  console.log('AXiA 3D ready. OSNAP: F3=Toggle, R=Rect, P=Push/Pull, I=Inspector, O=Outliner');
}

main().catch(console.error);
