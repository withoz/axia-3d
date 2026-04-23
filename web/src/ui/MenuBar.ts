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

  // 패널이 현재 열려있는지 — window의 전역 참조에서 isVisible() 우선,
  // 없으면 .visible 필드, 둘 다 없으면 false 반환.
  const isPanelOpen = (globalKey: string): boolean => {
    const panel = (window as unknown as Record<string, unknown>)[globalKey];
    if (!panel || typeof panel !== 'object') return false;
    const p = panel as { isVisible?: () => boolean; visible?: boolean };
    if (typeof p.isVisible === 'function') return !!p.isVisible();
    return !!p.visible;
  };

  // 토글 메뉴 항목의 상태 동기화 — 메뉴 열릴 때마다 현재 viewport/panel
  // 상태를 읽어 .toggle-on 클래스를 부여/제거. CSS에서 ✓ 표시를 처리한다.
  const syncToggleStates = () => {
    // 각 getter는 optional chaining으로 보호 — 테스트 mock은 일부 메서드만
    // 제공하므로 없을 경우 false로 fallback.
    const state: Record<string, boolean> = {
      'view-grid': viewport.infiniteGrid?.visible ?? true,
      'view-axis': viewport.axisGroup?.visible ?? true,
      'view-ssao': viewport.isSsaoEnabled?.() ?? false,
      'view-shadow-pro': viewport.isProjectedShadowEnabled?.() ?? false,
      'view-fur': viewport.isFurEnabled?.() ?? false,
      'view-sun-panel': isPanelOpen('__axia_sunPanel'),
      'view-history': isPanelOpen('__axia_historyPanel'),
    };
    for (const [action, on] of Object.entries(state)) {
      const el = menubar.querySelector(`.menu-action[data-action="${action}"]`);
      if (el) el.classList.toggle('toggle-on', on);
    }
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
        syncToggleStates();
        el.classList.add('open');
        openMenu = el;
      }
    });
    // 호버로 전환 (이미 하나가 열려있으면)
    item.addEventListener('mouseenter', () => {
      if (openMenu && openMenu !== item) {
        closeAllMenus();
        syncToggleStates();
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
      case 'clipboard-copy':
      case 'clipboard-cut':
      case 'clipboard-paste':
      case 'duplicate':
        toolManager.executeAction(act);
        break;
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
      case 'measure-selection':
        // 선택 상태에 따라 길이/면적/부피 Toast 출력.
        toolManager.executeAction('measure-selection');
        break;
      case 'view-ssao': {
        const next = !viewport.isSsaoEnabled();
        viewport.setSsaoEnabled(next);
        Toast.info(`주변광 차폐 ${next ? '켜짐' : '꺼짐'}`);
        break;
      }
      case 'view-fur': {
        const next = !viewport.isFurEnabled();
        viewport.setFurEnabled(next);
        Toast.info(`털 쉐이더 ${next ? '켜짐 (24 shell, 드로우콜 증가 주의)' : '꺼짐'}`);
        break;
      }
      case 'view-shadow-pro': {
        const next = !viewport.isProjectedShadowEnabled();
        viewport.setProjectedShadowEnabled(next);
        if (next) {
          // 즉시 projected shadow 계산을 위해 syncMesh 트리거
          toolManager.syncMesh();
        }
        Toast.info(
          `건축 그림자 (Projected + VSM) ${next ? '켜짐 — 매스 silhouette + 곡면 subtle 음영' : '꺼짐'}`,
          3000,
        );
        break;
      }
      case 'view-sun-panel': {
        const sp = (window as unknown as { __axia_sunPanel?: { toggle(): void } }).__axia_sunPanel;
        sp?.toggle();
        break;
      }
      case 'reference-image': {
        // 참조 이미지 overlay — 사진 따라 그리기 / 비율 맞추기 용.
        // HTML <img> overlay 방식: 3D 씬과 독립, 카메라 이동해도 고정.
        void import('./ReferenceImage').then(({ promptAndAddReferenceImage }) => {
          void promptAndAddReferenceImage(viewport.container).then(ref => {
            if (ref) Toast.info('참조 이미지 불러옴 — Shift+휠로 크기, 드래그로 이동', 3500);
          });
        });
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
      case 'tool-erase': setActiveTool('erase'); break;
      // Mirror (world-axis) — 메뉴에서 직접 X/Y/Z 반전 선택. tool-mirror alias는
      // 레거시 진입점 (x축 기본값).
      case 'tool-mirror': toolManager.executeAction('mirror-x'); break;
      case 'mirror-x':
      case 'mirror-y':
      case 'mirror-z':
        toolManager.executeAction(act);
        break;
      case 'subdivide': toolManager.executeAction('subdivide'); break;
      // Array — 선형/원형 직접 진입. tool-array는 레거시 linear alias.
      case 'tool-array': toolManager.executeAction('array-linear'); break;
      case 'array-linear':
      case 'array-radial':
        toolManager.executeAction(act);
        break;
      // Revolve — 선택 엣지 체인을 축(X/Y/Z) 중심으로 회전체 생성.
      case 'revolve-x':
      case 'revolve-y':
      case 'revolve-z':
        toolManager.executeAction(act);
        break;
      // Deformation — 축 기반 Bend/Twist/Taper (비선형 정점 변형).
      case 'bend-selection':
      case 'twist-selection':
      case 'taper-selection':
        toolManager.executeAction(act);
        break;
      // Fillet/Chamfer — 엣지 직접 진입 액션 (tool-fillet/tool-chamfer와 동일).
      case 'fillet-edge':
      case 'chamfer-edge':
        toolManager.executeAction(act);
        break;
      // Thicken — 선택 면에 두께를 부여 (push_pull 기반 slab).
      case 'thicken-faces': toolManager.executeAction('thicken-faces'); break;
      // Quick Color — 선택 면에 즉석 custom material 할당.
      case 'assign-quick-color': toolManager.executeAction('assign-quick-color'); break;
      // Measure Tool — 인터랙티브 2점 거리 / 3점 각도 (SelectTool 계열).
      case 'tool-measure': setActiveTool('measure'); break;
      case 'tool-centerline': setActiveTool('centerline'); break;
      case 'convert-to-centerline':
      case 'convert-to-geometry':
        toolManager.executeAction(act);
        break;
      case 'tool-trim': setActiveTool('trim'); break;
      case 'tool-extend': setActiveTool('extend'); break;
      // Fillet — 선택된 엣지 1개에 모깎기 적용. 도구가 아니라 액션이므로
      // 활성 도구 전환 없이 즉시 실행.
      case 'tool-fillet': toolManager.executeAction('fillet-edge'); break;
      // Chamfer — 선택된 엣지 1개에 모따기 적용. Fillet과 동일 파라미터
      // (거리)지만 세그먼트 없이 평면 bevel.
      case 'tool-chamfer': toolManager.executeAction('chamfer-edge'); break;
      case 'tool-explode': setActiveTool('explode'); break;
      case 'tool-group': toolManager.executeAction('group'); break;
      case 'tool-ungroup': toolManager.executeAction('ungroup'); break;
      case 'synthesize-faces': toolManager.executeAction('synthesize-faces'); break;
      case 'view-history': {
        const hp = (window as unknown as { __axia_historyPanel?: { toggle(): void } }).__axia_historyPanel;
        hp?.toggle();
        break;
      }
      case 'view-scenes': {
        const sm = (window as unknown as { __axia_scenes?: { toggle(): void } }).__axia_scenes;
        sm?.toggle();
        break;
      }
      case 'clash-detect': {
        (async () => {
          const { ClashDetection } = await import('../tools/ClashDetection');
          const cd = new ClashDetection(viewport);
          const results = cd.detect();
          (window as unknown as { __axia_clash?: typeof cd }).__axia_clash = cd;
          if (results.length === 0) {
            Toast.info('간섭 없음 ✓', 2500);
          } else {
            const totalVol = results.reduce((s, r) => s + r.volume_mm3, 0);
            Toast.info(
              `⚠️ ${results.length}개 간섭 발견 (총 ${(totalVol / 1e9).toFixed(2)}m³). 빨간 박스 확인.`,
              5000,
            );
          }
        })();
        break;
      }
      case 'clash-clear': {
        const cd = (window as unknown as { __axia_clash?: { clear(): void } }).__axia_clash;
        cd?.clear();
        Toast.info('간섭 표시 해제');
        break;
      }
      case 'solar-heatmap': {
        // 1회성 lazy init + generate.
        const dateStr = prompt('기준 날짜 (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
        if (!dateStr) break;
        const latStr = prompt('위도 (도)', '37.5665');
        if (!latStr) break;
        const lonStr = prompt('경도 (도)', '126.978');
        if (!lonStr) break;
        Toast.info('Solar heatmap 계산 중… (12 시간대 샘플)', 3000);
        (async () => {
          const { SolarHeatmap } = await import('../viewport/SolarHeatmap');
          const hm = new SolarHeatmap(viewport, bridge);
          await hm.generate({
            resolution: 60,
            sizeMM: 30000,
            timeSamples: 12,
            lat: parseFloat(latStr),
            lon: parseFloat(lonStr),
            dateISO: dateStr,
          });
          // 전역 참조 — 재사용 / 숨김
          (window as unknown as { __axia_heatmap?: typeof hm }).__axia_heatmap = hm;
          Toast.info('Solar heatmap 생성 완료', 2500);
        })().catch((err) => {
          console.error('[Heatmap] error:', err);
          alert('Heatmap 생성 실패: ' + err);
        });
        break;
      }
      case 'solar-heatmap-off': {
        const hm = (window as unknown as { __axia_heatmap?: { remove(): void } }).__axia_heatmap;
        hm?.remove();
        Toast.info('Solar heatmap 숨김');
        break;
      }
      case 'upload-texture': {
        const selected = toolManager.selection.getSelectedFaces();
        import('./TextureUploadDialog').then(({ openTextureUploadDialog }) => {
          openTextureUploadDialog(selected).then((result) => {
            if (result) toolManager.syncMesh();
          }).catch((err) => {
            console.error('[Texture] upload failed:', err);
            alert('텍스처 업로드 실패: ' + err);
          });
        });
        break;
      }
      case 'section-x':
      case 'section-y':
      case 'section-z':
      case 'section-off': {
        const sp = (window as unknown as {
          __axia_section?: { setAxis(a: 'x'|'y'|'z'|'off'): void; setPosition(p: number): void }
        }).__axia_section;
        if (!sp) break;
        const axis = act.replace('section-', '') as 'x'|'y'|'z'|'off';
        if (axis === 'off') {
          sp.setAxis('off');
          Toast.info('섹션 평면 해제됨', 2000);
          break;
        }
        const posStr = prompt(
          `섹션 ${axis.toUpperCase()}축 위치 (mm, 기본 0)`,
          '0',
        );
        if (posStr === null) break;
        const pos = parseFloat(posStr);
        if (!Number.isFinite(pos)) { alert('유효한 숫자를 입력해주세요.'); break; }
        sp.setAxis(axis);
        sp.setPosition(pos);
        Toast.info(`섹션 ${axis.toUpperCase()}축 @ ${pos}mm 활성`, 2500);
        break;
      }
      case 'solidify': toolManager.executeAction('solidify'); break;
      case 'mesh-repair': toolManager.executeAction('mesh-repair'); break;
      // Sketch Mode — 드로잉을 고정 평면에 잠금. Push/Pull로 3D 변환 前 작업.
      case 'sketch-start-xz':
      case 'sketch-start-xy':
      case 'sketch-start-yz':
      case 'sketch-start-face':
      case 'sketch-exit':
        toolManager.executeAction(act);
        break;
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
