/**
 * AXiA 3D — Main Entry Point
 *
 * Initializes WASM engine, Three.js viewport, and tool manager.
 * Phase 1 Refactor: Uses ServiceContainer for dependency injection instead of window.__axia_* globals.
 */

import { Viewport, ViewMode } from './viewport/Viewport';
import { ToolManager } from './tools/ToolManagerRefactored';
import { WasmBridge } from './bridge/WasmBridge';
import { UnitSystem } from './units/UnitSystem';
import { SettingsPanel } from './units/SettingsPanel';
import { FileImporter, ImportFormat } from './import/FileImporter';
import { DxfExporter } from './export/DxfExporter';
import { ComponentPanel } from './ui/ComponentPanel';
import { FileManager } from './file/FileManager';
import { MaterialLibrary } from './materials/MaterialLibrary';
import { DraggablePanelManager } from './ui/DraggablePanelManager';
import { CommandInput } from './ui/CommandInput';
import { ServiceContainer } from './core/ServiceContainer';
import { initCommandRegistry } from './ui/CommandRegistry';
import { initOsnapPanel } from './ui/OsnapPanel';
import { initStylePanel } from './ui/StylePanel';
import { importDxfFile } from './ui/DxfImportHandler';
import { startBooleanOp } from './ui/BooleanHandler';
import { initProjectSerializer } from './ui/ProjectSerializer';
import { initVCB } from './ui/VCB';
import { initKeyboardShortcuts } from './ui/KeyboardShortcuts';
import { initContextMenu } from './ui/ContextMenu';
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

  // Setup file operation handlers (will reference services from container)
  // These are called by UI, so we keep them on window for HTML onclick handlers
  (window as any).__axia_open = async () => {
    const fm = container.get<FileManager>('fileManager');
    const tm = container.get<ToolManager>('toolManager');
    const success = await fm.openProject();
    if (success) {
      tm.syncMesh();
    }
  };

  (window as any).__axia_save = async () => {
    const fm = container.get<FileManager>('fileManager');
    await fm.saveProject();
  };

  // 파일명 상태바 업데이트 함수
  const updateFileStatus = (fileName: string) => {
    const statFileEl = document.getElementById('stat-file');
    if (statFileEl) {
      statFileEl.textContent = fileName;
    }
  };

  // FileManager에 콜백 추가 (파일 열기/저장 후 업데이트)
  const originalOpenProject = fileManager.openProject.bind(fileManager);
  fileManager.openProject = async () => {
    const success = await originalOpenProject();
    if (success) {
      updateFileStatus(fileManager.getCurrentFileName());
    }
    return success;
  };

  const originalSaveProject = fileManager.saveProject.bind(fileManager);
  fileManager.saveProject = async (fileName?: string) => {
    const success = await originalSaveProject(fileName);
    if (success) {
      updateFileStatus(fileManager.getCurrentFileName());
    }
    return success;
  };

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

  // ═══ 4-0. 초기 씬: 저장된 프로젝트 파일 로드 ═══
  {
    console.log('[Init] Loading initial scene from saved project...');

    // 저장된 프로젝트 파일 로드
    fetch('/assets/AXiA_Project_2026-04-13.xia')
      .then(response => {
        if (!response.ok) throw new Error('Failed to load initial scene file');
        return response.arrayBuffer();
      })
      .then(arrayBuffer => {
        const fileData = new Uint8Array(arrayBuffer);
        console.log(`[Init] Initial scene file loaded: ${fileData.length} bytes`);

        // FileManager의 파일 파싱 로직 재사용
        const AXIA_MAGIC = 0x41584941;  // 'AXIA'
        // Version 호환성: v1, v2 모두 지원
        const SUPPORTED_VERSIONS = [1, 2];
        
        if (fileData.length < 12) {
          throw new Error('Invalid file format');
        }

        let offset = 0;

        // magic 확인
        const magicView = new DataView(fileData.buffer, offset, 4);
        const magic = magicView.getUint32(0, true);
        if (magic !== AXIA_MAGIC) {
          throw new Error('Invalid AXIA file');
        }
        offset += 4;

        // version 확인 (v1, v2 모두 지원)
        const versionView = new DataView(fileData.buffer, offset, 4);
        const version = versionView.getUint32(0, true);
        if (!SUPPORTED_VERSIONS.includes(version)) {
          throw new Error(`Unsupported version: ${version} (supported: ${SUPPORTED_VERSIONS.join(', ')})`);
        }
        console.log(`[Init] File version: ${version}`);
        offset += 4;
        
        // metadata 길이 읽기
        const lenView = new DataView(fileData.buffer, offset, 4);
        const metadataLen = lenView.getUint32(0, true);
        offset += 4;
        
        // metadata 파싱
        const metadataBytes = fileData.slice(offset, offset + metadataLen);
        const metadataJson = new TextDecoder().decode(metadataBytes);
        const metadata = JSON.parse(metadataJson);
        offset += metadataLen;
        
        // snapshot 추출
        const snapshot = fileData.slice(offset);
        
        console.log('[Init] Metadata:', metadata);
        console.log(`[Init] Snapshot size: ${snapshot.length} bytes`);
        
        // 스냅샷 로드
        const success = bridge.importSnapshot(snapshot);
        if (success) {
          // 파일명 업데이트 (.xia 확장자 보장)
          const filename = metadata.name || 'untitled';
          const finalName = filename.endsWith('.xia') ? filename : `${filename}.xia`;
          fileManager.setCurrentFileName(finalName);
          updateFileStatus(fileManager.getCurrentFileName());
          
          console.log('[Init] Initial scene loaded successfully');
        } else {
          console.error('[Init] Failed to import snapshot');
        }
        
        // 메시 동기화
        toolManager.syncMesh();
      })
      .catch(err => {
        console.error('[Init] Failed to load initial scene:', err);
        console.log('[Init] Creating fallback scene with default shapes...');
        
        // Fallback: 기본 도형 생성 (파일 로드 실패 시)
        try {
          const cylinderId = bridge.create_cylinder?.(-12000, 3000, 0, 5000, 8000, 24);
          const expectedFaceId = bridge.faceCount();
          const boxId = bridge.drawRect(0, 0, 0, 0, 1, 0, 0, 0, 1, 10000, 8000);
          if (boxId >= 0) {
            bridge.pushPull(expectedFaceId, 10000);
          }
          const sphereId = bridge.create_sphere?.(12000, 3500, 0, 5000, 24, 16);
          toolManager.syncMesh();
        } catch (e) {
          console.error('[Init] Fallback scene creation failed:', e);
        }
      });
  }

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

  // ═══ 4a. CAD Menu Bar ═══
  {
    const menubar = document.getElementById('menubar');
    let openMenu: HTMLElement | null = null;

    // 메뉴 열기/닫기
    const closeAllMenus = () => {
      menubar?.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      openMenu = null;
    };

    // 메뉴 항목 클릭 → 토글
    menubar?.querySelectorAll(':scope > .menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // menu-action이 아닌 경우에만 stopPropagation
        if (!(e.target as HTMLElement).closest('.menu-action')) {
          e.stopPropagation();
        }
        const el = item as HTMLElement;
        if (el.classList.contains('open')) {
          closeAllMenus();
        } else {
          closeAllMenus();
          el.classList.add('open');
          openMenu = el;
        }
      });
      // 호버로 전환 (이미 하나가 열려있으면)
      item.addEventListener('mouseenter', () => {
        if (openMenu && openMenu !== item) {
          closeAllMenus();
          (item as HTMLElement).classList.add('open');
          openMenu = item as HTMLElement;
        }
      });
    });

    // 바깥 클릭 시 닫기
    document.addEventListener('click', () => closeAllMenus());

    // 메뉴 액션 핸들러
    const setActiveTool = (tool: string) => {
      toolManager.setTool(tool);
      const tb = document.getElementById('toolbar')!;
      tb.querySelectorAll('.tool-btn').forEach(b => {
        b.classList.toggle('active', (b as HTMLElement).dataset.tool === tool);
      });
      const toolLabel = document.getElementById('tool-label');
      if (toolLabel) {
        const names: Record<string, string> = {
          select: 'Select', line: 'Line', rect: 'Rectangle',
          circle: 'Circle', pushpull: 'Push/Pull', move: 'Move',
          sphere: 'Sphere', cylinder: 'Cylinder', cone: 'Cone',
        };
        toolLabel.textContent = names[tool] || tool;
      }
    };

    const setActiveView = (view: string) => {
      viewport.setViewMode(view as any);
      const vmBar = document.getElementById('view-mode-bar');
      vmBar?.querySelectorAll('.view-btn').forEach(b =>
        b.classList.toggle('active', (b as HTMLElement).dataset.view === view)
      );
    };

    menubar?.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest('.menu-action') as HTMLElement;
      if (!action) return;
      const act = action.dataset.action;
      if (!act) return;

      closeAllMenus();

      switch (act) {
        // 파일
        case 'file-new':
          if (confirm('현재 작업을 초기화하시겠습니까?')) {
            location.reload();
          }
          break;
        case 'file-open':
          (window as any).__axia_open?.();
          break;
        case 'file-save':
          (window as any).__axia_save?.();
          break;
        case 'file-saveas':
          fileManager.saveAsProject();
          break;

        // 가져오기 (Import)
        case 'import-all':
          fileImporter.openFileDialog().catch((err) => {
            console.error('[main] Import all 실패:', err);
          });
          break;
        case 'import-obj':
          fileImporter.openFileDialog('obj').catch((err) => {
            console.error('[main] Import OBJ 실패:', err);
          });
          break;
        case 'import-stl':
          fileImporter.openFileDialog('stl').catch((err) => {
            console.error('[main] Import STL 실패:', err);
          });
          break;
        case 'import-gltf':
          fileImporter.openFileDialog('gltf').catch((err) => {
            console.error('[main] Import glTF 실패:', err);
          });
          break;
        case 'import-dae':
          fileImporter.openFileDialog('dae').catch((err) => {
            console.error('[main] Import DAE 실패:', err);
          });
          break;
        case 'import-ply':
          fileImporter.openFileDialog('ply').catch((err) => {
            console.error('[main] Import PLY 실패:', err);
          });
          break;
        case 'import-3ds':
          fileImporter.openFileDialog('3ds').catch((err) => {
            console.error('[main] Import 3DS 실패:', err);
          });
          break;
        case 'import-dxf':
          fileImporter.openFileDialog('dxf').catch((err) => {
            console.error('[main] Import DXF 실패:', err);
          });
          break;
        case 'import-dwg':
          fileImporter.openFileDialog('dwg').catch((err) => {
            console.error('[main] Import DWG 실패:', err);
          });
          break;
        case 'import-skp':
          fileImporter.openFileDialog('skp').catch((err) => {
            console.error('[main] Import SKP 실패:', err);
          });
          break;

        // 내보내기 (Export)
        case 'export-dxf':
          try {
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
            DxfExporter.downloadDxf(viewport.scene, `AXiA_3D_${timestamp}.dxf`);
            console.log('[main] DXF 내보내기 완료');
          } catch (err) {
            console.error('[main] DXF 내보내기 실패:', err);
            alert('DXF 내보내기에 실패했습니다');
          }
          break;

        case 'export-obj':
          console.info('[main] OBJ 내보내기: 준비 중...');
          alert('OBJ 내보내기는 준비 중입니다');
          break;

        case 'export-gltf':
          console.info('[main] glTF 내보내기: 준비 중...');
          alert('glTF 내보내기는 준비 중입니다');
          break;

        case 'export-stl':
          console.info('[main] STL 내보내기: 준비 중...');
          alert('STL 내보내기는 준비 중입니다');
          break;

        // 편집
        case 'undo': toolManager.executeAction('undo'); break;
        case 'redo': toolManager.executeAction('redo'); break;
        case 'delete': toolManager.executeAction('delete'); break;
        case 'select-all': toolManager.executeAction('select-all'); break;
        case 'select-same': toolManager.executeAction('select-same'); break;
        case 'deselect': toolManager.selection.clearSelection(); break;

        // 보기
        case 'view-3d': setActiveView('3d'); break;
        case 'view-top': setActiveView('top'); break;
        case 'view-front': setActiveView('front'); break;
        case 'view-back': setActiveView('back'); break;
        case 'view-right': setActiveView('right'); break;
        case 'view-left': setActiveView('left'); break;
        case 'view-bottom': setActiveView('bottom'); break;
        case 'view-home': viewport.resetCamera(); break;
        case 'view-grid': {
          const s = viewport.getStyleSettings();
          viewport.setGridVisible(!s.gridVisible);
          break;
        }
        case 'view-axis': {
          const s = viewport.getStyleSettings();
          viewport.setAxisVisible(!s.axisVisible);
          break;
        }

        // 그리기
        case 'tool-line': setActiveTool('line'); break;
        case 'tool-polyline': setActiveTool('polyline'); break;
        case 'tool-rect': setActiveTool('rect'); break;
        case 'tool-polygon': setActiveTool('polygon'); break;
        case 'tool-circle': setActiveTool('circle'); break;
        case 'tool-arc': setActiveTool('arc'); break;
        case 'tool-freehand': setActiveTool('freehand'); break;
        case 'tool-point': setActiveTool('point'); break;
        case 'tool-text3d': setActiveTool('text3d'); break;

        // 수정
        case 'tool-pushpull': setActiveTool('pushpull'); break;
        case 'tool-sphere': setActiveTool('sphere'); break;
        case 'tool-cylinder': setActiveTool('cylinder'); break;
        case 'tool-cone': setActiveTool('cone'); break;
        case 'tool-move': setActiveTool('move'); break;
        case 'tool-rotate': setActiveTool('rotate'); break;
        case 'tool-scale': setActiveTool('scale'); break;
        case 'tool-offset': setActiveTool('offset'); break;
        case 'tool-mirror': setActiveTool('mirror'); break;
        case 'tool-array': setActiveTool('array'); break;
        case 'tool-trim': setActiveTool('trim'); break;
        case 'tool-extend': setActiveTool('extend'); break;
        case 'tool-fillet': setActiveTool('fillet'); break;
        case 'tool-chamfer': setActiveTool('chamfer'); break;
        case 'tool-explode': setActiveTool('explode'); break;
        case 'tool-group': toolManager.executeAction('group'); break;
        case 'tool-ungroup': toolManager.executeAction('ungroup'); break;
        case 'tool-make-component': toolManager.executeAction('make-component'); break;

        // Boolean
        case 'bool-union': startBooleanOp({ bridge, toolManager }, 'union'); break;
        case 'bool-subtract': startBooleanOp({ bridge, toolManager }, 'subtract'); break;
        case 'bool-intersect': startBooleanOp({ bridge, toolManager }, 'intersect'); break;

        // 형식
        case 'format-units':
          document.getElementById('settings-btn')?.click();
          break;
        case 'format-style':
          document.getElementById('style-btn')?.click();
          break;
        case 'format-osnap':
          (window as any).__axia_openOsnapPanel?.();
          break;

        // 도움말
        case 'help-shortcuts':
          alert(
            'AXiA 3D 단축키\n\n' +
            '[ 그리기 ]\n' +
            'V — 선택\nL — 선 (Line)\nShift+L — 폴리선 (Polyline)\nR — 사각형 (Rect)\nG — 다각형 (Polygon)\n' +
            'C — 원 (Circle)\nA — 호 (Arc)\nShift+F — 자유선 (Freehand)\n\n' +
            '[ 수정 ]\n' +
            'P — 밀기/당기기 (Push/Pull)\nM — 이동 (Move)\nQ — 회전 (Rotate)\n' +
            'S — 크기 조정 (Scale)\nO — 오프셋 (Offset)\n\n' +
            '[ 편집 ]\n' +
            'Ctrl+G — 그룹\nCtrl+Shift+G — 그룹 해제\n' +
            'Ctrl+S — 저장\nCtrl+O — 열기\nCtrl+Z — 실행취소\nCtrl+Y — 다시실행\n\n' +
            '[ 탐색 ]\n' +
            'H — 원점 복귀\nF3 — 스냅 토글\n' +
            '→ X축 잠금 / ↑ Y축 잠금 / ← Z축 잠금 / ↓ 해제\n\n' +
            'Alt+드래그 — 궤도 회전\n중버튼 드래그 — 이동\n스크롤 — 줌'
          );
          break;
        case 'help-about':
          alert('AXiA 3D v0.1.0\n\n경량 3D 모델링 프로그램\nXIA Geometry Engine (Rust/WASM)');
          break;
      }
    });
  }

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
  initContextMenu({ viewport, bridge, toolManager, viewModeBar });

  // ═══ OSNAP 설정 패널 (제도 설정값) ═══
  initOsnapPanel({
    snap: toolManager.snap,
    snapVisual: toolManager.snapVisual,
    updateOsnapUI,
  });

  // ═══ 10. Project Save/Load (.xia) — see ui/ProjectSerializer.ts ═══
  const { saveProject, openProject } = initProjectSerializer({ bridge, viewport, toolManager, units });

  // ═══ 10b. DXF Import — see ui/DxfImportHandler.ts ═══
  // ═══ Boolean Operations — see ui/BooleanHandler.ts ═══

  // 글로벌 접근용
  (window as any).__axia_save = saveProject;
  (window as any).__axia_open = openProject;

  // Keyboard Shortcuts (depends on saveProject/openProject)
  initKeyboardShortcuts({ toolManager, viewport, toolbar, viewModeBar, saveProject, openProject });

  // ═══ 11. Style Side Panel — see ui/StylePanel.ts ═══
  initStylePanel({ viewport });

  // ═══ 12. XIA Inspector Panel (개념 체계: Point → Line → Face → Volume → XIA) ═══
  {
    const xiPanel = document.getElementById('xia-inspector');
    const xiBtn = document.getElementById('inspector-btn');
    const xiClose = document.getElementById('xi-close');

    // MaterialLibrary import (동적)
    const { getMaterialLibrary, GeometryState, GEOMETRY_STATES } = await import('./materials/MaterialLibrary');
    const matLib = getMaterialLibrary();
    matLib.setBridge(bridge); // Rust 엔진과 재질 동기화 연결

    let nextXiaNum = 1;
    let currentFaceIds: number[] = [];
    let currentVolumeMM3 = 0;

    // 재질 드롭다운 채우기
    const matSelect = document.getElementById('xi-material') as HTMLSelectElement | null;
    if (matSelect) {
      const allMats = matLib.getAll();
      for (const mat of allMats) {
        const opt = document.createElement('option');
        opt.value = mat.id;
        opt.textContent = `${mat.name} (${mat.nameEn})`;
        matSelect.appendChild(opt);
      }
    }

    const toggleInspector = () => {
      if (xiPanel) xiPanel.classList.toggle('open');
    };

    xiBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleInspector();
    });
    xiClose?.addEventListener('click', () => xiPanel?.classList.remove('open'));

    // 탭 전환
    xiPanel?.querySelectorAll('.xi-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        xiPanel.querySelectorAll('.xi-tab').forEach(t => t.classList.remove('active'));
        xiPanel.querySelectorAll('.xi-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const target = (tab as HTMLElement).dataset.tab;
        document.getElementById(`xi-tab-${target}`)?.classList.add('active');
      });
    });

    const formatNum = (n: number, decimals = 0): string => {
      if (decimals === 0) return Math.round(n).toLocaleString();
      return n.toFixed(decimals).replace(/\B(?=(\d{3})+\.)/g, ',');
    };

    // ── 기하 상태 단계 인디케이터 업데이트 ──
    const updateStateSteps = (state: string) => {
      const stepsEl = document.getElementById('xi-state-steps');
      if (!stepsEl) return;

      const order = ['point', 'line', 'face', 'volume', 'xia'];
      const activeIdx = order.indexOf(state);

      stepsEl.querySelectorAll('.xi-step').forEach(step => {
        const s = (step as HTMLElement).dataset.state || '';
        const idx = order.indexOf(s);
        step.classList.remove('active', 'passed');
        if (idx === activeIdx) step.classList.add('active');
        else if (idx < activeIdx) step.classList.add('passed');
      });

      stepsEl.querySelectorAll('.xi-step-line').forEach((line, i) => {
        line.classList.toggle('passed', i < activeIdx);
      });
    };

    // 초기 상태: Point 활성화
    updateStateSteps('point');

    // ── 물리 속성 패널 업데이트 ──
    const updatePhysicalPanel = (materialId: string | null) => {
      const hintEl = document.getElementById('xi-material-hint');
      const propsEl = document.getElementById('xi-material-props');
      const badgeEl = document.getElementById('xi-phys-badge');
      const assignBtn = document.getElementById('xi-assign-btn');

      if (!materialId || materialId === '') {
        // Appearance 상태 (재질 없음)
        if (hintEl) hintEl.style.display = '';
        if (propsEl) propsEl.style.display = 'none';
        if (badgeEl) { badgeEl.textContent = 'Appearance'; badgeEl.style.background = 'rgba(156, 39, 176, 0.15)'; badgeEl.style.color = '#ce93d8'; }
        assignBtn?.classList.remove('assigned');
        return;
      }

      const mat = matLib.get(materialId);
      if (!mat) return;

      // XIA 상태 (재질 있음)
      if (hintEl) hintEl.style.display = 'none';
      if (propsEl) propsEl.style.display = '';
      if (badgeEl) { badgeEl.textContent = 'XIA (물체)'; badgeEl.style.background = 'rgba(76, 175, 80, 0.15)'; badgeEl.style.color = '#81c784'; }
      assignBtn?.classList.add('assigned');

      // 물리 속성 채우기
      const densityEl = document.getElementById('xi-density') as HTMLInputElement;
      const thermalEl = document.getElementById('xi-thermal') as HTMLInputElement;
      if (densityEl) densityEl.value = mat.physical.density.toLocaleString();
      if (thermalEl) thermalEl.value = String(mat.physical.thermalConductivity);

      // 화재 등급
      xiPanel?.querySelectorAll('.xi-fire-btn').forEach(b => {
        b.classList.toggle('active', (b as HTMLElement).dataset.fire === mat.physical.fireRating);
      });

      // 질량/무게 계산
      const physics = matLib.computePhysics(currentVolumeMM3, materialId);
      const massEl = document.getElementById('xi-mass');
      const weightNEl = document.getElementById('xi-weight-n');
      if (physics) {
        if (massEl) massEl.textContent = formatNum(physics.mass, 1);
        if (weightNEl) weightNEl.textContent = formatNum(physics.weight, 1);
      }
    };

    // ── 재질 변경 → Viewport 색상 갱신 ──
    const refreshViewportColors = () => {
      viewport.refreshMaterialColors();
    };

    // MaterialLibrary 변경 이벤트 → Viewport 동기화
    matLib.onChange(refreshViewportColors);

    // ── 재질 변경 이벤트 ──
    matSelect?.addEventListener('change', () => {
      const materialId = matSelect.value;
      // 실제 선택된 면만 사용 (currentFaceIds가 stale하지 않도록)
      const selectedNow = toolManager.selection.getSelectedFaces();
      const targetFaces = selectedNow.length > 0 ? selectedNow : currentFaceIds;
      console.log('[Material] assign to faces:', targetFaces, 'material:', materialId);
      if (targetFaces.length > 0 && materialId) {
        matLib.assignToFaces(targetFaces, materialId);
      } else if (targetFaces.length > 0 && !materialId) {
        matLib.unassignFromFaces(targetFaces);
      }
      currentFaceIds = targetFaces;
      updatePhysicalPanel(materialId || null);
      // 상태 재판정
      updateInspector(currentFaceIds);
    });

    // ── 재질 부여/해제 버튼 ──
    document.getElementById('xi-assign-btn')?.addEventListener('click', () => {
      if (!matSelect || currentFaceIds.length === 0) return;
      if (matLib.hasMaterial(currentFaceIds)) {
        // 해제
        matLib.unassignFromFaces(currentFaceIds);
        matSelect.value = '';
        updatePhysicalPanel(null);
      } else if (matSelect.value) {
        // 부여
        matLib.assignToFaces(currentFaceIds, matSelect.value);
        updatePhysicalPanel(matSelect.value);
      }
      updateInspector(currentFaceIds);
    });

    // ── Inspector 메인 업데이트 ──
    const updateInspector = (faceIds: number[]) => {
      currentFaceIds = faceIds;
      const emptyEl = document.getElementById('xi-empty');
      const contentEl = document.getElementById('xi-content');

      if (faceIds.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
        if (contentEl) contentEl.style.display = 'none';
        updateStateSteps('point');
        return;
      }

      if (emptyEl) emptyEl.style.display = 'none';
      if (contentEl) contentEl.style.display = '';

      if (xiPanel && !xiPanel.classList.contains('open')) {
        xiPanel.classList.add('open');
      }

      // Rust에서 XIA 정보 가져오기
      const info = bridge.getXiaInfo(faceIds);

      // ID & Name
      const idEl = document.getElementById('xi-id');
      const nameEl = document.getElementById('xi-name') as HTMLInputElement;
      if (idEl) idEl.textContent = `XIA-${String(nextXiaNum).padStart(4, '0')}`;

      if (info && !info.empty) {
        // ── 기하 상태 판정 (Point → Line → Face → Volume → XIA) ──
        const geoState = matLib.determineState(
          { faceCount: info.faceCount || 0, isSolid: info.isSolid || false, height: info.height || 0 },
          faceIds
        );
        const stateInfo = GEOMETRY_STATES[geoState];

        // 상태 단계 인디케이터
        updateStateSteps(geoState);

        // 상태 표시
        const dotEl = document.getElementById('xi-solid-dot');
        const labelEl = document.getElementById('xi-solid-label');
        const subEl = document.getElementById('xi-solid-sub');
        const shapeEl = document.getElementById('xi-shape-type');

        if (dotEl) {
          dotEl.className = 'xi-solid-dot ' + geoState;
        }
        if (labelEl) labelEl.textContent = `${stateInfo.icon} ${stateInfo.labelEn}`;
        if (subEl) subEl.textContent = stateInfo.description;
        if (shapeEl) shapeEl.textContent = `\u25a1 ${info.shapeType || ''}`;

        // 기하학적 속성 — mm 단위
        const lengthEl = document.getElementById('xi-length');
        const widthEl = document.getElementById('xi-width');
        const heightEl = document.getElementById('xi-height');
        if (lengthEl) lengthEl.textContent = formatNum(info.length || 0);
        if (widthEl) widthEl.textContent = formatNum(info.width || 0);
        if (heightEl) heightEl.textContent = formatNum(info.height || 0);

        // 면적 mm² → m²
        const areaEl = document.getElementById('xi-area');
        const areaM2 = (info.surfaceArea || 0) / 1e6;
        if (areaEl) areaEl.textContent = formatNum(areaM2, 1);

        // 부피/무게: Volume 이상만 표시
        const volBox = document.getElementById('xi-volume')?.closest('.xi-computed-box') as HTMLElement | null;
        const weightBox = document.getElementById('xi-weight')?.closest('.xi-computed-box') as HTMLElement | null;

        if (geoState === GeometryState.Volume || geoState === GeometryState.Xia) {
          if (volBox) volBox.style.display = '';
          if (weightBox) weightBox.style.display = '';

          const volEl = document.getElementById('xi-volume');
          const volM3 = (info.volume || 0) / 1e9;
          if (volEl) volEl.textContent = formatNum(volM3, 1);

          currentVolumeMM3 = info.volume || 0;
        } else {
          if (volBox) volBox.style.display = 'none';
          if (weightBox) weightBox.style.display = 'none';
          currentVolumeMM3 = 0;
        }

        // 물리적 속성 섹션: Volume/Xia에서만 Material 드롭다운 활성화
        const physSection = document.getElementById('xi-physical-section');
        if (physSection) {
          if (geoState === GeometryState.Volume || geoState === GeometryState.Xia) {
            physSection.style.display = '';
            physSection.style.opacity = '1';
            physSection.style.pointerEvents = '';
          } else {
            // Point/Line/Face → 물리적 속성 섹션 비활성화
            physSection.style.display = '';
            physSection.style.opacity = '0.35';
            physSection.style.pointerEvents = 'none';
          }
        }

        // 재질 상태 반영
        const commonMat = matLib.getCommonMaterial(faceIds);
        if (matSelect) {
          matSelect.value = commonMat ? commonMat.id : '';
        }
        updatePhysicalPanel(commonMat ? commonMat.id : null);

        // 스냅 포인트
        const snapEl = document.getElementById('xi-snap-count');
        if (snapEl) snapEl.textContent = String(info.snapPoints || 0);

        // 이름 자동 설정
        if (nameEl && !nameEl.dataset.edited) {
          if (geoState === GeometryState.Xia && commonMat) {
            nameEl.value = `${commonMat.name} ${info.shapeType || '객체'}`;
          } else {
            nameEl.value = `${stateInfo.label} ${info.shapeType || ''}`.trim();
          }
        }
      } else {
        const lengthEl = document.getElementById('xi-length');
        const widthEl = document.getElementById('xi-width');
        const heightEl = document.getElementById('xi-height');
        if (lengthEl) lengthEl.textContent = '-';
        if (widthEl) widthEl.textContent = '-';
        if (heightEl) heightEl.textContent = '-';
        updateStateSteps('face');
      }
    };

    // 이름 수동 편집 표시
    document.getElementById('xi-name')?.addEventListener('input', (e) => {
      (e.target as HTMLInputElement).dataset.edited = 'true';
    });

    // Selection 변경 시 Inspector 업데이트
    toolManager.selection.onChange((faces: number[]) => {
      updateInspector(faces);
      if (faces.length > 0) nextXiaNum++;
    });

    // 키보드 I → Inspector 토글
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'i' || e.key === 'I') toggleInspector();
      if (e.key === 'Escape' && xiPanel?.classList.contains('open')) xiPanel.classList.remove('open');
    });
  }

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

    (window as any).__axia_componentPanel = componentPanel;

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
