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
import { SelectionManager } from './SelectionManager';
import { PickBox } from '../ui/PickBox';
import { ITool, ToolContext, DrawPlaneInfo } from './ITool';
import { ConstraintCommands } from './ConstraintCommands';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';
import { getMaterialLibrary } from '../materials/MaterialLibrary';
import { ServiceContainer } from '../core/ServiceContainer';
import '../utils/debug'; // Window interface augmentation

// Import all tools
import { SelectTool } from './SelectTool';
import { DrawLineTool } from './DrawLineTool';
import { DrawRectTool } from './DrawRectTool';
import { DrawCircleTool } from './DrawCircleTool';
import { PushPullTool } from './PushPullTool';
import { MoveTool } from './MoveTool';
import { RotateTool } from './RotateTool';
import { ScaleTool } from './ScaleTool';
import { OffsetTool } from './OffsetTool';
import { EraseTool } from './EraseTool';
import { GroupTool } from './GroupTool';
import { SphereTool } from '../primitives/SphereTool';
import { CylinderTool } from '../primitives/CylinderTool';
import { ConeTool } from '../primitives/ConeTool';

export class ToolManager {
  private viewport: Viewport;
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
    this.tools.set('rect', new DrawRectTool(this.toolContext));
    this.tools.set('circle', new DrawCircleTool(this.toolContext));
    this.tools.set('pushpull', new PushPullTool(this.toolContext));
    this.tools.set('move', new MoveTool(this.toolContext));
    this.tools.set('rotate', new RotateTool(this.toolContext));
    this.tools.set('scale', new ScaleTool(this.toolContext));
    this.tools.set('offset', new OffsetTool(this.toolContext));
    this.tools.set('erase', new EraseTool(this.toolContext));
    this.tools.set('group', new GroupTool(this.toolContext));
    this.tools.set('sphere', new SphereTool(this.toolContext));
    this.tools.set('cylinder', new CylinderTool(this.toolContext));
    this.tools.set('cone', new ConeTool(this.toolContext));

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

  applyVCBValue(value: number, value2?: number): void {
    const tool = this.tools.get(this._currentTool);
    if (tool?.applyVCBValue) {
      tool.applyVCBValue(value, value2);
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
    'delete', 'flip-faces', 'merge-faces', 'redo', 'group', 'make-component',
    'constrain-parallel', 'constrain-perpendicular', 'constrain-collinear',
  ]);

  /** 사용자 친화 명령어 이름 (Toast 메시지용) */
  private static readonly ACTION_DISPLAY: Record<string, string> = {
    'delete': '삭제',
    'flip-faces': '면 반전',
    'merge-faces': '면 통합',
    'redo': '다시 실행',
    'group': '그룹 만들기',
    'make-component': '컴포넌트 변환',
    'constrain-parallel': '평행 정렬',
    'constrain-perpendicular': '수직 정렬',
    'constrain-collinear': '동일 선상 정렬',
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
      const flipped = this.bridge.flipFaces(faces);
      if (flipped > 0) {
        this.syncMesh();
        Toast.info(`${flipped}개 면 반전됨`, 1800);
        debugLog('[Action] flip-faces:', flipped);
      } else {
        const err = this.bridge.lastError();
        Toast.error(err || '면 반전 실패');
      }
    } else if (action === 'merge-faces') {
      // 선택된 인접 coplanar face들을 하나로 통합
      const faces = this.selection.getSelectedFaces();
      if (faces.length < 2) {
        Toast.warning('통합하려면 2개 이상의 면을 선택하세요');
        return;
      }
      const merged = this.bridge.tryMergeAdjacentFaces(faces);
      if (merged > 0) {
        this.syncMesh();
        this.selection.clearSelection();
        Toast.info(`${merged}회 통합 — ${faces.length}개 면이 ${faces.length - merged}개로 합쳐짐`, 2500);
        debugLog('[Action] merge-faces:', merged);
      } else {
        const err = this.bridge.lastError();
        Toast.warning(err || '통합할 수 있는 인접 coplanar 면이 없습니다');
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

  syncMesh(): void {
    const edgeLines = this.bridge.getEdgeLines();
    this.edgeMap = this.bridge.getEdgeMap();

    // ════ Phase 1 Optimization: Try delta first (fast path) ════
    const delta = this.bridge.getDeltaBuffers();
    if (delta && delta.positions.length > 0) {
      const deltaApplied = this.viewport.applyDelta(delta);
      if (deltaApplied) {
        // ✅ Delta successfully applied — only updated changed vertices
        debugLog('[ToolManager] Delta applied:', {
          modifiedFaces: delta.modifiedFaceIds.length,
          positions: delta.positions.length,
          savings: '~90% vs full buffer',
        });
        // Note: Don't update SelectionManager/SnapManager for delta
        // They work fine with existing buffers until a topology change
        const stats = this.bridge.getStats();
        this.viewport.setStats(stats.verts, stats.faces);
        return;  // Success!
      }
    }

    // ════ Fallback: Full buffer update (slow path) ════
    debugLog('[ToolManager] Using full buffer update (delta unavailable or failed)');
    const buffers = this.bridge.getMeshBuffers();

    if (buffers) {
      this.viewport.updateMesh(
        buffers.positions, buffers.normals, buffers.indices,
        edgeLines ?? undefined,
        buffers.faceMap,
      );
      this.faceMap = buffers.faceMap;

      this.selection.updateBuffers(buffers.positions, buffers.indices, buffers.faceMap);
      this.selection.updateEdgeBuffers(edgeLines, this.edgeMap);

      // Get f64 precision vertices for snap (avoids f32 truncation)
      const snapF64 = this.bridge.getSnapVerticesF64();
      this.snap.updateFromMesh(
        buffers.positions, buffers.indices, buffers.faceMap,
        edgeLines, snapF64,
      );
    } else {
      this.viewport.updateMesh(
        new Float32Array(0), new Float32Array(0), new Uint32Array(0),
        edgeLines ?? undefined,
        new Uint32Array(0),
      );
      this.faceMap = new Uint32Array(0);
      this.selection.updateBuffers(new Float32Array(0), new Uint32Array(0), new Uint32Array(0));
      this.selection.updateEdgeBuffers(edgeLines, this.edgeMap);
      this.snap.updateFromMesh(
        new Float32Array(0), new Uint32Array(0), new Uint32Array(0),
        edgeLines, null,
      );
    }

    const stats = this.bridge.getStats();
    this.viewport.setStats(stats.verts, stats.faces);
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

  /** Get the drawing plane normal based on current view mode.
   *  - 3d / top / bottom → Y=0 plane (XZ ground)
   *  - front / back → Z=0 plane (XY wall)
   *  - right / left → X=0 plane (YZ wall)
   */
  private getWorkPlane(): THREE.Plane {
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
   * Detect drawing plane from mouse position.
   * If cursor is on an existing face → use that face's DCEL normal.
   * If cursor is on empty space → use default ground plane (Y-up).
   */
  private getDrawPlane(e: MouseEvent): DrawPlaneInfo {
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
  private handleDimensionEdit(index: number, newValue: number, dimLine: DimLine): void {
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
    });

    // ===== MOUSE LEAVE =====
    canvas.addEventListener('mouseleave', () => {
      this.selection.clearHover();
      this.selection.clearEdgeHover();
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
