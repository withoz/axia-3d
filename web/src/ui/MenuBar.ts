/**
 * CAD Menu Bar — File / Edit / View / Draw / Modify / Format / Help
 *
 * Extracted from main.ts (section 4a, lines 284-553).
 * Pure action dispatcher: no internal state, just routes menu-action data-attributes
 * to the appropriate service calls.
 */

import * as THREE from 'three';
import { Viewport, ViewMode } from '../viewport/Viewport';
import { WasmBridge } from '../bridge/WasmBridge';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { FileManager } from '../file/FileManager';
import { startBooleanOp } from './BooleanHandler';
import { debugLog } from '../utils/debug';
import { Toast } from './Toast';
import type { ImportFormat } from '../import/FileImporter';
import { timestampedName } from '../export/ExportUtils';

export interface MenuBarDeps {
  viewport: Viewport;
  bridge: WasmBridge;
  toolManager: ToolManager;
  /** Three.js scene for lazy FileImporter construction */
  scene: THREE.Scene;
  fileManager: FileManager;
  /** Project save callback (replaces window.__axia_save) */
  saveProject?: () => void;
  /** Project open callback (replaces window.__axia_open) */
  openProject?: () => void;
  /** OSNAP settings panel open callback (replaces window.__axia_openOsnapPanel) */
  openOsnapPanel?: () => void;
}

/** Tool name → display name mapping */
const toolNames: Record<string, string> = {
  select: 'Select', line: 'Line', rect: 'Rectangle',
  circle: 'Circle', pushpull: 'Push/Pull', move: 'Move',
  sphere: 'Sphere', cylinder: 'Cylinder', cone: 'Cone',
};

