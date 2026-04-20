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
// FileImporter is now lazy-loaded via MenuBar (dynamic import on first use)
import { ComponentPanel } from './ui/ComponentPanel';
import { ConstraintPanel } from './ui/ConstraintPanel';
import { ConstraintVisual } from './ui/ConstraintVisual';
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
import { StatusBar } from './ui/StatusBar';
import { initContextMenu } from './ui/ContextMenu';
import { loadInitialScene } from './ui/InitialScene';
import { initXiaInspector } from './ui/XiaInspector';
import { debugLog } from './utils/debug';
import './ui/DraggablePanels.css';

async function main() {
  debugLog('AXiA 3D starting...');

  // 1. Initialize WASM engine
  const bridge = new WasmBridge();
  await bridge.init();

  // Note: WASM is optional for basic Three.js rendering (e.g., Sphere tool)
  // Continue even if WASM fails to initialize
  if (!bridge.isReady()) {
    console.warn('⚠ WASM engine not ready - continuing with basic Three.js mode');
  } else {
    debugLog('WASM engine ready');
  }

  // 2. Initialize viewport (always required)
  const viewportEl = document.getElementById('viewport');
  if (!viewportEl) throw new Error('Missing #viewport element');
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

  // 3b. Initialize file manager (FileImporter is lazy-loaded on first import)
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
  debugLog('[Main] ServiceContainer initialized with services:', container.keys());

  // Register commands (line, help, backtick toggle)
  initCommandRegistry({ commandInput, bridge, toolManager });

  // ═══ 4-0. 초기 씬 로드 — see ui/InitialScene.ts ═══
  loadInitialScene({ bridge, fileManager, toolManager, updateFileStatus });

  // ═══ Selection status bar update ═══
  // Phase H 이후 status bar는 coords + F-keys에 집중.
  // "Selected: N" 정보는 XIA Inspector에서 이미 확인 가능하므로 status bar에
  // 반영하지 않음 (이전 코드는 overflow 유발).
  toolManager.selection.onChange((_faces) => {
    // 기존 stat-sel-wrap은 숨김 유지 (legacy 호환 목적으로 DOM은 유지)
  });

  // 5a. OSNAP toggle — 레거시(stat-osnap) 유지 + 새 StatusBar 연동
  const osnapToggle = document.getElementById('osnap-toggle');
  const statOsnap = document.getElementById('stat-osnap');

  const updateOsnapUI = () => {
    const on = toolManager.snap.enabled;
    if (statOsnap) {
      statOsnap.textContent = on ? 'ON' : 'OFF';
      statOsnap.style.color = on ? '#44ff88' : '#ff4444';
    }
    // 새 상태바 F3 버튼도 동기화
    statusBar.setToggle('sb-fkey-osnap', on);
  };

  if (osnapToggle) {
    osnapToggle.addEventListener('click', () => {
      toolManager.snap.toggle();
      updateOsnapUI();
    });
  }

  // ═══ 새 상태바: 좌표 추적 + F1~F7 아이콘 바 + 커맨드바 우측 유틸 ═══
  const statusBar = new StatusBar({
    viewport,
    units,
    snap: toolManager.snap,
    openSettings: () => settingsPanel.toggle(),
  });
  statusBar.syncFromViewport();

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
  initMenuBar({ viewport, bridge, toolManager, scene: viewport.scene, fileManager, saveProject, openProject, openOsnapPanel });

  // 4b. Wire toolbar buttons
  const toolbar = document.getElementById('toolbar');
  if (!toolbar) throw new Error('Missing #toolbar element');
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

  const statsIntervalId = setInterval(() => {
    const stats = bridge.getStats();
    const sv = document.getElementById('stat-verts');
    const sf = document.getElementById('stat-faces');
    const st = document.getElementById('stat-tool');
    if (sv) sv.textContent = String(stats.verts);
    if (sf) sf.textContent = String(stats.faces);
    if (st) st.textContent = toolManager.currentTool;

    // Undo/Redo 버튼 활성/비활성 (canUndo/canRedo가 없으면 항상 활성)
    if (undoBtn) undoBtn.classList.toggle('disabled', stats.canUndo === false);
    if (redoBtn) redoBtn.classList.toggle('disabled', stats.canRedo === false);
  }, 200);

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    clearInterval(statsIntervalId);
    viewport.stop();
    viewport.dispose();
  });

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
          debugLog(`[ComponentPanel] Group-${groupId} selected`);
        },
        onGroupDoubleClick: (groupId) => {
          toolManager.selection.enterGroupEdit(groupId);
          debugLog(`[ComponentPanel] Group-${groupId} edit mode`);
        },
        onGroupDelete: (groupId) => {
          debugLog(`[ComponentPanel] Group-${groupId} deleted`);
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

  // ═══ 14. Constraint Panel (파라메트릭 제약 목록) ═══
  {
    const constraintPanel = new ConstraintPanel(
      viewportEl,
      bridge,
      {
        syncMesh: () => toolManager.syncMesh(),
      },
    );
    // 전역 노출 — ToolManager가 제약 변경 후 refresh 호출하도록 함
    (window as unknown as { __axia_constraintPanel?: ConstraintPanel })
      .__axia_constraintPanel = constraintPanel;

    // 키보드 J → Constraint Panel 토글 ('K'는 Inference Lock에서 사용 중)
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if ((e.key === 'j' || e.key === 'J') && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        constraintPanel.toggle();
      }
    });
  }

  // ═══ 15. Constraint Visual (3D 뷰포트 제약 인디케이터) ═══
  {
    const constraintVisual = new ConstraintVisual(viewportEl, bridge);
    (window as unknown as { __axia_constraintVisual?: ConstraintVisual })
      .__axia_constraintVisual = constraintVisual;

    // 매 프레임 업데이트 (카메라 이동 시 마커 위치 즉시 추적)
    const tickCV = () => {
      constraintVisual.update(viewport.activeCamera);
      requestAnimationFrame(tickCV);
    };
    requestAnimationFrame(tickCV);

    // Shift+J → 인디케이터 토글
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if ((e.key === 'j' || e.key === 'J') && e.shiftKey && !e.ctrlKey && !e.altKey) {
        constraintVisual.toggle();
      }
    });
  }

  debugLog('AXiA 3D ready. OSNAP: F3=Toggle, R=Rect, P=Push/Pull, I=Inspector, O=Outliner, J=Constraints');
}

main().catch((err) => {
  console.error('[AXiA 3D] Fatal startup error:', err);
  // Show visible error to user instead of blank screen
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    background:#1a1a2e;color:#ff6b6b;padding:32px;border-radius:12px;
    font-family:'Segoe UI',sans-serif;text-align:center;z-index:99999;
    border:1px solid #ff6b6b33;max-width:480px;
  `;
  errorDiv.innerHTML = `
    <h2 style="margin:0 0 12px">AXiA 3D 시작 실패</h2>
    <p style="color:#ccc;margin:0 0 16px">${err instanceof Error ? err.message : String(err)}</p>
    <button onclick="location.reload()" style="
      background:#4ac1ff;color:#fff;border:none;padding:8px 24px;
      border-radius:6px;cursor:pointer;font-size:14px;
    ">새로고침</button>
  `;
  document.body.appendChild(errorDiv);
});
