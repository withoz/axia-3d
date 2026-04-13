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

  // Register line command handler
  commandInput.registerHandler({
    name: 'line',
    aliases: ['L'],
    help: 'Draw a line. Usage: L [length] [height] or L x1,y1,z1 x2,y2,z2',
    execute: (args: string[]) => {
      if (args.length === 0) {
        toolManager.setTool('line');
        commandInput.printSuccess('라인 도구 활성화됨. 클릭으로 시작점을 선택하세요.');
        return;
      }

      // Parse length argument
      if (args.length === 1) {
        const length = parseFloat(args[0]);
        if (isNaN(length) || length <= 0) {
          throw new Error('유효한 길이를 입력하세요');
        }
        toolManager.setTool('line');
        commandInput.printSuccess(`라인 도구: 길이 ${length} mm`);
        return;
      }

      // Parse coordinate arguments (x1,y1,z1 x2,y2,z2)
      if (args.length >= 2) {
        const pt1Parts = args[0].split(',');
        const pt2Parts = args[1].split(',');

        if (pt1Parts.length !== 3 || pt2Parts.length !== 3) {
          throw new Error('좌표 형식: x1,y1,z1 x2,y2,z2');
        }

        const x1 = parseFloat(pt1Parts[0]);
        const y1 = parseFloat(pt1Parts[1]);
        const z1 = parseFloat(pt1Parts[2]);
        const x2 = parseFloat(pt2Parts[0]);
        const y2 = parseFloat(pt2Parts[1]);
        const z2 = parseFloat(pt2Parts[2]);

        if ([x1, y1, z1, x2, y2, z2].some(isNaN)) {
          throw new Error('모든 좌표는 숫자여야 합니다');
        }

        bridge.drawLine(x1, y1, z1, x2, y2, z2);
        toolManager.syncMesh();
        const len = Math.sqrt(
          (x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2
        );
        commandInput.printSuccess(`라인 생성됨 (길이: ${len.toFixed(2)} mm)`);
        return;
      }

      throw new Error('명령 형식이 잘못되었습니다');
    }
  });

  // Register help command
  commandInput.registerHandler({
    name: 'help',
    aliases: ['H', '?'],
    help: 'Show available commands',
    execute: () => {
      const commands = [
        'L [길이] - 라인 도구 활성화',
        'R [너비,높이,깊이] - 직사각형',
        'C [반지름] - 원 그리기',
        'P [x,y,z] - 점 생성',
      ];
      commandInput.printInfo(commands.join('\n'));
    }
  });

  // Keyboard shortcut to toggle command input (Backtick or Ctrl+K)
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === '`' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      commandInput.toggle();
    }
  });

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
        case 'bool-union': startBooleanOp('union'); break;
        case 'bool-subtract': startBooleanOp('subtract'); break;
        case 'bool-intersect': startBooleanOp('intersect'); break;

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

  // 5. Keyboard shortcuts (도구 + Undo/Redo)
  // 뷰 단축키는 아래 섹션 6에서 처리
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;

    // Spacebar: 현재 도구 완료 (Line 종료 등 — CAD 스타일)
    if (e.key === ' ' && toolManager.isToolBusy()) {
      e.preventDefault();
      toolManager.cancelCurrentTool();
      return;
    }

    // Delete: 선택된 face 삭제
    if (e.key === 'Delete') {
      toolManager.executeAction('delete');
      return;
    }

    // F3: OSNAP 토글
    if (e.key === 'F3') {
      e.preventDefault();
      toolManager.snap.toggle();
      updateOsnapUI();
      return;
    }

    // 화살표 키: 축 잠금 (SketchUp 스타일)
    // → Right: X축(빨강), ↑ Up: Y축(파랑/높이), ← Left: Z축(초록), ↓ Down: 해제
    if (e.key === 'ArrowRight') { e.preventDefault(); toolManager.setAxisLock('x'); return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); toolManager.setAxisLock('y'); return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); toolManager.setAxisLock('z'); return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); toolManager.setAxisLock(null); return; }

    // Ctrl+S: 저장
    if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveProject();
      return;
    }
    // Ctrl+O: 열기
    if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault();
      openProject();
      return;
    }
    // Ctrl+Shift+G: 그룹 해제
    if (e.ctrlKey && e.shiftKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      toolManager.executeAction('ungroup');
      return;
    }
    // Ctrl+G: 그룹
    if (e.ctrlKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      toolManager.executeAction('group');
      return;
    }

    // Ctrl+A: 모두 선택
    if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      toolManager.executeAction('select-all');
      return;
    }

    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      if (e.repeat) return; // 키 반복 무시
      if (!e.isTrusted) { console.warn('[Undo] blocked non-trusted event'); return; }
      toolManager.executeAction('undo');
      const undoBtn = toolbar.querySelector('[data-tool="undo"]');
      if (undoBtn) { undoBtn.classList.add('flash'); undoBtn.addEventListener('animationend', () => undoBtn.classList.remove('flash'), { once: true }); }
    } else if (e.ctrlKey && e.key === 'y') {
      e.preventDefault();
      if (e.repeat) return; // 키 반복 무시
      if (!e.isTrusted) { console.warn('[Redo] blocked non-trusted event'); return; }
      toolManager.executeAction('redo');
      const redoBtn = toolbar.querySelector('[data-tool="redo"]');
      if (redoBtn) { redoBtn.classList.add('flash'); redoBtn.addEventListener('animationend', () => redoBtn.classList.remove('flash'), { once: true }); }
    } else if (e.key === 'Escape') {
      // Escape: 그룹 편집 모드 종료 → 3D 뷰 복귀 → Select 도구
      if (toolManager.selection.isInGroupEditMode()) {
        toolManager.selection.exitGroupEdit();
        return;
      }
      if (viewport.viewMode !== '3d') {
        viewport.setViewMode('3d');
        const vmBar = document.getElementById('view-mode-bar');
        vmBar?.querySelectorAll('.view-btn').forEach(b =>
          b.classList.toggle('active', (b as HTMLElement).dataset.view === '3d')
        );
        const toolLabel = document.getElementById('tool-label');
        if (toolLabel) toolLabel.textContent = '3D Perspective';
      } else {
        toolManager.setTool('select');
        toolbar.querySelectorAll('.tool-btn').forEach(b => {
          b.classList.toggle('active', (b as HTMLElement).dataset.tool === 'select');
        });
      }
    } else if (e.shiftKey && !e.ctrlKey && !e.altKey) {
      // Shift 조합 단축키
      const shiftMap: Record<string, string> = {
        'L': 'polyline',
        'F': 'freehand',
      };
      const shiftTool = shiftMap[e.key];
      if (shiftTool) {
        toolManager.setTool(shiftTool);
        toolbar.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        const toolLabel = document.getElementById('tool-label');
        if (toolLabel) toolLabel.textContent = shiftTool;
      }
    } else if (!e.ctrlKey && !e.altKey) {
      // 뷰 단축키 (AutoCAD 스타일) — t, b, f, k 는 여기서 걸러냄
      // H: 원점 복귀
      if (e.key === 'h' || e.key === 'H') {
        viewport.resetCamera();
        return;
      }

      const viewKeySet = new Set(['t', 'b', 'f', 'k']);
      if (viewKeySet.has(e.key.toLowerCase())) return; // 뷰 섹션에서 처리

      // 도구가 활성 작업 중이면 도구 전환 차단 (Escape로만 취소)
      if (toolManager.isToolBusy()) return;

      const keyMap: Record<string, string> = {
        'v': 'select', 'V': 'select',
        'l': 'line', 'L': 'line',
        'r': 'rect', 'R': 'rect',
        'g': 'polygon', 'G': 'polygon',
        'c': 'circle', 'C': 'circle',
        'a': 'arc', 'A': 'arc',
        'p': 'pushpull', 'P': 'pushpull',
        'h': 'sphere', 'H': 'sphere',
        'y': 'cylinder', 'Y': 'cylinder',
        'n': 'cone', 'N': 'cone',
        'm': 'move', 'M': 'move',
        'q': 'rotate', 'Q': 'rotate',
        's': 'scale', 'S': 'scale',
        'o': 'offset', 'O': 'offset',
        'e': 'erase', 'E': 'erase',
      };
      const tool = keyMap[e.key];
      if (tool) {
        toolManager.setTool(tool);
        toolbar.querySelectorAll('.tool-btn').forEach(b => {
          b.classList.toggle('active', (b as HTMLElement).dataset.tool === tool);
        });
        const toolLabel = document.getElementById('tool-label');
        if (toolLabel) {
          const names: Record<string, string> = {
            select: 'Select', line: 'Line', rect: 'Rectangle',
            circle: 'Circle', pushpull: 'Push/Pull', move: 'Move',
            rotate: 'Rotate', scale: 'Scale', offset: 'Offset',
            erase: 'Erase', sphere: 'Sphere', cylinder: 'Cylinder', cone: 'Cone',
          };
          toolLabel.textContent = names[tool] || tool;
        }
      }
    }
  });

  // 5b. Home (원점 복귀) 버튼
  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      viewport.resetCamera();
    });
  }

  // 6. View mode buttons (2D/3D 전환)
  const viewModeBar = document.getElementById('view-mode-bar');
  if (viewModeBar) {
    viewModeBar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.view-btn') as HTMLElement;
      if (!btn) return;
      const mode = btn.dataset.view as ViewMode;
      if (!mode) return;

      viewModeBar.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      viewport.setViewMode(mode);

      // 뷰 라벨 업데이트
      const toolLabel = document.getElementById('tool-label');
      if (toolLabel) {
        const viewNames: Record<string, string> = {
          '3d': '3D Perspective',
          top: 'Top (XY)', bottom: 'Bottom (XY)',
          front: 'Front (XZ)', back: 'Back (XZ)',
          right: 'Right (YZ)', left: 'Left (YZ)',
        };
        toolLabel.textContent = viewNames[mode] || mode;
      }
    });

    // 뷰 전환 헬퍼
    const switchView = (mode: ViewMode) => {
      viewport.setViewMode(mode);
      // 버튼 활성화 (기본 4개 버튼만 active 표시, 나머지는 해제)
      viewModeBar.querySelectorAll('.view-btn').forEach(b => {
        const v = (b as HTMLElement).dataset.view;
        b.classList.toggle('active', v === mode);
      });
      // 뷰 라벨 업데이트
      const toolLabel = document.getElementById('tool-label');
      if (toolLabel) {
        const viewNames: Record<string, string> = {
          '3d': '3D Perspective',
          top: 'Top (XY)', bottom: 'Bottom (XY)',
          front: 'Front (XZ)', back: 'Back (XZ)',
          right: 'Right (YZ)', left: 'Left (YZ)',
        };
        toolLabel.textContent = viewNames[mode] || mode;
      }
    };

    // ── 키보드 단축키: AutoCAD 스타일 + Blender 넘패드 ──
    window.addEventListener('keydown', (e) => {
      // 입력 필드에서는 무시
      if (e.target instanceof HTMLInputElement) return;

      // VCB 활성 도구에서는 넘패드도 숫자 입력으로 사용 (뷰 전환 차단)
      const currentTool = toolManager.currentTool;
      const isVcbTool = vcbTools.has(currentTool);
      const isNumpad = e.code.startsWith('Numpad');
      if (isVcbTool && isNumpad && !e.ctrlKey) return; // VCB 핸들러가 처리

      let mode: ViewMode | null = null;

      // Blender 넘패드 (Ctrl 조합 포함)
      if (e.code === 'Numpad7') mode = e.ctrlKey ? 'bottom' : 'top';
      else if (e.code === 'Numpad1') mode = e.ctrlKey ? 'back' : 'front';
      else if (e.code === 'Numpad3') mode = e.ctrlKey ? 'left' : 'right';
      else if (e.code === 'Numpad0' || e.code === 'Numpad5') mode = '3d';

      // AutoCAD / 3ds Max 스타일 단축키 (Ctrl 없이)
      if (!e.ctrlKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 't') mode = 'top';
        else if (key === 'b') mode = 'bottom';
        else if (key === 'f') mode = 'front';
        else if (key === 'k') mode = 'back';     // K = bacK
      }

      if (mode) {
        e.preventDefault();
        switchView(mode);
      }
    });
  }

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

  // 9. VCB (Value Control Box) — SketchUp 스타일 치수 직접 입력
  const cmdInput = document.getElementById('cmd-input') as HTMLInputElement;
  const cmdLabel = document.getElementById('cmd-label') as HTMLSpanElement;
  const commandBar = document.getElementById('commandbar') as HTMLDivElement;

  /** 도구별 VCB 라벨 */
  const vcbLabels: Record<string, string> = {
    offset: '오프셋 거리:',
    pushpull: '밀기/당기기 거리:',
    line: '길이:',
    rect: '가로, 세로:',
    circle: '반지름:',
    move: '이동 거리:',
    rotate: '각도(°):',
    scale: '배율:',
    select: '치수:',
  };

  /** VCB에 숫자 입력이 가능한 도구인지 */
  const vcbTools = new Set(['offset', 'pushpull', 'line', 'rect', 'circle', 'move', 'rotate', 'scale']);

  /** VCB 활성화 */
  const activateVCB = (initialChar?: string) => {
    if (!cmdInput) return;
    commandBar?.classList.add('vcb-active');
    cmdInput.focus();
    if (initialChar) {
      cmdInput.value = initialChar;
    }
    // 라벨 업데이트
    const tool = toolManager.currentTool;
    if (cmdLabel) {
      cmdLabel.textContent = vcbLabels[tool] || '치수:';
    }
  };

  /** VCB 비활성화 */
  const deactivateVCB = () => {
    if (!cmdInput) return;
    commandBar?.classList.remove('vcb-active');
    cmdInput.blur();
    cmdInput.value = '';
  };

  if (cmdInput) {
    // Enter 또는 Spacebar: 값 확정 → 도구에 전달
    // (rect는 "가로 세로" 형식이므로 Spacebar를 공백으로 유지)
    cmdInput.addEventListener('keydown', (e) => {
      const isConfirmKey = e.key === 'Enter'
        || (e.key === ' ' && toolManager.currentTool !== 'rect');
      if (isConfirmKey) {
        e.preventDefault();
        const raw = cmdInput.value.trim();
        if (!raw) { deactivateVCB(); return; }

        const tool = toolManager.currentTool;

        // rect: "가로,세로" 또는 "가로 세로" 파싱
        if (tool === 'rect' && (raw.includes(',') || raw.includes(' '))) {
          const parts = raw.split(/[,\s]+/).map(s => units.parseInput(s.trim()));
          if (parts.length === 2 && parts[0] !== null && parts[1] !== null) {
            console.log(`[VCB] rect: ${parts[0]}×${parts[1]} mm`);
            toolManager.applyVCBValue(parts[0]!, parts[1]!);
            deactivateVCB();
            return;
          }
        }

        const mm = units.parseInput(raw);
        if (mm !== null) {
          console.log(`[VCB] ${tool}: "${raw}" → ${mm.toFixed(2)} mm`);
          toolManager.applyVCBValue(mm);
          cmdInput.placeholder = units.format(mm);
          deactivateVCB();
        } else {
          console.warn(`[VCB] Invalid: "${raw}"`);
          cmdInput.value = '';
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        deactivateVCB();
      }
    });

    // placeholder
    const updatePlaceholder = () => {
      if (!cmdInput) return;
      const tool = toolManager.currentTool;
      if (tool === 'rect') {
        cmdInput.placeholder = `가로, 세로 (${units.config.label})`;
      } else {
        cmdInput.placeholder = `숫자 입력 후 Enter (${units.config.label})`;
      }
    };
    units.onChange(updatePlaceholder);
    updatePlaceholder();
  }

  // 숫자키 자동 VCB 활성화 (캔버스에서 숫자/마이너스/소수점 입력 시)
  window.addEventListener('keydown', (e) => {
    // 이미 입력 필드에 포커스 → 무시
    if (e.target instanceof HTMLInputElement) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    // 숫자, 마이너스, 소수점 키 감지 (넘패드 포함)
    const isNumericKey = /^[0-9.\-]$/.test(e.key);
    if (!isNumericKey) return;

    // VCB 가능한 도구에서만 활성화
    const tool = toolManager.currentTool;
    if (!vcbTools.has(tool)) return;

    e.preventDefault();
    e.stopPropagation(); // 뷰 전환 등 다른 핸들러로 전파 차단
    activateVCB(e.key);
  }, true); // capture phase — 다른 핸들러보다 먼저

  // ═══ Context Menu (오른쪽 짧게 클릭) ═══
  const ctxMenu = document.getElementById('context-menu');
  if (ctxMenu) {
    // 컨텍스트 메뉴 표시
    viewport.onContextMenu((x, y) => {
      // 라인 그리기 중 우클릭 → 라인 종료 + 메뉴도 표시
      if (toolManager.currentTool === 'line' && toolManager.isToolBusy()) {
        toolManager.cancelCurrentTool();
      }

      // ── 그룹/컴포넌트 메뉴 상황별 표시 ──
      const selected = toolManager.selection.getSelectedFaces();
      const hasSelection = selected.length > 0;
      const canGroup = selected.length >= 2;
      // 선택된 면 중 그룹에 속한 것이 있는지 확인
      let selectedGroupId: number | undefined;
      if (hasSelection) {
        selectedGroupId = toolManager.selection.getGroupId(selected[0]);
      }
      const isInGroup = selectedGroupId !== undefined;
      const isEditingGroup = toolManager.selection.isInGroupEditMode();

      // 그룹 메뉴 항목 가져오기
      const groupItems = ctxMenu.querySelectorAll('.ctx-group-item');
      const groupSep = ctxMenu.querySelector('.ctx-group-sep') as HTMLElement;

      // 각 항목별 표시 조건
      groupItems.forEach(item => {
        const el = item as HTMLElement;
        const action = el.dataset.action;
        let show = false;
        switch (action) {
          case 'group':          show = canGroup && !isInGroup; break;
          case 'ungroup':        show = isInGroup; break;
          case 'group-edit':     show = isInGroup && !isEditingGroup; break;
          case 'make-component': show = isInGroup; break;
          case 'group-lock':     show = isInGroup; break;
          case 'group-hide':     show = isInGroup; break;
        }
        el.style.display = show ? '' : 'none';
      });

      // 구분선: 그룹 관련 항목이 하나라도 보이면 표시
      const anyGroupVisible = Array.from(groupItems).some(
        el => (el as HTMLElement).style.display !== 'none'
      );
      if (groupSep) groupSep.style.display = anyGroupVisible ? '' : 'none';

      // 화면 밖으로 나가지 않도록 위치 조정
      const menuW = 200, menuH = 400;
      const cx = Math.min(x, window.innerWidth - menuW);
      // 하부 공간 부족 시 상부로 펼침 (ZWCAD 스타일)
      let cy: number;
      if (y + menuH > window.innerHeight) {
        cy = y - menuH;  // 클릭 위치 위로 펼침
      } else {
        cy = y;           // 클릭 위치 아래로 펼침
      }
      cy = Math.max(4, cy);
      ctxMenu.style.left = cx + 'px';
      ctxMenu.style.top = cy + 'px';
      ctxMenu.classList.add('visible');
    });

    // 메뉴 아이템 클릭
    ctxMenu.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.ctx-item') as HTMLElement;
      if (!item) return;
      const action = item.dataset.action;
      ctxMenu.classList.remove('visible');

      switch (action) {
        case 'snap-override': return; // hover로 처리, 클릭 무시
        case 'undo': toolManager.executeAction('undo'); break;
        case 'redo': toolManager.executeAction('redo'); break;
        case 'delete': toolManager.executeAction('delete'); break;
        case 'select-all': toolManager.executeAction('select-all'); break;
        case 'select-same': toolManager.executeAction('select-same'); break;
        case 'deselect': toolManager.selection.clearSelection(); break;
        // 그룹 / 컴포넌트
        case 'group': toolManager.executeAction('group'); break;
        case 'ungroup': toolManager.executeAction('ungroup'); break;
        case 'group-edit': {
          const faces = toolManager.selection.getSelectedFaces();
          if (faces.length > 0) {
            const gid = toolManager.selection.getGroupId(faces[0]);
            if (gid !== undefined) toolManager.selection.enterGroupEdit(gid);
          }
          break;
        }
        case 'make-component': toolManager.executeAction('make-component'); break;
        case 'group-lock': {
          const faces = toolManager.selection.getSelectedFaces();
          if (faces.length > 0) {
            const gid = toolManager.selection.getGroupId(faces[0]);
            if (gid !== undefined) bridge.toggleGroupLock(gid);
          }
          break;
        }
        case 'group-hide': {
          const faces = toolManager.selection.getSelectedFaces();
          if (faces.length > 0) {
            const gid = toolManager.selection.getGroupId(faces[0]);
            if (gid !== undefined) {
              bridge.toggleGroupVisibility(gid);
              toolManager.syncMesh();
            }
          }
          break;
        }
        // 뷰
        case 'view-top': viewport.setViewMode('top'); break;
        case 'view-front': viewport.setViewMode('front'); break;
        case 'view-right': viewport.setViewMode('right'); break;
        case 'view-3d': viewport.setViewMode('3d'); break;
      }

      // 뷰 모드 UI 동기화
      if (action?.startsWith('view-')) {
        const mode = action.replace('view-', '') as ViewMode;
        viewModeBar?.querySelectorAll('.view-btn').forEach(b =>
          b.classList.toggle('active', (b as HTMLElement).dataset.view === mode)
        );
        const toolLabel = document.getElementById('tool-label');
        if (toolLabel) {
          const viewNames: Record<string, string> = {
            '3d': '3D Perspective',
            top: 'Top (XY)', front: 'Front (XZ)',
            right: 'Right (YZ)',
          };
          toolLabel.textContent = viewNames[mode] || mode;
        }
      }
    });

    // ═══ 스냅 재지정 서브메뉴 — hover로 열기 (CAD 스타일) ═══
    const snapSub = document.getElementById('snap-submenu');
    const snapTrigger = ctxMenu.querySelector('.ctx-submenu-trigger') as HTMLElement;

    if (snapTrigger && snapSub) {
      // hover → 서브메뉴 표시
      snapTrigger.addEventListener('mouseenter', () => {
        const rect = snapTrigger.getBoundingClientRect();
        // 오른쪽으로 펼침, 화면 밖 방지
        let left = rect.right + 2;
        const subW = 210, subH = 480;
        if (left + subW > window.innerWidth) left = rect.left - subW - 2;
        // 하부 공간 부족 시 상부로 펼침 (ZWCAD 스타일)
        let top: number;
        if (rect.bottom + subH > window.innerHeight) {
          // 서브메뉴 하단을 트리거 하단에 맞춤 (위로 펼침)
          top = rect.bottom - subH;
        } else {
          // 서브메뉴 상단을 트리거 상단에 맞춤 (아래로 펼침)
          top = rect.top;
        }
        // 화면 상단 밖으로 나가지 않도록 클램프
        top = Math.max(4, top);
        snapSub.style.left = left + 'px';
        snapSub.style.top = top + 'px';
        snapSub.classList.add('visible');
      });

      // 메인 메뉴의 다른 항목에 hover하면 서브메뉴 닫기
      ctxMenu.querySelectorAll('.ctx-item').forEach(item => {
        if (item === snapTrigger) return;
        item.addEventListener('mouseenter', () => {
          snapSub.classList.remove('visible');
        });
      });

      // 서브메뉴 밖으로 나가면 닫기 (메인메뉴/서브메뉴 둘 다 벗어났을 때)
      let closeTimer: ReturnType<typeof setTimeout> | null = null;
      const startClose = () => {
        closeTimer = setTimeout(() => snapSub.classList.remove('visible'), 150);
      };
      const cancelClose = () => {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      };
      snapSub.addEventListener('mouseenter', cancelClose);
      snapSub.addEventListener('mouseleave', startClose);
      snapTrigger.addEventListener('mouseleave', startClose);
      snapTrigger.addEventListener('mouseenter', cancelClose);
    }

    // 메뉴 외부 클릭 시 닫기
    window.addEventListener('mousedown', (e) => {
      if (!ctxMenu.contains(e.target as Node) && !(snapSub && snapSub.contains(e.target as Node))) {
        ctxMenu.classList.remove('visible');
        snapSub?.classList.remove('visible');
      }
    });

    // ═══ 스냅 재지정 서브메뉴 클릭 ═══
    if (snapSub) {
      snapSub.addEventListener('click', (e) => {
        const item = (e.target as HTMLElement).closest('.snap-ov') as HTMLElement;
        if (!item) return;
        const snapType = item.dataset.snap;

        // 메뉴 닫기
        snapSub.classList.remove('visible');
        ctxMenu.classList.remove('visible');

        if (snapType === 'none') {
          // 스냅 일시 해제 (다음 클릭 한 번만)
          (window as any).__axia_snap_override = 'none';
        } else if (snapType === 'settings') {
          // OSNAP 설정 패널 열기
          const openFn = (window as any).__axia_openOsnapPanel;
          if (openFn) openFn();
        } else if (snapType) {
          // 스냅 재지정: 해당 모드만 활성화 (일회성)
          console.log('[OSNAP] Override snap:', snapType);
          // Store override for next click
          (window as any).__axia_snap_override = snapType;
        }
      });
    }
  }

  // ═══ OSNAP 설정 패널 (제도 설정값) ═══
  const osnapPanel = document.getElementById('osnap-panel');
  if (osnapPanel) {
    const masterCheck = document.getElementById('osnap-master') as HTMLInputElement;
    const modeChecks = osnapPanel.querySelectorAll<HTMLInputElement>('input[data-mode]');

    // 앱 시작 시 HTML checked 상태를 JS에 동기화
    modeChecks.forEach(cb => {
      const mode = cb.dataset.mode;
      if (mode) toolManager.snap.setMode(mode as any, cb.checked);
    });

    // 패널 열기 함수
    const openOsnapPanel = () => {
      // 현재 상태를 UI에 반영
      if (masterCheck) masterCheck.checked = toolManager.snap.enabled;
      modeChecks.forEach(cb => {
        const mode = cb.dataset.mode;
        if (mode) cb.checked = toolManager.snap.isActive(mode as any);
      });
      osnapPanel.classList.add('visible');
    };

    // 패널 닫기
    const closeOsnapPanel = () => osnapPanel.classList.remove('visible');

    // 체크박스 변경 즉시 반영 (CAD 스타일)
    const applySnapSettings = () => {
      toolManager.snap.enabled = masterCheck?.checked ?? true;
      modeChecks.forEach(cb => {
        const mode = cb.dataset.mode;
        if (mode) toolManager.snap.setMode(mode as any, cb.checked);
      });
      const slider = document.getElementById('osnap-size-slider') as HTMLInputElement;
      if (slider) {
        toolManager.snapVisual.setMarkerSize(parseInt(slider.value));
      }
      updateOsnapUI();
    };

    // 마스터 체크박스 즉시 반영
    if (masterCheck) {
      masterCheck.addEventListener('change', applySnapSettings);
    }

    // 각 모드 체크박스 즉시 반영
    modeChecks.forEach(cb => {
      cb.addEventListener('change', applySnapSettings);
    });

    // 확인 버튼: 설정 적용 후 닫기
    document.getElementById('osnap-ok')?.addEventListener('click', () => {
      applySnapSettings();
      closeOsnapPanel();
    });

    // 취소 버튼
    document.getElementById('osnap-cancel')?.addEventListener('click', closeOsnapPanel);
    document.getElementById('osnap-panel-close')?.addEventListener('click', closeOsnapPanel);

    // 모두 선택
    document.getElementById('osnap-select-all')?.addEventListener('click', () => {
      modeChecks.forEach(cb => cb.checked = true);
      applySnapSettings();
    });

    // 모두 지우기
    document.getElementById('osnap-clear-all')?.addEventListener('click', () => {
      modeChecks.forEach(cb => cb.checked = false);
      applySnapSettings();
    });

    // ── 스냅 표시 크기 슬라이더 + 미리보기 ──
    const sizeSlider = document.getElementById('osnap-size-slider') as HTMLInputElement;
    const sizePreview = document.getElementById('osnap-size-preview') as HTMLCanvasElement;

    const drawSizePreview = (halfSize: number) => {
      if (!sizePreview) return;
      const ctx = sizePreview.getContext('2d')!;
      const w = sizePreview.width, h = sizePreview.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      // 빨간 사각형 (끝점 마커 미리보기)
      const cx = w / 2, cy = h / 2;
      ctx.strokeStyle = '#FF3333';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(cx - halfSize, cy - halfSize, halfSize * 2, halfSize * 2);
    };

    if (sizeSlider) {
      // 초기 미리보기
      drawSizePreview(parseInt(sizeSlider.value));

      sizeSlider.addEventListener('input', () => {
        const val = parseInt(sizeSlider.value);
        drawSizePreview(val);
      });
    }

    // 패널 열 때 슬라이더 동기화
    const origOpen = openOsnapPanel;
    const openOsnapPanelWithSize = () => {
      origOpen();
      if (sizeSlider) {
        sizeSlider.value = String(toolManager.snapVisual?.getMarkerSize() ?? 8);
        drawSizePreview(parseInt(sizeSlider.value));
      }
    };

    // ESC로 닫기
    osnapPanel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeOsnapPanel();
    });

    // 스냅 재지정 메뉴의 "객체 스냅 설정(O)" 클릭 시 열기
    (window as any).__axia_openOsnapPanel = openOsnapPanelWithSize;

    // 상태바의 OSNAP 더블클릭으로도 열기
    osnapToggle?.addEventListener('dblclick', openOsnapPanelWithSize);
  }

  // ═══ 10. Project Save/Load (.xia) ═══

  /** Uint8Array → base64 문자열 */
  const toBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  /** base64 → Uint8Array */
  const fromBase64 = (b64: string): Uint8Array => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };

  /** .xia 프로젝트 파일 저장 */
  const saveProject = () => {
    const snapshot = bridge.exportSnapshot();
    if (!snapshot) {
      console.warn('[Save] WASM export_snapshot not available (WASM rebuild needed)');
      // Fallback: 메시 버퍼만 저장
      saveFallback();
      return;
    }

    const project = {
      format: 'xia',
      version: '1.0.0',
      engine: 'AXiA 3D',
      created: new Date().toISOString(),
      units: {
        unit: units.unit,
        precision: units.precision,
      },
      camera: viewport.getCameraState(),
      style: viewport.getStyleSettings(),
      mesh: toBase64(snapshot),
    };

    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `AXiA_Project_${new Date().toISOString().slice(0, 10)}.xia`;
    a.click();
    URL.revokeObjectURL(url);
    console.log('[Save] Project saved:', json.length, 'bytes');
  };

  /** WASM export 불가 시 fallback: 메시 버퍼를 직접 저장 */
  const saveFallback = () => {
    const buffers = bridge.getMeshBuffers();
    const edgeLines = bridge.getEdgeLines();

    const project = {
      format: 'xia',
      version: '1.0.0-fallback',
      engine: 'AXiA 3D',
      created: new Date().toISOString(),
      units: {
        unit: units.unit,
        precision: units.precision,
      },
      camera: viewport.getCameraState(),
      style: viewport.getStyleSettings(),
      buffers: buffers ? {
        positions: Array.from(buffers.positions),
        normals: Array.from(buffers.normals),
        indices: Array.from(buffers.indices),
        faceMap: Array.from(buffers.faceMap),
      } : null,
      edgeLines: edgeLines ? Array.from(edgeLines) : null,
    };

    const json = JSON.stringify(project);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `AXiA_Project_${new Date().toISOString().slice(0, 10)}.xia`;
    a.click();
    URL.revokeObjectURL(url);
    console.log('[Save] Fallback project saved:', json.length, 'bytes');
  };

  /** .xia 프로젝트 파일 열기 */
  const openProject = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xia';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const project = JSON.parse(text);

        if (project.format !== 'xia') {
          alert('올바른 .xia 파일이 아닙니다.');
          return;
        }

        // 메시 복원
        if (project.mesh) {
          const data = fromBase64(project.mesh);
          const ok = bridge.importSnapshot(data);
          if (ok) {
            toolManager.syncMesh();
            console.log('[Open] Mesh restored from snapshot');
          } else {
            console.error('[Open] importSnapshot failed');
          }
        }

        // 단위 복원
        if (project.units) {
          units.unit = project.units.unit;
          if (project.units.precision !== undefined) {
            units.precision = project.units.precision;
          }
        }

        // 카메라 복원
        if (project.camera) {
          viewport.setCameraState(project.camera);
        }

        // 스타일 복원
        if (project.style) {
          const s = project.style;
          viewport.updateBackground(s.bgMode, s.bgSkyColor, s.bgGroundColor, s.bgMidColor);
          if (s.frontColor !== undefined) viewport.setFaceColors(s.frontColor, s.backColor);
          if (s.edgeColor !== undefined) viewport.setEdgeStyle({ color: s.edgeColor, visible: s.edgeVisible });
          if (s.gridVisible !== undefined) viewport.setGridVisible(s.gridVisible);
          if (s.axisVisible !== undefined) viewport.setAxisVisible(s.axisVisible);
        }

        console.log('[Open] Project loaded:', file.name);
      } catch (e) {
        console.error('[Open] Failed to load project:', e);
        alert('파일을 불러오는데 실패했습니다.');
      }
    });
    input.click();
  };

  // ═══ 10b. DXF Import (Rust DCEL 변환) ═══
  const importDxfFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.dxf';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = async () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) return;

      console.log(`[DXF Import] 파일: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

      try {
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const result = bridge.importDxf(data);

        if (!result) {
          alert('DXF 가져오기 실패: WASM 엔진이 준비되지 않았습니다.\n로컬에서 wasm-pack 빌드 후 다시 시도해 주세요.');
          return;
        }

        if (!result.ok) {
          alert(`DXF 파싱 실패: ${result.error || '알 수 없는 오류'}`);
          return;
        }

        // 메시 동기화 (WASM → Three.js)
        toolManager.syncMesh();

        const summary = [
          result.lines && `선 ${result.lines}`,
          result.polylines && `폴리선 ${result.polylines}`,
          result.circles && `원 ${result.circles}`,
          result.arcs && `호 ${result.arcs}`,
          result.faces3d && `3D면 ${result.faces3d}`,
          result.solids && `솔리드 ${result.solids}`,
          result.ellipses && `타원 ${result.ellipses}`,
          result.splines && `스플라인 ${result.splines}`,
        ].filter(Boolean).join(', ');

        console.log(`[DXF Import] 완료: ${summary}`);
        console.log(`[DXF Import] 총 정점: ${result.totalVerts}, 총 면: ${result.totalFaces}, 스킵: ${result.skipped}`);

      } catch (err) {
        console.error('[DXF Import] 오류:', err);
        alert(`DXF 가져오기 중 오류: ${(err as Error).message}`);
      }
    };

    input.click();
  };

  // ═══ Boolean Operation Handler ═══
  const startBooleanOp = (op: 'union' | 'subtract' | 'intersect') => {
    // 현재 선택된 face들을 2그룹으로 나누어 Boolean 수행
    // MVP: 선택 시스템과 연동 — face 그룹 A, B를 번갈아 선택
    const selection = toolManager.selection.getSelectedFaces();
    if (selection.length < 2) {
      alert(
        `Boolean ${op}: 두 개의 솔리드를 선택해주세요.\n` +
        `현재 선택된 면: ${selection.length}개\n\n` +
        `사용법:\n` +
        `1. 첫 번째 솔리드의 면을 클릭 (Shift+클릭으로 여러 면)\n` +
        `2. 두 번째 솔리드의 면을 클릭\n` +
        `3. 수정 메뉴에서 Boolean 연산 선택`
      );
      return;
    }

    // 간단 분리: 선택 목록의 절반을 A, 나머지를 B로 처리
    // (향후: 솔리드 단위 자동 그룹핑)
    const mid = Math.ceil(selection.length / 2);
    const facesA = selection.slice(0, mid);
    const facesB = selection.slice(mid);

    console.log(`[Boolean] ${op}: A=${facesA.length} faces, B=${facesB.length} faces`);

    const result = bridge.booleanOp(facesA, facesB, op);
    if (!result) {
      alert('Boolean 연산 실패: WASM 엔진이 준비되지 않았습니다.');
      return;
    }

    if (!result.ok) {
      alert(`Boolean ${op} 실패: ${result.error || '알 수 없는 오류'}`);
      return;
    }

    toolManager.syncMesh();
    console.log(
      `[Boolean] ${op} 완료: 결과 면 ${result.resultFaces?.length ?? 0}개, ` +
      `총 정점 ${result.totalVerts}, 총 면 ${result.totalFaces}`
    );
  };

  // 글로벌 접근용
  (window as any).__axia_save = saveProject;
  (window as any).__axia_open = openProject;

  // ═══ 11. Style Side Panel ═══
  {
    const stylePanel = document.getElementById('style-panel');
    const styleBtn = document.getElementById('style-btn');
    const styleClose = document.getElementById('style-panel-close');

    const toggleStylePanel = () => {
      if (stylePanel) {
        stylePanel.classList.toggle('open');
        // 열릴 때 프리셋 그리기
        if (stylePanel.classList.contains('open')) {
          renderPresets();
          syncStyleUI();
        }
      }
    };

    styleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStylePanel();
    });
    styleClose?.addEventListener('click', () => stylePanel?.classList.remove('open'));

    // 키보드 S로 열기 (도구 전환과 충돌 방지: 이미 line 등에서 사용 가능하므로 주의)
    // Escape로 닫기
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape' && stylePanel?.classList.contains('open')) {
        stylePanel.classList.remove('open');
        e.stopPropagation();
      }
    });

    // ── 스타일 프리셋 정의 ──
    interface StylePreset {
      name: string;
      bgMode: 'solid' | 'gradient2' | 'gradient3';
      bgSkyColor: string;
      bgMidColor?: string;
      bgGroundColor: string;
      frontColor: number;
      backColor: number;
      edgeColor: number;
    }

    const presets: StylePreset[] = [
      { name: '건축 설계', bgMode: 'gradient2', bgSkyColor: '#8eaac4', bgGroundColor: '#d8dce2', frontColor: 0xe8e8e8, backColor: 0x8899bb, edgeColor: 0x333366 },
      { name: '밝은 하늘', bgMode: 'gradient2', bgSkyColor: '#87ceeb', bgGroundColor: '#d4e6c3', frontColor: 0xf5f5f5, backColor: 0xaabbcc, edgeColor: 0x444466 },
      { name: '클래식 흰색', bgMode: 'solid', bgSkyColor: '#ffffff', bgGroundColor: '#ffffff', frontColor: 0xf0f0f0, backColor: 0xc0c8d8, edgeColor: 0x333333 },
      { name: '다크 모드', bgMode: 'gradient2', bgSkyColor: '#0d0d1a', bgGroundColor: '#000000', frontColor: 0xcccccc, backColor: 0x667788, edgeColor: 0x222244 },
      { name: '블루프린트', bgMode: 'solid', bgSkyColor: '#1a2744', bgGroundColor: '#1a2744', frontColor: 0x6688bb, backColor: 0x445577, edgeColor: 0xaaccff },
      { name: '석양', bgMode: 'gradient3', bgSkyColor: '#1a0533', bgMidColor: '#cc4422', bgGroundColor: '#ffaa44', frontColor: 0xf0e0d0, backColor: 0x997766, edgeColor: 0x553322 },
      { name: '모노크롬', bgMode: 'gradient2', bgSkyColor: '#666666', bgGroundColor: '#222222', frontColor: 0xdddddd, backColor: 0x888888, edgeColor: 0x444444 },
      { name: '따뜻한 톤', bgMode: 'gradient2', bgSkyColor: '#5c4033', bgGroundColor: '#2a1810', frontColor: 0xf0dcc8, backColor: 0xaa9080, edgeColor: 0x443322 },
      { name: '네온', bgMode: 'solid', bgSkyColor: '#0a0a14', bgGroundColor: '#0a0a14', frontColor: 0x111122, backColor: 0x0a0a16, edgeColor: 0x00ffcc },
    ];

    let activePresetIdx = 0;

    /** 프리셋 썸네일을 캔버스로 그려서 그리드에 표시 */
    const renderPresets = () => {
      const container = document.getElementById('style-presets');
      if (!container) return;
      container.innerHTML = '';

      presets.forEach((p, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'sty-preset' + (i === activePresetIdx ? ' active' : '');

        const cvs = document.createElement('canvas');
        cvs.width = 80; cvs.height = 64;
        const ctx = cvs.getContext('2d')!;

        // 배경
        if (p.bgMode === 'solid') {
          ctx.fillStyle = p.bgSkyColor;
          ctx.fillRect(0, 0, 80, 64);
        } else {
          const grad = ctx.createLinearGradient(0, 0, 0, 64);
          grad.addColorStop(0, p.bgSkyColor);
          if (p.bgMode === 'gradient3' && p.bgMidColor) {
            grad.addColorStop(0.5, p.bgMidColor);
          }
          grad.addColorStop(1, p.bgGroundColor);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, 80, 64);
        }

        // 간단한 박스 미리보기
        const fc = '#' + p.frontColor.toString(16).padStart(6, '0');
        const ec = '#' + p.edgeColor.toString(16).padStart(6, '0');

        // 3D 박스 면
        ctx.fillStyle = fc;
        ctx.beginPath();
        ctx.moveTo(22, 44); ctx.lineTo(22, 20); ctx.lineTo(46, 12); ctx.lineTo(46, 36); ctx.closePath();
        ctx.fill();

        // 윗면 (약간 밝게)
        ctx.fillStyle = fc;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(22, 20); ctx.lineTo(40, 14); ctx.lineTo(58, 22); ctx.lineTo(46, 12);
        // 올바른 사다리꼴
        ctx.moveTo(22, 20); ctx.lineTo(46, 12); ctx.lineTo(62, 18); ctx.lineTo(38, 26); ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;

        // 오른쪽 면 (약간 어둡게)
        const bc = '#' + p.backColor.toString(16).padStart(6, '0');
        ctx.fillStyle = bc;
        ctx.beginPath();
        ctx.moveTo(46, 12); ctx.lineTo(62, 18); ctx.lineTo(62, 42); ctx.lineTo(46, 36); ctx.closePath();
        ctx.fill();

        // 엣지
        ctx.strokeStyle = ec;
        ctx.lineWidth = 1;
        ctx.beginPath();
        // 앞면
        ctx.moveTo(22, 44); ctx.lineTo(22, 20); ctx.lineTo(46, 12); ctx.lineTo(46, 36); ctx.lineTo(22, 44);
        // 윗면
        ctx.moveTo(22, 20); ctx.lineTo(38, 26); ctx.lineTo(62, 18); ctx.lineTo(46, 12);
        // 오른쪽 면
        ctx.moveTo(46, 36); ctx.lineTo(62, 42); ctx.lineTo(62, 18);
        // 바닥선
        ctx.moveTo(22, 44); ctx.lineTo(38, 50); ctx.lineTo(62, 42);
        ctx.stroke();

        // 바닥 그리드선 (얇게)
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 0.5;
        for (let x = 10; x < 75; x += 12) {
          ctx.beginPath(); ctx.moveTo(x, 58); ctx.lineTo(x + 6, 52); ctx.stroke();
        }

        wrap.appendChild(cvs);

        const label = document.createElement('div');
        label.className = 'sty-preset-name';
        label.textContent = p.name;
        wrap.appendChild(label);

        wrap.addEventListener('click', () => {
          activePresetIdx = i;
          viewport.applyStylePreset(p);
          renderPresets();
          syncStyleUI();
        });

        container.appendChild(wrap);
      });
    };

    /** UI 컨트롤을 현재 뷰포트 설정에 맞춤 */
    const syncStyleUI = () => {
      const s = viewport.getStyleSettings();
      const bgMode = document.getElementById('sty-bg-mode') as HTMLSelectElement;
      if (bgMode) bgMode.value = s.bgMode;

      const setStyColor = (id: string, hex: string) => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) el.value = hex;
      };
      setStyColor('sty-bg-sky', s.bgSkyColor);
      setStyColor('sty-bg-mid', s.bgMidColor);
      setStyColor('sty-bg-ground', s.bgGroundColor);
      setStyColor('sty-face-front', '#' + s.frontColor.toString(16).padStart(6, '0'));
      setStyColor('sty-face-back', '#' + s.backColor.toString(16).padStart(6, '0'));
      setStyColor('sty-edge-color', '#' + s.edgeColor.toString(16).padStart(6, '0'));

      // 투명도
      const opSlider = document.getElementById('sty-face-opacity') as HTMLInputElement;
      if (opSlider) opSlider.value = String(Math.round(s.faceOpacity * 100));
      const opVal = document.getElementById('sty-face-opacity-val');
      if (opVal) opVal.textContent = Math.round(s.faceOpacity * 100) + '%';

      // 엣지
      (document.getElementById('sty-edge-visible') as HTMLInputElement).checked = s.edgeVisible;
      (document.getElementById('sty-edge-profile') as HTMLInputElement).checked = s.profileEdge;

      // 환경
      (document.getElementById('sty-grid-visible') as HTMLInputElement).checked = s.gridVisible;
      (document.getElementById('sty-axis-visible') as HTMLInputElement).checked = s.axisVisible;

      // 중간색 행 표시
      const midRow = document.getElementById('sty-bg-mid-row');
      const groundRow = document.getElementById('sty-bg-ground-row');
      if (midRow) midRow.style.display = s.bgMode === 'gradient3' ? 'flex' : 'none';
      if (groundRow) groundRow.style.display = s.bgMode === 'solid' ? 'none' : 'flex';
    };

    // ── 이벤트 바인딩 ──

    // 배경 모드 변경
    document.getElementById('sty-bg-mode')?.addEventListener('change', (e) => {
      const mode = (e.target as HTMLSelectElement).value as 'solid' | 'gradient2' | 'gradient3';
      viewport.updateBackground(mode);
      syncStyleUI();
    });

    // 배경 색상 변경
    const bindBgColor = (id: string, param: 'sky' | 'ground' | 'mid') => {
      document.getElementById(id)?.addEventListener('input', (e) => {
        const val = (e.target as HTMLInputElement).value;
        if (param === 'sky') viewport.updateBackground(undefined, val);
        else if (param === 'ground') viewport.updateBackground(undefined, undefined, val);
        else viewport.updateBackground(undefined, undefined, undefined, val);
      });
    };
    bindBgColor('sty-bg-sky', 'sky');
    bindBgColor('sty-bg-ground', 'ground');
    bindBgColor('sty-bg-mid', 'mid');

    // 면 색상
    document.getElementById('sty-face-front')?.addEventListener('input', (e) => {
      const hex = parseInt((e.target as HTMLInputElement).value.replace('#', ''), 16);
      viewport.setFaceColors(hex, undefined);
    });
    document.getElementById('sty-face-back')?.addEventListener('input', (e) => {
      const hex = parseInt((e.target as HTMLInputElement).value.replace('#', ''), 16);
      viewport.setFaceColors(undefined, hex);
    });

    // 투명도
    document.getElementById('sty-face-opacity')?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value);
      viewport.setFaceOpacity(val / 100);
      const label = document.getElementById('sty-face-opacity-val');
      if (label) label.textContent = val + '%';
    });

    // 엣지 색상
    document.getElementById('sty-edge-color')?.addEventListener('input', (e) => {
      const hex = parseInt((e.target as HTMLInputElement).value.replace('#', ''), 16);
      viewport.setEdgeStyle({ color: hex });
    });

    // 엣지 두께 표시 (현재는 LineBasicMaterial이라 실제 두께 변경 제한적)
    document.getElementById('sty-edge-width')?.addEventListener('input', (e) => {
      const val = (e.target as HTMLInputElement).value;
      const label = document.getElementById('sty-edge-width-val');
      if (label) label.textContent = val;
    });

    // 엣지 표시
    document.getElementById('sty-edge-visible')?.addEventListener('change', (e) => {
      viewport.setEdgeStyle({ visible: (e.target as HTMLInputElement).checked });
    });
    document.getElementById('sty-edge-profile')?.addEventListener('change', (e) => {
      viewport.setEdgeStyle({ profileEdge: (e.target as HTMLInputElement).checked });
    });

    // 환경 토글
    document.getElementById('sty-grid-visible')?.addEventListener('change', (e) => {
      viewport.setGridVisible((e.target as HTMLInputElement).checked);
    });
    document.getElementById('sty-axis-visible')?.addEventListener('change', (e) => {
      viewport.setAxisVisible((e.target as HTMLInputElement).checked);
    });

    // 그리드 색상
    document.getElementById('sty-grid-color')?.addEventListener('input', (e) => {
      const hex = parseInt((e.target as HTMLInputElement).value.replace('#', ''), 16);
      viewport.setGridColor(hex);
    });
  }

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