export function initMenuBar(deps: MenuBarDeps): void {
  const { viewport, bridge, toolManager, scene, fileManager,
          saveProject, openProject, openOsnapPanel } = deps;

  // ── Lazy-loaded modules (deferred until first use) ──
  let _fileImporter: any = null;
  const getFileImporter = async () => {
    if (!_fileImporter) {
      const { FileImporter } = await import('../import/FileImporter');
      _fileImporter = new FileImporter(scene);
    }
    return _fileImporter;
  };

  const lazyExportDxf = async (scene3d: THREE.Scene, fileName: string) => {
    const { DxfExporter } = await import('../export/DxfExporter');
    DxfExporter.downloadDxf(scene3d, fileName);
  };

  const lazyExportObj = async (scene3d: THREE.Scene, fileName: string) => {
    const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
    const { downloadText } = await import('../export/ExportUtils');
    const result = new OBJExporter().parse(scene3d);
    downloadText(result, fileName, 'text/plain');
  };

  const lazyExportGltf = async (scene3d: THREE.Scene, fileName: string) => {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const { downloadBlob } = await import('../export/ExportUtils');
    const exporter = new GLTFExporter();
    const glb = await exporter.parseAsync(scene3d, { binary: true });
    downloadBlob(new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' }), fileName);
  };

  const lazyExportStl = async (scene3d: THREE.Scene, fileName: string) => {
    const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
    const { downloadBlob } = await import('../export/ExportUtils');
    const exporter = new STLExporter();
    const buffer = exporter.parse(scene3d, { binary: true }) as unknown as ArrayBuffer;
    downloadBlob(new Blob([buffer], { type: 'model/stl' }), fileName);
  };

  const menubar = document.getElementById('menubar');
  if (!menubar) return;

  let openMenu: HTMLElement | null = null;

  // ── 메뉴 열기/닫기 ──
  const closeAllMenus = () => {
    menubar.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
    openMenu = null;
  };

  // 메뉴 항목 클릭 → 토글
  menubar.querySelectorAll(':scope > .menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
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

  // ── 헬퍼 ──
  const setActiveTool = (tool: string) => {
    toolManager.setTool(tool);
    const tb = document.getElementById('toolbar')!;
    tb.querySelectorAll('.tool-btn').forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.tool === tool);
    });
    const toolLabel = document.getElementById('tool-label');
    if (toolLabel) {
      toolLabel.textContent = toolNames[tool] || tool;
    }
  };

  const setActiveView = (view: string) => {
    viewport.setViewMode(view as ViewMode);
    const vmBar = document.getElementById('view-mode-bar');
    vmBar?.querySelectorAll('.view-btn').forEach(b =>
      b.classList.toggle('active', (b as HTMLElement).dataset.view === view)
    );
  };

  // ── Action Dispatcher ──
  menubar.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest('.menu-action') as HTMLElement;
    if (!action) return;
    const act = action.dataset.action;
    if (!act) return;

    closeAllMenus();

    switch (act) {
      // ── 파일 ──
      case 'file-new':
        if (confirm('현재 작업을 초기화하시겠습니까?')) {
          location.reload();
        }
        break;
      case 'file-open':
        openProject?.();
        break;
      case 'file-save':
        saveProject?.();
        break;
      case 'file-saveas':
        fileManager.saveAsProject();
        break;

      // ── 가져오기 (Import) ──
      case 'import-all':
      case 'import-obj':
      case 'import-stl':
      case 'import-gltf':
      case 'import-dae':
      case 'import-ply':
      case 'import-3ds':
      case 'import-dxf':
      case 'import-dwg':
      case 'import-skp':
      case 'import-3dm': {
        const format = act === 'import-all' ? undefined : act.replace('import-', '');
        getFileImporter().then(fi => fi.openFileDialog(format as ImportFormat | undefined)).catch((err: Error) => {
          console.error(`[MenuBar] Import ${format || 'all'} 실패:`, err);
        });
        break;
      }

      // ── 내보내기 (Export) ──
      case 'export-dxf': {
        lazyExportDxf(viewport.scene, timestampedName('dxf'))
          .then(() => debugLog('[MenuBar] DXF 내보내기 완료'))
          .catch((err) => {
            console.error('[MenuBar] DXF 내보내기 실패:', err);
            alert('DXF 내보내기에 실패했습니다');
          });
        break;
      }
      case 'export-obj': {
        const objName = timestampedName('obj');
        lazyExportObj(viewport.scene, objName)
          .then(() => debugLog('[MenuBar] OBJ 내보내기 완료'))
          .catch((err) => { console.error('[MenuBar] OBJ 내보내기 실패:', err); alert('OBJ 내보내기에 실패했습니다'); });
        break;
      }
      case 'export-gltf': {
        const glbName = timestampedName('glb');
        lazyExportGltf(viewport.scene, glbName)
          .then(() => debugLog('[MenuBar] glTF 내보내기 완료'))
          .catch((err) => { console.error('[MenuBar] glTF 내보내기 실패:', err); alert('glTF 내보내기에 실패했습니다'); });
        break;
      }
      case 'export-stl': {
        const stlName = timestampedName('stl');
        lazyExportStl(viewport.scene, stlName)
          .then(() => debugLog('[MenuBar] STL 내보내기 완료'))
          .catch((err) => { console.error('[MenuBar] STL 내보내기 실패:', err); alert('STL 내보내기에 실패했습니다'); });
        break;
      }

      // ── 편집 ──
      case 'undo': toolManager.executeAction('undo'); break;
      case 'redo': toolManager.executeAction('redo'); break;
      case 'delete': toolManager.executeAction('delete'); break;
      case 'select-all': toolManager.executeAction('select-all'); break;
      case 'select-same': toolManager.executeAction('select-same'); break;
      case 'deselect': toolManager.selection.clearSelection(); break;

      // ── 보기 ──
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
        const next = !s.gridVisible;
        viewport.setGridVisible(next);
        Toast.info(`그리드 ${next ? '표시' : '숨김'}`);
        break;
      }
      case 'view-axis': {
        const s = viewport.getStyleSettings();
        const next = !s.axisVisible;
        viewport.setAxisVisible(next);
        Toast.info(`축 ${next ? '표시' : '숨김'}`);
        break;
      }

      // ── 그리기 ──
      case 'tool-line': setActiveTool('line'); break;
      case 'tool-polyline': setActiveTool('polyline'); break;
      case 'tool-rect': setActiveTool('rect'); break;
      case 'tool-polygon': setActiveTool('polygon'); break;
      case 'tool-circle': setActiveTool('circle'); break;
      case 'tool-arc': setActiveTool('arc'); break;
      case 'tool-freehand': setActiveTool('freehand'); break;
      case 'tool-bezier': setActiveTool('bezier'); break;
      case 'tool-point': setActiveTool('point'); break;
      case 'tool-text3d': setActiveTool('text3d'); break;

      // ── 수정 ──
      case 'tool-pushpull': setActiveTool('pushpull'); break;
      case 'tool-sphere': setActiveTool('sphere'); break;
      case 'tool-cylinder': setActiveTool('cylinder'); break;
      case 'tool-cone': setActiveTool('cone'); break;
      case 'tool-move': setActiveTool('move'); break;
      case 'tool-rotate': setActiveTool('rotate'); break;
      case 'tool-scale': setActiveTool('scale'); break;
      case 'tool-offset': setActiveTool('offset'); break;
      // Mirror — 현재는 WORLD YZ 평면 기준 (x 반전) 기본값. 다른 축은 우클릭
      // 컨텍스트 메뉴에서 mirror-y / mirror-z 선택.
      case 'tool-mirror': toolManager.executeAction('mirror-x'); break;
      case 'subdivide': toolManager.executeAction('subdivide'); break;
      case 'tool-array': setActiveTool('array'); break;
      case 'tool-trim': setActiveTool('trim'); break;
      case 'tool-extend': setActiveTool('extend'); break;
      // Fillet — 선택된 엣지 1개에 모깎기 적용. 도구가 아니라 액션이므로
      // 활성 도구 전환 없이 즉시 실행.
      case 'tool-fillet': toolManager.executeAction('fillet-edge'); break;
      case 'tool-chamfer': setActiveTool('chamfer'); break;
      case 'tool-explode': setActiveTool('explode'); break;
      case 'tool-group': toolManager.executeAction('group'); break;
      case 'tool-ungroup': toolManager.executeAction('ungroup'); break;
      case 'synthesize-faces': toolManager.executeAction('synthesize-faces'); break;
      case 'tool-make-component': toolManager.executeAction('make-component'); break;

      // ── Boolean ──
      case 'bool-union': startBooleanOp({ bridge, toolManager }, 'union'); break;
      case 'bool-subtract': startBooleanOp({ bridge, toolManager }, 'subtract'); break;
      case 'bool-intersect': startBooleanOp({ bridge, toolManager }, 'intersect'); break;

      // ── 형식 ──
      case 'format-units':
        document.getElementById('settings-btn')?.click();
        break;
      case 'format-style':
        document.getElementById('style-btn')?.click();
        break;
      case 'format-osnap':
        openOsnapPanel?.();
        break;

      // ── 도움말 ──
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
