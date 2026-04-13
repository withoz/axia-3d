/**
 * @deprecated This is the legacy monolithic ToolManager (2484 lines).
 * Use ToolManagerRefactored.ts instead, which delegates to individual ITool classes.
 * This file is kept for reference only and is no longer imported by main.ts.
 *
 * Tool Manager — dispatches mouse/keyboard events to active tool logic.
 * Integrates SnapManager for ZWCAD-style OSNAP support.
 */

import * as THREE from 'three';
import { Viewport } from '../viewport/Viewport';
import { WasmBridge } from '../bridge/WasmBridge';
import { DimensionLabel, DimLine } from '../ui/DimensionLabel';
import { UnitSystem } from '../units/UnitSystem';
import { SnapManager, SnapPoint } from '../snap/SnapManager';
import { SnapVisual } from '../snap/SnapVisual';
import { SelectionManager } from './SelectionManager';
import { PickBox } from '../ui/PickBox';

// Window interface is now defined in utils/debug.ts to avoid duplication

export class ToolManager {
  private viewport: Viewport;
  private bridge: WasmBridge;
  private _currentTool: string = 'select';
  private dimLabel: DimensionLabel;
  private units: UnitSystem;

  // ═══ Snap System ═══
  readonly snap: SnapManager;
  readonly snapVisual: SnapVisual;

  // ═══ Selection System ═══
  readonly selection: SelectionManager;

  // Face map: triangleIndex → Rust FaceId
  private faceMap: Uint32Array = new Uint32Array(0);

  // Rect tool state
  private rectStart: THREE.Vector3 | null = null;
  private rectPreview: THREE.Mesh | null = null;

  // Line tool state (click-click)
  private lineStart: THREE.Vector3 | null = null;
  private linePreview: THREE.Line | null = null;

  // Circle tool state (click-drag: center → radius)
  private circleCenter: THREE.Vector3 | null = null;
  private circlePreview: THREE.Line | null = null;

  // ═══ 3D Axis Inference (SketchUp style) ═══
  private axisLock: 'x' | 'y' | 'z' | 'free' | null = null;  // arrow key forced lock
  private inferredAxis: 'x' | 'y' | 'z' | 'free' = 'free';   // auto-detected axis
  private axisGuide: THREE.Line | null = null;  // colored axis guide line

  // ═══ Offset state (CAD style: select object → click side → repeat) ═══
  //  Phase 0: 대기 (객체 선택 대기)
  //  Phase 1: 객체 선택됨 → 방향 클릭 대기
  //  Phase 2: 방향 확정 → offset 실행 → Phase 0으로 복귀 (반복 대기)
  private offsetPhase: 0 | 1 | 2 = 0;
  private offsetFaceId: number = -1;
  private offsetEdgeId: number = -1;   // Line offset: 선택된 edge ID (-1이면 face offset)
  private offsetNormal: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private offsetHitPoint: THREE.Vector3 = new THREE.Vector3();  // 선택된 객체의 참조점
  private offsetGhost: THREE.Group | null = null;
  private offsetFaceVerts: THREE.Vector3[] = [];
  private lastOffsetDist: number = 0;  // 마지막 Offset 거리 (반복 적용용)
  private offsetEdgeDir: THREE.Vector3 = new THREE.Vector3();  // edge offset 방향 벡터
  private offsetEdgeP0: THREE.Vector3 = new THREE.Vector3();   // 선택된 edge 시작점
  private offsetEdgeP1: THREE.Vector3 = new THREE.Vector3();   // 선택된 edge 끝점
  private offsetEdgeHighlight: THREE.Line | null = null;  // edge 선택 하이라이트
  private offsetHoverHighlight: THREE.Line | null = null; // edge hover 하이라이트
  private offsetCurrentSign: number = 1;  // 마우스가 가리키는 방향 부호 (+1 또는 -1)
  private edgeMap: Uint32Array | null = null;  // edge line segment → EdgeId 매핑

  // ═══ Erase tool ═══
  private eraseHoverHighlight: THREE.Line | null = null;

  // ═══ Drag selection box (SketchUp style) ═══
  private dragSelectStart: { x: number; y: number } | null = null;
  private dragSelectBox: HTMLDivElement | null = null;
  private isDragSelecting: boolean = false;

  // ═══ Pickbox (CAD cursor) ═══
  private pickBox: PickBox | null = null;

  // ═══ Hover tools (정적 Set — 매 이벤트마다 할당 방지) ═══
  private static readonly HOVER_TOOLS = new Set(['select', 'pushpull', 'offset', 'move', 'rotate', 'scale']);
  private static readonly EDGE_HOVER_TOOLS = new Set(['offset', 'erase']);

  // ═══ Move/Rotate/Scale state ═══
  private transformActive: boolean = false;
  private transformStartPt: THREE.Vector3 | null = null;  // 드래그 시작 3D 점
  private transformCentroid: THREE.Vector3 | null = null;  // 선택된 면들의 중심
  private transformStartAngle: number = 0;                 // 회전 시작 각도
  private transformLastDelta: THREE.Vector3 = new THREE.Vector3(); // 누적 이동 방지용

  // Push/Pull state (SketchUp style: click → move → click)
  private ppFaceId: number = -1;
  private ppStartX: number = 0;
  private ppStartY: number = 0;
  private ppActive: boolean = false;  // 면 선택됨 → 마우스 이동으로 거리 조절 중
  private ppNormal: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private ppScreenDir: THREE.Vector2 = new THREE.Vector2(0, -1);
  private ppGhost: THREE.Group | null = null;
  private ppHitPoint: THREE.Vector3 = new THREE.Vector3();
  private lastPPDist: number = 0;  // 마지막 Push/Pull 거리 (반복 적용용)

  constructor(viewport: Viewport, bridge: WasmBridge, units?: UnitSystem) {
    this.viewport = viewport;
    this.bridge = bridge;
    this.units = units || window.__axia_units || new UnitSystem();
    this.dimLabel = new DimensionLabel(viewport.container);

    // Initialize snap system
    this.snap = new SnapManager();
    this.snapVisual = new SnapVisual(viewport.container);

    // Initialize selection system
    this.selection = new SelectionManager(viewport.scene);
    this.selection.setBridge(bridge); // DCEL topology 기반 연결 탐색 활성화

    // Initialize pickbox cursor
    this.pickBox = new PickBox(viewport.container);

    this.setupMouseHandlers();
  }

  /** Get snapped ground point: if snap is active, use snap position; otherwise raw ground point.
   *  @param consumeOverride — true on click (mousedown), false on hover (mousemove).
   *    When true, the one-shot snap override is consumed after use. */
  private getSnappedPoint(e: MouseEvent, rawGroundPoint: THREE.Vector3 | null, consumeOverride = false): THREE.Vector3 | null {
    const canvas = this.viewport.renderer.domElement;

    // Check for one-shot snap override (우클릭 스냅 재지정)
    const overrideType = window.__axia_snap_override;
    let snapResult;

    if (overrideType === 'none') {
      // "없음" — skip snap entirely for this action
      snapResult = null;
      if (consumeOverride) {
        delete window.__axia_snap_override;
      }
    } else if (overrideType) {
      // Use findSnapOverride which temporarily switches modes
      snapResult = this.snap.findSnapOverride(
        overrideType as any,
        e.clientX, e.clientY,
        this.viewport.activeCamera,
        canvas,
        rawGroundPoint,
      );
      // Only consume override on actual click, not on hover preview
      if (consumeOverride) {
        delete window.__axia_snap_override;
      }
    } else {
      snapResult = this.snap.findSnap(
        e.clientX, e.clientY,
        this.viewport.activeCamera,
        canvas,
        rawGroundPoint,
      );
    }

    // Update visual marker
    this.snapVisual.update(snapResult, this.viewport.activeCamera);

    if (snapResult) {
      return snapResult.position.clone();
    }
    return rawGroundPoint;
  }

  get currentTool(): string {
    return this._currentTool;
  }

  /** 도구가 활성 작업 중인지 (그리기 진행, PP 드래그 등) */
  isToolBusy(): boolean {
    return !!(
      this.rectStart ||
      this.lineStart ||
      this.circleCenter ||
      this.ppActive ||
      this.offsetPhase > 0 ||
      this.transformActive
    );
  }

  // ════════════════════════════════════════════════
  // VCB (Value Control Box) — 숫자 직접 입력
  // ════════════════════════════════════════════════

  /** VCB에서 Enter로 확정된 값을 현재 도구에 적용
   *  value: mm 단위 값 (또는 각도/배율)
   *  value2: rect의 세로 등 두번째 값 (optional) */
  applyVCBValue(value: number, value2?: number) {
    const tool = this._currentTool;
    console.log(`[VCB] apply: tool=${tool}, value=${value}${value2 != null ? ', value2=' + value2 : ''}`);

    if (tool === 'offset') {
      // ═══ CAD-style Offset VCB ═══
      // Phase 0: 숫자 입력 = 거리 설정 (다음 클릭에 사용)
      // Phase 1: 객체 선택 상태에서 숫자 입력 = 마우스 방향으로 즉시 적용
      if (this.offsetPhase === 0) {
        // 거리만 저장 (다음 객체 선택 → 방향 클릭 시 사용)
        this.lastOffsetDist = value;
        console.log('[VCB/Offset] Distance set:', value);
      } else if (this.offsetPhase === 1) {
        // 객체 선택 상태: 현재 마우스 방향으로 즉시 적용
        const signedValue = value * this.offsetCurrentSign;
        if (this.offsetEdgeId >= 0) {
          const planeN: [number, number, number] = [
            this.offsetNormal.x, this.offsetNormal.y, this.offsetNormal.z
          ];
          const result = this.bridge.offsetEdge(this.offsetEdgeId, signedValue, planeN);
          if (result && result.ok) {
            this.lastOffsetDist = value; // 절대값 저장
            console.log('[VCB/Offset/Edge] Applied:', signedValue, 'newEdge=', result.newEdge);
          }
        } else if (this.offsetFaceId >= 0) {
          const result = this.bridge.offsetFace(this.offsetFaceId, signedValue);
          if (result && result.ok) {
            this.lastOffsetDist = value;
            console.log('[VCB/Offset/Face] Applied:', signedValue, 'innerFace=', result.innerFace);
          }
        }
        this.syncMesh();
        this.resetOffsetState();
      }
      this.dimLabel.clear();
    } else if (tool === 'pushpull') {
      // Push/Pull: 활성 면 또는 선택된 face
      const faceId = this.ppFaceId >= 0 ? this.ppFaceId : this.getSelectedFaces()[0];
      if (faceId >= 0) {
        const success = this.bridge.pushPull(faceId, value);
        if (success) {
          this.lastPPDist = value;
          this.syncMesh();
        }
        this.ppActive = false;
        this.ppFaceId = -1;
        this.removePPGhost();
        this.selection.clearSelection();
        this.dimLabel.clear();
      }
    } else if (tool === 'move') {
      // Move: 선택된 face들을 X방향으로 이동 (축 잠금에 따라)
      const selected = this.getSelectedFaces();
      if (selected.length > 0) {
        let dx = 0, dy = 0, dz = 0;
        const axis = this.axisLock || this.inferredAxis;
        if (axis === 'x') dx = value;
        else if (axis === 'y') dy = value;
        else if (axis === 'z') dz = value;
        else dx = value; // 기본: X축
        this.bridge.translateFaces(selected, dx, dy, dz);
        console.log(`[VCB/Move] Applied: (${dx},${dy},${dz})`);
        this.syncMesh();
      }
    } else if (tool === 'rotate') {
      // Rotate: 선택된 face들을 Y축 기준 각도 회전
      const selected = this.getSelectedFaces();
      if (selected.length > 0) {
        const centroid = this.bridge.facesCentroid(selected);
        if (centroid) {
          this.bridge.rotateFaces(selected,
            centroid.x, centroid.y, centroid.z,
            0, 1, 0, value);
          console.log(`[VCB/Rotate] Applied: ${value}° Y-axis`);
          this.syncMesh();
        }
      }
    } else if (tool === 'scale') {
      // Scale: 선택된 face들을 균일 스케일
      const selected = this.getSelectedFaces();
      if (selected.length > 0) {
        const centroid = this.bridge.facesCentroid(selected);
        if (centroid) {
          this.bridge.scaleFaces(selected,
            centroid.x, centroid.y, centroid.z,
            value, value, value);
          console.log(`[VCB/Scale] Applied: ×${value}`);
          this.syncMesh();
        }
      }
    } else if (tool === 'line' && this.lineStart) {
      // Line: 현재 축 방향으로 정확한 길이의 선 생성
      const axis = this.axisLock || this.inferredAxis;
      let dir = new THREE.Vector3(1, 0, 0);
      if (axis === 'y') dir.set(0, 1, 0);
      else if (axis === 'z') dir.set(0, 0, 1);

      const endPt = this.lineStart.clone().add(dir.multiplyScalar(value));
      this.bridge.drawLine(
        this.lineStart.x, this.lineStart.y, this.lineStart.z,
        endPt.x, endPt.y, endPt.z,
      );
      console.log(`[VCB/Line] Length=${value} axis=${axis}`);
      this.lineStart = endPt.clone(); // 연속 그리기
      this.syncMesh();
    } else if (tool === 'rect') {
      // Rect: 정확한 크기의 사각형
      const w = value;
      const h = value2 != null ? value2 : value;
      const origin = this.rectStart || new THREE.Vector3(0, 0, 0);
      const cx = origin.x + w / 2;
      const cz = origin.z + h / 2;
      this.bridge.drawRect(cx, origin.y, cz, 0, 1, 0, 0, 0, 1, w, h);
      console.log(`[VCB/Rect] ${w}×${h}`);
      this.rectStart = null;
      if (this.rectPreview) {
        this.viewport.scene.remove(this.rectPreview);
        this.rectPreview.geometry.dispose();
        this.rectPreview = null;
      }
      this.syncMesh();
    } else if (tool === 'circle') {
      // Circle: 정확한 반지름의 원
      const center = this.circleCenter || new THREE.Vector3(0, 0, 0);
      this.bridge.drawCircle(center.x, center.y, center.z, 0, 1, 0, value, 24);
      console.log(`[VCB/Circle] R=${value}`);
      this.circleCenter = null;
      if (this.circlePreview) {
        this.viewport.scene.remove(this.circlePreview);
        this.circlePreview.geometry.dispose();
        (this.circlePreview.material as THREE.Material).dispose();
        this.circlePreview = null;
      }
      this.syncMesh();
    }

    this.dimLabel.clear();
  }

