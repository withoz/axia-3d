/**
 * AXiA 3D — Main Entry Point
 *
 * Initializes WASM engine, Three.js viewport, and tool manager.
 * Phase 1 Refactor: Uses ServiceContainer for dependency injection instead of window.__axia_* globals.
 */

import { Viewport } from './viewport/Viewport';
import { SectionPlane } from './viewport/SectionPlane';
import { ScenesManager } from './ui/ScenesManager';
import { ToolManager } from './tools/ToolManagerRefactored';
import { WasmBridge } from './bridge/WasmBridge';
import { UnitSystem } from './units/UnitSystem';
import { SettingsPanel } from './units/SettingsPanel';
// FileImporter is now lazy-loaded via MenuBar (dynamic import on first use)
import { ComponentPanel } from './ui/ComponentPanel';
import { ConstraintPanel } from './ui/ConstraintPanel';
import { HistoryPanel } from './ui/HistoryPanel';
import { CapabilityExplorerPanel } from './ui/CapabilityExplorerPanel';
import { InvariantVerifierPanel } from './ui/InvariantVerifierPanel';
import { AuditLogViewerPanel } from './ui/AuditLogViewerPanel';
import { getAuditLog } from './core/AuditLog';
import { AnalyticHoverOverlay } from './core/AnalyticHoverOverlay';
import { SunPanel } from './ui/SunPanel';
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
import { Toast } from './ui/Toast';
import { getConsolePanel } from './ui/ConsolePanel';
import './ui/DraggablePanels.css';

// Install in-UI console panel as early as possible so any errors during
// app boot are captured and visible to the user without DevTools.
// (ADR-045 D5 — first cut of Debug Panel surface.)
getConsolePanel().install();

/**
 * Detect whether the WASM binary on the server is newer than the one the
 * previous page load cached. If so, show a non-intrusive Toast so the
 * developer (or the user after a deploy) knows a hard refresh will pull
 * in the latest engine. Implementation uses a HEAD request so we don't
 * download the full binary just to check its Last-Modified.
 */
async function checkWasmFreshness(): Promise<void> {
  try {
    const res = await fetch('/src/wasm/axia_wasm_bg.wasm', {
      method: 'HEAD',
      cache: 'no-store',
    });
    if (!res.ok) return;
    const lastMod = res.headers.get('last-modified');
    if (!lastMod) return;
    const storageKey = 'axia:wasm-mtime';
    const stored = localStorage.getItem(storageKey);
    if (stored && stored !== lastMod) {
      debugLog(`[WASM] Binary updated: ${stored} → ${lastMod}`);
      Toast.info(
        'AXiA 엔진이 업데이트됐습니다. 최신 기능이 적용됩니다.',
        4000,
      );
    }
    localStorage.setItem(storageKey, lastMod);
  } catch (e) {
    debugLog('[WASM] freshness check skipped:', e);
  }
}

