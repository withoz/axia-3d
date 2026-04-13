/**
 * Tool Manager (Refactored) — Coordinates tool dispatch and manages shared state.
 * Now uses a clean Tool interface pattern with individual tool implementations.
 */

import * as THREE from 'three';
import { Viewport } from '../viewport/Viewport';
import { WasmBridge } from '../bridge/WasmBridge';
import { DimensionLabel } from '../ui/DimensionLabel';
import { UnitSystem } from '../units/UnitSystem';
import { SnapManager } from '../snap/SnapManager';
import { SnapVisual } from '../snap/SnapVisual';
import { SelectionManager } from './SelectionManager';
import { PickBox } from '../ui/PickBox';
import { ITool, ToolContext } from './ITool';
import { getMaterialLibrary } from '../materials/MaterialLibrary';
import { ServiceContainer } from '../core/ServiceContainer';
import '../utils/debug'; // Window interface augmentation

// Import all tools
import { SelectTool } from './SelectTool';
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
    };

    // Register all tools
    this.tools.set('select', new SelectTool(this.toolContext));
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
    const newToolObj = this.tools.get(name);
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
    console.log('[AxisLock]', axis ? `${axis.toUpperCase()}축 잠금` : '해제');
  }

  applyVCBValue(value: number, value2?: number): void {
    const tool = this.tools.get(this._currentTool);
    if (tool?.applyVCBValue) {
      tool.applyVCBValue(value, value2);
    }
  }

  executeAction(action: string): void {
    if (action === 'undo') {
      if (this.isToolBusy()) {
        console.log('[Action] undo blocked — tool is active, cancelling tool instead');
        this.cancelCurrentTool();
        return;
      }
      const result = this.bridge.undo();
      console.log('[Action] undo =>', result);
      if (result) {
        this.syncMesh();
        getMaterialLibrary().syncFromRust();
      }
    } else if (action === 'redo') {
      const result = this.bridge.redo();
      console.log('[Action] redo =>', result);
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
        console.log('[Action] delete', selectedFaces.length, 'faces,', selectedEdges.length, 'edges');
      }
    } else if (action === 'select-all') {
      this.selection.selectEverything(this.faceMap, this.edgeMap);
      console.log('[Action] select-all');
    } else if (action === 'select-same') {
      this.selection.selectSameType(this.faceMap, this.edgeMap);
      console.log('[Action] select-same');
    } else if (action === 'group') {
      const groupTool = this.tools.get('group') as GroupTool;
      if (groupTool) {
        groupTool.createGroupFromSelection();
      } else {
        const gid = this.selection.groupSelected();
        if (gid != null) {
          console.log(`[Action] group created: Group-${gid}, faces:`, this.selection.getSelectedFaces());
        }
      }
    } else if (action === 'ungroup') {
      const groupTool = this.tools.get('group') as GroupTool;
      if (groupTool) {
        groupTool.ungroupSelection();
      } else {
        const result = this.selection.ungroupSelected();
        console.log('[Action] ungroup =>', result);
      }
    } else if (action === 'make-component') {
      // 선택된 그룹을 컴포넌트로 변환
      const selected = this.selection.getSelectedFaces();
      if (selected.length > 0) {
        const groupId = this.selection.getGroupId(selected[0]);
        if (groupId !== undefined) {
          const defId = this.bridge.makeComponent(groupId, `Component-${groupId}`);
          if (defId > 0) {
            console.log(`[Action] make-component: Group-${groupId} → Component def ${defId}`);
          }
        } else {
          console.log('[Action] make-component — 먼저 그룹을 선택하세요');
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
        console.debug('[ToolManager] Delta applied:', {
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
    console.debug('[ToolManager] Using full buffer update (delta unavailable or failed)');
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

      this.snap.updateFromMesh(
        buffers.positions, buffers.indices, buffers.faceMap,
        edgeLines,
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
        edgeLines,
      );
    }

    const stats = this.bridge.getStats();
    this.viewport.setStats(stats.verts, stats.faces);
  }

  private getSnappedPoint(e: MouseEvent, rawGroundPoint: THREE.Vector3 | null, consumeOverride = false): THREE.Vector3 | null {
    const canvas = this.viewport.renderer.domElement;

    const overrideType = (window as any).__axia_snap_override as string | undefined;
    let snapResult;

    if (overrideType === 'none') {
      snapResult = null;
      if (consumeOverride) {
        delete (window as any).__axia_snap_override;
      }
    } else if (overrideType) {
      snapResult = this.snap.findSnapOverride(
        overrideType as any,
        e.clientX, e.clientY,
        this.viewport.activeCamera,
        canvas,
        rawGroundPoint,
      );
      if (consumeOverride) {
        delete (window as any).__axia_snap_override;
      }
    } else {
      snapResult = this.snap.findSnap(
        e.clientX, e.clientY,
        this.viewport.activeCamera,
        canvas,
        rawGroundPoint,
      );
    }

    this.snapVisual.update(snapResult, this.viewport.activeCamera);

    if (snapResult) {
      return snapResult.position.clone();
    }
    return rawGroundPoint;
  }

  private getGroundPoint(e: MouseEvent): THREE.Vector3 | null {
    const ray = this.getRay(e);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, target);
  }

  private get3DPoint(e: MouseEvent): THREE.Vector3 | null {
    const hit = this.viewport.pick(e.clientX, e.clientY);
    if (hit && hit.point) {
      return hit.point.clone();
    }
    const ray = this.getRay(e);
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
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

    const getVert = (idx: number) => new THREE.Vector3(
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

    const axes: { dir: THREE.Vector3; name: 'x' | 'y' | 'z' }[] = [
      { dir: new THREE.Vector3(1, 0, 0), name: 'x' },
      { dir: new THREE.Vector3(0, 1, 0), name: 'y' },
      { dir: new THREE.Vector3(0, 0, 1), name: 'z' },
    ];

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

    // ===== MOUSE DOWN =====
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.altKey) return;

      // Get 3D point
      const rawPt = this.get3DPoint(e);
      const point = this.getSnappedPoint(e, rawPt, true);

      // Dispatch to current tool
      const tool = this.tools.get(this._currentTool);
      if (tool?.onMouseDown) {
        tool.onMouseDown(e, point);
      }
    });

    // ===== MOUSE MOVE =====
    canvas.addEventListener('mousemove', (e) => {
      const rawPt = this.get3DPoint(e);
      const point = this.getSnappedPoint(e, rawPt);

      // Dispatch to current tool
      const tool = this.tools.get(this._currentTool);
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
        this.dimLabel.clear();
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
      // Tab/Enter: VCB 입력 제어 (숫자 입력 중일 때)
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