  /** 현재 선택된 Rust FaceId 배열 (Boolean 연산 등에서 사용) */
  getSelectedFaces(): number[] {
    return this.selection.getSelectedFaces();
  }

  setTool(name: string) {
    // 현재 선택 상태를 보존해야 하는 도구들
    const keepSelection = new Set(['pushpull', 'offset', 'move', 'rotate', 'scale']);
    const selectedBefore = keepSelection.has(name) ? this.getSelectedFaces() : [];

    this.cancelCurrentTool();
    this._currentTool = name;

    // Pickbox: offset 도구에서 표시 + 커서 숨김
    const canvas = this.viewport.renderer.domElement;
    if (name === 'offset') {
      canvas.style.cursor = 'none';
      if (this.pickBox) this.pickBox.visible = true;
    } else {
      canvas.style.cursor = '';
      if (this.pickBox) this.pickBox.visible = false;
    }

    // Push/Pull: 이미 선택된 면이 있으면 즉시 복원 (Select → PushPull 전환)
    if (selectedBefore.length > 0) {
      for (const fid of selectedBefore) {
        this.selection.handleClick(fid, true, false); // shift=true로 추가
      }
    }
  }

  /** 축 잠금 설정 (화살표 키: →X, ↑Y, ←Z, ↓해제) */
  setAxisLock(axis: 'x' | 'y' | 'z' | null) {
    this.axisLock = axis;
    if (!axis) {
      this.clearAxisGuide();
    }
    console.log('[AxisLock]', axis ? `${axis.toUpperCase()}축 잠금` : '해제');
  }

