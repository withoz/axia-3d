/**
 * Tool Manager (Refactored) — Coordinates tool dispatch and manages shared state.
 * Now uses a clean Tool interface pattern with individual tool implementations.
 */

import * as THREE from 'three';
import { Viewport } from '../viewport/Viewport';
import { WasmBridge } from '../bridge/WasmBridge';
import { DimensionLabel, DimLine } from '../ui/DimensionLabel';
import { UnitSystem } from '../units/UnitSystem';
import { SnapManager } from '../snap/SnapManager';
import { SnapVisual } from '../snap/SnapVisual';
import { DrawPlaneIndicator } from '../viewport/DrawPlaneIndicator';
import { SelectionManager } from './SelectionManager';
import { PickBox } from '../ui/PickBox';
import { ITool, ToolContext, DrawPlaneInfo } from './ITool';
import { ConstraintCommands } from './ConstraintCommands';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';
import { getMergeTolerance, getRespectMaterial, groupFacesByMaterial } from './MergeSettings';
import { extractEdgeChain } from './EdgeChain';
import { getMaterialLibrary } from '../materials/MaterialLibrary';
import { getOperationLog } from '../core/OperationLog';
import { getClipboard } from '../core/Clipboard';
import { ServiceContainer } from '../core/ServiceContainer';
import '../utils/debug'; // Window interface augmentation

// Import all tools
import { SelectTool } from './SelectTool';
import { DrawLineTool } from './DrawLineTool';
import { DrawRectTool } from './DrawRectTool';
import { DrawCircleTool } from './DrawCircleTool';
import { DrawPolygonTool } from './DrawPolygonTool';
import { DrawArcTool } from './DrawArcTool';
import { DrawFreehandTool } from './DrawFreehandTool';
import { DrawBezierTool } from './DrawBezierTool';
import { PushPullTool } from './PushPullTool';
import { MoveTool } from './MoveTool';
import { RotateTool } from './RotateTool';
import { ScaleTool } from './ScaleTool';
import { OffsetTool } from './OffsetTool';
import { EraseTool } from './EraseTool';
import { SplitTool } from './SplitTool';
import { GroupTool } from './GroupTool';
import { MeasureTool } from './MeasureTool';
import { DrawCenterlineTool } from './DrawCenterlineTool';
import { SphereTool } from '../primitives/SphereTool';
import { CylinderTool } from '../primitives/CylinderTool';
import { ConeTool } from '../primitives/ConeTool';
import { BoxTool } from './BoxTool';
import { SliceTool } from './SliceTool';
import {
  mergeFaces, mergeFacesGeometric, mergeFacesForce,
  mergeXiaCoplanar, mergeAsHole,
  type MergeActionContext,
} from './actions/MergeActions';

export class ToolManager {
  // 2026-04-23: private→public. KeyboardShortcuts/SnapVisual 등 외부 소비자가
  //   activeCamera/scene/renderer를 읽기 위함. 쓰기용 encapsulation은
  //   Viewport 내부 메서드(setStats 등)가 담당.
  public viewport: Viewport;
  private bridge: WasmBridge;
  private container?: ServiceContainer;  // Phase 1: Dependency injection container
  private _currentTool: string = 'select';
  private dimLabel: DimensionLabel;
  private units: UnitSystem;

  // ═══ Snap System ═══
  readonly snap: SnapManager;
  readonly snapVisual: SnapVisual;

  // ═══ Selection System ═══
  readonly selection: SelectionManager;

  // Face/Edge maps
  private faceMap: Uint32Array = new Uint32Array(0);
  private edgeMap: Uint32Array | null = null;

  // ═══ Selection Dimension Display (Stage 1) ═══
  private selectionDimLines: DimLine[] = [];

  // ═══ 3D Axis Inference (SketchUp style) ═══
  private axisLock: 'x' | 'y' | 'z' | 'free' | null = null;
  private inferredAxis: 'x' | 'y' | 'z' | 'free' = 'free';
  private axisGuide: THREE.Line | null = null;

  // ═══ Pickbox (CAD cursor) ═══
  private pickBox: PickBox | null = null;

  // ═══ Tool Registry ═══
  private tools: Map<string, ITool> = new Map();
  private toolContext!: ToolContext;

  // ═══ Hover tools (static sets) ═══
  private static readonly HOVER_TOOLS = new Set(['select', 'pushpull', 'offset', 'move', 'rotate', 'scale', 'group']);
  private static readonly EDGE_HOVER_TOOLS = new Set(['offset', 'erase']);
  /** Tools that benefit from a hover-time draw-plane preview (tiny RGB gizmo). */
  private static readonly DRAW_PLANE_TOOLS = new Set(['line', 'rect', 'circle', 'arc', 'freehand', 'bezier']);

  // ═══ Draw-plane hover indicator ═══
  private drawPlaneIndicator: DrawPlaneIndicator | null = null;
  private drawPlaneRafPending = false;
  private drawPlaneLastEvent: MouseEvent | null = null;

  // Session 4 — lazy snap refresh. syncMesh used to rebuild the snap
  //   spatial hash inline (~30 ms on a mid-sized scene). That blocks the
  //   frame right after every draw. We defer it to the next idle slot
  //   instead; if another syncMesh lands first we cancel and reschedule
  //   so snap always catches up to the latest buffers, just not on the
  //   critical path.
  private _snapIdleHandle: number | null = null;

  // ═══ Sketch Mode (Tier 3A) ═══
  // When active, all drawing commits to this fixed plane regardless of
  // cursor pick or view mode. Edges/faces created during a session are
  // logically "the sketch" — on exit we leave them in place (user can
  // Push/Pull them into 3D). MVP: no explicit edge-tagging (could add
  // later for better "sketch deletion on exit").
  private _sketch: {
    label: string;             // "XY 바닥" | "XZ 정면벽" | "YZ 측면벽" | "선택 면"
    origin: THREE.Vector3;     // any point on the plane
    normal: THREE.Vector3;     // unit
    up: THREE.Vector3;         // unit, perpendicular to normal
  } | null = null;

  constructor(
    viewport: Viewport,
    bridge: WasmBridge,
    units?: UnitSystem,
    container?: ServiceContainer
  ) {
    this.viewport = viewport;
    this.bridge = bridge;
    this.container = container;

    // Phase 1: Try to get units from container, fall back to parameter
    if (container && !units) {
      this.units = container.tryGet<UnitSystem>('units') || new UnitSystem();
    } else {
      this.units = units || new UnitSystem();
    }
    this.dimLabel = new DimensionLabel(viewport.container);

    // Initialize snap system
    this.snap = new SnapManager();
    this.snapVisual = new SnapVisual(viewport.container);

    // Initialize selection system
    this.selection = new SelectionManager(viewport.scene);
    this.selection.setBridge(bridge); // DCEL topology 기반 연결 탐색 활성화

    // Initialize pickbox
    this.pickBox = new PickBox(viewport.container);

    // Initialize draw-plane hover indicator (shown only for drawing tools)
    this.drawPlaneIndicator = new DrawPlaneIndicator(viewport.scene);

    // ═══ Selection Dimension Display: show edge dims when faces selected ═══
    this.selection.onChange((faces: number[]) => {
      if (this._currentTool === 'select' && faces.length > 0) {
        this.updateSelectionDimensions(faces);
      } else {
        this.selectionDimLines = [];
        this.dimLabel.clear();
      }
    });

    // ═══ Dimension Edit: click label → edit value → resize geometry ═══
    this.dimLabel.onEdit = (index: number, newValue: number, dimLine: DimLine) => {
      this.handleDimensionEdit(index, newValue, dimLine);
    };

    // Capture 'this' for closures
    const mgr = this;

    // Create tool context (shared state for all tools) — fully typed, no `as any`
    this.toolContext = {
      viewport,
      bridge,
      snap: this.snap,
      snapVisual: this.snapVisual,
      selection: this.selection,
      dimLabel: this.dimLabel,
      units: this.units,
      get faceMap() { return mgr.faceMap; },
      get edgeMap() { return mgr.edgeMap; },
      syncMesh: () => this.syncMesh(),
      getSnappedPoint: (e, rawGround, consume) => this.getSnappedPoint(e, rawGround, consume),
      getGroundPoint: (e) => this.getGroundPoint(e),
      getSelectedFaces: () => this.selection.getSelectedFaces(),
      get inferredAxis() { return mgr.inferredAxis; },
      set inferredAxis(val: 'x' | 'y' | 'z' | 'free') { mgr.inferredAxis = val; },
      get axisLock() { return mgr.axisLock; },
      set axisLock(val: 'x' | 'y' | 'z' | 'free' | null) { mgr.axisLock = val; },
      getFaceId: (faceIndex: number) => this.getFaceId(faceIndex),
      extractFaceBoundary: (faceId: number) => this.extractFaceBoundary(faceId),
      get3DPoint: (e: MouseEvent) => this.get3DPoint(e),
      getAxisInferredPoint: (e: MouseEvent, origin: THREE.Vector3) => {
        const result = this.getAxisInferredPoint(e, origin);
        return result ? { point: result.point, axis: result.axis } : null;
      },
      updateAxisGuide: (origin: THREE.Vector3, axis: 'x' | 'y' | 'z' | 'free', endPt: THREE.Vector3) => this.updateAxisGuide(origin, axis, endPt),
      clearAxisGuide: () => this.clearAxisGuide(),
      pickBox: this.pickBox,
      getDrawPlane: (e: MouseEvent) => this.getDrawPlane(e),
      getRay: (e: MouseEvent) => this.getRay(e),
    };

    // Register all tools
    this.tools.set('select', new SelectTool(this.toolContext));
    this.tools.set('line', new DrawLineTool(this.toolContext));
    // Polyline == Line with continuous mode (already the default behaviour —
    //   end of one segment = start of the next, Esc/RightClick to finish).
    //   Registered as an alias so "폴리선" menu item / Shift+L shortcut both
    //   resolve to a real tool.
    this.tools.set('polyline', new DrawLineTool(this.toolContext));
    this.tools.set('rect', new DrawRectTool(this.toolContext));
    this.tools.set('circle', new DrawCircleTool(this.toolContext));
    this.tools.set('polygon', new DrawPolygonTool(this.toolContext));
    this.tools.set('arc', new DrawArcTool(this.toolContext));
    this.tools.set('freehand', new DrawFreehandTool(this.toolContext));
    this.tools.set('bezier', new DrawBezierTool(this.toolContext));
    this.tools.set('pushpull', new PushPullTool(this.toolContext));
    this.tools.set('move', new MoveTool(this.toolContext));
    this.tools.set('rotate', new RotateTool(this.toolContext));
    this.tools.set('scale', new ScaleTool(this.toolContext));
    this.tools.set('offset', new OffsetTool(this.toolContext));
    this.tools.set('erase', new EraseTool(this.toolContext));
    this.tools.set('split', new SplitTool(this.toolContext));
    this.tools.set('group', new GroupTool(this.toolContext));
    this.tools.set('measure', new MeasureTool(this.toolContext));
    this.tools.set('centerline', new DrawCenterlineTool(this.toolContext));
    this.tools.set('sphere', new SphereTool(this.toolContext));
    this.tools.set('cylinder', new CylinderTool(this.toolContext));
    this.tools.set('cone', new ConeTool(this.toolContext));
    this.tools.set('box', new BoxTool(this.toolContext));
    this.tools.set('slice', new SliceTool(this.toolContext));

    this.setupMouseHandlers();
    this.setupKeyboardHandlers();

    // Per-frame dim label update (keeps labels correct during camera orbit)
    viewport.onFrame(() => this.renderSelectionDimensions());
  }

  get currentTool(): string {
    return this._currentTool;
  }

  isToolBusy(): boolean {
    const tool = this.tools.get(this._currentTool);
    return tool ? tool.isBusy() : false;
  }

  setTool(name: string): void {
    const keepSelection = new Set(['pushpull', 'offset', 'move', 'rotate', 'scale']);
    const selectedBefore = keepSelection.has(name) ? this.selection.getSelectedFaces() : [];

    // Deactivate current tool
    const currentToolObj = this.tools.get(this._currentTool);
    if (currentToolObj?.onDeactivate) {
      currentToolObj.onDeactivate();
    }

    this._currentTool = name;

    // If the new tool doesn't want snap, clear any lingering SnapVisual markers.
    const newToolObj = this.tools.get(name);
    if (newToolObj?.wantsSnap === false) {
      this.snapVisual.clear();
    }

    // Hide draw-plane indicator if the new tool doesn't use it
    if (!ToolManager.DRAW_PLANE_TOOLS.has(name)) {
      this.drawPlaneIndicator?.hide();
    }

    // Clear selection dimensions when switching tools
    if (name !== 'select') {
      this.selectionDimLines = [];
      this.dimLabel.clear();
    } else {
      // Re-entering select tool: recompute dims for current selection
      const faces = this.selection.getSelectedFaces();
      if (faces.length > 0) {
        this.updateSelectionDimensions(faces);
      }
    }

    // Pickbox visibility for offset tool
    const canvas = this.viewport.renderer.domElement;
    if (name === 'offset') {
      canvas.style.cursor = 'none';
      if (this.pickBox) this.pickBox.visible = true;
    } else {
      canvas.style.cursor = '';
      if (this.pickBox) this.pickBox.visible = false;
    }

    // Activate new tool
    if (newToolObj?.onActivate) {
      newToolObj.onActivate();
    }

    // Restore selection for transform tools
    if (selectedBefore.length > 0) {
      for (const fid of selectedBefore) {
        this.selection.handleClick(fid, true, false);
      }
    }
  }

  setAxisLock(axis: 'x' | 'y' | 'z' | null): void {
    this.axisLock = axis;
    if (!axis) {
      this.clearAxisGuide();
    }
    debugLog('[AxisLock]', axis ? `${axis.toUpperCase()}축 잠금` : '해제');
  }

  applyVCBValue(value: number, value2?: number, value3?: number): void {
    const tool = this.tools.get(this._currentTool);
    if (tool?.applyVCBValue) {
      tool.applyVCBValue(value, value2, value3);
    }
  }

  /**
   * 도구가 작업 중일 때 실행하면 안 되는 파괴적/구조적 명령어들.
   * `undo`는 예외 — busy 시 "현재 도구 취소"로 해석 (CAD 관례).
   *
   * 각 명령이 차단되는 이유 (2026-04-17):
   *   delete         — Line/Push/Pull이 참조하는 face가 사라져 state 깨짐
   *   flip-faces     — Push/Pull ghost 프리뷰의 normal 불일치
   *   redo           — 도구 state와 topology 불일치 유발
   *   group          — Drawing 중 그룹 생성 → 예측 불가
   *   make-component — group과 동일
   */
  private static readonly BUSY_BLOCKED_ACTIONS = new Set([
    'delete', 'flip-faces', 'merge-faces', 'merge-xia-coplanar', 'merge-as-hole',
    'merge-faces-geometric', 'merge-faces-force',
    'synthesize-faces',
    'mirror-x', 'mirror-y', 'mirror-z',
    'revolve-x', 'revolve-y', 'revolve-z',
    'subdivide',
    'fillet-edge',
    'chamfer-edge',
    'array-linear', 'array-radial',
    'thicken-faces',
    'solidify',
    'mesh-repair',
    'measure-selection',
    'bend-selection', 'twist-selection', 'taper-selection',
    'redo', 'group', 'make-component',
    'constrain-parallel', 'constrain-perpendicular', 'constrain-collinear',
    'constrain-edge-length', 'split-edge-midpoint', 'constrain-endpoint-distance',
  ]);

  /** 사용자 친화 명령어 이름 (Toast 메시지용) */
  private static readonly ACTION_DISPLAY: Record<string, string> = {
    'delete': '삭제',
    'flip-faces': '면 반전',
    'merge-faces': '면 통합',
    'merge-xia-coplanar': 'XIA 내 coplanar 면 일괄 통합',
    'merge-faces-force': '비평면 강제 통합 (내부 엣지 숨김)',
    'merge-as-hole': '내부 면을 구멍으로 합치기',
    'synthesize-faces': '자유 엣지 → 면 합성',
    'redo': '다시 실행',
    'group': '그룹 만들기',
    'make-component': '컴포넌트 변환',
    'constrain-parallel': '평행 정렬',
    'constrain-perpendicular': '수직 정렬',
    'constrain-collinear': '동일 선상 정렬',
    'constrain-edge-length': '엣지 길이 고정',
    'split-edge-midpoint': '엣지 중점 분할',
    'constrain-endpoint-distance': '끝점 거리 고정',
    'mirror-x': 'X축 기준 미러 (YZ 평면)',
    'mirror-y': 'Y축 기준 미러 (XZ 평면)',
    'mirror-z': 'Z축 기준 미러 (XY 평면)',
    'revolve-x': '선택 엣지를 X축으로 회전 (Revolve)',
    'revolve-y': '선택 엣지를 Y축으로 회전 (Revolve)',
    'revolve-z': '선택 엣지를 Z축으로 회전 (Revolve)',
    'subdivide': '전체 메시 Catmull-Clark 분할',
    'fillet-edge': '선택 엣지 모깎기 (Fillet)',
    'chamfer-edge': '선택 엣지 모따기 (Chamfer)',
    'array-linear': '선택을 선형 배열로 복제',
    'array-radial': '선택을 원형 배열로 복제',
    'thicken-faces': '선택 면에 두께 부여 (Shell/Thicken)',
    'solidify': '열린 쉘을 닫힌 솔리드로 변환 (Solidify)',
    'mesh-repair': '메시 정리 (퇴화면/와인딩/고립 정점)',
    'sketch-start-xz': '스케치 시작 — XZ 바닥 평면',
    'sketch-start-xy': '스케치 시작 — XY 정면 평면',
    'sketch-start-yz': '스케치 시작 — YZ 측면 평면',
    'sketch-start-face': '스케치 시작 — 선택 면',
    'sketch-start-auto': '스케치 시작 — 자동 평면 감지',
    'sketch-align-up': '스케치 up 방향을 카메라에 정렬',
    'sketch-resume-last': '마지막 스케치 평면 재진입',
    'sketch-exit': '스케치 종료',
    'convert-to-centerline': '선택 엣지 → 중심선 변환',
    'convert-to-geometry': '선택 엣지 → 일반선 변환',
    'clipboard-copy': '복사 (Ctrl+C)',
    'clipboard-cut': '잘라내기 (Ctrl+X)',
    'clipboard-paste': '붙여넣기 (Ctrl+V)',
    'duplicate': '복제 (Ctrl+D)',
    'measure-selection': '선택 측정 (길이/면적/부피)',
    'bend-selection': '선택 구부리기 (Bend)',
    'twist-selection': '선택 비틀기 (Twist)',
    'taper-selection': '선택 테이퍼 (Taper)',
    'assign-quick-color': '선택 면에 색상 지정',
  };