async function main() {
  debugLog('AXiA 3D starting...');

  // 0. WASM freshness check (non-blocking, just logs + Toast if newer).
  //    Runs alongside engine init so no wall-clock impact.
  checkWasmFreshness();

  // 1. Initialize WASM engine
  const bridge = new WasmBridge();
  await bridge.init();

  // Phase 2 — auto-intersect-on-draw 설정 WASM 에 반영 (초기 + 변경 시)
  const { getAutoIntersect, onAutoIntersectChange } = await import('./tools/AutoIntersectSettings');
  if (bridge.isReady()) bridge.setAutoIntersectOnDraw(getAutoIntersect());
  onAutoIntersectChange((v) => {
    if (bridge.isReady()) bridge.setAutoIntersectOnDraw(v);
  });

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

  // ADR-082 C-ε — OCCT loader (bundled function, Vite static analysis 활용).
  //   `loadOcct()` 호출 시 Vite 가 build-time 에 분석한 opencascade-deps
  //   lazy chunk 가 fetch + execute 됨. Playwright E2E 도 본 entry 를
  //   통해 chunk 접근 (browser context 의 bare specifier resolve 우회).
  container.register('loadOcct', () => import('opencascade.js'));

  // ADR-083 T-δ — StepIgesImporter loader for E2E testing.
  //   Vite 가 StepIgesImporter chunk 를 hash-named 로 빌드하므로 Playwright
  //   page.evaluate 에서 direct path import 불가. Container entry 를 통해
  //   StepIgesImporter module 접근 (loadOcct 패턴 답습).
  container.register(
    'loadStepIgesImporter',
    () => import('./import/StepIgesImporter'),
  );

  // Export single container to window (replaces all window.__axia_* globals)
  (window as any).__axia = container;

  // ADR-012 telemetry — install BEFORE any draw/sync work happens.
  //   Lookups are guarded by `?.` so cost is ~0 when window props missing
  //   (tests, headless), and bound minimal closures otherwise.
  void import('./core/telemetry').then(({ installTelemetryGlobal }) => {
    installTelemetryGlobal();
  });
  // ADR-013 §1·§2 memory budget — installs window.__AXIA_MEMORY getter.
  // Other modules (SnapManager, BVH, History) can register samplers via
  // memoryBudget.registerSampler(area, () => byteCount) at any point.
  void import('./core/memory').then(async ({ installMemoryGlobal, memoryBudget }) => {
    installMemoryGlobal();
    // ADR-013 §3 — eviction policy. Register handlers per area.
    const { evictionPolicy, installEvictionGlobal } = await import('./core/eviction');
    installEvictionGlobal();
    // Telemetry buffer evict — clears violation/frame history.
    evictionPolicy.register('telemetry', 4, () => {
      const t = (window as any).__AXIA_TELEMETRY_RESET as (() => void) | undefined;
      if (!t) return 0;
      // Estimate bytes freed: ~50 bytes/violation × cap 1000 = 50KB max.
      t();
      return 50_000;
    });
    // History evict — drop oldest entries from OperationLog.
    evictionPolicy.register('history', 3, () => {
      const log = (container.tryGet?.('operationLog') as { clear?: () => void; getAll?: () => unknown[] } | undefined);
      if (!log?.clear) return 0;
      const before = (log.getAll?.() ?? []).length;
      log.clear();
      return before * 200;  // ~200 bytes/entry
    });
    // Three.js geometry size sampler.
    memoryBudget.registerSampler('geometry', () => {
      const vp = container.tryGet?.('viewport') as { meshGroup?: { traverse?: (cb: (o: any) => void) => void } } | undefined;
      let bytes = 0;
      vp?.meshGroup?.traverse?.((obj: any) => {
        const geo = obj.geometry;
        if (!geo || !geo.attributes) return;
        for (const attr of Object.values(geo.attributes) as Array<{ array?: { byteLength?: number } }>) {
          bytes += attr.array?.byteLength ?? 0;
        }
        if (geo.index?.array?.byteLength) bytes += geo.index.array.byteLength;
      });
      return bytes;
    });
    // History (OperationLog) size sampler.
    memoryBudget.registerSampler('history', () => {
      try {
        const log = (container.tryGet?.('operationLog') as { getAll?: () => unknown[] } | undefined);
        const arr = log?.getAll?.() ?? [];
        // Approximate: 200 bytes/entry (id, kind, name, params, ts, inputs, outputs).
        return arr.length * 200;
      } catch { return 0; }
    });
  });
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

  // ═══ Command Catalog — single source of truth for command metadata.
  //   NOT a new dispatcher — each entry's `execute` callback delegates
  //   into the existing ToolManager / MenuBar paths. Adding a new
  //   command still happens in ToolManagerRefactored.executeAction or
  //   MenuBar; the catalog just gathers the metadata so toolbar / menu
  //   / keyboard / palette can all consult one list.
  void import('./commands/AxiaCommands').then(({ registerAxiaCommands }) => {
    registerAxiaCommands({ toolManager });
  });
  // Command Palette — Ctrl+K / Ctrl+Shift+P opens a searchable list of every
  //   registered command (single visible surface for the catalog).
  void import('./ui/CommandPalette').then(({ bindCommandPaletteHotkey }) => {
    bindCommandPaletteHotkey();
  });

  // ═══ 4a. CAD Menu Bar — see ui/MenuBar.ts ═══
  initMenuBar({ viewport, bridge, toolManager, scene: viewport.scene, fileManager, saveProject, openProject, openOsnapPanel });

  // 4b. Wire toolbar buttons
  const toolbar = document.getElementById('toolbar');
  if (!toolbar) throw new Error('Missing #toolbar element');

  // 툴바 data-action 디스패치 헬퍼 — 대부분 executeAction 으로 가지만
  // bool-union/subtract/intersect는 BooleanHandler로 라우팅 필요 (메뉴와 동일).
  // 이 분기를 한 곳에 모아 버튼/드롭다운 양쪽에서 공통 사용.
  const dispatchToolbarAction = (action: string) => {
    if (action === 'bool-union' || action === 'bool-subtract' || action === 'bool-intersect') {
      const op = action.replace('bool-', '') as 'union' | 'subtract' | 'intersect';
      void import('./ui/BooleanHandler').then(({ startBooleanOp }) => {
        startBooleanOp({ bridge, toolManager }, op);
      });
      return;
    }
    toolManager.executeAction(action);
  };

  // 툴바 밖 클릭 시 열린 dropdown 모두 닫기
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.tool-dropdown')) {
      toolbar.querySelectorAll('.tool-dropdown.open').forEach(d => d.classList.remove('open'));
    }
  });

  // ═══ Dropdown 트리거 + 선택 핸들러 ═══
  toolbar.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // 드롭다운 trigger (▼ 버튼)
    const trigger = target.closest('.tool-dropdown-trigger') as HTMLElement;
    if (trigger) {
      e.stopPropagation();
      const dropdown = trigger.closest('.tool-dropdown') as HTMLElement;
      if (dropdown) {
        // 다른 열린 드롭다운 닫기
        toolbar.querySelectorAll('.tool-dropdown.open').forEach(d => {
          if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
      }
      return;
    }

    // 드롭다운 패널 안의 항목 선택
    const item = target.closest('.tool-dropdown-item') as HTMLElement;
    if (item) {
      const dropdown = item.closest('.tool-dropdown') as HTMLElement;

      // Action dropdown item (data-action) — dispatch action + close panel,
      // do NOT change active tool or swap the main button's icon.
      const itemAction = item.dataset.action;
      if (itemAction) {
        dropdown?.classList.remove('open');
        dispatchToolbarAction(itemAction);
        item.classList.add('flash');
        item.addEventListener('animationend', () => item.classList.remove('flash'), { once: true });
        return;
      }

      const tool = item.dataset.tool;
      if (tool && dropdown) {
        // 그룹 내 active 갱신
        dropdown.querySelectorAll('.tool-dropdown-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        // 대표 버튼의 data-tool 갱신 (다음 클릭이 이 도구를 선택하도록)
        const mainBtn = dropdown.querySelector('.tool-btn') as HTMLElement | null;
        if (mainBtn) {
          mainBtn.dataset.tool = tool;
          // 아이콘 교체 — 항목의 아이콘 SVG 복제
          const srcIcon = item.querySelector('.tdi-icon svg');
          if (srcIcon && mainBtn) {
            mainBtn.innerHTML = srcIcon.outerHTML;
          }
          mainBtn.title = (item.querySelector('.tdi-label')?.textContent ?? '') +
            ((item.querySelector('.tdi-key')?.textContent ?? '').length > 0
              ? ' (' + item.querySelector('.tdi-key')?.textContent + ')'
              : '');
        }
        dropdown.classList.remove('open');
        // 도구 활성화
        toolbar.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        if (mainBtn) mainBtn.classList.add('active');
        toolManager.setTool(tool);
        return;
      }
    }

    const btn = target.closest('.tool-btn') as HTMLElement;
    if (!btn) return;

    // Action button (data-action on the main tool-btn) — execute without
    // altering tool selection state. Used by Mirror / Revolve / Subdivide.
    const btnAction = btn.dataset.action;
    if (btnAction) {
      dispatchToolbarAction(btnAction);
      btn.classList.add('flash');
      btn.addEventListener('animationend', () => btn.classList.remove('flash'), { once: true });
      return;
    }

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
  initStylePanel({
    viewport,
    bridge,
    syncMesh: () => toolManager.syncMesh(),
  });

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

  // ═══ 15. History Panel (Tier 3B — Parametric History MVP) ═══
  {
    const historyPanel = new HistoryPanel(viewportEl, {
      rerun: (kind, params) => toolManager.rerunLoggedOperation(kind, params),
    });
    (window as unknown as { __axia_historyPanel?: HistoryPanel })
      .__axia_historyPanel = historyPanel;

    // 키보드 Shift+H → History Panel 토글
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if ((e.key === 'h' || e.key === 'H') && e.shiftKey && !e.ctrlKey && !e.altKey) {
        historyPanel.toggle();
      }
    });
  }

  // ═══ 15b. Capability Explorer Panel (ADR-063 Phase 1 Path Z) ═══
  // §D #1 lock-in: 단일 ActionCatalog 사용 사이트.
  // Step 2 scaffold + Step 3 tree/search + Step 4 invocation form.
  {
    const capabilityExplorerPanel = new CapabilityExplorerPanel(viewportEl, {
      // ADR-063 Step 4 — Action invocation dispatcher.
      // Tier 0 read 는 직접 WASM 호출, Tier 1/2 launcher 는 ToolManager
      // executeAction 경유. 알 수 없는 액션은 명시 거부.
      onActionInvoke: async (actionId, args) => {
        // ADR-069 Step 2 — audit capture wrap. Tier 정보 catalog 에서 조회.
        const allActions = CapabilityExplorerPanel.getAllActions();
        const def = allActions.find((a) => a.id === actionId);
        const tier = (def?.tier ?? 0) as 0 | 1 | 2 | 3;
        const audit = getAuditLog();
        try {
          // 1. Tier 0 read + Phase O Step 6 / P-narrow / Path Z direct dispatch.
          const eng = bridge.engine as unknown as Record<string, (...a: unknown[]) => unknown> | null;
          if (eng) {
            const directDispatch: Record<string, () => unknown> = {
              'edge-curve-info':       () => eng.getEdgeCurveJson?.(Number(args.edgeId)),
              'face-surface-info':     () => eng.getFaceSurfaceJson?.(Number(args.faceId)),
              'face-normals-cached':   () => {
                const arr = eng.getFaceNormalsCached?.(Number(args.faceId)) as Float64Array | undefined;
                return arr ? `Float64Array(len=${arr.length}): [${Array.from(arr.slice(0, 12)).join(', ')}${arr.length > 12 ? ', ...' : ''}]` : null;
              },
              'edge-polyline-cached':  () => {
                const arr = eng.getEdgePolylineCached?.(Number(args.edgeId), Number(args.chordTol ?? 0)) as Float64Array | undefined;
                return arr ? `Float64Array(len=${arr.length})` : null;
              },
              'cache-stats':           () => eng.getCacheStats?.(),
              'migrate-curve-surface': () => eng.migrateCurveSurfaceMandatory?.(),
              'fillet-dispatch':       () => eng.filletEdgeDispatchJson?.(Number(args.edgeId), Number(args.radius), Number(args.segments)),
            };
            const direct = directDispatch[actionId];
            if (direct) {
              const result = direct();
              const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
              audit.record({ actionId, tier, result: 'ok', args });
              return { ok: true, result: text ?? '(empty)' };
            }
          }
          // 2. Tier 1/2 launcher — ToolManager executeAction (existing tool dispatch).
          // executeAction is void — best-effort delegation. Unknown actions
          // surface via Toast (ToolManager internal warning).
          toolManager.executeAction(actionId);
          audit.record({ actionId, tier, result: 'ok', args });
          return { ok: true, result: 'Launched (existing tool dispatch).' };
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          audit.record({ actionId, tier, result: 'error', error: errMsg, args });
          return { ok: false, error: errMsg };
        }
      },
    });
    (window as unknown as { __axia_capabilityExplorer?: CapabilityExplorerPanel })
      .__axia_capabilityExplorer = capabilityExplorerPanel;
    // 단축키 보류 (D-C=(b) 메뉴만). Step 5 종합에서 단축키 결정.
  }

  // ═══ 15c. Invariant Verifier Panel (ADR-068 Phase 1 Path Y B pilot) ═══
  // §D #1 lock-in: WASM verifyInvariants 재사용 (ADR-007), 백엔드 신규 0.
  // §D #2 lock-in: Path Z scope — A/C/D sub-features 별도 ADR.
  {
    const invariantVerifierPanel = new InvariantVerifierPanel(viewportEl, {
      runVerify: () => bridge.verifyInvariants(),
      jumpToFace: (faceId: number) => {
        // ADR-068 §D #4 lock-in: jump = SelectionManager.selectFaces only.
        // Camera 이동은 Phase 2 enhancement.
        toolManager.selection.clearSelection?.();
        toolManager.selection.selectFaces([faceId]);
      },
    });
    (window as unknown as { __axia_invariantVerifier?: InvariantVerifierPanel })
      .__axia_invariantVerifier = invariantVerifierPanel;
  }

  // ═══ 15d. Audit Log Viewer Panel (ADR-069 Phase 1 Path Y A pilot) ═══
  // §D #1 lock-in: web-side audit (localStorage 'axia.auditLog').
  // §D #2 lock-in: P26.7 capture policy (Tier 0/1 success skip).
  {
    const auditLogViewerPanel = new AuditLogViewerPanel(viewportEl);
    (window as unknown as { __axia_auditLogViewer?: AuditLogViewerPanel })
      .__axia_auditLogViewer = auditLogViewerPanel;
  }

  // ═══ 15e. Analytic Hover Overlay (ADR-070 Phase 1 Path Y C pilot) ═══
  // §C #1 lock-in: DOM overlay only (Three.js 통합 별도 ADR).
  // §C #3 lock-in: hover read-only — selection / preselect 무관.
  {
    const analyticHoverOverlay = new AnalyticHoverOverlay(document.body, {
      getFaceSurfaceJson: (faceId: number) => {
        const eng = bridge.engine as unknown as { getFaceSurfaceJson?: (id: number) => string };
        return eng?.getFaceSurfaceJson?.(faceId) ?? null;
      },
      getEdgeCurveJson: (edgeId: number) => {
        const eng = bridge.engine as unknown as { getEdgeCurveJson?: (id: number) => string };
        return eng?.getEdgeCurveJson?.(edgeId) ?? null;
      },
    });
    (window as unknown as { __axia_analyticHoverOverlay?: AnalyticHoverOverlay })
      .__axia_analyticHoverOverlay = analyticHoverOverlay;

    // Mousemove → raf-throttled overlay update.
    // Uses faceMap (triangle → FaceId) and edgeMap (segment → EdgeId)
    // from the WasmBridge per ADR-037 Pick→Promote.
    viewportEl.addEventListener('mousemove', (e: MouseEvent) => {
      if (!analyticHoverOverlay.isEnabled()) return;
      const picked = viewport.pickEdgeOrFace(e.clientX, e.clientY, 5);
      let target: { kind: 'face' | 'edge'; id: number } | null = null;
      const tm = toolManager as unknown as {
        faceMap?: Uint32Array | null;
        edgeMap?: Uint32Array | null;
      };
      if (picked && picked.hit.faceIndex != null) {
        const idx = picked.hit.faceIndex;
        if (picked.type === 'face') {
          const fm = tm.faceMap;
          const fid = fm && idx >= 0 && idx < fm.length ? fm[idx] : -1;
          if (fid >= 0) target = { kind: 'face', id: fid };
        } else if (picked.type === 'edge') {
          const em = tm.edgeMap;
          const eid = em && idx >= 0 && idx < em.length ? em[idx] : -1;
          if (eid >= 0) target = { kind: 'edge', id: eid };
        }
      }
      analyticHoverOverlay.update({
        target,
        screenX: e.clientX,
        screenY: e.clientY,
      });
    });
    viewportEl.addEventListener('mouseleave', () => {
      analyticHoverOverlay.update({ target: null, screenX: 0, screenY: 0 });
    });
  }

  // ═══ 14b. Sun Panel (Phase 2 — 태양 방향 제어) ═══
  {
    const sunPanel = new SunPanel(viewportEl, {
      viewport,
      onSunChange: () => toolManager.syncMesh(),
    });
    (window as unknown as { __axia_sunPanel?: SunPanel })
      .__axia_sunPanel = sunPanel;

    // 키보드 Shift+U → Sun Panel 토글 (U alone은 Measure Tool)
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if ((e.key === 'u' || e.key === 'U') && e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        sunPanel.toggle();
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

  // ═══ 15. Toolbar toggle-state sync ═══
  // Phase 1: Inspector/Style/Settings 버튼의 .active 클래스를 실제 패널 상태에
  //   바인딩. MutationObserver로 패널 DOM 변화(class/style)를 감시 → 버튼 갱신.
  // Phase 2: 새 display 토글 버튼(grid/AO/shadow) 클릭 → 대응 setter 호출 +
  //   상태를 .active 클래스로 반영.
  wireToolbarToggleState(viewport, toolManager);

  // Section plane — 단축키 F2로 간단 prompt 기반 토글.
  const sectionPlane = new SectionPlane(viewport);
  (window as unknown as { __axia_section?: SectionPlane }).__axia_section = sectionPlane;

  // Scenes (saved views) — 토글식 floating panel.
  const scenesManager = new ScenesManager(viewportEl, viewport, sectionPlane);
  (window as unknown as { __axia_scenes?: ScenesManager }).__axia_scenes = scenesManager;

  // Solar heatmap — lazy init on first menu use.
  (window as unknown as { __axia_solarHeatmap?: {
    viewport: typeof viewport; bridge: typeof bridge;
  } }).__axia_solarHeatmap = { viewport, bridge };

  debugLog('AXiA 3D ready. OSNAP: F3=Toggle, R=Rect, P=Push/Pull, I=Inspector, O=Outliner, J=Constraints');
}

/** Phase 1 + Phase 2 — 툴바 버튼이 실제 상태(켜짐/꺼짐)를 시각적으로 반영하게
 *  묶어주는 배선. 패널 세 개는 MutationObserver, display 토글 세 개는 클릭
 *  리스너 + 초기 동기화로 처리. */
function wireToolbarToggleState(viewport: Viewport, toolManager: ToolManager): void {
  // ── Phase 1: 패널 버튼 3개 ──
  const panelBindings: Array<{ btnId: string; panelId: string; isOpen: (p: HTMLElement) => boolean }> = [
    { btnId: 'inspector-btn', panelId: 'xia-inspector', isOpen: (p) => p.classList.contains('open') },
    { btnId: 'style-btn',     panelId: 'style-panel',   isOpen: (p) => p.classList.contains('open') },
    { btnId: 'settings-btn',  panelId: 'settings-panel', isOpen: (p) => p.style.display !== 'none' && p.style.display !== '' },
  ];
  for (const { btnId, panelId, isOpen } of panelBindings) {
    const btn = document.getElementById(btnId);
    if (!btn) continue;
    const syncFromPanel = () => {
      const panel = document.getElementById(panelId);
      // settings-panel은 클릭 시 lazily 생성되므로 초기엔 없을 수 있음.
      btn.classList.toggle('active', !!panel && isOpen(panel));
    };
    // 패널 존재 여부와 상관없이 document.body 전체를 관찰하면 동적 생성도 캐치.
    const observer = new MutationObserver(syncFromPanel);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
      childList: true,
    });
    syncFromPanel();
  }

  // ── Phase 2: display 토글 버튼 3개 ──
  const displayToggles: Array<{ key: string; get: () => boolean; set: (v: boolean) => void }> = [
    {
      key: 'grid',
      get: () => viewport.infiniteGrid.visible,
      set: (v) => viewport.setGridVisible(v),
    },
    {
      key: 'ssao',
      get: () => viewport.isSsaoEnabled(),
      set: (v) => viewport.setSsaoEnabled(v),
    },
    {
      key: 'shadow',
      get: () => viewport.isProjectedShadowEnabled(),
      set: (v) => {
        viewport.setProjectedShadowEnabled(v);
        // 그림자 켤 때 즉시 geometry 계산 필요 (MenuBar와 동일한 흐름).
        if (v) toolManager.syncMesh();
      },
    },
  ];
  for (const { key, get, set } of displayToggles) {
    const btn = document.querySelector(`.toggle-btn[data-toggle="${key}"]`) as HTMLElement | null;
    if (!btn) continue;
    const sync = () => btn.classList.toggle('active', get());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      set(!get());
      sync();
    });
    sync();
  }
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