  executeAction(action: string) {
    if (action === 'undo') {
      // 도구가 활성 중이면 undo 대신 도구 취소
      if (this.rectStart || this.lineStart || this.circleCenter ||
          this.ppActive || this.offsetPhase > 0 || this.transformActive) {
        console.log('[Action] undo blocked — tool is active, cancelling tool instead');
        this.cancelCurrentTool();
        return;
      }
      const result = this.bridge.undo();
      console.log('[Action] undo =>', result);
      if (result) this.syncMesh();
    } else if (action === 'redo') {
      const result = this.bridge.redo();
      console.log('[Action] redo =>', result);
      if (result) this.syncMesh();
    } else if (action === 'delete') {
      // 선택된 face + edge 삭제 (단일 undo transaction)
      const selectedFaces = this.getSelectedFaces();
      const selectedEdges = this.selection.getSelectedEdges();
      if (selectedFaces.length > 0 || selectedEdges.length > 0) {
        const ok = this.bridge.batchDelete(selectedFaces, selectedEdges);
        if (!ok) {
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
      // 모든 face + edge 선택
      this.selection.selectEverything(this.faceMap, this.edgeMap);
      console.log('[Action] select-all');
    } else if (action === 'select-same') {
      // 동일요소 선택: 선택된 face/edge와 동일 유형의 모든 요소 선택
      this.selection.selectSameType(this.faceMap, this.edgeMap);
      console.log('[Action] select-same');
    } else if (action === 'group') {
      // 선택된 면들을 그룹으로 묶기
      const selected = this.selection.getSelectedFaces();
      if (selected.length < 2) {
        console.log('[Action] group — 2개 이상 면을 선택하세요');
        return;
      }
      // WASM 백엔드에 그룹 생성
      const wasmGid = this.bridge.createGroup('Group', selected);
      // 로컬 SelectionManager에도 그룹 생성
      const gid = this.selection.groupSelected();
      if (gid != null) {
        console.log(`[Action] group created: Group-${gid} (wasm=${wasmGid}), faces:`, selected);
      }
    } else if (action === 'ungroup') {
      // 선택된 면의 그룹 해제
      const selected = this.selection.getSelectedFaces();
      if (selected.length > 0) {
        const groupId = this.selection.getGroupId(selected[0]);
        if (groupId !== undefined) {
          this.bridge.deleteGroup(groupId);
        }
      }
      const result = this.selection.ungroupSelected();
      console.log('[Action] ungroup =>', result);
    } else if (action === 'make-component') {
      // 선택된 그룹을 컴포넌트로 변환
      const selected = this.selection.getSelectedFaces();
      if (selected.length > 0) {
        const groupId = this.selection.getGroupId(selected[0]);
        if (groupId !== undefined) {
          const defId = this.bridge.makeComponent(groupId, `Component-${groupId}`);
          console.log(`[Action] make-component: Group-${groupId} → def=${defId}`);
        }
      }
    }
  }

  /** Send current engine mesh to viewport for rendering.
   *  Uses delta path (fast) for position-only changes (translate/rotate/scale).
   *  Falls back to full rebuild for topology changes (draw/push_pull/delete/boolean).
   */
  syncMesh() {
    // Clear any ghost/preview meshes before updating
    this.clearGhost();

    // ═══ Phase 1: Try delta path first (position-only changes) ═══
    const delta = this.bridge.getDeltaBuffers();
    if (delta && !delta.topologyChanged && delta.modifiedFaceIds.length > 0) {
      const patched = this.viewport.applyDelta(delta);
      if (patched) {
        // Delta applied — now update edge lines (positions changed)
        // and selection/snap with fresh full buffers
        const edgeLines = this.bridge.getEdgeLines();
        this.edgeMap = this.bridge.getEdgeMap();
        const buffers = this.bridge.getMeshBuffers();
        if (buffers) {
          // Update edge wireframe (vertex positions moved)
          this.viewport.updateEdgeLines(edgeLines);
          // Sync selection & snap with new positions (faceMap unchanged)
          this.selection.updateBuffers(buffers.positions, buffers.indices, buffers.faceMap);
          this.selection.updateEdgeBuffers(edgeLines, this.edgeMap);
          this.snap.updateFromMesh(
            buffers.positions, buffers.indices, buffers.faceMap,
            edgeLines,
          );
        }
        const stats = this.bridge.getStats();
        this.viewport.setStats(stats.verts, stats.faces);
        return; // Fast path done
      }
      // Patch failed — fall through to full rebuild
    }

    // ═══ Full rebuild path (topology changed or delta unavailable) ═══
    const buffers = this.bridge.getMeshBuffers();
    const edgeLines = this.bridge.getEdgeLines();
    this.edgeMap = this.bridge.getEdgeMap();
    if (buffers) {
      this.viewport.updateMesh(
        buffers.positions, buffers.normals, buffers.indices,
        edgeLines ?? undefined,
        buffers.faceMap,
      );
      this.faceMap = buffers.faceMap;

      // ═══ Update selection highlight ═══
      this.selection.updateBuffers(buffers.positions, buffers.indices, buffers.faceMap);
      this.selection.updateEdgeBuffers(edgeLines, this.edgeMap);

      // ═══ Update snap geometry ═══
      this.snap.updateFromMesh(
        buffers.positions, buffers.indices, buffers.faceMap,
        edgeLines,
      );
    } else {
      // face가 없어도 edge lines(wireframe)은 렌더링해야 함 (Line 도구로 그린 선)
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

  /** Remove any ghost/preview meshes from scene (safety net) */
  private clearGhost() {
    if (this.rectPreview) {
      this.viewport.scene.remove(this.rectPreview);
      this.rectPreview.geometry?.dispose();
      if (this.rectPreview.material instanceof THREE.Material) {
        this.rectPreview.material.dispose();
      }
      this.rectPreview = null;
    }
    if (this.linePreview) {
      this.viewport.scene.remove(this.linePreview);
      this.linePreview.geometry?.dispose();
      (this.linePreview.material as THREE.Material)?.dispose();
      this.linePreview = null;
    }
    if (this.circlePreview) {
      this.viewport.scene.remove(this.circlePreview);
      this.circlePreview.geometry?.dispose();
      (this.circlePreview.material as THREE.Material)?.dispose();
      this.circlePreview = null;
    }
    this.removePPGhost();
    this.removeOffsetGhost(); this.removeEdgeHighlight(); this.removeOffsetHover();
    this.clearAxisGuide();
  }

  // Cached face boundary vertices for ghost preview
  private ppFaceVerts: THREE.Vector3[] = [];

  /** Extract face boundary vertices from mesh buffers (unique outline loop) */
  private extractFaceBoundary(faceId: number): THREE.Vector3[] {
    const buffers = this.bridge.getMeshBuffers();
    if (!buffers) return [];

    // Collect all triangle edges for this face
    // Boundary edges appear exactly once; internal edges appear twice
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

    // Boundary edges: count === 1
    const boundary: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
    for (const [, e] of edgeMap) {
      if (e.count === 1) boundary.push(e);
    }
    if (boundary.length === 0) return [];

    // Chain edges into ordered loop
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

    // Remove last vertex if it matches first (closed loop)
    if (loop.length > 2 && loop[0].distanceTo(loop[loop.length - 1]) < 0.001) {
      loop.pop();
    }

    return loop;
  }

  /** Create ghost face + side walls preview.
   *  AixxiA-style blue transparent preview. */
  /** Push/Pull 고스트 프리뷰 생성 (SketchUp 스타일)
   *  - Push/Pull 동일 처리: 면 + 측면 벽 + 엣지를 메인 메시와 동일 색상으로 렌더링
   *  - 경계가 보이지 않아 실제 메시가 늘어나는 것처럼 보임 */
  private createPPGhost(faceId: number, _hitPoint: THREE.Vector3) {
    this.removePPGhost();
    this.ppFaceVerts = this.extractFaceBoundary(faceId);
    if (this.ppFaceVerts.length < 3) return;

    this.ppGhost = new THREE.Group();
    this.ppGhost.renderOrder = 999;
    this.viewport.scene.add(this.ppGhost);
    this.rebuildPPGhost(0);
  }

  /** 고스트 지오메트리 재구성: 이동된 면 + 측면 벽 + 엣지 라인 */
  private rebuildPPGhost(dist: number) {
    if (!this.ppGhost || this.ppFaceVerts.length < 3) return;

    // 기존 자식 정리
    while (this.ppGhost.children.length > 0) {
      const child = this.ppGhost.children[0];
      this.ppGhost.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }

    if (Math.abs(dist) < 0.001) return;

    const n = this.ppFaceVerts.length;
    const offset = this.ppNormal.clone().multiplyScalar(dist);
    const offsetVerts = this.ppFaceVerts.map(v => v.clone().add(offset));

    // ── 삼각형 팬으로 면 생성 ──
    const makeFaceGeo = (verts: THREE.Vector3[]) => {
      const pos: number[] = [];
      const idx: number[] = [];
      for (const v of verts) pos.push(v.x, v.y, v.z);
      for (let i = 1; i < verts.length - 1; i++) idx.push(0, i, i + 1);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    };

    // ── 측면 벽 쿼드 생성 ──
    const makeWallGeo = (origVerts: THREE.Vector3[], offVerts: THREE.Vector3[]) => {
      const pos: number[] = [];
      const idx: number[] = [];
      let vi = 0;
      for (let i = 0; i < origVerts.length; i++) {
        const j = (i + 1) % origVerts.length;
        const a = origVerts[i], b = origVerts[j], c = offVerts[j], d = offVerts[i];
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
        idx.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
        vi += 4;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    };

    // ═══ 이동된 면 (반투명 매끈한 프리뷰) ═══
    const faceMesh = new THREE.Mesh(makeFaceGeo(offsetVerts), new THREE.MeshBasicMaterial({
      color: 0x5b9bd5, side: THREE.FrontSide,
      transparent: true, opacity: 0.3,
      depthWrite: false,
    }));
    faceMesh.renderOrder = 999;
    this.ppGhost.add(faceMesh);

    // ═══ 측면 벽 (반투명 매끈한 프리뷰 — FrontSide만) ═══
    const wallMesh = new THREE.Mesh(makeWallGeo(this.ppFaceVerts, offsetVerts), new THREE.MeshBasicMaterial({
      color: 0x5b9bd5, side: THREE.FrontSide,
      transparent: true, opacity: 0.2,
      depthWrite: false,
    }));
    wallMesh.renderOrder = 998;
    this.ppGhost.add(wallMesh);

    // ═══ 엣지 라인 (선명한 프레임) ═══
    const linePositions: number[] = [];
    // 이동된 면 테두리
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      linePositions.push(offsetVerts[i].x, offsetVerts[i].y, offsetVerts[i].z);
      linePositions.push(offsetVerts[j].x, offsetVerts[j].y, offsetVerts[j].z);
    }
    // 측면 세로 엣지
    for (let i = 0; i < n; i++) {
      linePositions.push(this.ppFaceVerts[i].x, this.ppFaceVerts[i].y, this.ppFaceVerts[i].z);
      linePositions.push(offsetVerts[i].x, offsetVerts[i].y, offsetVerts[i].z);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePositions), 3));
    const lineSegs = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      color: 0x2a6cb8, depthTest: false,
    }));
    lineSegs.renderOrder = 1000;
    this.ppGhost.add(lineSegs);
  }

  /** 고스트를 주어진 거리로 갱신 */
  private updatePPGhost(dist: number) {
    this.rebuildPPGhost(dist);
  }

  /** 고스트 프리뷰 제거 및 정리 */
  private removePPGhost() {
    if (this.ppGhost) {
      while (this.ppGhost.children.length > 0) {
        const child = this.ppGhost.children[0];
        this.ppGhost.remove(child);
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      }
      this.viewport.scene.remove(this.ppGhost);
      this.ppGhost = null;
    }
    this.ppFaceVerts = [];
  }

  // ═══ Offset Ghost Preview ═══

  /** Offset용 고스트 생성: 면 경계를 안쪽으로 축소한 미리보기 */
  private createOffsetGhost(faceId: number) {
    this.removeOffsetGhost(); this.removeEdgeHighlight();
    this.offsetFaceVerts = this.extractFaceBoundary(faceId);
    if (this.offsetFaceVerts.length < 3) return;

    this.offsetGhost = new THREE.Group();
    this.offsetGhost.renderOrder = 999;
    this.viewport.scene.add(this.offsetGhost);
    this.rebuildOffsetGhost(0);
  }

  /** Offset ghost 재구성: 면 경계를 dist만큼 안쪽으로 축소한 외곽선 */
  private rebuildOffsetGhost(dist: number) {
    if (!this.offsetGhost || this.offsetFaceVerts.length < 3) return;

    // Clear old children
    while (this.offsetGhost.children.length > 0) {
      const child = this.offsetGhost.children[0];
      this.offsetGhost.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }

    const n = this.offsetFaceVerts.length;
    const absDist = Math.abs(dist);
    if (absDist < 0.1) return;

    // 면 법선 계산
    const normal = this.offsetNormal.clone().normalize();

    // 각 변의 안쪽 방향(inward) 벡터 계산 후, 각 꼭짓점을 안쪽으로 이동
    // 각 변의 inward = cross(edge, normal).normalize()
    const inwards: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const edge = new THREE.Vector3().subVectors(this.offsetFaceVerts[j], this.offsetFaceVerts[i]);
      const inward = new THREE.Vector3().crossVectors(edge, normal).normalize();
      inwards.push(inward);
    }

    // 각 꼭짓점: 인접 두 변의 inward 평균 방향으로 이동
    // dist > 0: 안쪽(inset), dist < 0: 바깥쪽(outset → inward 반대 방향)
    const direction = dist >= 0 ? 1 : -1;
    const offsetVerts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n;
      const inA = inwards[prev]; // 이전 변의 inward
      const inB = inwards[i];    // 현재 변의 inward

      // 두 inward의 bisector
      const bisector = new THREE.Vector3().addVectors(inA, inB).normalize();
      // 실제 이동 거리: dist / cos(halfAngle) — 꼭짓점에서의 보정
      const cosHalf = bisector.dot(inA);
      const moveDist = cosHalf > 0.1 ? absDist / cosHalf : absDist;
      const clampedDist = Math.min(moveDist, absDist * 3); // 너무 큰 보정 방지

      offsetVerts.push(
        this.offsetFaceVerts[i].clone().add(bisector.multiplyScalar(clampedDist * direction))
      );
    }

    // ── 1) 내부 면 (반투명) ──
    const facePositions: number[] = [];
    const faceIndices: number[] = [];
    for (const v of offsetVerts) {
      facePositions.push(v.x, v.y, v.z);
    }
    for (let i = 1; i < n - 1; i++) {
      faceIndices.push(0, i, i + 1);
    }

    const faceGeo = new THREE.BufferGeometry();
    faceGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(facePositions), 3));
    faceGeo.setIndex(faceIndices);
    faceGeo.computeVertexNormals();

    const faceMat = new THREE.MeshBasicMaterial({
      color: 0xff9f43, transparent: true, opacity: 0.2,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.offsetGhost.add(new THREE.Mesh(faceGeo, faceMat));

    // ── 2) 내부 외곽선 (오렌지) ──
    const linePositions: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      linePositions.push(offsetVerts[i].x, offsetVerts[i].y, offsetVerts[i].z);
      linePositions.push(offsetVerts[j].x, offsetVerts[j].y, offsetVerts[j].z);
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePositions), 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xff9f43, linewidth: 2, depthTest: false,
    });
    this.offsetGhost.add(new THREE.LineSegments(lineGeo, lineMat));

    // ── 3) 원본↔오프셋 연결선 (점선 느낌) ──
    const connPositions: number[] = [];
    for (let i = 0; i < n; i++) {
      connPositions.push(this.offsetFaceVerts[i].x, this.offsetFaceVerts[i].y, this.offsetFaceVerts[i].z);
      connPositions.push(offsetVerts[i].x, offsetVerts[i].y, offsetVerts[i].z);
    }
    const connGeo = new THREE.BufferGeometry();
    connGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(connPositions), 3));
    const connMat = new THREE.LineBasicMaterial({
      color: 0xff9f43, linewidth: 1, depthTest: false, transparent: true, opacity: 0.5,
    });
    this.offsetGhost.add(new THREE.LineSegments(connGeo, connMat));
  }

  private updateOffsetGhost(dist: number) {
    this.rebuildOffsetGhost(dist);
  }

  /** Offset 상태 완전 초기화 */
  private resetOffsetState() {
    this.offsetPhase = 0;
    this.offsetFaceId = -1;
    this.offsetEdgeId = -1;
    this.offsetCurrentSign = 1;
    this.removeOffsetGhost();
    this.removeEdgeHighlight();
    this.removeOffsetHover();
    this.selection.clearSelection();
  }

  private removeEdgeHighlight() {
    if (this.offsetEdgeHighlight) {
      this.offsetEdgeHighlight.geometry.dispose();
      (this.offsetEdgeHighlight.material as THREE.Material).dispose();
      this.viewport.scene.remove(this.offsetEdgeHighlight);
      this.offsetEdgeHighlight = null;
    }
  }

  private removeOffsetHover() {
    if (this.offsetHoverHighlight) {
      this.offsetHoverHighlight.geometry.dispose();
      (this.offsetHoverHighlight.material as THREE.Material).dispose();
      this.viewport.scene.remove(this.offsetHoverHighlight);
      this.offsetHoverHighlight = null;
    }
  }

  // ═══ Erase hover helpers ═══

  private showEraseHover(segIndex: number) {
    this.removeEraseHover();
    const edgeLines = this.bridge.getEdgeLines();
    if (!edgeLines) return;

    const base = segIndex * 6;
    if (base + 5 >= edgeLines.length) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([
        edgeLines[base], edgeLines[base+1], edgeLines[base+2],
        edgeLines[base+3], edgeLines[base+4], edgeLines[base+5],
      ]), 3
    ));
    const mat = new THREE.LineBasicMaterial({
      color: 0xff4444, linewidth: 2, depthTest: false,
    });
    this.eraseHoverHighlight = new THREE.Line(geo, mat);
    this.eraseHoverHighlight.renderOrder = 998;
    this.viewport.scene.add(this.eraseHoverHighlight);
  }

  private removeEraseHover() {
    if (this.eraseHoverHighlight) {
      this.eraseHoverHighlight.geometry.dispose();
      (this.eraseHoverHighlight.material as THREE.Material).dispose();
      this.viewport.scene.remove(this.eraseHoverHighlight);
      this.eraseHoverHighlight = null;
    }
  }

  /** 특정 edge에 hover 하이라이트 표시 */
  private showEdgeHover(segIndex: number) {
    this.removeOffsetHover();
    const edgeLines = this.bridge.getEdgeLines();
    if (!edgeLines) return;

    const base = segIndex * 6;
    if (base + 5 >= edgeLines.length) return;

    const p0x = edgeLines[base], p0y = edgeLines[base+1], p0z = edgeLines[base+2];
    const p1x = edgeLines[base+3], p1y = edgeLines[base+4], p1z = edgeLines[base+5];

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([p0x, p0y, p0z, p1x, p1y, p1z]), 3
    ));
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffff, linewidth: 2, depthTest: false,
    });
    this.offsetHoverHighlight = new THREE.Line(geo, mat);
    this.offsetHoverHighlight.renderOrder = 998;
    this.viewport.scene.add(this.offsetHoverHighlight);
  }

  /** 선택된 edge에 확정 하이라이트 표시 (더 밝은 색) */
  private showEdgeSelected(p0: THREE.Vector3, p1: THREE.Vector3) {
    this.removeEdgeHighlight();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z]), 3
    ));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffff00, linewidth: 3, depthTest: false,
    });
    this.offsetEdgeHighlight = new THREE.Line(geo, mat);
    this.offsetEdgeHighlight.renderOrder = 999;
    this.viewport.scene.add(this.offsetEdgeHighlight);
  }

  private removeOffsetGhost() {
    if (this.offsetGhost) {
      while (this.offsetGhost.children.length > 0) {
        const child = this.offsetGhost.children[0];
        this.offsetGhost.remove(child);
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      }
      this.viewport.scene.remove(this.offsetGhost);
      this.offsetGhost = null;
    }
    this.offsetFaceVerts = [];
  }

  /** 바닥 평면(Y=0)에 마우스 레이 투영 → 3D 좌표 */
  private getGroundPoint(e: MouseEvent): THREE.Vector3 | null {
    const ray = this.getRay(e);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, target);
  }

  /** Offset 대상 객체 선택 (face 또는 edge) → true if found */
  private pickOffsetTarget(e: MouseEvent): { type: 'face' | 'edge' } | null {
    // 1) Face 먼저 시도
    const hit = this.viewport.pick(e.clientX, e.clientY);
    let rustFaceId = -1;
    let hitPoint: THREE.Vector3 | null = null;

    if (hit && hit.faceIndex != null && hit.faceIndex >= 0) {
      rustFaceId = this.getFaceId(hit.faceIndex);
      hitPoint = hit.point ? hit.point.clone() : null;
    }

    // 이미 선택된 면 사용 (fallback)
    if (rustFaceId < 0) {
      const selected = this.getSelectedFaces();
      if (selected.length === 1) {
        rustFaceId = selected[0];
        const centroid = this.bridge.facesCentroid(selected);
        if (centroid) hitPoint = centroid;
      }
    }

    if (rustFaceId >= 0 && hitPoint) {
      this.offsetFaceId = rustFaceId;
      this.offsetEdgeId = -1;
      const normal = this.bridge.getFaceNormal(rustFaceId);
      this.offsetNormal = new THREE.Vector3(normal[0], normal[1], normal[2]);
      this.offsetHitPoint = hitPoint;
      this.createOffsetGhost(rustFaceId);
      this.selection.handleClick(rustFaceId, false, false);
      return { type: 'face' };
    }

    // 2) Edge 시도
    const edgeHit = this.viewport.pickEdge(e.clientX, e.clientY);
    if (edgeHit && edgeHit.index != null && this.edgeMap) {
      const segIndex = Math.floor(edgeHit.index / 2);
      const edgeId = this.edgeMap[segIndex];
      if (edgeId != null) {
        this.offsetEdgeId = edgeId;
        this.offsetFaceId = -1;
        this.offsetNormal = new THREE.Vector3(0, 1, 0);

        // Edge endpoints
        const edgeLines = this.bridge.getEdgeLines();
        if (edgeLines) {
          const base = segIndex * 6;
          this.offsetEdgeP0 = new THREE.Vector3(edgeLines[base], edgeLines[base+1], edgeLines[base+2]);
          this.offsetEdgeP1 = new THREE.Vector3(edgeLines[base+3], edgeLines[base+4], edgeLines[base+5]);
          const edgeDir = new THREE.Vector3().subVectors(this.offsetEdgeP1, this.offsetEdgeP0).normalize();
          this.offsetEdgeDir = new THREE.Vector3().crossVectors(edgeDir, this.offsetNormal).normalize();

          // Edge를 직선 위에 투영하여 정확한 참조점 설정
          const midPt = new THREE.Vector3().addVectors(this.offsetEdgeP0, this.offsetEdgeP1).multiplyScalar(0.5);
          this.offsetHitPoint = midPt;

          // 선택 하이라이트 (노란색)
          this.showEdgeSelected(this.offsetEdgeP0, this.offsetEdgeP1);
        }
        return { type: 'edge' };
      }
    }

    return null;
  }

  /** Offset 거리 계산: 부호 있는 거리
   *  양수 = 안쪽(inset), 음수 = 바깥쪽(outset)
   *  면 중심(centroid)에 가까워지면 안쪽, 멀어지면 바깥쪽 */
  private offsetRayDist(e: MouseEvent): number {
    const canvas = this.viewport.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this.viewport.activeCamera);

    // 면 평면에 마우스 레이 투영
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.offsetNormal, this.offsetHitPoint);
    const intersection = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(plane, intersection);

    if (!hit) {
      return 0;
    }

    // hitPoint에서 intersection까지 거리 (면 평면 위)
    const diff = new THREE.Vector3().subVectors(intersection, this.offsetHitPoint);
    const absDist = diff.length();

    // ─── Edge offset: offset 방향 벡터와 마우스 이동 방향의 dot product로 부호 결정 ───
    if (this.offsetEdgeId >= 0 && this.offsetEdgeDir.lengthSq() > 0.001) {
      const sign = diff.dot(this.offsetEdgeDir) >= 0 ? 1 : -1;
      return absDist * sign;
    }

    // ─── Face offset: 면 중심(centroid)과 비교 ───
    if (this.offsetFaceVerts.length >= 3) {
      const centroid = new THREE.Vector3();
      for (const v of this.offsetFaceVerts) centroid.add(v);
      centroid.divideScalar(this.offsetFaceVerts.length);

      const hitToCentroid = centroid.distanceTo(this.offsetHitPoint);
      const mouseToCentroid = centroid.distanceTo(intersection);

      return mouseToCentroid < hitToCentroid ? absDist : -absDist;
    }

    return absDist;
  }

  /** Convert Three.js faceIndex (triangle index) to Rust FaceId */
  private getFaceId(faceIndex: number): number {
    if (faceIndex >= 0 && faceIndex < this.faceMap.length) {
      return this.faceMap[faceIndex];
    }
    return -1;
  }

  /**
   * 마우스 위치에서 ppNormal 방향 직선 위의 최근접점까지 거리 계산.
   * ppHitPoint를 원점으로 ppNormal 방향 직선과 마우스 레이의 최근접 거리 → 부호 있는 거리 반환.
   */
  private ppRayDist(e: MouseEvent): number {
    const canvas = this.viewport.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this.viewport.activeCamera);

    // 노멀 방향 평면에 마우스 레이를 투영
    // ppHitPoint를 지나고 카메라 right 벡터를 포함하는 평면 사용
    const camRight = new THREE.Vector3();
    camRight.setFromMatrixColumn(this.viewport.activeCamera.matrixWorld, 0).normalize();

    // 평면 법선 = cross(ppNormal, camRight) → 노멀과 카메라 오른쪽에 수직
    const planeNormal = new THREE.Vector3().crossVectors(this.ppNormal, camRight).normalize();
    if (planeNormal.length() < 0.001) {
      // fallback: 카메라 up 사용
      const camUp = new THREE.Vector3();
      camUp.setFromMatrixColumn(this.viewport.activeCamera.matrixWorld, 1).normalize();
      planeNormal.crossVectors(this.ppNormal, camUp).normalize();
    }

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, this.ppHitPoint);
    const intersection = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(plane, intersection);

    if (!hit) return 0;

    // ppHitPoint → intersection 벡터를 ppNormal에 투영
    const diff = intersection.sub(this.ppHitPoint);
    return diff.dot(this.ppNormal);
  }

  // ═══ Drag Selection Box ═══

  private createDragSelectBox() {
    if (this.dragSelectBox) return;
    const box = document.createElement('div');
    box.style.position = 'absolute';
    box.style.pointerEvents = 'none';
    box.style.zIndex = '1000';
    box.style.border = '1px dashed #2196f3';
    box.style.background = 'rgba(33, 150, 243, 0.08)';
    this.viewport.container.appendChild(box);
    this.dragSelectBox = box;
  }

  private updateDragSelectBox(startX: number, startY: number, curX: number, curY: number) {
    if (!this.dragSelectBox) return;
    const containerRect = this.viewport.container.getBoundingClientRect();
    const sx = startX - containerRect.left;
    const sy = startY - containerRect.top;
    const cx = curX - containerRect.left;
    const cy = curY - containerRect.top;

    const left = Math.min(sx, cx);
    const top = Math.min(sy, cy);
    const width = Math.abs(cx - sx);
    const height = Math.abs(cy - sy);

    // SketchUp 스타일: 왼→오 = 파랑(window), 오→왼 = 초록(crossing)
    const isWindowSelect = cx >= sx;
    if (isWindowSelect) {
      this.dragSelectBox.style.border = '1px solid #2196f3';
      this.dragSelectBox.style.background = 'rgba(33, 150, 243, 0.1)';
    } else {
      this.dragSelectBox.style.border = '1px dashed #4caf50';
      this.dragSelectBox.style.background = 'rgba(76, 175, 80, 0.1)';
    }

    this.dragSelectBox.style.left = left + 'px';
    this.dragSelectBox.style.top = top + 'px';
    this.dragSelectBox.style.width = width + 'px';
    this.dragSelectBox.style.height = height + 'px';
  }

  private removeDragSelectBox() {
    if (this.dragSelectBox) {
      this.dragSelectBox.remove();
      this.dragSelectBox = null;
    }
    this.isDragSelecting = false;
    this.dragSelectStart = null;
  }

  /** 스크린 좌표 사각형 안에 있는 face/edge 선택 */
  private performBoxSelect(startX: number, startY: number, endX: number, endY: number) {
    const camera = this.viewport.activeCamera;
    const canvas = this.viewport.renderer.domElement;
    const rect = canvas.getBoundingClientRect();

    const isWindowSelect = endX >= startX; // 왼→오: window, 오→왼: crossing

    // 스크린 박스 (min/max)
    const boxLeft = Math.min(startX, endX);
    const boxRight = Math.max(startX, endX);
    const boxTop = Math.min(startY, endY);
    const boxBottom = Math.max(startY, endY);

    // world → screen 변환
    const toScreen = (pos: THREE.Vector3): { x: number; y: number } | null => {
      const v = pos.clone().project(camera);
      if (v.z < -1 || v.z > 1) return null;
      return {
        x: (v.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-v.y * 0.5 + 0.5) * rect.height + rect.top,
      };
    };

    // 점이 박스 안에 있는지
    const inBox = (sx: number, sy: number) =>
      sx >= boxLeft && sx <= boxRight && sy >= boxTop && sy <= boxBottom;

    // ── Face 선택 ──
    const selectedFaces = new Set<number>();
    const buffers = this.bridge.getMeshBuffers();
    if (buffers && this.faceMap.length > 0 && buffers.positions.length > 0) {
      const positions = buffers.positions;
      const indices = buffers.indices;

      // 각 face의 정점을 screen 좌표로 변환
      const faceScreenPts = new Map<number, { x: number; y: number }[]>();

      for (let tri = 0; tri < this.faceMap.length; tri++) {
        const fid = this.faceMap[tri];
        const base = tri * 3;
        if (base + 2 >= indices.length) continue;

        if (!faceScreenPts.has(fid)) faceScreenPts.set(fid, []);
        const pts = faceScreenPts.get(fid)!;

        for (let j = 0; j < 3; j++) {
          const idx = indices[base + j];
          const v = new THREE.Vector3(
            positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]
          );
          const sp = toScreen(v);
          if (sp) pts.push(sp);
        }
      }

      for (const [fid, pts] of faceScreenPts) {
        if (pts.length === 0) continue;
        if (isWindowSelect) {
          if (pts.every(p => inBox(p.x, p.y))) {
            selectedFaces.add(fid);
          }
        } else {
          if (pts.some(p => inBox(p.x, p.y))) {
            selectedFaces.add(fid);
          }
        }
      }
    }

    // ── Edge 선택 ──
    const selectedEdges = new Set<number>();
    const edgeLines = this.bridge.getEdgeLines();
    if (edgeLines && this.edgeMap) {
      for (let i = 0; i < this.edgeMap.length; i++) {
        const base = i * 6;
        if (base + 5 >= edgeLines.length) continue;

        const pA = toScreen(new THREE.Vector3(edgeLines[base], edgeLines[base+1], edgeLines[base+2]));
        const pB = toScreen(new THREE.Vector3(edgeLines[base+3], edgeLines[base+4], edgeLines[base+5]));
        if (!pA || !pB) continue;

        if (isWindowSelect) {
          // Window: 양 끝점 모두 박스 안
          if (inBox(pA.x, pA.y) && inBox(pB.x, pB.y)) {
            selectedEdges.add(this.edgeMap[i]);
          }
        } else {
          // Crossing: 한 끝점이라도 박스 안
          if (inBox(pA.x, pA.y) || inBox(pB.x, pB.y)) {
            selectedEdges.add(this.edgeMap[i]);
          }
        }
      }
    }

    // 선택 적용
    this.selection.clearSelection();
    for (const fid of selectedFaces) {
      this.selection.handleClick(fid, true, false); // shift=true로 추가
    }
    for (const eid of selectedEdges) {
      this.selection.handleEdgeClick(eid, true, false);
    }
  }

  cancelCurrentTool() {
    this.rectStart = null;
    if (this.rectPreview) {
      this.viewport.scene.remove(this.rectPreview);
      this.rectPreview.geometry.dispose();
      this.rectPreview = null;
    }
    // Line cleanup
    this.lineStart = null;
    if (this.linePreview) {
      this.viewport.scene.remove(this.linePreview);
      this.linePreview.geometry.dispose();
      (this.linePreview.material as THREE.Material).dispose();
      this.linePreview = null;
    }
    // Circle cleanup
    this.circleCenter = null;
    if (this.circlePreview) {
      this.viewport.scene.remove(this.circlePreview);
      this.circlePreview.geometry.dispose();
      (this.circlePreview.material as THREE.Material).dispose();
      this.circlePreview = null;
    }
    if (this.ppActive) {
      this.ppActive = false;
      this.ppFaceId = -1;
      this.removePPGhost();
    }
    // Drag selection cleanup
    this.removeDragSelectBox();
    // Erase cleanup
    this.removeEraseHover();
    // Offset cleanup
    this.resetOffsetState();
    // Transform cleanup
    this.transformActive = false;
    this.transformStartPt = null;
    this.transformCentroid = null;
    this.transformLastDelta.set(0, 0, 0);
    this.dimLabel.clear();
    this.snapVisual.clear();
    this.snap.setReferencePoint(null);
    this.snap.clearTrackPoints();
    this.axisLock = null;
    this.inferredAxis = 'free';
    this.clearAxisGuide();
  }

  /** Mouse → NDC raycaster */
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

  /** 3D 포인트 취득: 면 위 히트 → 바닥 평면 fallback */
  private get3DPoint(e: MouseEvent): THREE.Vector3 | null {
    // 1) 기존 메시에 히트 테스트
    const hit = this.viewport.pick(e.clientX, e.clientY);
    if (hit && hit.point) {
      return hit.point.clone();
    }
    // 2) 바닥 평면 (Y=0) fallback
    const ray = this.getRay(e);
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    return ray.ray.intersectPlane(groundPlane, target);
  }

  /** 시작점 + 마우스 레이 → 축 추론 포인트 (SketchUp 스타일)
   *  시작점에서 X/Y/Z 축 위의 가장 가까운 점을 찾고,
   *  마우스 방향에 가장 잘 맞는 축을 선택 */
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

    // 축 강제 잠금 (화살표 키)
    const forcedAxis = this.axisLock;

    let bestAxis: 'x' | 'y' | 'z' = 'x';
    let bestPoint = origin.clone();
    let bestScreenDist = Infinity;

    const canvas = this.viewport.renderer.domElement;
    const canvasRect = canvas.getBoundingClientRect();

    for (const ax of axes) {
      if (forcedAxis && forcedAxis !== 'free' && forcedAxis !== ax.name) continue;

      // 시작점에서 축 방향 직선과 마우스 레이 사이의 최근접점
      const projected = this.closestPointOnAxisToRay(
        origin, ax.dir, ray.ray.origin, ray.ray.direction
      );
      if (!projected) continue;

      // 축 위의 점을 화면에 투영하여 마우스와의 거리 계산
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

    // 축 잠금이 아닌 경우, 축과의 거리가 너무 멀면 자유 모드
    const AXIS_THRESHOLD = 30; // pixels
    if (!forcedAxis && bestScreenDist > AXIS_THRESHOLD) {
      // 자유 모드: 3D 포인트 또는 ground plane
      const freePt = this.get3DPoint(e);
      return { point: freePt || origin.clone(), axis: 'free' };
    }

    return { point: bestPoint, axis: forcedAxis && forcedAxis !== 'free' ? forcedAxis : bestAxis };
  }

  /** 두 직선 (origin+dir, rayOrigin+rayDir) 사이의 최근접점 (축 위의 점) */
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
    if (Math.abs(denom) < 1e-10) return null; // 평행

    const t = (b * e - c * d) / denom;
    return axisOrigin.clone().add(axisDir.clone().multiplyScalar(t));
  }

  /** 축 가이드 라인 표시/업데이트 */
  private updateAxisGuide(origin: THREE.Vector3, axis: 'x' | 'y' | 'z' | 'free', endPt: THREE.Vector3) {
    if (this.axisGuide) {
      this.viewport.scene.remove(this.axisGuide);
      this.axisGuide.geometry.dispose();
      (this.axisGuide.material as THREE.Material).dispose();
      this.axisGuide = null;
    }

    if (axis === 'free') return;

    // 축 색상: X=빨강, Y=파랑, Z=초록 (Three.js 관례)
    const colors: Record<string, number> = { x: 0xff3333, y: 0x3388ff, z: 0x33cc33 };
    const axisDir: Record<string, THREE.Vector3> = {
      x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, 1, 0),
      z: new THREE.Vector3(0, 0, 1),
    };

    // 시작점에서 축 방향으로 긴 가이드 라인 (양방향)
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

  private clearAxisGuide() {
    if (this.axisGuide) {
      this.viewport.scene.remove(this.axisGuide);
      this.axisGuide.geometry.dispose();
      (this.axisGuide.material as THREE.Material).dispose();
      this.axisGuide = null;
    }
  }

  private setupMouseHandlers() {
    const canvas = this.viewport.renderer.domElement;
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const getGroundPoint = (e: MouseEvent): THREE.Vector3 | null => {
      const ray = this.getRay(e);
      const target = new THREE.Vector3();
      return ray.ray.intersectPlane(groundPlane, target);
    };

    // ===== CLICK COUNT (스케치업 스타일: 싱글/더블/트리플) =====
    let clickCount = 0;
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    let skipNextDblClick = false;         // 트리플 클릭 후 dblclick 무시용
    const TRIPLE_CLICK_DELAY = 400; // ms

    // ===== DOUBLE CLICK (스케치업: face + 경계 edge 선택) =====
    canvas.addEventListener('dblclick', (e) => {
      if (e.button !== 0 || e.altKey) return;
      if (this._currentTool !== 'select') return;

      // 트리플 클릭 직후 발생한 dblclick → 무시 (XIA 선택 보존)
      if (skipNextDblClick) {
        skipNextDblClick = false;
        return;
      }

      clickCount = 2;
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(() => { clickCount = 0; }, TRIPLE_CLICK_DELAY);

      const hit = this.viewport.pick(e.clientX, e.clientY);
      if (hit && hit.faceIndex != null) {
        const fid = this.getFaceId(hit.faceIndex!);
        if (fid >= 0) {
          // 그룹 더블클릭 → 편집 모드 진입
          const groupId = this.selection.getGroupId(fid);
          if (groupId !== undefined) {
            this.selection.enterGroupEdit(groupId);
            return;
          }
          this.selection.selectFaceWithEdges(fid);
        }
      }
    });

    // ===== MOUSE DOWN =====
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.altKey) return;

      // ═══ 스케치업 트리플 클릭 감지 → XIA/그룹 전체 선택 ═══
      if (this._currentTool === 'select' && clickCount >= 2) {
        clickCount = 0;
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        skipNextDblClick = true;  // 이후 dblclick이 XIA 선택 덮어쓰기 방지

        const hit = this.viewport.pick(e.clientX, e.clientY);
        if (hit && hit.faceIndex != null) {
          const fid = this.getFaceId(hit.faceIndex!);
          if (fid >= 0) {
            this.selection.selectAll(fid);
            return; // 트리플 클릭 처리 완료 — XIA 전체 선택
          }
        }
      }

      // ═══ Face/Edge 선택 (Select, Move, Rotate, Scale 도구) ═══
      const selectableTools = new Set(['select', 'move', 'rotate', 'scale']);
      if (selectableTools.has(this._currentTool)) {
        const hit = this.viewport.pick(e.clientX, e.clientY);

        if (hit && hit.faceIndex != null && hit.faceIndex !== undefined) {
          const fid = this.getFaceId(hit.faceIndex!);
          this.selection.handleClick(fid, e.shiftKey, e.ctrlKey);
        } else {
          // Face 미히트 → Edge 선택 시도
          const edgeHit = this.viewport.pickEdge(e.clientX, e.clientY);
          if (edgeHit && edgeHit.index != null && this.edgeMap) {
            const segIndex = Math.floor(edgeHit.index / 2);
            const edgeId = this.edgeMap[segIndex];
            if (edgeId != null) {
              this.selection.handleEdgeClick(edgeId, e.shiftKey, e.ctrlKey);
            }
          } else {
            // 빈 공간 클릭 → 드래그 선택 시작 준비
            if (this._currentTool === 'select') {
              this.dragSelectStart = { x: e.clientX, y: e.clientY };
              this.isDragSelecting = false; // 아직 드래그 시작 아님 (5px 이상 이동해야)
            }
          }
        }
      }

      // ═══ Erase 도구: 클릭으로 face 또는 edge 삭제 (SketchUp Eraser) ═══
      if (this._currentTool === 'erase') {
        // 1) Face 먼저 시도
        const hit = this.viewport.pick(e.clientX, e.clientY);
        if (hit && hit.faceIndex != null && hit.faceIndex >= 0) {
          const fid = this.getFaceId(hit.faceIndex);
          if (fid >= 0) {
            this.bridge.deleteFace(fid);
            this.selection.clearSelection();
            this.syncMesh();
            console.log('[Erase] Deleted face:', fid);
            return;
          }
        }

        // 2) Edge 시도
        const edgeHit = this.viewport.pickEdge(e.clientX, e.clientY);
        if (edgeHit && edgeHit.index != null && this.edgeMap) {
          const segIndex = Math.floor(edgeHit.index / 2);
          const edgeId = this.edgeMap[segIndex];
          if (edgeId != null) {
            this.bridge.deleteEdge(edgeId);
            this.syncMesh();
            console.log('[Erase] Deleted edge:', edgeId);
            return;
          }
        }
      }

      // ═══ Rect 도구: SketchUp 스타일 (클릭→이동→클릭) ═══
      if (this._currentTool === 'rect') {
        if (!this.rectStart) {
          // 첫 번째 클릭: 시작점 설정
          const rawPt = this.get3DPoint(e);
          const pt = this.getSnappedPoint(e, rawPt, true);
          if (pt) {
            this.rectStart = pt.clone();
            this.snap.setReferencePoint(pt);
          }
        } else {
          // 두 번째 클릭: 사각형 생성
          const rawPt = this.get3DPoint(e);
          const pt = this.getSnappedPoint(e, rawPt, true);
          if (pt) {
            const center = new THREE.Vector3().addVectors(this.rectStart, pt).multiplyScalar(0.5);
            const size = new THREE.Vector3().subVectors(pt, this.rectStart);
            const width = Math.abs(size.x);
            const height = Math.abs(size.z);

            if (width > 1 && height > 1) {
              this.bridge.drawRect(
                center.x, center.y, center.z,
                0, 1, 0,
                0, 0, 1,
                width, height,
              );
              console.log('[Rect] Created 3D:', `${width.toFixed(2)} x ${height.toFixed(2)}`);
              this.syncMesh();
            }
          }
          this.rectStart = null;
          if (this.rectPreview) {
            this.viewport.scene.remove(this.rectPreview);
            this.rectPreview.geometry.dispose();
            this.rectPreview = null;
          }
          this.dimLabel.clear();
          this.snap.setReferencePoint(null);
        }
      }

      // ═══ Line 도구: SketchUp 스타일 (클릭→이동→클릭, 연속) ═══
      if (this._currentTool === 'line') {
        if (!this.lineStart) {
          // 첫 번째 클릭: 시작점 설정
          const rawPt = this.get3DPoint(e);
          const pt = this.getSnappedPoint(e, rawPt, true);
          if (pt) {
            this.lineStart = pt.clone();
            this.snap.setReferencePoint(pt);
            this.axisLock = null;
            this.inferredAxis = 'free';
          }
        } else {
          // 두 번째 클릭: 라인 생성 → 끝점이 다음 시작점 (연속)
          const rawPt = this.get3DPoint(e);
          const snapPt = this.getSnappedPoint(e, rawPt, true);
          let pt: THREE.Vector3 | null = null;

          if (snapPt && rawPt && snapPt.distanceTo(rawPt) > 0.01) {
            pt = snapPt;
          } else {
            const inferred = this.getAxisInferredPoint(e, this.lineStart);
            pt = inferred.point;
          }

          if (pt) {
            const len = this.lineStart.distanceTo(pt);
            if (len > 1) {
              this.bridge.drawLine(
                this.lineStart.x, this.lineStart.y, this.lineStart.z,
                pt.x, pt.y, pt.z,
              );
              console.log('[Line] Created 3D:', len.toFixed(2), 'mm',
                `(${this.lineStart.x.toFixed(0)},${this.lineStart.y.toFixed(0)},${this.lineStart.z.toFixed(0)})→` +
                `(${pt.x.toFixed(0)},${pt.y.toFixed(0)},${pt.z.toFixed(0)})`);
              this.syncMesh();
            }
          }
          // 연속 그리기: 끝점이 다음 시작점
          this.lineStart = pt ? pt.clone() : null;
          if (this.linePreview) {
            this.viewport.scene.remove(this.linePreview);
            this.linePreview.geometry.dispose();
            (this.linePreview.material as THREE.Material).dispose();
            this.linePreview = null;
          }
          this.clearAxisGuide();
          this.dimLabel.clear();
          this.axisLock = null;
          if (this.lineStart) {
            this.snap.setReferencePoint(this.lineStart);
          }
        }
      }

      // ═══ Circle 도구: SketchUp 스타일 (클릭→이동→클릭) ═══
      if (this._currentTool === 'circle') {
        if (!this.circleCenter) {
          // 첫 번째 클릭: 중심점 설정
          const rawPt = this.get3DPoint(e);
          const pt = this.getSnappedPoint(e, rawPt, true);
          if (pt) {
            this.circleCenter = pt.clone();
            this.snap.setReferencePoint(pt);
          }
        } else {
          // 두 번째 클릭: 원 생성
          const rawPt = this.get3DPoint(e);
          const pt = this.getSnappedPoint(e, rawPt, true);
          if (pt) {
            const radius = this.circleCenter.distanceTo(pt);
            if (radius > 1) {
              this.bridge.drawCircle(
                this.circleCenter.x, this.circleCenter.y, this.circleCenter.z,
                0, 1, 0,
                radius, 24,
              );
              console.log('[Circle] Created 3D: R', radius.toFixed(2), 'mm');
              this.syncMesh();
            }
          }
          this.circleCenter = null;
          if (this.circlePreview) {
            this.viewport.scene.remove(this.circlePreview);
            this.circlePreview.geometry.dispose();
            (this.circlePreview.material as THREE.Material).dispose();
            this.circlePreview = null;
          }
          this.dimLabel.clear();
          this.snap.setReferencePoint(null);
        }
      }

      // ═══ Offset 도구: CAD 스타일 (숫자입력 → 객체선택 → 방향클릭 → 반복) ═══
      if (this._currentTool === 'offset') {
        if (this.offsetPhase === 0) {
          // ──── Phase 0 → 1: 객체 선택 ────
          const picked = this.pickOffsetTarget(e);
          if (picked) {
            this.offsetPhase = 1;
            this.removeOffsetHover();
            console.log('[Offset] Phase 1: object selected,',
              picked.type === 'edge' ? 'edgeId=' + this.offsetEdgeId : 'faceId=' + this.offsetFaceId);
          }
        } else if (this.offsetPhase === 1) {
          // ──── Phase 1 → 실행: 방향 결정 (두 번째 클릭) ────
          const clickPt = this.getGroundPoint(e);
          if (!clickPt) return;

          let dist = 0;

          if (this.offsetEdgeId >= 0) {
            // Edge offset: 클릭 지점이 edge의 어느 쪽인지 판단
            const midPt = new THREE.Vector3().addVectors(this.offsetEdgeP0, this.offsetEdgeP1).multiplyScalar(0.5);
            const clickDir = new THREE.Vector3().subVectors(clickPt, midPt);
            const side = clickDir.dot(this.offsetEdgeDir) >= 0 ? 1 : -1;

            if (this.lastOffsetDist > 0) {
              // 거리가 이미 설정됨 → 해당 거리로 방향만 결정
              dist = this.lastOffsetDist * side;
            } else {
              // 거리 미설정 → 클릭 지점까지의 수직 거리 사용
              dist = clickDir.dot(this.offsetEdgeDir);
            }

            if (Math.abs(dist) > 0.1) {
              const planeN: [number, number, number] = [
                this.offsetNormal.x, this.offsetNormal.y, this.offsetNormal.z
              ];
              const result = this.bridge.offsetEdge(this.offsetEdgeId, dist, planeN);
              if (result && result.ok) {
                this.lastOffsetDist = Math.abs(dist);
                console.log('[Offset/Edge] Applied: dist=', dist.toFixed(1), 'newEdge=', result.newEdge);
              } else {
                console.warn('[Offset/Edge] Failed:', result?.error);
              }
            }
          } else if (this.offsetFaceId >= 0) {
            // Face offset: 면 중심 기준 inset/outset 판단
            dist = this.offsetRayDist(e);
            if (this.lastOffsetDist > 0) {
              const sign = dist >= 0 ? 1 : -1;
              dist = this.lastOffsetDist * sign;
            }

            if (Math.abs(dist) > 0.1) {
              const result = this.bridge.offsetFace(this.offsetFaceId, dist);
              if (result && result.ok) {
                this.lastOffsetDist = Math.abs(dist);
                console.log('[Offset/Face] Applied: dist=', dist.toFixed(1), 'innerFace=', result.innerFace);
              } else {
                console.warn('[Offset/Face] Failed:', result?.error);
              }
            }
          }

          this.syncMesh();
          // 실행 후 Phase 0으로 복귀 (반복 대기) — lastOffsetDist 유지
          this.removeOffsetGhost();
          this.removeEdgeHighlight();
          this.offsetPhase = 0;
          this.offsetFaceId = -1;
          this.offsetEdgeId = -1;
          this.selection.clearSelection();
          this.dimLabel.clear();
        }
      }

      // ═══ Move / Rotate / Scale 도구: 드래그 시작 ═══
      if ((this._currentTool === 'move' || this._currentTool === 'rotate' || this._currentTool === 'scale')
          && !this.transformActive) {
        const selected = this.getSelectedFaces();
        if (selected.length > 0) {
          const centroid = this.bridge.facesCentroid(selected);
          if (centroid) {
            this.transformCentroid = centroid;
            const pt = this.get3DPoint(e);
            if (pt) {
              this.transformStartPt = pt.clone();
              this.transformActive = true;
              this.transformLastDelta.set(0, 0, 0);

              // 회전: 시작 각도 계산 (centroid → 마우스 방향)
              if (this._currentTool === 'rotate') {
                const dx = pt.x - centroid.x;
                const dz = pt.z - centroid.z;
                this.transformStartAngle = Math.atan2(dz, dx);
              }
              console.log(`[${this._currentTool}] Start drag, ${selected.length} faces, centroid=`,
                centroid.x.toFixed(1), centroid.y.toFixed(1), centroid.z.toFixed(1));
            }
          }
        }
      }

      // ═══ Push/Pull: SketchUp 스타일 (클릭→이동→클릭) ═══
      if (this._currentTool === 'pushpull') {
        if (!this.ppActive) {
          // 1단계: 면 선택 (첫 번째 클릭)
          const hit = this.viewport.pick(e.clientX, e.clientY);
          let rustFaceId = -1;
          let hitPoint: THREE.Vector3 | null = null;

          if (hit && hit.faceIndex != null && hit.faceIndex >= 0) {
            // 클릭한 면 사용 (hit.face 대신 faceIndex로만 판단)
            rustFaceId = this.getFaceId(hit.faceIndex);
            hitPoint = hit.point ? hit.point.clone() : null;
          }

          // 면을 직접 클릭하지 못한 경우 → 이미 선택된 면이 있으면 그 면 사용
          if (rustFaceId < 0) {
            const selected = this.getSelectedFaces();
            if (selected.length === 1) {
              rustFaceId = selected[0];
              const centroid = this.bridge.facesCentroid(selected);
              if (centroid) hitPoint = centroid;
            }
          }

          if (rustFaceId >= 0 && hitPoint) {
            this.ppFaceId = rustFaceId;
            this.ppStartX = e.clientX;
            this.ppStartY = e.clientY;
            this.ppActive = true;

            const normal = this.bridge.getFaceNormal(rustFaceId);
            if (!normal || (normal[0] === 0 && normal[1] === 0 && normal[2] === 0)) {
              console.warn('[PP] Invalid face normal for faceId=', rustFaceId);
              this.ppNormal = new THREE.Vector3(0, 1, 0);
            } else {
              this.ppNormal = new THREE.Vector3(normal[0], normal[1], normal[2]);
            }

            // 노멀 방향 → 화면 방향 투영
            const pA = hitPoint.clone().project(this.viewport.activeCamera);
            const pB = hitPoint.clone().add(this.ppNormal.clone().multiplyScalar(1000)).project(this.viewport.activeCamera);
            this.ppScreenDir = new THREE.Vector2(pB.x - pA.x, pB.y - pA.y);
            if (this.ppScreenDir.length() > 0.0001) {
              this.ppScreenDir.normalize();
            } else {
              this.ppScreenDir.set(0, -1);
            }

            this.ppHitPoint = hitPoint;
            this.createPPGhost(rustFaceId, hitPoint);

            // 면 선택 하이라이트
            this.selection.handleClick(rustFaceId, false, false);
            console.log('[PP] Phase 1: face selected, faceId=', rustFaceId,
              'normal=', this.ppNormal.toArray().map(v => v.toFixed(3)));
          }
        } else {
          // 2단계: 거리 확정 (두 번째 클릭)
          const dist = this.ppRayDist(e);
          console.log('[PP] Phase 2: confirm dist=', dist.toFixed(2));

          if (Math.abs(dist) > 0.5) {
            const success = this.bridge.pushPull(this.ppFaceId, dist);
            console.log('[PP] pushPull result=', success, 'dist=', dist.toFixed(2));
            if (success) {
              this.lastPPDist = dist;
              this.syncMesh();
            }
          }
          this.removePPGhost();
          this.ppActive = false;
          this.ppFaceId = -1;
          this.selection.clearSelection();
          this.dimLabel.clear();
        }
      }
    });

    // ===== MOUSE MOVE =====
    canvas.addEventListener('mousemove', (e) => {
      // (Face hover 하이라이트는 mousemove 끝부분에서 처리)

      // ─── Drag Selection Box (Select 도구) ───
      if (this._currentTool === 'select' && this.dragSelectStart) {
        const dx = e.clientX - this.dragSelectStart.x;
        const dy = e.clientY - this.dragSelectStart.y;
        if (!this.isDragSelecting && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
          // 5px 이상 이동 → 드래그 선택 시작
          this.isDragSelecting = true;
          this.selection.clearSelection();
          this.createDragSelectBox();
        }
        if (this.isDragSelecting) {
          this.updateDragSelectBox(
            this.dragSelectStart.x, this.dragSelectStart.y,
            e.clientX, e.clientY
          );
        }
      }

      // ─── Erase: hover 하이라이트 (빨간색) ───
      if (this._currentTool === 'erase') {
        // Edge hover 하이라이트
        const edgeHit = this.viewport.pickEdge(e.clientX, e.clientY);
        if (edgeHit && edgeHit.index != null && this.edgeMap) {
          const segIndex = Math.floor(edgeHit.index / 2);
          this.showEraseHover(segIndex);
        } else {
          this.removeEraseHover();
        }

        // Face hover도 빨간색으로 표시 (selection highlight 활용)
        const faceHit = this.viewport.pick(e.clientX, e.clientY);
        if (faceHit && faceHit.faceIndex != null && faceHit.faceIndex >= 0) {
          const fid = this.getFaceId(faceHit.faceIndex);
          if (fid >= 0) {
            this.selection.handleClick(fid, false, false);
          }
        } else if (!edgeHit) {
          this.selection.clearSelection();
        }
      }

      // ─── Offset: pickbox + hover highlight + 치수 미리보기 ───
      if (this._currentTool === 'offset') {
        // Pickbox 표시 (항상)
        if (this.pickBox) {
          this.pickBox.visible = true;
          this.pickBox.update(e.clientX, e.clientY);
        }

        if (this.offsetPhase === 0) {
          // Phase 0: 객체 hover 하이라이트
          const edgeHit = this.viewport.pickEdge(e.clientX, e.clientY);
          if (edgeHit && edgeHit.index != null && this.edgeMap) {
            const segIndex = Math.floor(edgeHit.index / 2);
            this.showEdgeHover(segIndex);
          } else {
            this.removeOffsetHover();
          }
        } else if (this.offsetPhase === 1) {
          // Phase 1: 방향 미리보기 + 치수 표시
          if (this.offsetEdgeId >= 0) {
            // Edge: 마우스 위치에서 edge까지의 수직 거리 + 방향 계산
            const groundPt = this.getGroundPoint(e);
            if (groundPt) {
              const midPt = new THREE.Vector3().addVectors(this.offsetEdgeP0, this.offsetEdgeP1).multiplyScalar(0.5);
              const clickDir = new THREE.Vector3().subVectors(groundPt, midPt);
              const projDist = clickDir.dot(this.offsetEdgeDir);

              // 방향 부호 저장 (VCB용)
              if (Math.abs(projDist) > 0.1) {
                this.offsetCurrentSign = projDist >= 0 ? 1 : -1;
              }

              let previewDist = this.lastOffsetDist > 0
                ? this.lastOffsetDist * this.offsetCurrentSign
                : projDist;

              if (Math.abs(previewDist) > 0.1) {
                // 미리보기 선 표시
                const offset = this.offsetEdgeDir.clone().multiplyScalar(previewDist);
                const prevP0 = this.offsetEdgeP0.clone().add(offset);
                const prevP1 = this.offsetEdgeP1.clone().add(offset);

                // hover highlight을 미리보기 선으로 재사용
                this.removeOffsetHover();
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(
                  new Float32Array([prevP0.x, prevP0.y, prevP0.z, prevP1.x, prevP1.y, prevP1.z]), 3
                ));
                const mat = new THREE.LineBasicMaterial({
                  color: 0xff9f43, linewidth: 2, depthTest: false,
                });
                this.offsetHoverHighlight = new THREE.Line(geo, mat);
                this.offsetHoverHighlight.renderOrder = 998;
                this.viewport.scene.add(this.offsetHoverHighlight);

                // 치수 표시
                const text = this.units.format(Math.abs(previewDist));
                const midFrom = new THREE.Vector3().addVectors(this.offsetEdgeP0, this.offsetEdgeP1).multiplyScalar(0.5);
                const midTo = midFrom.clone().add(this.offsetEdgeDir.clone().multiplyScalar(previewDist));
                this.dimLabel.update(this.viewport.activeCamera, [
                  { from: midFrom, to: midTo, text, color: '#ff9f43' },
                ]);
              }
            }
          } else if (this.offsetFaceId >= 0) {
            // Face: 기존 고스트 미리보기
            const dist = this.offsetRayDist(e);
            if (Math.abs(dist) > 0.1) {
              this.offsetCurrentSign = dist >= 0 ? 1 : -1;
            }
            let previewDist = this.lastOffsetDist > 0
              ? this.lastOffsetDist * this.offsetCurrentSign
              : dist;
            this.updateOffsetGhost(previewDist);

            if (Math.abs(previewDist) > 0.1) {
              const text = this.units.format(Math.abs(previewDist));
              const label = previewDist >= 0 ? 'Inset' : 'Outset';
              if (this.offsetFaceVerts.length >= 2) {
                const midA = new THREE.Vector3().addVectors(
                  this.offsetFaceVerts[0], this.offsetFaceVerts[1]
                ).multiplyScalar(0.5);
                const edge = new THREE.Vector3().subVectors(
                  this.offsetFaceVerts[1], this.offsetFaceVerts[0]
                );
                const inward = new THREE.Vector3().crossVectors(edge, this.offsetNormal).normalize();
                const midB = midA.clone().add(inward.multiplyScalar(previewDist));
                this.dimLabel.update(this.viewport.activeCamera, [
                  { from: midA, to: midB, text: `${label}: ${text}`, color: '#ff9f43' },
                ]);
              }
            } else {
              this.dimLabel.clear();
            }
          }
        }
      } else {
        // Offset 도구가 아니면 pickbox 숨김
        if (this.pickBox) this.pickBox.visible = false;
      }

      // ─── Move / Rotate / Scale 드래그 ───
      if ((this._currentTool === 'move' || this._currentTool === 'rotate' || this._currentTool === 'scale')
          && this.transformActive && this.transformStartPt && this.transformCentroid) {
        const pt = this.get3DPoint(e);
        if (pt) {
          const selected = this.getSelectedFaces();
          const centroid = this.transformCentroid;

          if (this._currentTool === 'move') {
            // 이동: 이전 프레임 대비 증분 이동
            const totalDelta = new THREE.Vector3().subVectors(pt, this.transformStartPt);
            const incDelta = new THREE.Vector3().subVectors(totalDelta, this.transformLastDelta);

            if (incDelta.length() > 0.1) {
              this.bridge.translateFaces(selected, incDelta.x, incDelta.y, incDelta.z);
              this.transformLastDelta.copy(totalDelta);
              this.syncMesh();

              const dist = totalDelta.length();
              this.dimLabel.update(this.viewport.activeCamera, [
                { from: this.transformStartPt.clone(), to: pt.clone(),
                  text: this.units.format(dist), color: '#ffd43b' },
              ]);
            }
          } else if (this._currentTool === 'rotate') {
            // 회전: XZ 평면에서 centroid 기준 각도 변화
            const dx = pt.x - centroid.x;
            const dz = pt.z - centroid.z;
            const currentAngle = Math.atan2(dz, dx);
            const angleDiff = (currentAngle - this.transformStartAngle) * (180 / Math.PI);

            if (Math.abs(angleDiff) > 0.1) {
              // 증분 회전: 전체 각도에서 이전까지 적용된 것 빼기
              this.bridge.rotateFaces(selected,
                centroid.x, centroid.y, centroid.z,
                0, 1, 0,  // Y축 회전 (바닥 평면)
                angleDiff,
              );
              this.transformStartAngle = currentAngle;
              this.syncMesh();

              // 중심점 갱신 (회전 후)
              const newCentroid = this.bridge.facesCentroid(selected);
              if (newCentroid) this.transformCentroid = newCentroid;

              this.dimLabel.update(this.viewport.activeCamera, [
                { from: centroid.clone(), to: pt.clone(),
                  text: `${angleDiff.toFixed(1)}°`, color: '#da77f2' },
              ]);
            }
          } else if (this._currentTool === 'scale') {
            // 스케일: centroid에서 마우스까지 거리 비율
            const startDist = this.transformStartPt.distanceTo(centroid);
            const currentDist = pt.distanceTo(centroid);
            if (startDist > 1) {
              const ratio = currentDist / startDist;
              // 이전 스케일 대비 증분 (매 프레임 ratio 적용하면 누적됨)
              // → 원본 기준 전체 ratio를 적용하려면 역변환 필요
              // MVP: start 기준 한번에 적용 (mouseup에서만 최종 적용)
              // 여기서는 미리보기만 표시
              this.dimLabel.update(this.viewport.activeCamera, [
                { from: centroid.clone(), to: pt.clone(),
                  text: `×${ratio.toFixed(2)}`, color: '#51cf66' },
              ]);
            }
          }
        }
      }

      // ─── Rect 드래그 치수 표시 ───
      if (this._currentTool === 'rect' && this.rectStart) {
        const rawPt = this.get3DPoint(e);
        const pt = this.getSnappedPoint(e, rawPt);
        if (pt) {
          this.updateRectPreview(this.rectStart, pt);

          const w = Math.abs(pt.x - this.rectStart.x);
          const h = Math.abs(pt.z - this.rectStart.z);
          if (w > 0.001 || h > 0.001) {
            const s = this.rectStart;
            const minX = Math.min(s.x, pt.x);
            const maxX = Math.max(s.x, pt.x);
            const minZ = Math.min(s.z, pt.z);
            const maxZ = Math.max(s.z, pt.z);

            // 치수선 오프셋 (사각형 바깥쪽)
            const gap = Math.max(w, h) * 0.08 + 100;

            const y = this.rectStart.y;
            const dimLines: DimLine[] = [
              // 가로(X) 치수: 아래쪽 (maxZ + gap)
              { from: new THREE.Vector3(minX, y, maxZ + gap), to: new THREE.Vector3(maxX, y, maxZ + gap), text: this.units.format(w), color: '#ff6b6b' },
              // 세로(Z) 치수: 왼쪽 (minX - gap)
              { from: new THREE.Vector3(minX - gap, y, minZ), to: new THREE.Vector3(minX - gap, y, maxZ), text: this.units.format(h), color: '#51cf66' },
            ];
            this.dimLabel.update(this.viewport.activeCamera, dimLines);
          }
        }
      }

      // ─── Push/Pull 드래그 치수 표시 ───
      if (this._currentTool === 'pushpull' && this.ppActive && this.ppGhost) {
        const dist = this.ppRayDist(e);
        this.updatePPGhost(dist);

        // 치수 표시: 마우스에 가장 가까운 모서리에 평행하게
        if (this.ppFaceVerts.length >= 2 && Math.abs(dist) > 0.001) {
          const absDist = Math.abs(dist);
          const sign = dist >= 0 ? '' : '-';
          const text = sign + this.units.format(absDist);
          const offset = this.ppNormal.clone().multiplyScalar(dist);

          // 마우스에 가장 가까운 꼭짓점(모서리) 찾기
          const canvasRect = canvas.getBoundingClientRect();
          const mouseNdc = new THREE.Vector2(
            ((e.clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
            -((e.clientY - canvasRect.top) / canvasRect.height) * 2 + 1,
          );
          let bestIdx = 0;
          let bestScreenDist = Infinity;
          for (let i = 0; i < this.ppFaceVerts.length; i++) {
            const v = this.ppFaceVerts[i].clone().project(this.viewport.activeCamera);
            const sd = new THREE.Vector2(v.x, v.y).distanceTo(mouseNdc);
            if (sd < bestScreenDist) {
              bestScreenDist = sd;
              bestIdx = i;
            }
          }

          // 해당 꼭짓점의 수직 모서리 (원본→오프셋)
          const edgeFrom = this.ppFaceVerts[bestIdx].clone();
          const edgeTo = edgeFrom.clone().add(offset);

          this.dimLabel.update(this.viewport.activeCamera, [
            { from: edgeFrom, to: edgeTo, text, color: '#ffd43b' },
          ]);
        } else {
          this.dimLabel.clear();
        }
      }

      // ─── Line 드래그 미리보기 (3D 축 추론) ───
      if (this._currentTool === 'line' && this.lineStart) {
        // 스냅 먼저 체크
        const rawPt = this.get3DPoint(e);
        const snapPt = this.getSnappedPoint(e, rawPt);

        // 스냅이 있으면 스냅 우선, 없으면 축 추론
        let pt: THREE.Vector3 | null = null;
        let axis: 'x' | 'y' | 'z' | 'free' = 'free';

        if (snapPt && rawPt && snapPt.distanceTo(rawPt) > 0.01) {
          // 스냅 포인트가 유효 → 스냅 우선
          pt = snapPt;
          axis = 'free';
        } else {
          // 축 추론
          const inferred = this.getAxisInferredPoint(e, this.lineStart);
          pt = inferred.point;
          axis = inferred.axis;
        }

        this.inferredAxis = axis;

        if (pt) {
          // 축 색상으로 미리보기
          const axisColors: Record<string, number> = { x: 0xff3333, y: 0x3388ff, z: 0x33cc33, free: 0x74c0fc };
          const axisColorStr: Record<string, string> = { x: '#ff3333', y: '#3388ff', z: '#33cc33', free: '#74c0fc' };
          const axisNames: Record<string, string> = { x: 'X축', y: 'Y축(높이)', z: 'Z축', free: '' };

          this.updateLinePreview(this.lineStart, pt, axisColors[axis]);
          this.updateAxisGuide(this.lineStart, axis, pt);

          const len = this.lineStart.distanceTo(pt);
          if (len > 0.1) {
            const label = axisNames[axis] ? `${axisNames[axis]} ${this.units.format(len)}` : this.units.format(len);
            this.dimLabel.update(this.viewport.activeCamera, [
              { from: this.lineStart.clone(), to: pt.clone(), text: label, color: axisColorStr[axis] },
            ]);
          }
        }
      }

      // ─── Circle 드래그 미리보기 (3D) ───
      if (this._currentTool === 'circle' && this.circleCenter) {
        const rawPt = this.get3DPoint(e);
        const pt = this.getSnappedPoint(e, rawPt);
        if (pt) {
          const radius = this.circleCenter.distanceTo(pt);
          if (radius > 0.1) {
            this.updateCirclePreview(this.circleCenter, radius);
            this.dimLabel.update(this.viewport.activeCamera, [
              { from: this.circleCenter.clone(), to: pt.clone(), text: 'R ' + this.units.format(radius), color: '#da77f2' },
            ]);
          }
        }
      }

      // ─── 스냅 마커 표시 (도구 활성 시 항상) ───
      if (this._currentTool !== 'select' && this._currentTool !== 'pushpull') {
        const isDragging = (this._currentTool === 'rect' && this.rectStart)
          || (this._currentTool === 'line' && this.lineStart)
          || (this._currentTool === 'circle' && this.circleCenter);
        if (!isDragging) {
          const rawPt = getGroundPoint(e);
          this.getSnappedPoint(e, rawPt);
        }
      }

      // ─── Hover 하이라이트 (Select, PushPull, Offset, Move, Rotate, Scale) ───
      // 드래그/조작 중에는 hover pick 생략 (성능 + 불필요)
      const isOperating = (this._currentTool === 'pushpull' && this.ppActive)
        || (this._currentTool === 'move' && this.transformActive)
        || (this._currentTool === 'rotate' && this.transformActive)
        || (this._currentTool === 'scale' && this.transformActive);

      if (!isOperating && ToolManager.HOVER_TOOLS.has(this._currentTool)) {
        const hit = this.viewport.pick(e.clientX, e.clientY);
        if (hit && hit.faceIndex != null) {
          const fid = this.getFaceId(hit.faceIndex!);
          this.selection.setHover(fid);
          this.selection.clearEdgeHover();
        } else {
          this.selection.clearHover();
          // Edge hover (offset/erase 도구에서만 — 불필요한 pickEdge 호출 방지)
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
        // 조작 중에는 hover 강제 해제
        this.selection.clearHover();
        this.selection.clearEdgeHover();
      } else {
        this.selection.clearHover();
        this.selection.clearEdgeHover();
      }

      // ─── 기본: 도구 비활성 시 치수 숨김 ───
      if (this._currentTool === 'select') {
        this.dimLabel.clear();
        this.snapVisual.clear();
      }
    });

    // ===== MOUSE LEAVE (캔버스 벗어남 → hover 즉시 해제) =====
    canvas.addEventListener('mouseleave', () => {
      this.selection.clearHover();
      this.selection.clearEdgeHover();
    });

    // ===== MOUSE UP =====
    canvas.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;

      // ═══ Drag Selection Box 완료 ═══
      if (this._currentTool === 'select' && this.dragSelectStart) {
        if (this.isDragSelecting) {
          this.performBoxSelect(
            this.dragSelectStart.x, this.dragSelectStart.y,
            e.clientX, e.clientY
          );
          this.removeDragSelectBox();
          return;
        } else {
          // 드래그 없이 마우스 올린 경우 → 빈 공간 클릭으로 처리 (선택 해제)
          this.selection.clearSelection();
          this.dragSelectStart = null;
        }
      }

      // Offset: mouseup은 이제 사용하지 않음 (클릭→이동→클릭 방식)
      // (2단계 확정은 mousedown에서 처리)

      // ═══ Move / Rotate / Scale: 드래그 종료 ═══
      if ((this._currentTool === 'move' || this._currentTool === 'rotate' || this._currentTool === 'scale')
          && this.transformActive) {

        if (this._currentTool === 'scale' && this.transformStartPt && this.transformCentroid) {
          // Scale은 mouseup 시 한번에 적용
          const pt = this.get3DPoint(e);
          if (pt) {
            const centroid = this.transformCentroid;
            const startDist = this.transformStartPt.distanceTo(centroid);
            const currentDist = pt.distanceTo(centroid);
            if (startDist > 1) {
              const ratio = currentDist / startDist;
              if (Math.abs(ratio - 1.0) > 0.01) {
                const selected = this.getSelectedFaces();
                this.bridge.scaleFaces(selected,
                  centroid.x, centroid.y, centroid.z,
                  ratio, ratio, ratio,
                );
                console.log(`[Scale] Applied ×${ratio.toFixed(3)}`);
                this.syncMesh();
              }
            }
          }
        }

        console.log(`[${this._currentTool}] End drag`);
        this.transformActive = false;
        this.transformStartPt = null;
        this.transformCentroid = null;
        this.transformLastDelta.set(0, 0, 0);
        this.dimLabel.clear();
      }

      // Rect: mouseup은 이제 사용하지 않음 (클릭→이동→클릭 방식)

      // Push/Pull: mouseup은 이제 사용하지 않음 (클릭→이동→클릭 방식)
      // (2단계 확정은 mousedown에서 처리)

      // Line: mouseup은 이제 사용하지 않음 (클릭→이동→클릭 방식)

      // Circle: mouseup은 이제 사용하지 않음 (클릭→이동→클릭 방식)
    });
  }

  private updateRectPreview(start: THREE.Vector3, end: THREE.Vector3) {
    const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.z - start.z);
    if (w < 0.001 || h < 0.001) return;

    if (this.rectPreview) {
      this.viewport.scene.remove(this.rectPreview);
      this.rectPreview.geometry.dispose();
    }

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    this.rectPreview = new THREE.Mesh(geo, mat);
    this.rectPreview.rotation.x = -Math.PI / 2;
    // 3D: 실제 Y 좌표 사용 (약간 offset으로 z-fighting 방지)
    this.rectPreview.position.set(center.x, center.y + 0.5, center.z);
    this.viewport.scene.add(this.rectPreview);
  }

  /** Line 미리보기 (3D 시작점 → 끝점, 축 색상) */
  private updateLinePreview(start: THREE.Vector3, end: THREE.Vector3, color: number = 0x74c0fc) {
    if (this.linePreview) {
      this.viewport.scene.remove(this.linePreview);
      this.linePreview.geometry.dispose();
      (this.linePreview.material as THREE.Material).dispose();
    }

    // 3D 좌표 그대로 사용 (약간 offset하여 z-fighting 방지)
    const offset = 0.5;
    const points = [
      new THREE.Vector3(start.x, start.y + offset, start.z),
      new THREE.Vector3(end.x, end.y + offset, end.z),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 1 });
    this.linePreview = new THREE.Line(geo, mat);
    this.viewport.scene.add(this.linePreview);
  }

  /** Circle 미리보기 (중심 + 반지름 원형 와이어프레임) */
  private updateCirclePreview(center: THREE.Vector3, radius: number) {
    if (this.circlePreview) {
      this.viewport.scene.remove(this.circlePreview);
      this.circlePreview.geometry.dispose();
      (this.circlePreview.material as THREE.Material).dispose();
    }

    const segments = 48;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(
        center.x + Math.cos(angle) * radius,
        center.y + 0.5,  // 3D: 실제 Y 좌표 사용 (z-fighting 방지 offset)
        center.z + Math.sin(angle) * radius,
      ));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xda77f2, linewidth: 1 });
    this.circlePreview = new THREE.Line(geo, mat);
    this.viewport.scene.add(this.circlePreview);
  }
}