  executeAction(action: string): void {
    // ═══ Busy 가드 (2026-04-17) ═══
    // 파괴적/구조적 명령은 도구가 작업 중일 때 차단.
    // undo는 별도 처리 (아래 분기) — busy 시 "cancel" 의미로 사용.
    if (ToolManager.BUSY_BLOCKED_ACTIONS.has(action) && this.isToolBusy()) {
      const name = ToolManager.ACTION_DISPLAY[action] ?? action;
      Toast.warning(`'${name}'은 도구 작업 중 실행할 수 없습니다 — Esc 또는 Space로 먼저 완료하세요`);
      debugLog(`[Action] ${action} blocked — tool is busy`);
      return;
    }

    if (action === 'undo') {
      if (this.isToolBusy()) {
        debugLog('[Action] undo blocked — tool is active, cancelling tool instead');
        this.cancelCurrentTool();
        return;
      }
      const result = this.bridge.undo();
      debugLog('[Action] undo =>', result);
      if (result) {
        this.syncMesh();
        getMaterialLibrary().syncFromRust();
      }
    } else if (action === 'redo') {
      const result = this.bridge.redo();
      debugLog('[Action] redo =>', result);
      if (result) {
        this.syncMesh();
        getMaterialLibrary().syncFromRust();
      }
    } else if (action === 'clipboard-copy' || action === 'clipboard-cut') {
      // Ctrl+C / Ctrl+X — 현재 선택된 face를 클립보드에 저장.
      // MVP: face만 지원. Edge-only 선택은 별도 안내.
      const faces = this.selection.getSelectedFaces();
      const edges = this.selection.getSelectedEdges();
      if (faces.length === 0) {
        if (edges.length > 0) {
          Toast.warning('엣지 복사는 아직 미지원 — 면을 선택하세요', 3000);
        } else {
          Toast.info('복사할 항목이 선택되지 않음', 2000);
        }
        return;
      }
      getClipboard().copy('faces', faces);
      const verb = action === 'clipboard-cut' ? '잘라내기' : '복사';
      Toast.info(`${faces.length}개 면 ${verb} — Ctrl+V로 붙여넣기`, 2500);
      debugLog(`[Action] ${action}: ${faces.length} faces`);
      if (action === 'clipboard-cut') {
        // cut = copy + delete. delete는 이미 batchDelete 경로가 있으므로 재사용.
        const ok = this.bridge.batchDelete(faces, []);
        if (ok) {
          this.selection.clearSelection();
          this.syncMesh();
        }
      }
    } else if (action === 'clipboard-paste' || action === 'duplicate') {
      // Ctrl+V / Ctrl+D — 복사된 face를 즉시 복제 후 커서에 부착해 배치 대기.
      //
      // UX (SketchUp/AutoCAD 스타일):
      //   1) 복제본을 원본 위치에 생성 (zero offset → 시각적으로 겹침)
      //   2) MoveTool을 "placement" 모드로 즉시 활성화
      //   3) 사용자가 마우스 이동 → 복제본이 따라옴
      //   4) 클릭 → 그 위치에 고정
      //   5) Esc → undo로 복제본 삭제 (paste 취소)
      //
      // duplicate는 현재 선택에서, paste는 클립보드에서 원본을 가져옴.
      let sourceFaces: number[];
      if (action === 'duplicate') {
        sourceFaces = this.selection.getSelectedFaces();
        if (sourceFaces.length === 0) {
          Toast.warning('복제할 면을 먼저 선택하세요', 2500);
          return;
        }
      } else {
        const clip = getClipboard().get();
        if (!clip || clip.ids.length === 0) {
          Toast.info('붙여넣을 내용이 없습니다 — 먼저 Ctrl+C로 복사하세요', 2500);
          return;
        }
        sourceFaces = clip.ids;
      }
      // 최소 offset (0.1mm = 100μm)으로 복제 — 이유:
      //   Rust의 add_vertex는 SPATIAL_HASH_CELL × 1.5 = 1.5μm 이내 vertex를
      //   dedup(재사용). offset=0이면 복제본 vertex가 원본과 같은 VertId가 되어
      //   topology가 깨짐 (한 vertex를 두 face가 "독립적으로" 경계로 사용 불가).
      //   또 array_linear_faces에 `ensure!(offset > EPSILON)` 가드가 있어 아예
      //   거부됨. 0.1mm 는 dedup 임계값보다 66배 커서 새 vertex 보장 + 화면
      //   확대에서도 거의 감지 불가 + 이어지는 MoveTool placement가 즉시
      //   재배치하므로 사용자에겐 무영향.
      const TINY = 0.1;
      const newFaces = this.bridge.arrayLinearFaces(sourceFaces, 1, [TINY, 0, TINY]);
      if (newFaces.length === 0) {
        Toast.error(
          `${action === 'duplicate' ? '복제' : '붙여넣기'} 실패 — ` +
          `원본 면이 삭제되었거나 유효하지 않음`,
          4000,
        );
        return;
      }
      this.snap.invalidateCache();
      this.syncMesh();
      // 새로 생긴 면들을 선택 → MoveTool이 이 선택을 move 대상으로 사용
      this.selection.clearSelection();
      this.selection.selectFaces(newFaces);

      // 복제본의 "기준점(grab point)"을 계산 — bbox의 min corner.
      // 이 점이 커서에 붙은 상태로 이동하게 되어 사용자는 corner snap을
      // 적극 활용할 수 있음 (예: 다른 박스의 vertex에 정확히 착지).
      //
      // 대안: bbox center를 쓰면 "객체 중심을 커서에 맞춤"이라 매스 배치에는
      // 편하지만 건축 배치(벽 corner를 grid 교차점에 snap)는 min corner가 훨씬
      // 직관적. SketchUp도 원본의 "지정된 base point" 또는 bbox corner를 사용.
      const refPoint = this.computeBBoxMin(newFaces);

      // MoveTool로 전환 후 즉시 placement 모드 진입 — 첫 mousemove가 anchor,
      // 첫 click이 commit, Esc는 undo.
      this.setTool('move');
      const moveTool = this.tools.get('move') as unknown as {
        startPlacement?: (faceIds: number[], refPoint?: THREE.Vector3) => void;
      };
      moveTool?.startPlacement?.(newFaces, refPoint ?? undefined);
      const verb = action === 'duplicate' ? '복제' : '붙여넣기';
      debugLog(`[Action] ${action}: ${newFaces.length} faces → placement mode (refPt=${refPoint?.toArray()})`);
      void verb; // Toast는 startPlacement 내부에서 안내 — 중복 방지
    } else if (action === 'delete') {
      const selectedFaces = this.selection.getSelectedFaces();
      const selectedEdges = this.selection.getSelectedEdges();
      if (selectedFaces.length > 0 || selectedEdges.length > 0) {
        // Batch delete in a single undo transaction
        const ok = this.bridge.batchDelete(selectedFaces, selectedEdges);
        if (!ok) {
          // Fallback: individual deletes (old behavior, for WASM without batch_delete)
          for (const fid of selectedFaces) {
            this.bridge.deleteFace(fid);
          }
          for (const eid of selectedEdges) {
            this.bridge.deleteEdge(eid);
          }
        }
        this.selection.clearSelection();
        this.syncMesh();
        debugLog('[Action] delete', selectedFaces.length, 'faces,', selectedEdges.length, 'edges');
      }
    } else if (action === 'flip-faces') {
      // SketchUp "Reverse Faces" — 선택된 면의 노멀/winding 반전.
      // Busy 가드는 executeAction 진입부의 BUSY_BLOCKED_ACTIONS에서 일괄 처리.
      const faces = this.selection.getSelectedFaces();
      if (faces.length === 0) {
        Toast.warning('반전할 면을 먼저 선택하세요');
        return;
      }
      // ADR-007 Rev 2 — Sheet 면은 양면 동등 → flip 의미 없음.
      //   선택에 Sheet 가 포함되면 Wall 만 처리 + Sheet 는 Toast 안내.
      const wallOnly: number[] = [];
      let sheetSkipped = 0;
      for (const f of faces) {
        if (this.bridge.isFaceInVolume?.(f) === false) sheetSkipped++;
        else wallOnly.push(f);
      }
      if (wallOnly.length === 0) {
        Toast.info(
          'Sheet 면은 앞/뒷면 구분이 없어 반전할 필요가 없습니다 (ADR-007 Rev 2)',
          3500,
        );
        return;
      }
      if (sheetSkipped > 0) {
        Toast.info(`${sheetSkipped}개 sheet 면 건너뜀 (Wall 면만 반전)`, 2500);
      }
      const flipped = this.bridge.flipFaces(wallOnly);
      if (flipped > 0) {
        this.syncMesh();
        Toast.info(`${flipped}개 면 반전됨`, 1800);
        debugLog('[Action] flip-faces:', flipped);
      } else {
        const err = this.bridge.lastError();
        Toast.error(err || '면 반전 실패');
      }
    } else if (action === 'merge-faces') {
      mergeFaces(this._mergeCtx());
      return;
    } else if (action === 'merge-faces-geometric') {
      mergeFacesGeometric(this._mergeCtx());
      return;
    } else if (action === 'merge-faces-force') {
      mergeFacesForce(this._mergeCtx());
      return;
    } else if (action === 'merge-xia-coplanar') {
      mergeXiaCoplanar(this._mergeCtx());
      return;
    } else if (action === 'merge-as-hole') {
      mergeAsHole(this._mergeCtx());
      return;
    } else if (action === 'mirror-x' || action === 'mirror-y' || action === 'mirror-z') {
      // Phase "Mirror" — 선택 면을 world plane (YZ / XZ / XY) 기준으로 미러링.
      // 원본은 유지되고 mirrored copy가 별도 geometry로 추가됨. 캐릭터 모델링
      // 대칭 워크플로우 (반만 모델링 후 반대쪽 복제)에 유용.
      const sel = this.selection.getSelectedFaces();
      if (sel.length === 0) {
        Toast.warning('미러링할 면을 먼저 선택하세요', 2500);
        return;
      }
      // Plane origin = world 원점, normal = 해당 축
      const [nx, ny, nz] =
        action === 'mirror-x' ? [1, 0, 0] :
        action === 'mirror-y' ? [0, 1, 0] : [0, 0, 1];
      const newFaces = this.bridge.mirrorFaces(sel, 0, 0, 0, nx, ny, nz);
      if (newFaces.length > 0) {
        this.syncMesh();
        // 새로 생성된 면을 선택 상태로 전환 — 사용자가 바로 이어서 편집 가능
        this.selection.clearSelection();
        const label = action === 'mirror-x' ? 'YZ' : action === 'mirror-y' ? 'XZ' : 'XY';
        Toast.info(`${sel.length}개 면을 ${label} 평면 기준 미러링 (${newFaces.length}개 생성)`, 2500);
        debugLog(`[Action] ${action}: ${newFaces.length} mirrored faces`);
      } else {
        Toast.fromBridgeError(this.bridge, '미러링 실패');
      }
    } else if (action === 'revolve-x' || action === 'revolve-y' || action === 'revolve-z') {
      // Revolve Tool — 선택된 엣지 체인을 프로파일로, world X/Y/Z 축을
      // 회전 축으로 삼아 surface of revolution 생성.
      // 축 origin은 프로파일 bbox의 해당 축 위 점 (bbox 중심을 축에 투영).
      const sel = this.selection.getSelectedEdges();
      if (sel.length < 1) {
        Toast.warning('회전시킬 엣지 체인을 먼저 선택하세요', 2500);
        return;
      }
      const chain = extractEdgeChain(sel, this.bridge);
      if (!chain) {
        Toast.warning(
          '선택된 엣지가 단순 체인이 아닙니다 (분기/단절). ' +
          '연결된 폴리라인만 revolve 가능합니다.',
          3500,
        );
        return;
      }
      const [ax, ay, az] =
        action === 'revolve-x' ? [1, 0, 0] :
        action === 'revolve-y' ? [0, 1, 0] : [0, 0, 1];
      // Axis origin = 프로파일 bbox 중심을 축에 투영한 점.
      // (Three.js Box3 대신 직접 계산 — 테스트 mock 호환성)
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const p of chain.positions) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      }
      const center = {
        x: (minX + maxX) * 0.5,
        y: (minY + maxY) * 0.5,
        z: (minZ + maxZ) * 0.5,
      };
      const origin: [number, number, number] =
        action === 'revolve-x' ? [0, center.y, center.z] :
        action === 'revolve-y' ? [center.x, 0, center.z] : [center.x, center.y, 0];
      const flat: number[] = [];
      for (const p of chain.positions) { flat.push(p.x, p.y, p.z); }
      const newFaces = this.bridge.revolveProfile(flat, origin[0], origin[1], origin[2], ax, ay, az, 24);
      if (newFaces.length > 0) {
        this.syncMesh();
        this.selection.clearSelection();
        const axisLabel = action === 'revolve-x' ? 'X' : action === 'revolve-y' ? 'Y' : 'Z';
        Toast.info(`${chain.positions.length} point profile → ${axisLabel} 축 revolve (${newFaces.length} faces)`, 2500);
        debugLog(`[Action] ${action}: ${newFaces.length} faces`);
      } else {
        Toast.fromBridgeError(this.bridge, 'Revolve 실패');
      }
    } else if (action === 'bend-selection' || action === 'twist-selection' || action === 'taper-selection') {
      // Deformers operate on the vertex set of the selected faces (or
      // edges' endpoints). We derive a natural axis from the selection's
      // bounding-box longest dimension — the "length direction" of the
      // shape — then prompt for the single scalar parameter. Users who
      // need custom axis can pre-rotate the model.
      const faces = this.selection.getSelectedFaces();
      const edges = this.selection.getSelectedEdges();
      if (faces.length === 0 && edges.length === 0) {
        Toast.warning('변형할 면 또는 에지를 먼저 선택하세요', 2500);
        return;
      }
      // Collect unique vertex IDs from selected faces + edges.
      const vertSet = new Set<number>();
      for (const fid of faces) {
        for (const v of this.bridge.getFaceVertices(fid)) vertSet.add(v);
      }
      for (const eid of edges) {
        const eps = this.bridge.getEdgeEndpoints(eid);
        if (eps.length === 2) { vertSet.add(eps[0]); vertSet.add(eps[1]); }
      }
      if (vertSet.size === 0) {
        Toast.warning('선택에서 정점을 추출할 수 없습니다', 2500);
        return;
      }
      const vertIds = Array.from(vertSet);
      // Compute bbox + longest-dimension axis.
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const v of vertIds) {
        const p = this.bridge.getVertexPos(v);
        if (!p) continue;
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
      }
      const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
      const origin: [number, number, number] = [minX, minY, minZ];
      // Pick longest axis as the deformer axis.
      let axisDir: [number, number, number], axisLen: number;
      if (dx >= dy && dx >= dz) { axisDir = [1, 0, 0]; axisLen = dx; }
      else if (dy >= dz)        { axisDir = [0, 1, 0]; axisLen = dy; }
      else                      { axisDir = [0, 0, 1]; axisLen = dz; }
      if (axisLen < 1e-3) {
        Toast.warning('선택 범위가 너무 작습니다', 2500);
        return;
      }

      if (action === 'bend-selection') {
        const input = window.prompt('구부리기 각도 (도, +/-):', '30');
        if (input == null) return;
        const deg = parseFloat(input);
        if (!Number.isFinite(deg)) { Toast.warning('유효한 숫자를 입력하세요'); return; }
        // Bend axis is perpendicular to the longest direction AND to world
        // up (Y) by default. This matches the natural "bend this rod" feel.
        const upish: [number, number, number] = axisDir[1] !== 0 ? [0, 0, 1] : [0, 1, 0];
        const bendAxis: [number, number, number] = [
          axisDir[1] * upish[2] - axisDir[2] * upish[1],
          axisDir[2] * upish[0] - axisDir[0] * upish[2],
          axisDir[0] * upish[1] - axisDir[1] * upish[0],
        ];
        const ok = this.bridge.bendVerts(vertIds, bendAxis, axisDir, origin, deg, axisLen);
        if (ok) {
          this.syncMesh();
          Toast.info(`${vertIds.length}개 정점을 ${deg.toFixed(1)}° 구부림`, 2000);
        } else {
          Toast.fromBridgeError(this.bridge, 'Bend 실패');
        }
        return;
      }
      if (action === 'twist-selection') {
        const input = window.prompt('비틀기 각도 (축 전체에 대해 총 도수):', '45');
        if (input == null) return;
        const totalDeg = parseFloat(input);
        if (!Number.isFinite(totalDeg)) { Toast.warning('유효한 숫자를 입력하세요'); return; }
        const degPerUnit = totalDeg / axisLen;
        const ok = this.bridge.twistVertsDeform(vertIds, origin, axisDir, degPerUnit);
        if (ok) {
          this.syncMesh();
          Toast.info(`${vertIds.length}개 정점을 총 ${totalDeg.toFixed(1)}° 비틈`, 2000);
        } else {
          Toast.fromBridgeError(this.bridge, 'Twist 실패');
        }
        return;
      }
      // taper-selection
      const input = window.prompt('끝 스케일 (0보다 큰 실수, 1.0 = 원래 크기):', '0.5');
      if (input == null) return;
      const endScale = parseFloat(input);
      if (!Number.isFinite(endScale) || endScale <= 0) {
        Toast.warning('유효한 양수 스케일을 입력하세요'); return;
      }
      const ok = this.bridge.taperVerts(vertIds, origin, axisDir, 1.0, endScale, axisLen);
      if (ok) {
        this.syncMesh();
        Toast.info(`${vertIds.length}개 정점을 ×${endScale.toFixed(2)} 테이퍼`, 2000);
      } else {
        Toast.fromBridgeError(this.bridge, 'Taper 실패');
      }
    } else if (action === 'measure-selection') {
      // 현재 선택을 검사해 적절한 측정 결과 출력.
      //   - 엣지만 선택 → 각 엣지 길이 합계 + 최장/최단
      //   - 면만 선택      → 각 면적 합계 + 최장 변(reference)
      //   - 아무것도 없음  → 전체 메시 부피 + XIA 개수
      const edges = this.selection.getSelectedEdges();
      const faces = this.selection.getSelectedFaces();
      const fmt = (v: number) => this.units.format(v);
      if (edges.length > 0 && faces.length === 0) {
        let total = 0, min = Infinity, max = -Infinity;
        for (const eid of edges) {
          const L = this.bridge.edgeLength(eid);
          total += L;
          if (L < min) min = L;
          if (L > max) max = L;
        }
        const lines = [
          `📏 엣지 ${edges.length}개`,
          `합계: ${fmt(total)}`,
          edges.length > 1 ? `최단 ${fmt(min)} · 최장 ${fmt(max)}` : '',
        ].filter(Boolean);
        Toast.info(lines.join('\n'), 5000);
        debugLog(`[Measure] edges: total=${total}, min=${min}, max=${max}`);
      } else if (faces.length > 0) {
        let total = 0, maxA = -Infinity;
        for (const fid of faces) {
          const A = this.bridge.faceArea(fid);
          total += A;
          if (A > maxA) maxA = A;
        }
        // Units are length, so area = length². We format with the base
        // unit label appended with '²' — users can parse that intuitively.
        const unitLbl = this.units.config.label;
        Toast.info(
          `📐 면 ${faces.length}개\n` +
          `면적 합: ${total.toFixed(2)} ${unitLbl}²` +
          (faces.length > 1 ? `\n최대 면: ${maxA.toFixed(2)} ${unitLbl}²` : ''),
          5000,
        );
        debugLog(`[Measure] faces: total=${total}, max=${maxA}`);
      } else {
        // 전체 메시 부피
        const vol = this.bridge.meshVolume();
        const unitLbl = this.units.config.label;
        Toast.info(
          `🧊 전체 메시 부피\n` +
          `${vol.toFixed(2)} ${unitLbl}³\n` +
          `(닫힌 솔리드 기준, 열린 쉘은 근사치)`,
          5000,
        );
        debugLog(`[Measure] mesh volume: ${vol}`);
      }
    } else if (action === 'array-linear') {
      // 선택한 face들을 N개 복제, 각 복제는 offset만큼 이동된 위치에.
      // Prompt에서 "N,dx,dy,dz" 형식으로 입력받음.
      const sel = this.selection.getSelectedFaces();
      if (sel.length === 0) {
        Toast.warning('배열할 면을 먼저 선택하세요', 2500);
        return;
      }
      const last = localStorage.getItem('axia:array:params') ?? '5, 2000, 0, 0';
      const input = window.prompt(
        '배열 파라미터 "N, dx, dy, dz" (개수, X 오프셋, Y 오프셋, Z 오프셋):',
        last,
      );
      if (input == null) return;
      const parts = input.split(/[,\s]+/).map(s => s.trim()).filter(s => s.length);
      if (parts.length !== 4) {
        Toast.warning('4개 값이 필요합니다: N,dx,dy,dz', 3000);
        return;
      }
      const count = parseInt(parts[0], 10);
      const dx = parseFloat(parts[1]);
      const dy = parseFloat(parts[2]);
      const dz = parseFloat(parts[3]);
      if (!Number.isFinite(count) || count < 1 ||
          ![dx, dy, dz].every(Number.isFinite)) {
        Toast.warning('유효한 숫자 값을 입력하세요', 3000);
        return;
      }
      try { localStorage.setItem('axia:array:params', input); } catch { /* ignore */ }
      const newFaces = this.bridge.arrayLinearFaces(sel, count, [dx, dy, dz]);
      if (newFaces.length > 0) {
        this.syncMesh();
        this.selection.clearSelection();
        getOperationLog().record(
          'array-linear',
          `선형 배열 ${count}회, (${dx},${dy},${dz})`,
          input,
          { inputs: sel, outputs: newFaces },
        );
        Toast.info(`${sel.length}개 면을 ${count}회 복제 (총 ${newFaces.length}개)`, 2500);
        debugLog(`[Action] array-linear: count=${count}, offset=(${dx},${dy},${dz})`);
      } else {
        Toast.fromBridgeError(this.bridge, '배열 실패');
      }
    } else if (action === 'thicken-faces') {
      // Shell/Thicken — 선택 면에 두께를 부여해 얇은 슬랩 생성.
      // push_pull의 CreateFace 모드는 이미 base face 유지 ("솔리드 방식: 바닥면
      // 유지" — push_pull.rs 주석). 따라서 각 선택 면에 pushPull(d)를 호출하면
      // 자동으로 [base + top + 측벽]로 구성된 닫힌 슬랩이 만들어짐.
      //
      // 여러 면을 동시에 선택한 경우 면별로 독립 슬랩 생성 — 인접 면은 각자
      // 측벽을 가지므로 경계에서 겹침이 발생할 수 있음. (추후 "공유 엣지 통합
      // shell" 모드 고려 대상)
      const selFaces = this.selection.getSelectedFaces();
      if (selFaces.length === 0) {
        Toast.warning('두께를 부여할 면을 먼저 선택하세요', 2500);
        return;
      }
      const last = localStorage.getItem('axia:thicken:distance') ?? '200';
      const input = window.prompt(
        `두께 (mm, 양수=노멀 방향 / 음수=반대 방향) — 선택 ${selFaces.length}개 면:`,
        last,
      );
      if (input == null) return;
      const distance = parseFloat(input);
      if (!Number.isFinite(distance) || distance === 0) {
        Toast.warning('0이 아닌 유효한 숫자를 입력하세요', 2500);
        return;
      }
      try { localStorage.setItem('axia:thicken:distance', String(distance)); } catch { /* ignore */ }

      // 각 면에 순차 push_pull. 실패 면이 있어도 나머지는 계속 진행.
      let success = 0;
      let firstFailure = '';
      for (const fid of selFaces) {
        const ok = this.bridge.pushPull(fid, distance);
        if (ok) {
          success++;
        } else if (!firstFailure) {
          firstFailure = this.bridge.lastError();
        }
      }
      if (success > 0) {
        this.syncMesh();
        this.selection.clearSelection();
        getOperationLog().record(
          'thicken-faces',
          `두께 ${distance}mm × ${success}개 면`,
          String(distance),
          { inputs: selFaces.slice() },
        );
        if (success === selFaces.length) {
          Toast.info(`${success}개 면에 두께 ${distance}mm 부여`, 2500);
        } else {
          Toast.warning(
            `${success}/${selFaces.length}개 면 성공 — 실패: ${firstFailure || '알 수 없는 오류'}`,
            4000,
          );
        }
        debugLog(`[Action] thicken-faces: ${success}/${selFaces.length}, d=${distance}mm`);
      } else {
        Toast.error(`두께 부여 실패: ${firstFailure || '모든 면에서 push_pull 실패'}`, 4000);
      }
    } else if (action === 'sketch-start-xz') {
      // XZ 바닥 — Y=0, 평면도 기본. up = -Z so "북쪽"이 위.
      this.enterSketch({
        label: 'XZ 바닥',
        origin: new THREE.Vector3(0, 0, 0),
        normal: new THREE.Vector3(0, 1, 0),
        up: new THREE.Vector3(0, 0, -1),
      });
      Toast.info(`✏️ 스케치 시작 — XZ 바닥 (Y=0). 모든 드로잉이 이 평면에 고정됩니다.`, 4000);
    } else if (action === 'sketch-start-xy') {
      // XY 정면 — Z=0, 입면도.
      this.enterSketch({
        label: 'XY 정면',
        origin: new THREE.Vector3(0, 0, 0),
        normal: new THREE.Vector3(0, 0, 1),
        up: new THREE.Vector3(0, 1, 0),
      });
      Toast.info(`✏️ 스케치 시작 — XY 정면 (Z=0). 모든 드로잉이 이 평면에 고정됩니다.`, 4000);
    } else if (action === 'sketch-start-yz') {
      // YZ 측면 — X=0.
      this.enterSketch({
        label: 'YZ 측면',
        origin: new THREE.Vector3(0, 0, 0),
        normal: new THREE.Vector3(1, 0, 0),
        up: new THREE.Vector3(0, 1, 0),
      });
      Toast.info(`✏️ 스케치 시작 — YZ 측면 (X=0). 모든 드로잉이 이 평면에 고정됩니다.`, 4000);
    } else if (action === 'sketch-start-face') {
      // 선택된 단일 면의 평면에서 스케치 시작.
      const faces = this.selection.getSelectedFaces();
      if (faces.length !== 1) {
        Toast.warning('스케치 기준 면 1개를 선택하세요', 2500);
        return;
      }
      const boundary = this.toolContext.extractFaceBoundary(faces[0]);
      if (boundary.length < 3) {
        Toast.error('선택 면의 경계를 읽을 수 없습니다', 3000);
        return;
      }
      // Compute plane from 3 non-colinear boundary points
      const p0 = boundary[0];
      const p1 = boundary[1];
      const p2 = boundary[2];
      const edgeA = new THREE.Vector3().subVectors(p1, p0);
      const edgeB = new THREE.Vector3().subVectors(p2, p0);
      const normal = new THREE.Vector3().crossVectors(edgeA, edgeB).normalize();
      if (normal.lengthSq() < 1e-8) {
        Toast.error('선택 면이 퇴화되어 스케치 평면을 계산할 수 없습니다', 3000);
        return;
      }
      // Up: prefer world Y projection onto plane; fall back to edgeA
      const worldY = new THREE.Vector3(0, 1, 0);
      let up = worldY.clone().sub(normal.clone().multiplyScalar(worldY.dot(normal)));
      if (up.lengthSq() < 1e-6) up = edgeA.normalize();
      else up.normalize();
      this.enterSketch({
        label: `면 #${faces[0]}`,
        origin: p0.clone(),
        normal,
        up,
      });
      Toast.info(`✏️ 스케치 시작 — 면 #${faces[0]}. 모든 드로잉이 이 평면에 고정됩니다.`, 4000);
    } else if (action === 'sketch-start-auto') {
      // Phase 4 — auto-detect 평면.
      this.startSketchAuto();
    } else if (action === 'sketch-align-up') {
      this.alignSketchUpToCamera();
    } else if (action === 'sketch-resume-last') {
      try {
        const raw = localStorage.getItem('axia.sketch.lastPlane');
        if (!raw) {
          Toast.warning('이전에 사용한 스케치 평면 정보가 없습니다', 2500);
          return;
        }
        const data = JSON.parse(raw) as {
          label: string; origin: number[]; normal: number[]; up: number[];
        };
        this.enterSketch({
          label: `${data.label} (재개)`,
          origin: new THREE.Vector3().fromArray(data.origin),
          normal: new THREE.Vector3().fromArray(data.normal),
          up: new THREE.Vector3().fromArray(data.up),
        });
        Toast.info(`✏️ 스케치 재개 — ${data.label}`, 3000);
      } catch (e) {
        Toast.error(`스케치 재개 실패: ${String(e)}`, 3000);
      }
    } else if (action === 'convert-to-centerline' || action === 'convert-to-geometry') {
      // 선택된 엣지들의 class를 일괄 flip. Geometry → Centerline은 face를
      // 감싸는 엣지는 Rust에서 거부됨 (dangling face 방지).
      const edges = this.selection.getSelectedEdges();
      if (edges.length === 0) {
        Toast.warning('변환할 엣지를 먼저 선택하세요', 2500);
        return;
      }
      const targetClass = action === 'convert-to-centerline' ? 1 : 0;
      const label = action === 'convert-to-centerline' ? '중심선' : '일반선';
      let ok = 0;
      let firstErr = '';
      for (const eid of edges) {
        if (this.bridge.setEdgeClass(eid, targetClass as 0 | 1)) ok++;
        else if (!firstErr) firstErr = this.bridge.lastError();
      }
      if (ok > 0) {
        this.syncMesh();
        if (ok === edges.length) {
          Toast.info(`${ok}개 엣지 → ${label} 변환 완료`, 2500);
        } else {
          Toast.warning(
            `${ok}/${edges.length}개 변환 — 나머지 거부: ${firstErr || '원인 불명'}`,
            4500,
          );
        }
      } else {
        Toast.error(`변환 실패: ${firstErr || '알 수 없는 오류'}`, 3500);
      }
    } else if (action === 'sketch-exit') {
      if (!this.isSketching()) {
        Toast.info('활성 스케치 세션이 없습니다', 2000);
        return;
      }
      const info = this.getSketchInfo();
      this.exitSketch();

      // ── Auto Finish → Synthesize → optional Extrude ──
      // 건축 핵심 워크플로우: 평면도 그리기 → 스케치 종료 → 닫힌 프로필
      // 자동 감지 → 즉시 벽체 높이 입력 → 3D 매스 완성.
      //
      // synthesizeFacesFromFreeEdges는 전역으로 free HE를 대상으로 하므로
      // 스케치 평면의 프로필만 정확히 타겟하지는 않지만, 일반적으로
      // 스케치 세션의 "갓 그린 선"이 주 대상. 기존 free edge가 있어도
      // 같은 평면에서 닫힌 loop만 face가 됨 → 오작동 가능성 낮음.
      const freeBefore = this.bridge.countFreeEdges();
      if (freeBefore === 0) {
        Toast.info(
          `스케치 종료 (${info?.label ?? ''}) — 자유 엣지 없음 (닫힌 프로필 미작성)`,
          3500,
        );
        return;
      }
      const created = this.bridge.synthesizeFacesFromFreeEdges();
      if (created === 0) {
        this.syncMesh();
        Toast.info(
          `스케치 종료 (${info?.label ?? ''}) — 자유 엣지 ${freeBefore}개 있으나 ` +
          `닫힌 polygon 미감지. 선이 끝점에서 정확히 만났는지 확인하세요.`,
          4500,
        );
        return;
      }
      this.syncMesh();

      // 높이 입력 prompt — 취소 시 면만 남기고 종료.
      const lastH = localStorage.getItem('axia:sketch:extrude:height') ?? '2400';
      const heightInput = window.prompt(
        `✅ 스케치에서 ${created}개 닫힌 프로필을 감지했습니다.\n` +
        `높이(mm)를 입력하면 즉시 Push/Pull로 3D 변환합니다.\n` +
        `(취소 = 면만 남기고 종료)`,
        lastH,
      );
      if (heightInput == null) {
        Toast.info(
          `스케치 종료 (${info?.label ?? ''}) — ${created}개 면 생성, 3D 변환 건너뜀`,
          3500,
        );
        return;
      }
      const height = parseFloat(heightInput);
      if (!Number.isFinite(height) || height === 0) {
        Toast.warning('유효한 양/음수 높이를 입력하세요 — 면은 이미 생성됨', 3500);
        return;
      }
      try { localStorage.setItem('axia:sketch:extrude:height', String(height)); } catch { /* ignore */ }

      // 가장 최근 생성된 N개 face를 추출 (synthesize의 반환값이 개수만이므로
      // countFaces() 기반 추정은 불안정 — 대신 전역 면 중 활성인 것 중 가장
      // 최근 rustId N개를 가정). 간단한 MVP 접근: 현재 선택 + synthesize 후
      // 선택 변화를 보고 대상 고르는 건 복잡하므로 직관적으로 "selected가
      // 비어 있으면 추출 실패" 방지용 — 대신 bridge에 "recently created
      // faces" API가 필요. 지금은 synthesize가 반환한 개수만 사용하고,
      // getMeshBuffers()의 faceMap에서 뒤쪽 N개 FaceId를 타깃으로 잡음.
      const buffers = this.bridge.getMeshBuffers();
      if (!buffers || !buffers.faceMap) {
        Toast.warning('면 ID 조회 실패 — 수동으로 Push/Pull하세요', 3500);
        return;
      }
      // 중복 제거: faceMap은 per-triangle face id 배열이므로 unique Set
      const uniqueFaces = Array.from(new Set(Array.from(buffers.faceMap)));
      // 최신 N개 (큰 ID부터)
      uniqueFaces.sort((a, b) => b - a);
      const targets = uniqueFaces.slice(0, created);
      let ok = 0;
      for (const fid of targets) {
        if (this.bridge.pushPull(fid, height)) ok++;
      }
      if (ok > 0) {
        this.syncMesh();
        getOperationLog().record(
          'thicken-faces',
          `스케치 Extrude ${height}mm × ${ok}개 프로필`,
          String(height),
          { inputs: Array.from(targets) },
        );
        Toast.info(
          `✅ 스케치 완료 — ${created}개 프로필 → ${ok}개 3D 매스 (높이 ${height}mm)`,
          4000,
        );
      } else {
        Toast.warning(
          `${created}개 면은 생성되었으나 Push/Pull 실패. 수동으로 면 선택 후 P 키로 시도.`,
          4500,
        );
      }
    } else if (action === 'mesh-repair') {
      // Mesh Repair — ADR-007 Phase H의 normalize_for_import를 사용자 명시 호출로 노출.
      // 네 가지 정리 단계: degenerate 면 제거 / winding 일관화 / normal 재계산 /
      // 고립 vertex 제거. Import 직후뿐 아니라 사용 중 메시가 오염된 경우에도
      // 재실행 가능.
      //
      // Before/After manifold 리포트 + invariant 위반 수를 Toast로 안내.
      const before = this.bridge.meshManifoldInfo();
      const report = this.bridge.normalizeForImport();
      this.syncMesh();
      const after = this.bridge.meshManifoldInfo();
      debugLog(`[MeshRepair] ${JSON.stringify(report)} | before→after: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      const total = report.degenerateRemoved + report.windingFlipped +
                    report.normalsRecomputed + report.isolatedVertsRemoved;
      if (total === 0 && report.remainingViolations === 0) {
        Toast.info(
          `✅ 메시 상태 양호 — 정리할 항목 없음 (면 ${after.faceCount}개)`,
          3500,
        );
      } else {
        const parts: string[] = [];
        if (report.degenerateRemoved > 0) parts.push(`퇴화면 ${report.degenerateRemoved}개 제거`);
        if (report.windingFlipped > 0) parts.push(`winding ${report.windingFlipped}개 뒤집음`);
        if (report.normalsRecomputed > 0) parts.push(`normal ${report.normalsRecomputed}개 재계산`);
        if (report.isolatedVertsRemoved > 0) parts.push(`고립 vertex ${report.isolatedVertsRemoved}개 제거`);
        const summary = parts.length > 0 ? parts.join(', ') : '변경 없음';
        const remain = report.remainingViolations > 0
          ? `\n⚠️ 잔여 invariant 위반 ${report.remainingViolations}개 — 수동 점검 필요`
          : '';
        Toast.info(`🩹 Mesh Repair — ${summary}${remain}`, 6000);
      }
    } else if (action === 'solidify') {
      // Solidify — 열린 쉘의 boundary edge 루프를 자동 cap. 전형 사용 시나리오:
      //   DXF/SKP import 후 "이게 닫힌 솔리드인가?" 확인 + 보정 버튼.
      //
      // 3단계:
      //   1. 현재 manifold 상태 리포트 (face/boundary/non-manifold edge 수)
      //   2. 닫힘 판정:
      //        - 이미 닫힘 → info Toast + 종료
      //        - non-manifold 있음 → warning Toast (Solidify만으로는 못 고침)
      //        - boundary > 0 → synthesize 실행
      //   3. 실행 후 재검사 → 결과 리포트
      const before = this.bridge.meshManifoldInfo();
      debugLog(`[Solidify] before: ${JSON.stringify(before)}`);
      if (before.isClosedSolid) {
        Toast.info(
          `이미 닫힌 솔리드입니다 (면 ${before.faceCount}개, 내부 엣지 ${before.interiorEdgeCount}개)`,
          3500,
        );
        return;
      }
      if (before.nonManifoldEdgeCount > 0) {
        Toast.warning(
          `Non-manifold 엣지 ${before.nonManifoldEdgeCount}개 발견 — ` +
          `3개 이상 면이 공유하는 엣지는 Solidify가 자동 수정할 수 없습니다.\n` +
          `먼저 Mesh Repair로 non-manifold를 해결한 뒤 다시 시도하세요.`,
          6000,
        );
        return;
      }
      if (before.boundaryEdgeCount === 0 && before.faceCount === 0) {
        Toast.warning('솔리드화할 메시가 없습니다 (활성 face 0개)', 3000);
        return;
      }
      if (before.boundaryEdgeCount === 0) {
        // 면은 있는데 boundary는 0이고 is_closed_solid도 아님 → face 수가 4 미만
        Toast.info(
          `경계 엣지가 없지만 닫힌 솔리드 판정 미충족(면 ${before.faceCount}개 — ` +
          `최소 4면 필요)`,
          4000,
        );
        return;
      }
      // boundary > 0 → synthesize 시도
      const created = this.bridge.synthesizeFacesFromFreeEdges();
      this.syncMesh();
      const after = this.bridge.meshManifoldInfo();
      debugLog(`[Solidify] after: created=${created}, ${JSON.stringify(after)}`);
      if (after.isClosedSolid) {
        Toast.info(
          `✅ Solidify 성공 — ${created}개 면 cap 생성, ` +
          `총 ${after.faceCount}면 닫힌 솔리드`,
          4000,
        );
      } else if (created > 0) {
        Toast.warning(
          `일부 cap 생성(${created}개) but 아직 열린 상태: ` +
          `boundary ${after.boundaryEdgeCount}개, non-manifold ${after.nonManifoldEdgeCount}개 남음.\n` +
          `복잡한 비평면 boundary는 수동 보정이 필요할 수 있음.`,
          6000,
        );
      } else {
        Toast.error(
          `Solidify 실패 — boundary ${before.boundaryEdgeCount}개가 닫힌 polygon을 ` +
          `이루지 않거나 비평면 루프일 수 있습니다.`,
          5000,
        );
      }
    } else if (action === 'array-radial') {
      // 선택한 면을 축 중심으로 원형 배열. Prompt: "N, axis(x|y|z), totalDeg"
      // 축 원점은 선택 면의 bounding box center(X축은 YZ-평면, 등)에서 유추.
      const sel = this.selection.getSelectedFaces();
      if (sel.length === 0) {
        Toast.warning('배열할 면을 먼저 선택하세요', 2500);
        return;
      }
      const last = localStorage.getItem('axia:array-radial:params') ?? '6, y, 360';
      const input = window.prompt(
        '원형 배열 파라미터 "N, axis(x|y|z), 총각도°" (예: 6, y, 360):',
        last,
      );
      if (input == null) return;
      const parts = input.split(/[,\s]+/).map(s => s.trim()).filter(s => s.length);
      if (parts.length !== 3) {
        Toast.warning('3개 값이 필요합니다: N, axis, 총각도°', 3000);
        return;
      }
      const count = parseInt(parts[0], 10);
      const axisChar = parts[1].toLowerCase();
      const totalDeg = parseFloat(parts[2]);
      if (!Number.isFinite(count) || count < 1 || !Number.isFinite(totalDeg)) {
        Toast.warning('유효한 숫자 값을 입력하세요', 3000);
        return;
      }
      let axis: [number, number, number];
      if (axisChar === 'x') axis = [1, 0, 0];
      else if (axisChar === 'y') axis = [0, 1, 0];
      else if (axisChar === 'z') axis = [0, 0, 1];
      else { Toast.warning('축은 x / y / z 중 하나여야 합니다', 3000); return; }
      // axis_origin = 월드 원점. (선택 중심을 축 원점으로 하면 원형 배열이
      // 제자리에서 시작 — 대부분의 사용자가 원하는 "원점 중심 원형 배열"과 달라짐)
      const origin: [number, number, number] = [0, 0, 0];
      try { localStorage.setItem('axia:array-radial:params', input); } catch { /* ignore */ }
      const totalRad = (totalDeg * Math.PI) / 180;
      const newFaces = this.bridge.arrayRadialFaces(sel, count, origin, axis, totalRad);
      if (newFaces.length > 0) {
        this.syncMesh();
        this.selection.clearSelection();
        getOperationLog().record(
          'array-radial',
          `원형 배열 ${count}회 · ${axisChar}축 · ${totalDeg}°`,
          input,
          { inputs: sel, outputs: newFaces },
        );
        Toast.info(`${sel.length}개 면을 ${count}회 원형 복제 (${axisChar}축, ${totalDeg}°)`, 2500);
        debugLog(`[Action] array-radial: count=${count}, axis=${axisChar}, deg=${totalDeg}`);
      } else {
        Toast.fromBridgeError(this.bridge, '원형 배열 실패');
      }
    } else if (action === 'assign-quick-color') {
      // 선택된 face들에 즉석 색상을 부여. HTML color picker → MaterialLibrary에
      // 일회용 custom material 등록 → assignToFaces. Rust 엔진은 rustId를
      // opaque u32로 저장하므로 10000+ 범위는 안전하게 사용 가능 (BUILTIN 12개와 충돌 없음).
      // Viewport의 vertex color 파이프라인은 TS-side getMaterialForFace만 참조하므로
      // 즉시 색이 반영됨.
      const selFaces = this.selection.getSelectedFaces();
      if (selFaces.length === 0) {
        Toast.warning('색상을 지정할 면을 먼저 선택하세요', 2500);
        return;
      }
      const lastColor = localStorage.getItem('axia:quickcolor:last') ?? '#3b82f6';
      const input = document.createElement('input');
      input.type = 'color';
      input.value = lastColor;
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      const cleanup = () => { try { input.remove(); } catch { /* ignore */ } };
      input.addEventListener('change', () => {
        const hex = input.value; // '#rrggbb'
        try { localStorage.setItem('axia:quickcolor:last', hex); } catch { /* ignore */ }
        const colorInt = parseInt(hex.slice(1), 16);
        const lib = getMaterialLibrary();
        // 10000+ 범위에서 고유 rustId 할당 (현재 최대값 + 1)
        let maxRustId = 12;
        for (const m of lib.getAll()) {
          if (m.rustId > maxRustId) maxRustId = m.rustId;
        }
        const rustId = Math.max(maxRustId + 1, 10001);
        const id = `quick-${Date.now()}-${rustId}`;
        lib.addCustom({
          id,
          rustId,
          name: `색상 ${hex}`,
          nameEn: `Color ${hex}`,
          category: 'custom',
          physical: {
            density: 1000, friction: 0.5, restitution: 0.2, specificGravity: 1.0,
            thermalConductivity: 0.5, fireRating: 'incombustible',
          },
          visual: { color: colorInt, roughness: 0.5, metalness: 0.0, opacity: 1.0 },
        });
        const ok = lib.assignToFaces(selFaces, id);
        if (ok) {
          this.syncMesh();
          Toast.info(`${selFaces.length}개 면에 ${hex} 색상 적용`, 2000);
          debugLog(`[Action] assign-quick-color: ${selFaces.length} faces, color=${hex}`);
        } else {
          Toast.error('색상 적용 실패', 2500);
        }
        cleanup();
      });
      input.addEventListener('cancel', cleanup);
      input.click();
    } else if (action === 'chamfer-edge') {
      // Chamfer is a degenerate Fillet with only one strip segment — so
      // instead of an arc between the rolled-back points, a single flat
      // quad connects them. Same DCEL surgery, same parameter, different
      // sampling. Delegating to filletEdge(edge, distance, 1) keeps the
      // code path unified.
      const edges = this.selection.getSelectedEdges();
      if (edges.length !== 1) {
        Toast.warning('모따기할 엣지 1개를 먼저 선택하세요', 2500);
        return;
      }
      const lastDist = Number(localStorage.getItem('axia:chamfer:distance') ?? '50');
      const input = window.prompt('모따기 거리 (mm):', String(lastDist));
      if (input == null) return;
      const distance = parseFloat(input);
      if (!Number.isFinite(distance) || distance <= 0) {
        Toast.warning('유효한 양수 거리를 입력하세요', 2500);
        return;
      }
      try { localStorage.setItem('axia:chamfer:distance', String(distance)); } catch { /* ignore */ }
      const n = this.bridge.filletEdge(edges[0], distance, 1);
      if (n >= 0) {
        this.syncMesh();
        this.selection.clearSelection();
        getOperationLog().record('chamfer-edge', `모따기 ${distance}mm`, String(distance),
          { inputs: edges.slice(0, 1) });
        Toast.info(`모따기 완료 — 거리 ${distance}mm`, 2500);
        debugLog(`[Action] chamfer-edge: distance=${distance}, n=${n}`);
      } else {
        Toast.fromBridgeError(this.bridge, '모따기 실패');
      }
    } else if (action === 'fillet-edge') {
      // 선택된 엣지들을 radius 반경으로 모깎기.
      //
      // 다중 엣지(Edge Bevel) 지원:
      //   - 1개: 단일 fillet_edge 호출, 기존 동작과 동일
      //   - N개: 순차 적용 — 각 edge가 아직 활성인지 확인 후 fillet 시도.
      //     같은 vertex를 공유하는 3-way corner는 첫 fillet이 두 번째 edge의
      //     endpoint를 교체할 수 있어 실패 가능 → 실패 edge 수를 집계해 안내.
      //
      // localStorage `axia:fillet:radius`로 마지막 반경 기본값, 없으면 50mm.
      const edges = this.selection.getSelectedEdges();
      if (edges.length === 0) {
        Toast.warning('모깎기할 엣지를 1개 이상 선택하세요', 2500);
        return;
      }
      const lastRadius = Number(localStorage.getItem('axia:fillet:radius') ?? '50');
      const input = window.prompt(
        `모깎기 반경 (mm) — 선택 ${edges.length}개 엣지:`,
        String(lastRadius),
      );
      if (input == null) return;
      const radius = parseFloat(input);
      if (!Number.isFinite(radius) || radius <= 0) {
        Toast.warning('유효한 양수 반경을 입력하세요', 2500);
        return;
      }
      try { localStorage.setItem('axia:fillet:radius', String(radius)); } catch { /* ignore */ }
      const segments = 8;
      let totalFaces = 0;
      let successEdges = 0;
      let firstError = '';
      for (const eid of edges) {
        const n = this.bridge.filletEdge(eid, radius, segments);
        if (n >= 0) {
          successEdges++;
          totalFaces += n;
        } else if (!firstError) {
          firstError = this.bridge.lastError();
        }
      }
      if (successEdges > 0) {
        this.syncMesh();
        this.selection.clearSelection();
        getOperationLog().record(
          'fillet-edge',
          `모깎기 ${radius}mm × ${successEdges}개 엣지`,
          String(radius),
          { inputs: edges.slice() },
        );
        if (successEdges === edges.length) {
          Toast.info(
            `모깎기 완료 — ${successEdges}개 엣지, ${totalFaces}개 fillet face 생성`,
            2500,
          );
        } else {
          const failed = edges.length - successEdges;
          Toast.warning(
            `${successEdges}/${edges.length}개 성공 — ${failed}개 실패 ` +
            `(공유 vertex 충돌 가능성: 첫 실패 "${firstError || '원인 불명'}")`,
            5000,
          );
        }
        debugLog(`[Action] fillet-edge: ${successEdges}/${edges.length} edges, ${totalFaces} faces`);
      } else {
        Toast.fromBridgeError(this.bridge, `${edges.length}개 엣지 모두 모깎기 실패`);
      }
    } else if (action === 'subdivide') {
      // 전체 메시에 Catmull-Clark subdivision 1회 적용.
      // 면 개수 N → 각 면의 verts 수 합 (quad로 분할). 경계/hole 면은 거부.
      const count = this.bridge.subdivideCatmullClark();
      if (count >= 0) {
        this.syncMesh();
        this.selection.clearSelection();
        getOperationLog().record('subdivide', `Catmull-Clark 분할 (${count}개 quad)`, '');
        Toast.info(`Catmull-Clark 분할 완료 — ${count}개 quad 생성`, 2500);
        debugLog(`[Action] subdivide: ${count} quads`);
      } else {
        Toast.fromBridgeError(this.bridge, 'Subdivision 실패');
      }
    } else if (action === 'synthesize-faces') {
      // Phase H5 — 자유 엣지를 감지해 face로 합성 (수동 트리거)
      // 주로 2D DXF import 후 "평면도에서 면 만들기" 용도.
      // 자동이 아니라 사용자가 명시적으로 호출 → 의도 왜곡 방지.
      const freeEdgeCount = this.bridge.countFreeEdges();
      if (freeEdgeCount === 0) {
        Toast.info('자유 엣지가 없습니다 (모든 엣지가 이미 면에 속함)', 2500);
        return;
      }
      const created = this.bridge.synthesizeFacesFromFreeEdges();
      if (created > 0) {
        this.syncMesh();
        Toast.info(`${created}개 면 합성 완료 (자유 엣지 ${freeEdgeCount}개 중)`, 3000);
      } else {
        Toast.warning(
          `자유 엣지 ${freeEdgeCount}개 발견했으나 닫힌 polygon 미감지.\n` +
          '엣지가 실제로 닫혀 있는지 확인해 주세요.',
          3500,
        );
      }
    } else if (action === 'split-edge-midpoint') {
      // 1개 엣지 선택 → 중점에서 split
      const edges = this.selection.getSelectedEdges();
      if (edges.length !== 1) {
        Toast.warning('1개의 엣지를 선택해야 합니다');
        return;
      }
      const edgeId = edges[0];
      const eps = this.bridge.getEdgeEndpoints(edgeId);
      if (eps.length !== 2) { Toast.error('엣지 엔드포인트 조회 실패'); return; }
      const p0 = this.bridge.getVertexPos(eps[0]);
      const p1 = this.bridge.getVertexPos(eps[1]);
      if (!p0 || !p1) { Toast.error('엣지 좌표 조회 실패'); return; }
      const mx = (p0[0] + p1[0]) / 2;
      const my = (p0[1] + p1[1]) / 2;
      const mz = (p0[2] + p1[2]) / 2;
      const newVid = this.bridge.splitEdge(edgeId, mx, my, mz);
      if (newVid >= 0) {
        this.selection.clearSelection();
        this.syncMesh();
        Toast.info(`엣지 중점 분할 → 새 vertex ${newVid}`, 1800);
        debugLog(`[Action] split-edge-midpoint: edge=${edgeId} → vert=${newVid}`);
      } else {
        const err = this.bridge.lastError();
        Toast.error(err || '엣지 분할 실패', 3000);
      }
    } else if (action === 'constrain-edge-length') {
      // 선택된 1개 엣지의 길이를 고정 — 양 끝 vertex 간 Distance 제약으로 변환.
      const edges = this.selection.getSelectedEdges();
      if (edges.length !== 1) {
        Toast.warning('1개의 엣지를 선택해야 합니다');
        return;
      }
      const edgeId = edges[0];
      const eps = this.bridge.getEdgeEndpoints(edgeId);
      if (eps.length !== 2) {
        Toast.error('엣지 엔드포인트 조회 실패');
        return;
      }
      const p0 = this.bridge.getVertexPos(eps[0]);
      const p1 = this.bridge.getVertexPos(eps[1]);
      if (!p0 || !p1) { Toast.error('엣지 좌표 조회 실패'); return; }
      const current = Math.sqrt(
        (p1[0]-p0[0])**2 + (p1[1]-p0[1])**2 + (p1[2]-p0[2])**2
      );
      const promptText = `엣지 길이 (현재 ${current.toFixed(2)} mm):`;
      const input = window.prompt(promptText, current.toFixed(2));
      if (input == null) return;
      const target = parseFloat(input);
      if (!(target > 0) || !Number.isFinite(target)) {
        Toast.warning('유효한 양수 값을 입력하세요');
        return;
      }
      const id = this.bridge.addDistanceConstraint(eps[0], eps[1], target);
      if (id > 0) {
        this.syncMesh();
        Toast.info(`엣지 길이 제약 추가 (id=${id}, ${target.toFixed(2)} mm)`, 2200);
        debugLog(`[Action] constrain-edge-length: edge=${edgeId}, verts=${eps[0]},${eps[1]}, length=${target}`);
        const cp = (window as unknown as { __axia_constraintPanel?: { refresh: () => void } })
          .__axia_constraintPanel;
        cp?.refresh();
      } else {
        const err = this.bridge.lastError();
        Toast.error(err || '엣지 길이 제약 생성 실패', 3000);
      }
    } else if (action === 'constrain-endpoint-distance') {
      // 2 선택 엣지의 4개 끝점 중 가장 가까운 쌍에 Distance 제약.
      // 공유 정점이 있으면 나머지 2개 사이 거리로 자동 해석.
      const edges = this.selection.getSelectedEdges();
      if (edges.length !== 2) {
        Toast.warning('2개의 엣지를 선택해야 합니다');
        return;
      }
      const [edgeA, edgeB] = edges;
      const epA = this.bridge.getEdgeEndpoints(edgeA);
      const epB = this.bridge.getEdgeEndpoints(edgeB);
      if (epA.length !== 2 || epB.length !== 2) {
        Toast.error('엣지 엔드포인트 조회 실패'); return;
      }
      // 공유 정점이 있는지 확인
      const shared = [epA[0], epA[1]].filter(v => epB.includes(v));
      let vA: number, vB: number;
      if (shared.length === 1) {
        // 공유 있음 → 반대쪽 정점끼리 distance (삼각형 변 길이)
        vA = epA.find(v => v !== shared[0])!;
        vB = epB.find(v => v !== shared[0])!;
      } else {
        // 공유 없음 → 4쌍 중 최단 거리 정점 쌍
        const positions = [
          [epA[0], this.bridge.getVertexPos(epA[0])],
          [epA[1], this.bridge.getVertexPos(epA[1])],
          [epB[0], this.bridge.getVertexPos(epB[0])],
          [epB[1], this.bridge.getVertexPos(epB[1])],
        ];
        if (positions.some(([, p]) => !p)) { Toast.error('정점 좌표 조회 실패'); return; }
        let best = { vA: epA[0], vB: epB[0], dist: Infinity };
        for (const a of [0, 1]) {
          for (const b of [2, 3]) {
            const [vAid, pA] = positions[a] as [number, [number, number, number]];
            const [vBid, pB] = positions[b] as [number, [number, number, number]];
            const d = Math.sqrt((pA[0]-pB[0])**2 + (pA[1]-pB[1])**2 + (pA[2]-pB[2])**2);
            if (d < best.dist) best = { vA: vAid, vB: vBid, dist: d };
          }
        }
        vA = best.vA; vB = best.vB;
      }

      const pA = this.bridge.getVertexPos(vA);
      const pB = this.bridge.getVertexPos(vB);
      if (!pA || !pB) { Toast.error('정점 좌표 조회 실패'); return; }
      const current = Math.sqrt((pA[0]-pB[0])**2 + (pA[1]-pB[1])**2 + (pA[2]-pB[2])**2);

      const input = window.prompt(
        `정점 v${vA} ↔ v${vB} 거리 (현재 ${current.toFixed(2)} mm):`,
        current.toFixed(2),
      );
      if (input == null) return;
      const target = parseFloat(input);
      if (!(target > 0) || !Number.isFinite(target)) {
        Toast.warning('유효한 양수 값을 입력하세요'); return;
      }
      const id = this.bridge.addDistanceConstraint(vA, vB, target);
      if (id > 0) {
        this.syncMesh();
        Toast.info(`끝점 거리 제약 추가 (id=${id}, v${vA}↔v${vB} = ${target.toFixed(2)})`, 2500);
        const cp = (window as unknown as { __axia_constraintPanel?: { refresh: () => void } })
          .__axia_constraintPanel;
        cp?.refresh();
      } else {
        Toast.error(this.bridge.lastError() || '제약 생성 실패', 3000);
      }
    } else if (action === 'constrain-parallel' || action === 'constrain-perpendicular' || action === 'constrain-collinear') {
      // Constraint Solver Level 2 — persistent graph.
      // 2개 엣지: 첫번째 = 기준(driver), 두번째 = 이동 대상(driven).
      // 엔진에 제약이 영속 저장되고 이후 transform 때마다 자동 재해결.
      const edges = this.selection.getSelectedEdges();
      if (edges.length !== 2) {
        Toast.warning('2개의 엣지를 선택해야 합니다 (첫 번째 = 기준, 두 번째 = 이동 대상)');
        return;
      }
      const [edgeA, edgeB] = edges;
      const cc = new ConstraintCommands(this.bridge);
      let id = 0;
      let label = '';
      if (action === 'constrain-parallel')            { id = cc.addParallel(edgeA, edgeB); label = '평행'; }
      else if (action === 'constrain-perpendicular')  { id = cc.addPerpendicular(edgeA, edgeB); label = '수직'; }
      else                                            { id = cc.addCollinear(edgeA, edgeB); label = '동일 선상'; }

      if (id > 0) {
        this.syncMesh();
        Toast.info(`${label} 제약 추가 (id=${id}) — 이후 이동 시 자동 유지`, 2200);
        debugLog(`[Action] ${action}: edges=${edgeA},${edgeB}, constraintId=${id}`);
        // Constraint Panel 자동 새로고침 (열려 있는 경우)
        const cp = (window as unknown as { __axia_constraintPanel?: { refresh: () => void } })
          .__axia_constraintPanel;
        cp?.refresh();
      } else {
        const err = this.bridge.lastError();
        Toast.error(err || `${label} 제약 생성 실패`, 3000);
      }
    } else if (action === 'select-all') {
      this.selection.selectEverything(this.faceMap, this.edgeMap);
      debugLog('[Action] select-all');
    } else if (action === 'select-same') {
      this.selection.selectSameType(this.faceMap, this.edgeMap);
      debugLog('[Action] select-same');
    } else if (action === 'group') {
      const groupTool = this.tools.get('group') as GroupTool;
      if (groupTool) {
        groupTool.createGroupFromSelection();
      } else {
        const gid = this.selection.groupSelected();
        if (gid != null) {
          debugLog(`[Action] group created: Group-${gid}, faces:`, this.selection.getSelectedFaces());
        }
      }
    } else if (action === 'ungroup') {
      const groupTool = this.tools.get('group') as GroupTool;
      if (groupTool) {
        groupTool.ungroupSelection();
      } else {
        const result = this.selection.ungroupSelected();
        debugLog('[Action] ungroup =>', result);
      }
    } else if (action === 'make-component') {
      // 선택된 그룹을 컴포넌트로 변환
      const selected = this.selection.getSelectedFaces();
      if (selected.length > 0) {
        const groupId = this.selection.getGroupId(selected[0]);
        if (groupId !== undefined) {
          const defId = this.bridge.makeComponent(groupId, `Component-${groupId}`);
          if (defId > 0) {
            debugLog(`[Action] make-component: Group-${groupId} → Component def ${defId}`);
          }
        } else {
          debugLog('[Action] make-component — 먼저 그룹을 선택하세요');
        }
      }
    }
  }

  /**
   * Session 4 — defer snap spatial-hash rebuild to the next idle slot.
   * Called from syncMesh in place of the old inline `snap.updateFromMesh`.
   * If the browser does not implement `requestIdleCallback` (Safari) we
   * fall back to a zero-delay `setTimeout` which at least gets us off the
   * current frame.
   */
  private scheduleSnapRefresh(
    positions: Float32Array,
    indices: Uint32Array,
    faceMap: Uint32Array,
    edgeLines: Float32Array | null,
    snapF64: Float64Array | null,
  ): void {
    // Cancel a pending refresh — the buffers we just received are newer.
    if (this._snapIdleHandle !== null) {
      const w = window as unknown as {
        cancelIdleCallback?: (h: number) => void;
      };
      if (typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(this._snapIdleHandle);
      } else {
        clearTimeout(this._snapIdleHandle);
      }
      this._snapIdleHandle = null;
    }

    const run = () => {
      this._snapIdleHandle = null;
      try {
        this.snap.updateFromMesh(positions, indices, faceMap, edgeLines, snapF64);
      } catch (e) {
        console.warn('[ToolManager] scheduled snap refresh failed:', e);
      }
    };

    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof w.requestIdleCallback === 'function') {
      // 100 ms timeout caps worst-case snap staleness even under heavy load.
      this._snapIdleHandle = w.requestIdleCallback(run, { timeout: 100 });
    } else {
      this._snapIdleHandle = (setTimeout(run, 0) as unknown) as number;
    }
  }

  syncMesh(): void {
    // ADR-012 telemetry — full syncMesh budget = 33 ms (one frame).
    // Lazy import to keep WASM bridge dep-free.
    const t0 = performance.now();
    try {
      this._syncMeshInternal();
    } finally {
      const elapsed = performance.now() - t0;
      const w = window as unknown as { __AXIA_TELEMETRY_RECORD?: (key: string, ms: number) => void };
      w.__AXIA_TELEMETRY_RECORD?.('syncMesh', elapsed);
    }
  }

  /** Internal — original syncMesh body. Wrapped by syncMesh() for telemetry.
   *
   *  Sprint 2 §2 — 각 sub-step 을 따로 측정해 어디가 over-budget 인지
   *  telemetry 가 알려주도록 분해한다. 합산은 syncMesh budget(33ms)
   *  안에 들어가야 하며 부분 budget 은 BUDGETS["syncMesh.*"] 참조. */
  private _syncMeshInternal(): void {
    const recordStep = (key: string, ms: number): void => {
      const w = window as unknown as { __AXIA_TELEMETRY_RECORD?: (key: string, ms: number) => void };
      w.__AXIA_TELEMETRY_RECORD?.(key, ms);
    };

    // ── (a) Bridge queries ─ getEdgeLines / getEdgeMap / getDeltaBuffers ──
    const tBridge0 = performance.now();
    const edgeLines = this.bridge.getEdgeLines();
    this.edgeMap = this.bridge.getEdgeMap();
    if (this._sketch) this.updateSketchStatusBadge();
    const delta = this.bridge.getDeltaBuffers();
    recordStep('syncMesh.bridgeQueries', performance.now() - tBridge0);

    // ════ Phase 1 Optimization: Try delta first (fast path) ════
    if (delta && delta.positions.length > 0) {
      const tDelta0 = performance.now();
      const deltaApplied = this.viewport.applyDelta(delta);
      recordStep('syncMesh.deltaApply', performance.now() - tDelta0);
      if (deltaApplied) {
        // ✅ Delta successfully applied — only updated changed vertices
        debugLog('[ToolManager] Delta applied:', {
          modifiedFaces: delta.modifiedFaceIds.length,
          positions: delta.positions.length,
          savings: '~90% vs full buffer',
        });
        // ✱ Bug fix (2026-04-19): delta 경로에서도 edge lines / selection / snap을
        // 새 위치 기반으로 갱신해야 함. 이전에는 geometry 위치만 패치하고 끝내서
        // edge picking과 snap이 옛 위치를 참조 → 옮긴 오브젝트 대신 "뒤에 있는 것처럼
        // 보이는 원래 위치"의 오브젝트가 선택되는 현상 발생.
        if (edgeLines) this.viewport.updateEdgeLines(edgeLines);
        const buffersForUpdate = this.bridge.getMeshBuffers();
        if (buffersForUpdate) {
          this.faceMap = buffersForUpdate.faceMap;
          const tSel0 = performance.now();
          this.selection.updateBuffers(
            buffersForUpdate.positions, buffersForUpdate.indices, buffersForUpdate.faceMap,
          );
          this.selection.updateEdgeBuffers(edgeLines, this.edgeMap);
          recordStep('syncMesh.selection', performance.now() - tSel0);
          const snapF64 = this.bridge.getSnapVerticesF64();
          const tSnap0 = performance.now();
          this.scheduleSnapRefresh(
            buffersForUpdate.positions, buffersForUpdate.indices, buffersForUpdate.faceMap,
            edgeLines, snapF64,
          );
          recordStep('syncMesh.snapSchedule', performance.now() - tSnap0);
        }
        const stats = this.bridge.getStats();
        this.viewport.setStats(stats.verts, stats.faces);
        return;  // Success!
      }
    }

    // ════ Fallback: Full buffer update (slow path) ════
    debugLog('[ToolManager] Using full buffer update (delta unavailable or failed)');
    // Sprint 2 § 추가 — getMeshBuffers / getCenterlineLines / getFaceVolumeFlags
    // 도 bridge query 의 일부. 통합해서 'syncMesh.bridgeQueries' 에 누적.
    const tBridge1 = performance.now();
    const buffers = this.bridge.getMeshBuffers();
    const centerLines = this.bridge.getCenterlineLines();
    // ADR-007 Rev 2 — face 분류 비트 array (Wall=1, Sheet=0).
    //   Viewport 가 sheet 의 BackSide 를 front-color 로 렌더하는 데 사용.
    const volumeFlags = this.bridge.getFaceVolumeFlags();
    recordStep('syncMesh.bridgeQueries', performance.now() - tBridge1);
    if (buffers) {
      const tFull0 = performance.now();
      this.viewport.updateMesh(
        buffers.positions, buffers.normals, buffers.indices,
        edgeLines ?? undefined,
        buffers.faceMap,
        centerLines,
        volumeFlags,
      );
      recordStep('syncMesh.fullUpdate', performance.now() - tFull0);
      this.faceMap = buffers.faceMap;

      const tSel0 = performance.now();
      this.selection.updateBuffers(buffers.positions, buffers.indices, buffers.faceMap);
      this.selection.updateEdgeBuffers(edgeLines, this.edgeMap);
      recordStep('syncMesh.selection', performance.now() - tSel0);

      // Get f64 precision vertices for snap (avoids f32 truncation)
      const tBridge2 = performance.now();
      const snapF64 = this.bridge.getSnapVerticesF64();
      recordStep('syncMesh.bridgeQueries', performance.now() - tBridge2);
      const tSnap0 = performance.now();
      this.scheduleSnapRefresh(
        buffers.positions, buffers.indices, buffers.faceMap,
        edgeLines, snapF64,
      );
      recordStep('syncMesh.snapSchedule', performance.now() - tSnap0);
    } else {
      this.viewport.updateMesh(
        new Float32Array(0), new Float32Array(0), new Uint32Array(0),
        edgeLines ?? undefined,
        new Uint32Array(0),
        centerLines,
      );
      this.faceMap = new Uint32Array(0);
      this.selection.updateBuffers(new Float32Array(0), new Uint32Array(0), new Uint32Array(0));
      this.selection.updateEdgeBuffers(edgeLines, this.edgeMap);
      this.scheduleSnapRefresh(
        new Float32Array(0), new Uint32Array(0), new Uint32Array(0),
        edgeLines, null,
      );
    }

    const stats = this.bridge.getStats();
    this.viewport.setStats(stats.verts, stats.faces);

    // ━━━ Projected shadow update (enabled 시만) ━━━
    // Sun 방향은 viewport에서 얻어 Rust compute → triangle buffer → viewport 렌더.
    // Disabled 상태에도 호출은 가볍게 early-return하므로 매 sync마다 호출.
    if (this.viewport.isProjectedShadowEnabled()) {
      const sun = this.viewport.getSunTravelDirection();
      const tris = this.bridge.computeGroundProjectedShadows(sun.x, sun.y, sun.z);
      this.viewport.updateProjectedShadow(tris);
    } else {
      this.viewport.updateProjectedShadow(null);
    }
  }

  private getSnappedPoint(e: MouseEvent, rawGroundPoint: THREE.Vector3 | null, consumeOverride = false): THREE.Vector3 | null {
    const canvas = this.viewport.renderer.domElement;

    // ── onFace 스냅용: 커서 아래 face pick (있으면 전달) ──
    let faceHitPoint: THREE.Vector3 | null = null;
    try {
      const hit = this.viewport.pick(e.clientX, e.clientY);
      if (hit && hit.point) {
        faceHitPoint = hit.point.clone();
      }
    } catch {
      faceHitPoint = null;
    }

    const overrideType = consumeOverride
      ? this.snap.consumeOverride()
      : this.snap.getOverride();
    let snapResult;

    if (overrideType === 'none') {
      snapResult = null;
    } else if (overrideType) {
      snapResult = this.snap.findSnapOverride(
        overrideType,
        e.clientX, e.clientY,
        this.viewport.activeCamera,
        canvas,
        rawGroundPoint,
        faceHitPoint,
      );
    } else {
      snapResult = this.snap.findSnap(
        e.clientX, e.clientY,
        this.viewport.activeCamera,
        canvas,
        rawGroundPoint,
        faceHitPoint,
      );
    }

    // Phase B2: Inference chaining — remember recently hovered edges so that
    // parallel / extension inferences remain available even after the cursor
    // leaves them. Called whenever a snap fires on an edge-type candidate.
    if (snapResult?.edgeRef) {
      this.snap.recordHoveredEdge(snapResult.edgeRef.a, snapResult.edgeRef.b);
    }

    // SketchUp-style: if normal snap didn't fire, always-on endpoint inference kicks in
    if (!snapResult) {
      snapResult = this.snap.findNearestEndpoint(
        e.clientX, e.clientY,
        this.viewport.activeCamera,
        canvas,
      );
    }

    this.snapVisual.update(snapResult, this.viewport.activeCamera);

    if (snapResult) {
      return snapResult.position.clone();
    }
    return rawGroundPoint;
  }

  /**
   * 여러 face의 모든 vertex를 스캔해 axis-aligned bounding box의 최소 corner를
   * 반환. Paste/Duplicate의 placement "grab point"로 사용.
   *
   * 반환 null: face가 없거나 vertex 조회 실패한 경우. 호출자는 안전하게
   * undefined 처리 (placement는 기존 "첫 mousemove = anchor" 동작으로 fallback).
   */
  private computeBBoxMin(faceIds: number[]): THREE.Vector3 | null {
    if (faceIds.length === 0) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let found = false;
    for (const fid of faceIds) {
      const verts = this.bridge.getFaceVertices(fid);
      for (const vid of verts) {
        const p = this.bridge.getVertexPos(vid);
        if (!p) continue;
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[2] < minZ) minZ = p[2];
        found = true;
      }
    }
    return found ? new THREE.Vector3(minX, minY, minZ) : null;
  }

  // ═══ Parametric History re-run (Tier 3B) ═══

  /**
   * Re-run a previously logged operation with new parameter values (no
   * prompt — params come from HistoryPanel input). Returns true on success.
   *
   * This is NOT a full parametric feature tree — it doesn't track downstream
   * geometry dependencies. It simply reuses the last parameter template for
   * a one-shot rerun on the *current selection* (not the original target).
   * Users should re-select geometry before hitting "재실행…".
   */
  rerunLoggedOperation(kind: string, params: string): boolean {
    switch (kind) {
      case 'fillet-edge': {
        const r = parseFloat(params);
        if (!Number.isFinite(r) || r <= 0) { Toast.warning('유효한 반경 필요', 2500); return false; }
        const edges = this.selection.getSelectedEdges();
        if (edges.length === 0) { Toast.warning('재실행할 엣지를 선택하세요', 2500); return false; }
        try { localStorage.setItem('axia:fillet:radius', String(r)); } catch { /* ignore */ }
        let ok = 0, faces = 0;
        for (const eid of edges) {
          const n = this.bridge.filletEdge(eid, r, 8);
          if (n >= 0) { ok++; faces += n; }
        }
        if (ok > 0) {
          this.syncMesh();
          this.selection.clearSelection();
          getOperationLog().record('fillet-edge', `모깎기 ${r}mm × ${ok}개 엣지 (재실행)`, String(r));
          return true;
        }
        Toast.fromBridgeError(this.bridge, '재실행 실패');
        return false;
      }
      case 'chamfer-edge': {
        const d = parseFloat(params);
        if (!Number.isFinite(d) || d <= 0) { Toast.warning('유효한 거리 필요', 2500); return false; }
        const edges = this.selection.getSelectedEdges();
        if (edges.length !== 1) { Toast.warning('1개 엣지 선택 필요', 2500); return false; }
        try { localStorage.setItem('axia:chamfer:distance', String(d)); } catch { /* ignore */ }
        const n = this.bridge.filletEdge(edges[0], d, 1);
        if (n >= 0) {
          this.syncMesh();
          this.selection.clearSelection();
          getOperationLog().record('chamfer-edge', `모따기 ${d}mm (재실행)`, String(d));
          return true;
        }
        Toast.fromBridgeError(this.bridge, '재실행 실패');
        return false;
      }
      case 'thicken-faces': {
        const t = parseFloat(params);
        if (!Number.isFinite(t) || t === 0) { Toast.warning('0이 아닌 두께 필요', 2500); return false; }
        const sel = this.selection.getSelectedFaces();
        if (sel.length === 0) { Toast.warning('재실행할 면을 선택하세요', 2500); return false; }
        try { localStorage.setItem('axia:thicken:distance', String(t)); } catch { /* ignore */ }
        let ok = 0;
        for (const fid of sel) { if (this.bridge.pushPull(fid, t)) ok++; }
        if (ok > 0) {
          this.syncMesh();
          this.selection.clearSelection();
          getOperationLog().record('thicken-faces', `두께 ${t}mm × ${ok}개 면 (재실행)`, String(t));
          return true;
        }
        Toast.error('재실행 실패', 3000);
        return false;
      }
      case 'array-linear': {
        const sel = this.selection.getSelectedFaces();
        if (sel.length === 0) { Toast.warning('재실행할 면을 선택하세요', 2500); return false; }
        const parts = params.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
        if (parts.length !== 4) { Toast.warning('"N, dx, dy, dz" 4개 값 필요', 2500); return false; }
        const count = parseInt(parts[0], 10);
        const [dx, dy, dz] = [parts[1], parts[2], parts[3]].map(parseFloat);
        if (!Number.isFinite(count) || count < 1 || ![dx, dy, dz].every(Number.isFinite)) {
          Toast.warning('유효한 숫자 필요', 2500); return false;
        }
        try { localStorage.setItem('axia:array:params', params); } catch { /* ignore */ }
        const newFaces = this.bridge.arrayLinearFaces(sel, count, [dx, dy, dz]);
        if (newFaces.length > 0) {
          this.syncMesh();
          this.selection.clearSelection();
          getOperationLog().record('array-linear', `선형 배열 ${count}회 (재실행)`, params);
          return true;
        }
        Toast.fromBridgeError(this.bridge, '재실행 실패');
        return false;
      }
      case 'array-radial': {
        const sel = this.selection.getSelectedFaces();
        if (sel.length === 0) { Toast.warning('재실행할 면을 선택하세요', 2500); return false; }
        const parts = params.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
        if (parts.length !== 3) { Toast.warning('"N, axis, deg" 3개 값 필요', 2500); return false; }
        const count = parseInt(parts[0], 10);
        const axisChar = parts[1].toLowerCase();
        const totalDeg = parseFloat(parts[2]);
        if (!Number.isFinite(count) || count < 1 || !Number.isFinite(totalDeg)) {
          Toast.warning('유효한 숫자 필요', 2500); return false;
        }
        let axis: [number, number, number];
        if (axisChar === 'x') axis = [1, 0, 0];
        else if (axisChar === 'y') axis = [0, 1, 0];
        else if (axisChar === 'z') axis = [0, 0, 1];
        else { Toast.warning('축은 x/y/z 중 하나', 2500); return false; }
        try { localStorage.setItem('axia:array-radial:params', params); } catch { /* ignore */ }
        const newFaces = this.bridge.arrayRadialFaces(sel, count, [0, 0, 0], axis, totalDeg * Math.PI / 180);
        if (newFaces.length > 0) {
          this.syncMesh();
          this.selection.clearSelection();
          getOperationLog().record('array-radial', `원형 배열 ${count}회 · ${axisChar}축 · ${totalDeg}° (재실행)`, params);
          return true;
        }
        Toast.fromBridgeError(this.bridge, '재실행 실패');
        return false;
      }
      case 'subdivide': {
        const n = this.bridge.subdivideCatmullClark();
        if (n >= 0) {
          this.syncMesh();
          this.selection.clearSelection();
          getOperationLog().record('subdivide', `Catmull-Clark 분할 (재실행, ${n}개 quad)`, '');
          return true;
        }
        Toast.fromBridgeError(this.bridge, '재실행 실패');
        return false;
      }
      default:
        Toast.warning(`재실행 지원 안 함: ${kind}`, 2500);
        return false;
    }
  }

  // ═══ Sketch Mode API ═══

  /** Enter sketch mode. All subsequent drawing locks to this plane. */
  enterSketch(opts: {
    label: string;
    origin: THREE.Vector3;
    normal: THREE.Vector3;
    up: THREE.Vector3;
  }): void {
    this._sketch = {
      label: opts.label,
      origin: opts.origin.clone(),
      normal: opts.normal.clone().normalize(),
      up: opts.up.clone().normalize(),
    };
    this.viewport.setSketchPlaneVisual(this._sketch);
    // 툴바 배지 (DOM status bar 내부 요소) 갱신.
    this.updateSketchStatusBadge();
    // Phase 4 — last-used plane을 localStorage에 저장 (auto 모드 fallback).
    try {
      localStorage.setItem('axia.sketch.lastPlane', JSON.stringify({
        label: this._sketch.label,
        origin: this._sketch.origin.toArray(),
        normal: this._sketch.normal.toArray(),
        up: this._sketch.up.toArray(),
      }));
    } catch { /* localStorage may be disabled */ }
    // Constraint Panel 자동 열기 — 스케치 중에는 제약 사용이 권장되므로
    // 사용자가 J 키를 누르지 않아도 즉시 보이게.
    const panel = (window as unknown as { __axia_constraintPanel?: { show(): void } })
      .__axia_constraintPanel;
    panel?.show();
    debugLog(`[Sketch] enter: ${opts.label}`);
  }

  /** Phase 4 — Auto-detect best sketch plane.
   *
   *  Priority:
   *    1. If exactly 1 face is selected → use that face's plane.
   *    2. Else if camera direction is dominantly aligned with a world axis →
   *       use the perpendicular world plane (looking down → XZ floor;
   *       looking front → XY wall; looking sideways → YZ wall).
   *    3. Else → fall back to last-used plane from localStorage.
   *    4. Else → XZ floor (Y=0).
   */
  startSketchAuto(): void {
    const sel = this.selection.getSelectedFaces();
    if (sel.length === 1) {
      this.executeAction('sketch-start-face');
      return;
    }
    // Camera dominant-axis heuristic.
    const cam = this.viewport.activeCamera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const ax = Math.abs(dir.x), ay = Math.abs(dir.y), az = Math.abs(dir.z);
    let chosen: 'xz' | 'xy' | 'yz';
    if (ay >= ax && ay >= az) chosen = 'xz';
    else if (az >= ax && az >= ay) chosen = 'xy';
    else chosen = 'yz';
    this.executeAction(`sketch-start-${chosen}`);
  }

  /** Phase 4 — Re-orient the current sketch's `up` vector to the
   *  projected camera-up direction (keeps drawing aligned with view). */
  alignSketchUpToCamera(): void {
    if (!this._sketch) {
      Toast.warning('스케치 모드가 아닙니다', 2500);
      return;
    }
    const cam = this.viewport.activeCamera;
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    // Project camUp onto sketch plane (remove component along normal).
    const n = this._sketch.normal;
    const u = camUp.clone().sub(n.clone().multiplyScalar(camUp.dot(n)));
    if (u.lengthSq() < 1e-6) {
      Toast.warning('카메라가 스케치 평면에 직각 — 정렬 불가', 2500);
      return;
    }
    u.normalize();
    this._sketch.up = u;
    this.viewport.setSketchPlaneVisual(this._sketch);
    Toast.info('스케치 up 방향을 카메라에 정렬했습니다', 2000);
  }

  /** Exit sketch mode. Geometry created during the session stays in the
   *  scene — users typically follow up with push_pull to extrude. */
  exitSketch(): void {
    if (!this._sketch) return;
    debugLog(`[Sketch] exit: ${this._sketch.label}`);
    this._sketch = null;
    this.viewport.setSketchPlaneVisual(null);
    this.updateSketchStatusBadge();
  }

  /** Update the status-bar badge to reflect sketch state.
   *  Uses #sb-sketch-badge element (added to status bar in index.html).
   *  Also shows the live free-edge count so the user knows when a closed
   *  profile is likely ready (count drops as edges connect into loops). */
  private updateSketchStatusBadge(): void {
    const el = document.getElementById('sb-sketch-badge');
    if (!el) return;
    if (this._sketch) {
      let freeCount = 0;
      try { freeCount = this.bridge.countFreeEdges(); } catch { /* bridge may not be ready */ }
      // "N free" shows dangling polyline endpoints. When all lines connect
      // into closed loops, free edges drop to 0 within each loop (each HE
      // paired) → user knows "ready to finish".
      const suffix = freeCount > 0 ? ` · ${freeCount} free` : ' · ready';
      el.textContent = `✏️ ${this._sketch.label}${suffix}`;
      el.style.display = 'inline-block';
      // Color-code: orange (still drawing) → green (ready to finish)
      el.style.background = freeCount > 0 ? '#ffa500' : '#4caf50';
    } else {
      el.style.display = 'none';
    }
  }

  isSketching(): boolean { return this._sketch !== null; }

  getSketchInfo(): { label: string; origin: THREE.Vector3; normal: THREE.Vector3; up: THREE.Vector3 } | null {
    if (!this._sketch) return null;
    return {
      label: this._sketch.label,
      origin: this._sketch.origin.clone(),
      normal: this._sketch.normal.clone(),
      up: this._sketch.up.clone(),
    };
  }

  /** Get the drawing plane normal based on current view mode.
   *  - Sketch mode ACTIVE → the sketch plane (overrides view mode)
   *  - 3d / top / bottom → Y=0 plane (XZ ground)
   *  - front / back → Z=0 plane (XY wall)
   *  - right / left → X=0 plane (YZ wall)
   */
  private getWorkPlane(): THREE.Plane {
    if (this._sketch) {
      // THREE.Plane(normal, constant) where constant = -normal·origin
      const c = -this._sketch.normal.dot(this._sketch.origin);
      return new THREE.Plane(this._sketch.normal.clone(), c);
    }
    const vm = this.viewport.viewMode;
    switch (vm) {
      case 'front':
      case 'back':
        return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // Z=0
      case 'right':
      case 'left':
        return new THREE.Plane(new THREE.Vector3(1, 0, 0), 0); // X=0
      default: // '3d', 'top', 'bottom'
        return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Y=0
    }
  }

  private getGroundPoint(e: MouseEvent): THREE.Vector3 | null {
    const ray = this.getRay(e);
    const plane = this.getWorkPlane();
    const target = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, target);
  }

  private get3DPoint(e: MouseEvent): THREE.Vector3 | null {
    // Sketch mode: bypass object pick — all clicks project to the sketch
    // plane (user explicitly chose the plane when entering sketch).
    if (this._sketch) {
      const ray = this.getRay(e);
      const target = new THREE.Vector3();
      return ray.ray.intersectPlane(this.getWorkPlane(), target);
    }
    // 1st: try hitting an object face (exact surface point)
    const hit = this.viewport.pick(e.clientX, e.clientY);
    if (hit && hit.point) {
      return hit.point.clone();
    }
    // 2nd: fall back to view-adaptive work plane
    const ray = this.getRay(e);
    const groundPlane = this.getWorkPlane();
    const target = new THREE.Vector3();
    return ray.ray.intersectPlane(groundPlane, target);
  }

  private getRay(e: MouseEvent): THREE.Raycaster {
    const canvas = this.viewport.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this.viewport.activeCamera as THREE.PerspectiveCamera);
    return ray;
  }

  /** ADR-007 Rev 2 (C 코드 부채 정리) — small context object for action
   *  modules so they don't reach into ToolManager internals.
   *  See web/src/tools/actions/MergeActions.ts. */
  private _mergeCtx(): MergeActionContext {
    return {
      bridge: this.bridge,
      selection: this.selection,
      syncMesh: () => this.syncMesh(),
      extractFaceBoundary: (faceId: number) => this.extractFaceBoundary(faceId),
    };
  }

  private extractFaceBoundary(faceId: number): THREE.Vector3[] {
    const buffers = this.bridge.getMeshBuffers();
    if (!buffers) return [];

    const edgeMap = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; count: number }>();

    // Use f64 positions for CAD-grade precision (no f32 truncation)
    const pf64 = buffers.positionsF64 ?? this.bridge.getPositionsF64();
    const getVert = pf64
      ? (idx: number) => new THREE.Vector3(pf64[idx * 3], pf64[idx * 3 + 1], pf64[idx * 3 + 2])
      : (idx: number) => new THREE.Vector3(
          buffers.positions[idx * 3],
          buffers.positions[idx * 3 + 1],
          buffers.positions[idx * 3 + 2],
        );

    const edgeKey = (a: THREE.Vector3, b: THREE.Vector3) => {
      const ka = `${a.x.toFixed(5)},${a.y.toFixed(5)},${a.z.toFixed(5)}`;
      const kb = `${b.x.toFixed(5)},${b.y.toFixed(5)},${b.z.toFixed(5)}`;
      return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    };

    for (let tri = 0; tri < buffers.faceMap.length; tri++) {
      if (buffers.faceMap[tri] !== faceId) continue;
      const i0 = buffers.indices[tri * 3];
      const i1 = buffers.indices[tri * 3 + 1];
      const i2 = buffers.indices[tri * 3 + 2];
      const v0 = getVert(i0), v1 = getVert(i1), v2 = getVert(i2);

      for (const [a, b] of [[v0, v1], [v1, v2], [v2, v0]]) {
        const key = edgeKey(a, b);
        const existing = edgeMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          edgeMap.set(key, { a: a.clone(), b: b.clone(), count: 1 });
        }
      }
    }

    const boundary: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
    for (const [, e] of edgeMap) {
      if (e.count === 1) boundary.push(e);
    }
    if (boundary.length === 0) return [];

    const loop: THREE.Vector3[] = [boundary[0].a.clone(), boundary[0].b.clone()];
    const used = new Set<number>([0]);

    for (let iter = 0; iter < boundary.length; iter++) {
      const last = loop[loop.length - 1];
      let found = false;
      for (let i = 0; i < boundary.length; i++) {
        if (used.has(i)) continue;
        const e = boundary[i];
        if (last.distanceTo(e.a) < 0.001) {
          loop.push(e.b.clone());
          used.add(i);
          found = true;
          break;
        } else if (last.distanceTo(e.b) < 0.001) {
          loop.push(e.a.clone());
          used.add(i);
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    if (loop.length > 2 && loop[0].distanceTo(loop[loop.length - 1]) < 0.001) {
      loop.pop();
    }

    return loop;
  }

  private getAxisInferredPoint(e: MouseEvent, origin: THREE.Vector3): {
    point: THREE.Vector3;
    axis: 'x' | 'y' | 'z' | 'free';
  } {
    const ray = this.getRay(e);

    // In orthographic views, exclude the viewing axis (parallel to camera ray → unusable)
    const allAxes: { dir: THREE.Vector3; name: 'x' | 'y' | 'z' }[] = [
      { dir: new THREE.Vector3(1, 0, 0), name: 'x' },
      { dir: new THREE.Vector3(0, 1, 0), name: 'y' },
      { dir: new THREE.Vector3(0, 0, 1), name: 'z' },
    ];
    const vm = this.viewport.viewMode;
    const axes = allAxes.filter(ax => {
      if ((vm === 'top' || vm === 'bottom') && ax.name === 'y') return false;
      if ((vm === 'front' || vm === 'back') && ax.name === 'z') return false;
      if ((vm === 'right' || vm === 'left') && ax.name === 'x') return false;
      return true;
    });

    const forcedAxis = this.axisLock;
    let bestAxis: 'x' | 'y' | 'z' = 'x';
    let bestPoint = origin.clone();
    let bestScreenDist = Infinity;

    const canvas = this.viewport.renderer.domElement;
    const canvasRect = canvas.getBoundingClientRect();

    for (const ax of axes) {
      if (forcedAxis && forcedAxis !== 'free' && forcedAxis !== ax.name) continue;

      const projected = this.closestPointOnAxisToRay(
        origin, ax.dir, ray.ray.origin, ray.ray.direction
      );
      if (!projected) continue;

      const screenPt = projected.clone().project(this.viewport.activeCamera);
      const sx = (screenPt.x * 0.5 + 0.5) * canvasRect.width;
      const sy = (-screenPt.y * 0.5 + 0.5) * canvasRect.height;
      const mouseX = e.clientX - canvasRect.left;
      const mouseY = e.clientY - canvasRect.top;
      const dist = Math.sqrt((sx - mouseX) ** 2 + (sy - mouseY) ** 2);

      if (dist < bestScreenDist) {
        bestScreenDist = dist;
        bestAxis = ax.name;
        bestPoint = projected;
      }
    }

    const AXIS_THRESHOLD = 30;
    if (!forcedAxis && bestScreenDist > AXIS_THRESHOLD) {
      const freePt = this.get3DPoint(e);
      return { point: freePt || origin.clone(), axis: 'free' };
    }

    return { point: bestPoint, axis: forcedAxis && forcedAxis !== 'free' ? forcedAxis : bestAxis };
  }

  private closestPointOnAxisToRay(
    axisOrigin: THREE.Vector3, axisDir: THREE.Vector3,
    rayOrigin: THREE.Vector3, rayDir: THREE.Vector3,
  ): THREE.Vector3 | null {
    const w0 = new THREE.Vector3().subVectors(axisOrigin, rayOrigin);
    const a = axisDir.dot(axisDir);
    const b = axisDir.dot(rayDir);
    const c = rayDir.dot(rayDir);
    const d = axisDir.dot(w0);
    const e = rayDir.dot(w0);

    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-10) return null;

    const t = (b * e - c * d) / denom;
    return axisOrigin.clone().add(axisDir.clone().multiplyScalar(t));
  }

  private updateAxisGuide(origin: THREE.Vector3, axis: 'x' | 'y' | 'z' | 'free', endPt: THREE.Vector3): void {
    if (this.axisGuide) {
      this.viewport.scene.remove(this.axisGuide);
      this.axisGuide.geometry.dispose();
      (this.axisGuide.material as THREE.Material).dispose();
      this.axisGuide = null;
    }

    if (axis === 'free') return;

    const colors: Record<string, number> = { x: 0xff3333, y: 0x3388ff, z: 0x33cc33 };
    const axisDir: Record<string, THREE.Vector3> = {
      x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, 1, 0),
      z: new THREE.Vector3(0, 0, 1),
    };

    const dir = axisDir[axis];
    const len = origin.distanceTo(endPt) * 1.5 + 500;
    const p1 = origin.clone().add(dir.clone().multiplyScalar(-len));
    const p2 = origin.clone().add(dir.clone().multiplyScalar(len));

    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const mat = new THREE.LineDashedMaterial({
      color: colors[axis],
      dashSize: 20,
      gapSize: 10,
      transparent: true,
      opacity: 0.5,
    });
    this.axisGuide = new THREE.Line(geo, mat);
    this.axisGuide.computeLineDistances();
    this.viewport.scene.add(this.axisGuide);
  }

  private clearAxisGuide(): void {
    if (this.axisGuide) {
      this.viewport.scene.remove(this.axisGuide);
      this.axisGuide.geometry.dispose();
      (this.axisGuide.material as THREE.Material).dispose();
      this.axisGuide = null;
    }
  }

  /**
   * Update the hover-time draw-plane gizmo from the last recorded mouse
   * event. Called at most once per animation frame (RAF throttle).
   *
   * Performance: one `viewport.pick()` raycast (BVH-accelerated) per frame
   * at most, only while a drawing tool is active and the user is hovering.
   */
  private flushDrawPlaneIndicator(): void {
    this.drawPlaneRafPending = false;
    const e = this.drawPlaneLastEvent;
    if (!e) return;
    if (!ToolManager.DRAW_PLANE_TOOLS.has(this._currentTool)) return;
    if (this.isToolBusy()) { this.drawPlaneIndicator?.hide(); return; }

    const plane = this.getDrawPlane(e);
    // Gizmo anchor: use the face hit point if we're on a face,
    // else the ground raycast point. If neither exists, hide.
    let origin: THREE.Vector3 | null = null;
    if (plane.onFace) {
      const hit = this.viewport.pick(e.clientX, e.clientY);
      if (hit?.point) origin = hit.point.clone();
    }
    if (!origin) origin = this.get3DPoint(e);
    if (!origin) { this.drawPlaneIndicator?.hide(); return; }

    this.drawPlaneIndicator?.show(origin, plane);
  }

  /**
   * Detect drawing plane from mouse position.
   * If cursor is on an existing face → use that face's DCEL normal.
   * If cursor is on empty space → use default ground plane (Y-up).
   */
  private getDrawPlane(e: MouseEvent): DrawPlaneInfo {
    // Sketch mode: lock to the sketch plane irrespective of cursor face hit.
    if (this._sketch) {
      const normal = this._sketch.normal.clone();
      const up = this._sketch.up.clone();
      const right = new THREE.Vector3().crossVectors(up, normal).normalize();
      return { normal, up, right, onFace: false };
    }
    // View-mode-adaptive default drawing plane
    const vm = this.viewport.viewMode;
    let defaultPlane: DrawPlaneInfo;
    switch (vm) {
      case 'front':
      case 'back':
        // Z=0 plane (XY wall) — normal=(0,0,1), up=(0,1,0), right=(1,0,0)
        defaultPlane = {
          normal: new THREE.Vector3(0, 0, 1),
          up: new THREE.Vector3(0, 1, 0),
          right: new THREE.Vector3(1, 0, 0),
          onFace: false,
        };
        break;
      case 'right':
      case 'left':
        // X=0 plane (YZ wall) — normal=(1,0,0), up=(0,1,0), right=(0,0,-1)
        defaultPlane = {
          normal: new THREE.Vector3(1, 0, 0),
          up: new THREE.Vector3(0, 1, 0),
          right: new THREE.Vector3(0, 0, -1),
          onFace: false,
        };
        break;
      default: // '3d', 'top', 'bottom'
        // Y=0 plane (XZ ground) — normal=(0,1,0), up=(0,0,-1), right=(1,0,0)
        defaultPlane = {
          normal: new THREE.Vector3(0, 1, 0),
          up: new THREE.Vector3(0, 0, -1),
          right: new THREE.Vector3(1, 0, 0),
          onFace: false,
        };
        break;
    }

    const hit = this.viewport.pick(e.clientX, e.clientY);
    if (!hit || hit.faceIndex == null) return defaultPlane;

    const fid = this.getFaceId(hit.faceIndex);
    if (fid < 0) return defaultPlane;

    // Get DCEL face normal (more accurate than Three.js interpolated normal)
    const [nx, ny, nz] = this.bridge.getFaceNormal(fid);
    const normal = new THREE.Vector3(nx, ny, nz);
    if (normal.lengthSq() < 0.001) return defaultPlane;
    normal.normalize();

    // Compute up and right vectors for this plane
    // Strategy: pick the world axis least parallel to the normal as the reference
    const absN = new THREE.Vector3(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z));
    let ref: THREE.Vector3;
    if (absN.y >= absN.x && absN.y >= absN.z) {
      // Normal is mostly Y → use world Z as reference
      ref = new THREE.Vector3(0, 0, 1);
    } else if (absN.x >= absN.y && absN.x >= absN.z) {
      // Normal is mostly X → use world Y as reference
      ref = new THREE.Vector3(0, 1, 0);
    } else {
      // Normal is mostly Z → use world Y as reference
      ref = new THREE.Vector3(0, 1, 0);
    }

    const right = new THREE.Vector3().crossVectors(ref, normal).normalize();
    const up = new THREE.Vector3().crossVectors(normal, right).normalize();

    return { normal, up, right, onFace: true };
  }

  private getFaceId(faceIndex: number): number {
    if (faceIndex >= 0 && faceIndex < this.faceMap.length) {
      return this.faceMap[faceIndex];
    }
    return -1;
  }

  cancelCurrentTool(): void {
    const tool = this.tools.get(this._currentTool);
    if (tool?.onDeactivate) {
      tool.onDeactivate();
    }
    this.clearAxisGuide();
    this.dimLabel.clear();
    this.snapVisual.clear();
    this.snap.setReferencePoint(null);
    this.snap.clearTrackPoints();
    this.axisLock = null;
    this.inferredAxis = 'free';
  }

  // ═══════════════════════════════════════════════════
  //  Selection Dimension Display (Stage 1)
  // ═══════════════════════════════════════════════════

  /**
   * Compute dimension lines for selected faces' boundary edges.
   * Called on selection change — caches the result for per-frame rendering.
   */
  private updateSelectionDimensions(faceIds: number[]): void {
    this.selectionDimLines = [];

    if (faceIds.length === 0) {
      this.dimLabel.clear();
      return;
    }

    // ═══ Phase 1: Perimeter edge 추출 (count==1인 것만) ═══
    // 이전엔 edgeSet으로 중복만 제거했는데, 인접한 두 선택 면이
    // 공유하는 내부 edge도 포함되어 테셀레이션된 구/원기둥이
    // 수백 개 라벨로 덮였음. 이제는 선택 영역의 **실제 perimeter**만.
    const vkey = (v: THREE.Vector3) =>
      `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
    const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

    type EdgeRec = { from: THREE.Vector3; to: THREE.Vector3; fromKey: string; toKey: string; count: number };
    const edges = new Map<string, EdgeRec>();

    for (const faceId of faceIds) {
      const loop = this.extractFaceBoundary(faceId);
      if (loop.length < 2) continue;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const ka = vkey(a);
        const kb = vkey(b);
        const k = edgeKey(ka, kb);
        const ex = edges.get(k);
        if (ex) {
          ex.count++;
        } else {
          edges.set(k, { from: a.clone(), to: b.clone(), fromKey: ka, toKey: kb, count: 1 });
        }
      }
    }

    // Perimeter = 선택 내부에서 공유되지 않는 edge들
    const perimeter: EdgeRec[] = [];
    for (const [, e] of edges) {
      if (e.count === 1 && e.from.distanceTo(e.to) >= 0.1) perimeter.push(e);
    }

    if (perimeter.length === 0) {
      this.dimLabel.clear();
      return;
    }

    // ═══ Phase 2: Edge chain 재구성 (vertex connectivity로 연결된 체인 묶기) ═══
    // 같은 vertex key를 공유하는 edge들을 따라가며 연속 체인 형성.
    // smooth group의 연속된 perimeter는 하나의 "arc"로 인식됨.
    const adj = new Map<string, EdgeRec[]>();
    for (const e of perimeter) {
      (adj.get(e.fromKey) ?? adj.set(e.fromKey, []).get(e.fromKey)!).push(e);
      (adj.get(e.toKey) ?? adj.set(e.toKey, []).get(e.toKey)!).push(e);
    }
    const visited = new Set<EdgeRec>();
    const chains: EdgeRec[][] = [];
    for (const start of perimeter) {
      if (visited.has(start)) continue;
      const chain: EdgeRec[] = [start];
      visited.add(start);
      // Forward walk from start.toKey
      let frontierKey = start.toKey;
      while (true) {
        const neighbors = adj.get(frontierKey) ?? [];
        const next = neighbors.find(e => !visited.has(e));
        if (!next) break;
        visited.add(next);
        chain.push(next);
        frontierKey = next.fromKey === frontierKey ? next.toKey : next.fromKey;
        if (frontierKey === start.fromKey) break; // closed loop
      }
      // Backward walk from start.fromKey (in case chain is open)
      let backKey = start.fromKey;
      while (true) {
        const neighbors = adj.get(backKey) ?? [];
        const prev = neighbors.find(e => !visited.has(e));
        if (!prev) break;
        visited.add(prev);
        chain.unshift(prev);
        backKey = prev.fromKey === backKey ? prev.toKey : prev.fromKey;
      }
      chains.push(chain);
    }

    // ═══ Phase 3: 각 체인을 분석하여 표시 결정 ═══
    // - 원형 감지: 닫힌 체인의 모든 vertex가 centroid에서 등거리 → R 라벨
    // - 기타 체인: 단일 선분이면 길이 라벨, 다중 선분이면 총 길이 (⌒)
    const colors = ['#ff6b6b', '#51cf66', '#4dabf7', '#ffd43b', '#cc5de8', '#ff922b'];
    let colorIdx = 0;
    const MAX_DIM_LABELS = 20;

    // 집계 기준: 이 값 미만 길이의 chain은 개별 edge 라벨 유지
    // (직사각형 4 edge, 오각형 5 edge 등은 개별로 보여야 자연스러움)
    const AGGREGATE_MIN_EDGES = 8;

    // 원통 높이 감지용: 감지된 원형 체인의 centroid + radius 수집
    const detectedCircles: Array<{ centroid: THREE.Vector3; radius: number }> = [];

    for (const chain of chains) {
      if (this.selectionDimLines.length >= MAX_DIM_LABELS) break;
      const isClosed = chain.length > 1 &&
        (chain[0].fromKey === chain[chain.length - 1].toKey ||
         chain[0].fromKey === chain[chain.length - 1].fromKey ||
         chain[0].toKey === chain[chain.length - 1].toKey ||
         chain[0].toKey === chain[chain.length - 1].fromKey);

      const color = colors[colorIdx++ % colors.length];

      // 짧은 chain (직사각형·다각형) — 개별 edge 라벨 유지
      if (chain.length < AGGREGATE_MIN_EDGES) {
        for (const e of chain) {
          if (this.selectionDimLines.length >= MAX_DIM_LABELS) break;
          const len = e.from.distanceTo(e.to);
          this.selectionDimLines.push({
            from: e.from, to: e.to, text: this.units.format(len),
            color: colors[colorIdx++ % colors.length], editable: true,
          });
        }
        continue;
      }

      // 체인의 모든 vertex 수집 (중복 제거)
      const vertMap = new Map<string, THREE.Vector3>();
      for (const e of chain) {
        vertMap.set(e.fromKey, e.from);
        vertMap.set(e.toKey, e.to);
      }
      const verts = Array.from(vertMap.values());

      // centroid
      const centroid = new THREE.Vector3();
      for (const v of verts) centroid.add(v);
      centroid.divideScalar(verts.length);

      // 총 길이
      let totalLen = 0;
      for (const e of chain) totalLen += e.from.distanceTo(e.to);

      // Phase 3: 원형(닫힌 체인 + 등거리) 감지
      let isCircular = false;
      let radius = 0;
      if (isClosed && verts.length >= 8) {
        // avg radius
        let sumR = 0;
        for (const v of verts) sumR += v.distanceTo(centroid);
        const avgR = sumR / verts.length;
        // 모든 vertex가 avgR에서 ±1% 이내면 원으로 인식
        let maxDev = 0;
        for (const v of verts) {
          const dev = Math.abs(v.distanceTo(centroid) - avgR);
          if (dev > maxDev) maxDev = dev;
        }
        if (maxDev < avgR * 0.01) {
          isCircular = true;
          radius = avgR;
        }
      }

      if (isCircular) {
        // 중심 → 첫 vertex로 R 라벨
        this.selectionDimLines.push({
          from: centroid,
          to: verts[0],
          text: `R ${this.units.format(radius)}`,
          color,
          editable: true,
        });
        // 원통 높이 감지를 위해 centroid + radius 기록
        detectedCircles.push({ centroid: centroid.clone(), radius });
      } else {
        // 체인 중간 edge 한 개 골라서 arc 심볼 + 총 길이
        const mid = chain[Math.floor(chain.length / 2)];
        const arcLabel = isClosed
          ? `⌒ ${this.units.format(totalLen)} (닫힘)`
          : `⌒ ${this.units.format(totalLen)}`;
        this.selectionDimLines.push({
          from: mid.from, to: mid.to, text: arcLabel, color, editable: false,
        });
      }
    }

    // ═══ 원통 높이 감지 ═══
    // 동일 반지름(±2%)의 원형 체인이 2개 이상이면 → 원통으로 간주하고
    // 각 쌍의 centroid 거리를 "H" 라벨로 추가.
    // (3개 이상인 경우: 가장 먼 두 원만 표시 — 전체 높이)
    if (detectedCircles.length >= 2 && this.selectionDimLines.length < MAX_DIM_LABELS) {
      // 같은 반지름으로 그룹핑 (±2%)
      const groups: Array<{ radius: number; circles: typeof detectedCircles }> = [];
      for (const c of detectedCircles) {
        const g = groups.find(gr => Math.abs(gr.radius - c.radius) <= c.radius * 0.02);
        if (g) g.circles.push(c); else groups.push({ radius: c.radius, circles: [c] });
      }
      for (const group of groups) {
        if (group.circles.length < 2) continue;
        // 가장 먼 두 centroid를 선택 → 원통 전체 높이
        let maxDist = 0;
        let best: [THREE.Vector3, THREE.Vector3] | null = null;
        for (let i = 0; i < group.circles.length; i++) {
          for (let j = i + 1; j < group.circles.length; j++) {
            const d = group.circles[i].centroid.distanceTo(group.circles[j].centroid);
            if (d > maxDist) {
              maxDist = d;
              best = [group.circles[i].centroid, group.circles[j].centroid];
            }
          }
        }
        if (best && maxDist > 1) {
          if (this.selectionDimLines.length >= MAX_DIM_LABELS) break;
          this.selectionDimLines.push({
            from: best[0],
            to: best[1],
            text: `H ${this.units.format(maxDist)}`,
            color: '#ffa94d', // 원통 높이 — 오렌지 계열로 radius(R)와 구분
            editable: true,
          });
        }
      }
    }

    // 초과 시 요약 덧붙이기
    if (chains.length > MAX_DIM_LABELS) {
      // 라벨 배열은 이미 MAX로 잘렸고, 단순 경고만 debugLog
      debugLog(`[Selection] ${chains.length} chains, showing ${MAX_DIM_LABELS}`);
    }

    if (this.selectionDimLines.length > 0) {
      this.dimLabel.update(this.viewport.activeCamera, this.selectionDimLines);
    } else {
      this.dimLabel.clear();
    }
  }

  /**
   * Re-render cached selection dimensions (called on camera/mouse updates)
   */
  renderSelectionDimensions(): void {
    if (this.selectionDimLines.length > 0 && this._currentTool === 'select') {
      this.dimLabel.update(this.viewport.activeCamera, this.selectionDimLines);
    }
  }

  /**
   * Handle dimension edit: user clicked a dimension label and entered a new value.
   *
   * Strategy:
   *   1. Scale center = face centroid (symmetric, both parallel edges change equally)
   *   2. For axis-aligned edges: direct scaleFaces (exact, 0% error)
   *   3. For non-axis-aligned edges: rotate → scale → rotate-back (exact, 0% error)
   *
   * Result: The edited edge AND its parallel opposite edge both become newLength.
   * The face stays rectangular (no shear/distortion).
   */
  private handleDimensionEdit(_index: number, newValue: number, dimLine: DimLine): void {
    const selectedFaces = this.selection.getSelectedFaces();
    if (selectedFaces.length === 0) return;

    const oldLength = dimLine.from.distanceTo(dimLine.to);
    if (oldLength < 0.001) return;

    const delta = newValue - oldLength;
    if (Math.abs(delta) < 0.01) return; // No meaningful change

    const scaleFactor = newValue / oldLength;

    // Edge direction (unit vector along the edge)
    const edgeDir = new THREE.Vector3().subVectors(dimLine.to, dimLine.from).normalize();

    // Face centroid as scale center (symmetric scaling)
    const allVerts: THREE.Vector3[] = [];
    for (const fid of selectedFaces) {
      const loop = this.extractFaceBoundary(fid);
      allVerts.push(...loop);
    }
    if (allVerts.length === 0) return;

    const centroid = new THREE.Vector3();
    for (const v of allVerts) centroid.add(v);
    centroid.divideScalar(allVerts.length);
    const cx = centroid.x, cy = centroid.y, cz = centroid.z;

    // Check if edge is axis-aligned (fast path, exact)
    const ax = Math.abs(edgeDir.x);
    const ay = Math.abs(edgeDir.y);
    const az = Math.abs(edgeDir.z);
    const isAxisAligned = (ax > 0.999) || (ay > 0.999) || (az > 0.999);

    let ok = false;

    if (isAxisAligned) {
      // ═══ Fast path: axis-aligned edge → direct scale (exact) ═══
      const sx = ax > 0.999 ? scaleFactor : 1;
      const sy = ay > 0.999 ? scaleFactor : 1;
      const sz = az > 0.999 ? scaleFactor : 1;

      debugLog(`[DimEdit] Axis-aligned: ${oldLength.toFixed(2)} → ${newValue.toFixed(2)}, scale=(${sx},${sy},${sz})`);
      ok = this.bridge.scaleFaces(selectedFaces, cx, cy, cz, sx, sy, sz);
    } else {
      // ═══ General path: rotate → scale → rotate-back (exact) ═══
      // Rotate so edgeDir aligns with X-axis, then scale X, then rotate back.
      //
      // Rotation angle: angle from edgeDir to X-axis around their cross product
      const xAxis = new THREE.Vector3(1, 0, 0);
      const rotAxis = new THREE.Vector3().crossVectors(edgeDir, xAxis);
      const rotAxisLen = rotAxis.length();

      if (rotAxisLen < 0.0001) {
        // edgeDir is already ±X → should have been caught by isAxisAligned
        ok = this.bridge.scaleFaces(selectedFaces, cx, cy, cz, scaleFactor, 1, 1);
      } else {
        rotAxis.divideScalar(rotAxisLen); // normalize
        const angleDeg = Math.acos(Math.max(-1, Math.min(1, edgeDir.dot(xAxis)))) * (180 / Math.PI);

        debugLog(`[DimEdit] Non-axis: rotate ${angleDeg.toFixed(2)}° around (${rotAxis.x.toFixed(3)},${rotAxis.y.toFixed(3)},${rotAxis.z.toFixed(3)}), scale X×${scaleFactor.toFixed(4)}, rotate back`);

        // Step 1: Rotate to align edge with X-axis
        let stepsCompleted = 0;
        const r1 = this.bridge.rotateFaces(
          selectedFaces, cx, cy, cz,
          rotAxis.x, rotAxis.y, rotAxis.z, angleDeg,
        );
        if (r1) {
          stepsCompleted++;
          // Step 2: Scale along X-axis (now exact)
          const s = this.bridge.scaleFaces(selectedFaces, cx, cy, cz, scaleFactor, 1, 1);
          if (s) {
            stepsCompleted++;
            // Step 3: Rotate back
            ok = this.bridge.rotateFaces(
              selectedFaces, cx, cy, cz,
              rotAxis.x, rotAxis.y, rotAxis.z, -angleDeg,
            );
            if (ok) stepsCompleted++;
          }
        }
        if (!ok) {
          debugLog(`[DimEdit] Rotate-scale-rotate failed at step ${stepsCompleted + 1}/3, undoing ${stepsCompleted} ops`);
          for (let u = 0; u < stepsCompleted; u++) this.bridge.undo();
        }
      }
    }

    if (ok) {
      this.syncMesh();
      const newFaces = this.selection.getSelectedFaces();
      if (newFaces.length > 0) {
        this.updateSelectionDimensions(newFaces);
      }
      debugLog(`[DimEdit] ✓ ${oldLength.toFixed(2)} → ${newValue.toFixed(2)} mm (exact)`);
    } else {
      debugLog(`[DimEdit] ✗ Failed`);
    }
  }

  private setupMouseHandlers(): void {
    const canvas = this.viewport.renderer.domElement;

    // ===== DBLCLICK =====
    canvas.addEventListener('dblclick', (e) => {
      if (e.button !== 0 || e.altKey) return;
      if (this._currentTool !== 'select' && this._currentTool !== 'group') return;

      const hit = this.viewport.pick(e.clientX, e.clientY);
      if (hit && hit.faceIndex != null) {
        const fid = this.getFaceId(hit.faceIndex);
        if (fid >= 0) {
          // 그룹 더블클릭 → 편집 모드 진입
          const groupId = this.selection.getGroupId(fid);
          if (groupId !== undefined) {
            const groupTool = this.tools.get('group') as GroupTool;
            if (groupTool) {
              groupTool.enterEditMode(fid);
              return;
            }
          }
          // 일반 더블클릭 → face + edge 선택
          this.selection.selectFaceWithEdges(fid);
        }
      }
    });

    // ===== CONTEXT MENU (Right Click) =====
    canvas.addEventListener('contextmenu', (e) => {
      // If the current tool is busy, right click cancels the operation
      if (this.isToolBusy()) {
        e.preventDefault();
        const tool = this.tools.get(this._currentTool);
        // Create a synthetic right-click MouseEvent for the tool
        if (tool?.onMouseDown) {
          const synth = new MouseEvent('mousedown', { button: 2, clientX: e.clientX, clientY: e.clientY });
          tool.onMouseDown(synth, null);
        }
      }
    });

    // ===== MOUSE DOWN =====
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.altKey) return;

      // Get 3D point
      const rawPt = this.get3DPoint(e);

      // Skip snap for tools that explicitly opt out (Select, Erase).
      const tool = this.tools.get(this._currentTool);
      const point = tool?.wantsSnap === false
        ? rawPt
        : this.getSnappedPoint(e, rawPt, true);

      // Dispatch to current tool
      if (tool?.onMouseDown) {
        tool.onMouseDown(e, point);
      }
    });

    // ===== MOUSE MOVE =====
    canvas.addEventListener('mousemove', (e) => {
      const rawPt = this.get3DPoint(e);

      // Snap is skipped when the active tool opts out (wantsSnap=false) —
      // eliminates visual marker noise and saves findSnap computation.
      const tool = this.tools.get(this._currentTool);
      const point = tool?.wantsSnap === false
        ? rawPt
        : this.getSnappedPoint(e, rawPt);

      if (tool?.onMouseMove) {
        tool.onMouseMove(e, point);
      }

      // Hover highlight for applicable tools
      const isOperating = this.isToolBusy();
      if (!isOperating && ToolManager.HOVER_TOOLS.has(this._currentTool)) {
        const hit = this.viewport.pick(e.clientX, e.clientY);
        if (hit && hit.faceIndex != null) {
          const fid = this.getFaceId(hit.faceIndex);
          this.selection.setHover(fid);
          this.selection.clearEdgeHover();
        } else {
          this.selection.clearHover();
          if (ToolManager.EDGE_HOVER_TOOLS.has(this._currentTool)) {
            const edgeHit = this.viewport.pickEdge(e.clientX, e.clientY);
            if (edgeHit && edgeHit.index != null) {
              const segIndex = Math.floor(edgeHit.index / 2);
              this.selection.setEdgeHover(segIndex);
            } else {
              this.selection.clearEdgeHover();
            }
          } else {
            this.selection.clearEdgeHover();
          }
        }
      } else if (isOperating) {
        this.selection.clearHover();
        this.selection.clearEdgeHover();
      } else {
        this.selection.clearHover();
        this.selection.clearEdgeHover();
      }

      if (this._currentTool === 'select') {
        // Re-render selection dimensions on every mousemove (camera may have changed)
        if (this.selectionDimLines.length > 0) {
          this.dimLabel.update(this.viewport.activeCamera, this.selectionDimLines);
        } else {
          this.dimLabel.clear();
        }
        this.snapVisual.clear();
      }

      // ═══ Draw-plane hover indicator (RAF-throttled) ═══
      if (ToolManager.DRAW_PLANE_TOOLS.has(this._currentTool) && !isOperating) {
        this.drawPlaneLastEvent = e;
        if (!this.drawPlaneRafPending) {
          this.drawPlaneRafPending = true;
          requestAnimationFrame(() => this.flushDrawPlaneIndicator());
        }
      } else {
        this.drawPlaneIndicator?.hide();
      }
    });

    // ===== MOUSE LEAVE =====
    canvas.addEventListener('mouseleave', () => {
      this.selection.clearHover();
      this.selection.clearEdgeHover();
      this.drawPlaneIndicator?.hide();
    });

    // ===== MOUSE UP =====
    canvas.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;

      const tool = this.tools.get(this._currentTool);
      if (tool?.onMouseUp) {
        tool.onMouseUp(e);
      }
    });

  }

  /**
   * Setup keyboard event handlers
   */
  private setupKeyboardHandlers(): void {
    // ═══ CAPTURE PHASE: Tab/Enter선점 (기본 포커스 이동 방지) ═══
    document.addEventListener('keydown', (e) => {
      // VCB(cmd-input)에 포커스 → VCB 핸들러가 Enter/Tab 처리하도록 통과시킴
      if (e.target instanceof HTMLInputElement) return;

      // Tab/Enter: 도구 내부 제어 (숫자 입력 중일 때)
      // 이 핸들러는 가장 우선순위가 높음 (캡처 단계)
      if ((e.key === 'Tab' || e.key === 'Enter') && this.isToolBusy()) {
        // Prevent default browser behavior (focus movement for Tab, form submit for Enter)
        e.preventDefault();
        e.stopPropagation();

        // Dispatch to current tool with full control
        const tool = this.tools.get(this._currentTool);
        if (tool?.onKeyDown) {
          tool.onKeyDown(e);
        }
        return;
      }
    }, { capture: true }); // ✅ CAPTURE: 버블링 전에 먼저 잡음

    // ═══ BUBBLE PHASE: 일반 키보드 이벤트 ═══
    document.addEventListener('keydown', (e) => {
      // Arrow keys for axis lock
      if (e.key === 'ArrowRight') {
        this.setAxisLock('x');
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        this.setAxisLock('y');
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        this.setAxisLock('z');
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        this.setAxisLock(null);
        e.preventDefault();
      }

      // Dispatch to current tool (Tab/Enter는 위의 캡처 핸들러에서 이미 처리됨)
      if (e.key !== 'Tab' && e.key !== 'Enter') {
        const tool = this.tools.get(this._currentTool);
        if (tool?.onKeyDown) {
          tool.onKeyDown(e);
        }
      }
    });
  }
}
