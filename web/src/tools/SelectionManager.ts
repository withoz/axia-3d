/**
 * SelectionManager — 다중 Face 선택 + 하이라이트 관리
 *
 * 기능:
 *   - 단일 클릭: 기존 선택 해제 → 새 face 선택
 *   - Shift+클릭: 선택에 추가
 *   - Ctrl+클릭: 선택 토글
 *   - 더블클릭: 솔리드 전체 자동 선택 (연결된 face 그룹)
 *   - 마우스오버: hover 하이라이트
 */

import * as THREE from 'three';
import { debugLog, debugWarn } from '../utils/debug';
import { COS_SMOOTH_GROUP, COS_EXACT_COPLANAR } from '../constants';

export interface SelectionState {
  /** 현재 선택된 Rust FaceId 집합 */
  selected: Set<number>;
  /** 현재 선택된 EdgeId 집합 */
  selectedEdges: Set<number>;
  /** 현재 hover 중인 FaceId (-1 = 없음) */
  hovered: number;
}

export class SelectionManager {
  private selected = new Set<number>();
  private selectedEdges = new Set<number>();  // 선택된 EdgeId
  private hovered = -1;
  private hoveredEdgeSegIndex = -1;  // hover 중인 edge segment index

  // ── Three.js 하이라이트 메시 ──
  private highlightGroup: THREE.Group;
  private hoverMesh: THREE.Mesh | null = null;
  private hoverOutline: THREE.LineSegments | null = null;
  private selectionMesh: THREE.Mesh | null = null;
  private selectionOutline: THREE.LineSegments | null = null;
  private edgeSelectionLine: THREE.LineSegments | null = null;  // 선택된 edge 하이라이트
  private edgeHoverLine: THREE.Line | null = null;  // hover edge 하이라이트

  // ── XIA 전체 선택 (트리플 클릭) 도트 표시 ──
  private isXiaSelected = false;
  private xiaDotPoints: THREE.Points | null = null;        // 정점 도트
  private xiaBBoxLines: THREE.LineSegments | null = null;   // 점선 바운딩 박스

  // ── 그룹 시스템 ──
  // groupId → Set<faceId> 매핑 (로컬 캐시 + WASM 백엔드 연동)
  private groups = new Map<number, Set<number>>();
  // faceId → groupId 역인덱스 (빠른 조회)
  private faceToGroup = new Map<number, number>();
  private nextGroupId = 1;

  // ── 그룹 편집 모드 ──
  private editingGroupId: number | null = null;  // 현재 편집 중인 그룹 ID
  private groupBBoxLines: THREE.LineSegments | null = null;  // 그룹 바운딩 박스

  // ── 외부 참조 ──
  private faceMap: Uint32Array = new Uint32Array(0);
  private positions: Float32Array = new Float32Array(0);
  private indices: Uint32Array = new Uint32Array(0);
  private edgeLines: Float32Array | null = null;   // edge line segments
  private edgeMap: Uint32Array | null = null;       // segment → EdgeId

  // ── WASM Bridge (DCEL topology 접근용) ──
  private bridge: {
    getConnectedFaces(seedFaceId: number): number[];
    isFaceLocked?(faceId: number): boolean;
  } | null = null;

  // ── 콜백 (다중 리스너 지원) ──
  private selectionChangeListeners: Array<(faces: number[]) => void> = [];

  // ── 하이라이트 색상 ──
  // Face: 파랑(fill) — 기존 유지
  // Edge: 오렌지(line) — 기본 엣지 색(#333366) 및 face 선택색과 명확히 구분 (2026-04-17)
  // Hover: 밝은 파랑 — 엣지 hover에도 공용
  private static readonly HOVER_COLOR = 0x4fc3f7;       // 밝은 파랑
  private static readonly HOVER_OPACITY = 0.08;          // 매우 은은한 오버레이
  private static readonly SELECT_COLOR = 0x2196f3;      // 파랑 — face 선택
  private static readonly SELECT_OPACITY = 0.18;
  private static readonly EDGE_SELECT_COLOR = 0xff6f00;  // 오렌지 — edge 선택 (대비↑)

  constructor(scene: THREE.Scene) {
    this.highlightGroup = new THREE.Group();
    this.highlightGroup.name = 'selection-highlights';
    this.highlightGroup.renderOrder = 1;
    scene.add(this.highlightGroup);
  }

  /** WASM Bridge 연결 — DCEL topology 기반 연결 탐색 활성화 */
  setBridge(bridge: {
    getConnectedFaces(seedFaceId: number): number[];
    isFaceLocked?(faceId: number): boolean;
  }): void {
    this.bridge = bridge;
  }

  /** 메시 버퍼 업데이트 (syncMesh 시 호출) */
  updateBuffers(positions: Float32Array, indices: Uint32Array, faceMap: Uint32Array) {
    this.positions = positions;
    this.indices = indices;
    this.faceMap = faceMap;

    // 삭제된 face 정리
    const validFaces = new Set<number>();
    for (let i = 0; i < faceMap.length; i++) {
      validFaces.add(faceMap[i]);
    }
    for (const fid of this.selected) {
      if (!validFaces.has(fid)) {
        this.selected.delete(fid);
      }
    }

    this.rebuildSelectionMesh();
    // XIA 선택 도트도 갱신 (Move/Rotate/Scale 중 위치 추적)
    if (this.isXiaSelected) this.rebuildXiaDots();
  }

  /** Edge 버퍼 업데이트 (syncMesh 시 호출) */
  updateEdgeBuffers(edgeLines: Float32Array | null, edgeMap: Uint32Array | null) {
    this.edgeLines = edgeLines;
    this.edgeMap = edgeMap;

    // 삭제된 edge 정리
    if (edgeMap) {
      const validEdges = new Set<number>();
      for (let i = 0; i < edgeMap.length; i++) {
        validEdges.add(edgeMap[i]);
      }
      for (const eid of this.selectedEdges) {
        if (!validEdges.has(eid)) {
          this.selectedEdges.delete(eid);
        }
      }
    } else {
      this.selectedEdges.clear();
    }

    this.rebuildEdgeSelectionLine();
  }

  /** 콜백 등록 (다중 리스너 — 덮어쓰지 않음) */
  onChange(cb: (faces: number[]) => void) {
    this.selectionChangeListeners.push(cb);
  }

  // ════════════════════════════════════════════════
  // 선택 조작
  // ════════════════════════════════════════════════

  /** 클릭 처리 — modifier key에 따라 동작 분기 */
  handleClick(faceId: number, shiftKey: boolean, ctrlKey: boolean) {
    if (faceId < 0) {
      // 빈 공간 클릭 → 전체 해제
      this.clearSelection();
      return;
    }

    // 잠긴 그룹의 면은 선택 불가
    if (this.bridge?.isFaceLocked?.(faceId)) {
      debugLog(`[Selection] Face ${faceId} is locked — selection blocked`);
      return;
    }

    this.clearXiaDots(); // XIA 도트 모드 해제

    // 곡면 그룹 확장: 클릭된 면과 법선 각도 < 30°로 연결된 모든 면을 한 그룹으로 선택
    const smoothGroup = this.findSmoothGroup(faceId);

    if (shiftKey) {
      // Shift+클릭: 추가 (기존 edge 선택도 유지)
      for (const fid of smoothGroup) this.selected.add(fid);
    } else if (ctrlKey) {
      // Ctrl+클릭: 토글 (edge 선택은 건드리지 않음)
      const allSelected = [...smoothGroup].every(fid => this.selected.has(fid));
      if (allSelected) {
        for (const fid of smoothGroup) this.selected.delete(fid);
      } else {
        for (const fid of smoothGroup) this.selected.add(fid);
      }
    } else {
      // 일반 클릭: 면과 엣지 **모두** 해제 후 곡면 그룹 선택 (Bug 1 fix, 2026-04-17)
      // handleEdgeClick의 대칭성 맞춤 — 이전엔 edge만 남아있어 혼란 유발했음
      this.selected.clear();
      this.selectedEdges.clear();
      for (const fid of smoothGroup) this.selected.add(fid);
    }

    this.rebuildSelectionMesh();
    this.rebuildEdgeSelectionLine();  // edge clear 시각 반영
    this.notifyChange();
  }

  /** Edge 클릭 처리 */
  handleEdgeClick(edgeId: number, shiftKey: boolean, ctrlKey: boolean) {
    if (edgeId < 0) {
      this.selectedEdges.clear();
      this.rebuildEdgeSelectionLine();
      this.notifyChange();
      return;
    }

    if (shiftKey) {
      this.selectedEdges.add(edgeId);
    } else if (ctrlKey) {
      if (this.selectedEdges.has(edgeId)) {
        this.selectedEdges.delete(edgeId);
      } else {
        this.selectedEdges.add(edgeId);
      }
    } else {
      // 일반 클릭: face 선택 해제 + edge 선택
      this.selected.clear();
      this.rebuildSelectionMesh();
      this.selectedEdges.clear();
      this.selectedEdges.add(edgeId);
    }

    this.rebuildEdgeSelectionLine();
    this.notifyChange();
  }

  /** 선택된 EdgeId 배열 */
  getSelectedEdges(): number[] {
    return Array.from(this.selectedEdges);
  }

  /** Edge hover 업데이트 */
  setEdgeHover(segIndex: number) {
    if (segIndex === this.hoveredEdgeSegIndex) return;
    this.hoveredEdgeSegIndex = segIndex;
    this.rebuildEdgeHoverLine();
  }

  clearEdgeHover() {
    if (this.hoveredEdgeSegIndex < 0) return;
    this.hoveredEdgeSegIndex = -1;
    this.rebuildEdgeHoverLine();
  }

  /**
   * SketchUp 더블클릭: face + 경계 edge 모두 선택.
   *
   * Modifier 동작 (2026-04-17 추가):
   * - plain: 기존 선택 모두 해제 → face + 경계 edges 선택
   * - shift: 기존 선택 유지하며 face + 경계 edges **추가**
   * - ctrl:  face가 이미 선택되어 있으면 face + 경계 edges **제거**, 아니면 추가
   */
  selectFaceWithEdges(faceId: number, shiftKey: boolean = false, ctrlKey: boolean = false) {
    if (faceId < 0) return;

    this.clearXiaDots(); // XIA 도트 모드 해제

    const faceSet = new Set<number>([faceId]);
    const borderEdges = this.computeBorderEdges(faceSet);

    if (shiftKey) {
      // 추가 (기존 유지)
      this.selected.add(faceId);
      for (const eid of borderEdges) this.selectedEdges.add(eid);
    } else if (ctrlKey) {
      // 토글
      if (this.selected.has(faceId)) {
        this.selected.delete(faceId);
        for (const eid of borderEdges) this.selectedEdges.delete(eid);
      } else {
        this.selected.add(faceId);
        for (const eid of borderEdges) this.selectedEdges.add(eid);
      }
    } else {
      // 교체
      this.selected.clear();
      this.selectedEdges.clear();
      this.selected.add(faceId);
      for (const eid of borderEdges) this.selectedEdges.add(eid);
    }

    this.rebuildSelectionMesh();
    this.rebuildEdgeSelectionLine();
    this.notifyChange();
  }

  /**
   * 주어진 face 집합의 경계 edge ID들을 계산 (side-effect 없음).
   * addBorderEdgesForFaces는 즉시 this.selectedEdges에 추가하는데,
   * 토글/교체 로직을 구현하려면 먼저 수집이 필요해 분리함.
   */
  private computeBorderEdges(faceIds: Set<number>): number[] {
    if (!this.edgeMap || !this.edgeLines) return [];

    const faceVertKeys = new Set<string>();
    for (let tri = 0; tri < this.faceMap.length; tri++) {
      if (!faceIds.has(this.faceMap[tri])) continue;
      const base = tri * 3;
      if (base + 2 >= this.indices.length) continue;
      for (let j = 0; j < 3; j++) {
        const idx = this.indices[base + j];
        const x = this.positions[idx * 3];
        const y = this.positions[idx * 3 + 1];
        const z = this.positions[idx * 3 + 2];
        faceVertKeys.add(`${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`);
      }
    }

    const result: number[] = [];
    for (let i = 0; i < this.edgeMap.length; i++) {
      const base = i * 6;
      if (base + 5 >= this.edgeLines.length) continue;
      const keyA = `${this.edgeLines[base].toFixed(1)},${this.edgeLines[base + 1].toFixed(1)},${this.edgeLines[base + 2].toFixed(1)}`;
      const keyB = `${this.edgeLines[base + 3].toFixed(1)},${this.edgeLines[base + 4].toFixed(1)},${this.edgeLines[base + 5].toFixed(1)}`;
      if (faceVertKeys.has(keyA) && faceVertKeys.has(keyB)) {
        result.push(this.edgeMap[i]);
      }
    }
    return result;
  }

  /** SketchUp 트리플클릭: 연결된 전체 오브젝트 (face + edge) 선택 — XIA 도트 표시
   *  그룹이 있으면 그룹 전체를, 없으면 연결된 면(XIA) 전체를 선택
   */
  /**
   * 트리플클릭: 연결된 전체 XIA(group 또는 connected faces) + 경계 edges 선택.
   *
   * Modifier (2026-04-17 추가):
   * - plain: 기존 선택 해제 → XIA 전체
   * - shift: 기존 선택에 XIA 전체 추가
   * - ctrl:  XIA가 모두 선택되어 있으면 제거, 아니면 추가
   */
  selectAll(seedFaceId: number, shiftKey: boolean = false, ctrlKey: boolean = false) {
    if (seedFaceId < 0) return;

    // 그룹이 있으면 그룹 면을 우선 선택
    const groupFaces = this.getGroupFaces(seedFaceId);
    const targetFaces = groupFaces ?? this.findConnectedFaces(seedFaceId);
    const targetBorderEdges = this.computeBorderEdges(targetFaces);

    if (shiftKey) {
      // 추가
      for (const fid of targetFaces) this.selected.add(fid);
      for (const eid of targetBorderEdges) this.selectedEdges.add(eid);
    } else if (ctrlKey) {
      // 토글: 모두 선택 상태면 제거, 아니면 추가
      const allSelected = [...targetFaces].every(f => this.selected.has(f));
      if (allSelected) {
        for (const fid of targetFaces) this.selected.delete(fid);
        for (const eid of targetBorderEdges) this.selectedEdges.delete(eid);
      } else {
        for (const fid of targetFaces) this.selected.add(fid);
        for (const eid of targetBorderEdges) this.selectedEdges.add(eid);
      }
    } else {
      // 교체
      this.selected.clear();
      this.selectedEdges.clear();
      for (const fid of targetFaces) this.selected.add(fid);
      for (const eid of targetBorderEdges) this.selectedEdges.add(eid);
    }

    this.isXiaSelected = !shiftKey && !ctrlKey;  // 교체 케이스에서만 XIA 도트 모드
    this.rebuildSelectionMesh();
    this.rebuildEdgeSelectionLine();
    if (this.isXiaSelected) this.rebuildXiaDots();
    this.notifyChange();
  }

  /** 지정된 face 집합의 경계 edge를 selectedEdges에 추가 */
  private addBorderEdgesForFaces(faceIds: Set<number>) {
    if (!this.edgeMap || !this.edgeLines) return;

    // face에 속하는 정점 좌표 수집
    const faceVertKeys = new Set<string>();
    for (let tri = 0; tri < this.faceMap.length; tri++) {
      if (!faceIds.has(this.faceMap[tri])) continue;
      const base = tri * 3;
      if (base + 2 >= this.indices.length) continue;
      for (let j = 0; j < 3; j++) {
        const idx = this.indices[base + j];
        const x = this.positions[idx * 3];
        const y = this.positions[idx * 3 + 1];
        const z = this.positions[idx * 3 + 2];
        faceVertKeys.add(`${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`);
      }
    }

    // edge의 양 끝점이 모두 face 정점에 포함되면 → 경계 edge
    for (let i = 0; i < this.edgeMap.length; i++) {
      const base = i * 6;
      if (base + 5 >= this.edgeLines.length) continue;
      const keyA = `${this.edgeLines[base].toFixed(1)},${this.edgeLines[base+1].toFixed(1)},${this.edgeLines[base+2].toFixed(1)}`;
      const keyB = `${this.edgeLines[base+3].toFixed(1)},${this.edgeLines[base+4].toFixed(1)},${this.edgeLines[base+5].toFixed(1)}`;
      if (faceVertKeys.has(keyA) && faceVertKeys.has(keyB)) {
        this.selectedEdges.add(this.edgeMap[i]);
      }
    }
  }

  /** 더블클릭: 면 + 면의 경계 edge만 선택 */
  selectAdjacentEdges(faceId: number) {
    if (faceId < 0 || !this.edgeMap || !this.edgeLines) return;

    const faceSet = new Set<number>([faceId]);
    this.addBorderEdgesForFaces(faceSet);
    this.rebuildEdgeSelectionLine();
    this.notifyChange();
  }

  /** 모든 face + edge 선택 (Ctrl+A) */
  selectEverything(faceMap: Uint32Array | null, edgeMap: Uint32Array | null) {
    this.selected.clear();
    this.selectedEdges.clear();

    if (faceMap) {
      for (let i = 0; i < faceMap.length; i++) {
        this.selected.add(faceMap[i]);
      }
    }
    if (edgeMap) {
      for (let i = 0; i < edgeMap.length; i++) {
        this.selectedEdges.add(edgeMap[i]);
      }
    }

    this.rebuildSelectionMesh();
    this.rebuildEdgeSelectionLine();
    this.notifyChange();
  }

  /** 동일요소 선택: 선택된 항목과 같은 유형(face/edge) 전체 선택 */
  selectSameType(faceMap: Uint32Array | null, edgeMap: Uint32Array | null) {
    const hasFaces = this.selected.size > 0;
    const hasEdges = this.selectedEdges.size > 0;

    if (hasFaces && faceMap) {
      // 모든 face 선택
      for (let i = 0; i < faceMap.length; i++) {
        this.selected.add(faceMap[i]);
      }
    }
    if (hasEdges && edgeMap) {
      // 모든 edge 선택
      for (let i = 0; i < edgeMap.length; i++) {
        this.selectedEdges.add(edgeMap[i]);
      }
    }

    // 아무것도 선택 안 된 상태면 전체 선택
    if (!hasFaces && !hasEdges) {
      this.selectEverything(faceMap, edgeMap);
      return;
    }

    this.rebuildSelectionMesh();
    this.rebuildEdgeSelectionLine();
    this.notifyChange();
  }

  /** 선택 전체 해제 */
  clearSelection() {
    this.clearXiaDots(); // XIA 도트 모드 해제
    if (this.selected.size === 0 && this.selectedEdges.size === 0) return;
    this.selected.clear();
    this.selectedEdges.clear();
    this.rebuildSelectionMesh();
    this.rebuildEdgeSelectionLine();
    this.notifyChange();
  }

  /** 프로그래밍적으로 face를 선택에 추가 (UI 이벤트 없이) */
  addFace(faceId: number): void {
    this.selected.add(faceId);
  }

  /** 프로그래밍적으로 여러 face를 선택 + 시각화 갱신 */
  selectFaces(faceIds: number[]): void {
    for (const fid of faceIds) this.selected.add(fid);
    this.rebuildSelectionMesh();
    this.notifyChange();
  }

  /** 현재 선택된 face ID 배열 */
  getSelectedFaces(): number[] {
    return Array.from(this.selected);
  }

  /** 곡면 그룹 반환 (외부 도구용 — PushPullTool 등) */
  getSmoothGroup(seedFaceId: number): number[] {
    return Array.from(this.findSmoothGroup(seedFaceId));
  }

  /** 선택된 face 수 */
  get selectionCount(): number {
    return this.selected.size;
  }

  /** 특정 face가 선택되었는지 */
  isSelected(faceId: number): boolean {
    return this.selected.has(faceId);
  }

  // ════════════════════════════════════════════════
  // 그룹 기능
  // ════════════════════════════════════════════════

  /** 현재 선택된 면들을 그룹으로 묶기 */
  groupSelected(): number | null {
    if (this.selected.size < 2) return null; // 2개 이상 면 필요

    // 기존 그룹에 속한 면들은 먼저 해제
    for (const fid of this.selected) {
      const oldGroup = this.faceToGroup.get(fid);
      if (oldGroup !== undefined) {
        const g = this.groups.get(oldGroup);
        if (g) {
          g.delete(fid);
          if (g.size === 0) this.groups.delete(oldGroup);
        }
      }
    }

    // 새 그룹 생성
    const gid = this.nextGroupId++;
    const faces = new Set(this.selected);
    this.groups.set(gid, faces);
    for (const fid of faces) {
      this.faceToGroup.set(fid, gid);
    }

    return gid;
  }

  /** 선택된 면이 속한 그룹 해제 */
  ungroupSelected(): boolean {
    const groupsToRemove = new Set<number>();
    for (const fid of this.selected) {
      const gid = this.faceToGroup.get(fid);
      if (gid !== undefined) groupsToRemove.add(gid);
    }

    if (groupsToRemove.size === 0) return false;

    for (const gid of groupsToRemove) {
      const faces = this.groups.get(gid);
      if (faces) {
        for (const fid of faces) {
          this.faceToGroup.delete(fid);
        }
        this.groups.delete(gid);
      }
    }
    return true;
  }

  /** face가 속한 그룹의 모든 면 반환 (그룹 없으면 null) */
  getGroupFaces(faceId: number): Set<number> | null {
    const gid = this.faceToGroup.get(faceId);
    if (gid === undefined) return null;
    return this.groups.get(gid) || null;
  }

  /** 그룹이 존재하는지 */
  hasGroup(faceId: number): boolean {
    return this.faceToGroup.has(faceId);
  }

  /** 그룹 ID 반환 */
  getGroupId(faceId: number): number | undefined {
    return this.faceToGroup.get(faceId);
  }

  /** 전체 그룹 목록 반환 */
  getAllGroups(): Map<number, Set<number>> {
    return new Map(this.groups);
  }

  /** 그룹 수 */
  get groupCount(): number {
    return this.groups.size;
  }

  // ════════════════════════════════════════════════
  // 그룹 편집 모드
  // ════════════════════════════════════════════════

  /** 그룹 편집 모드 진입 (더블클릭으로 그룹 내부 편집) */
  enterGroupEdit(groupId: number): boolean {
    const faces = this.groups.get(groupId);
    if (!faces || faces.size === 0) return false;

    this.editingGroupId = groupId;
    this.clearSelection();

    // 그룹 바운딩 박스 표시
    this.rebuildGroupBBox(faces);

    debugLog(`[SelectionManager] 그룹 편집 모드 진입: Group-${groupId}`);
    return true;
  }

  /** 그룹 편집 모드 종료 (ESC 또는 외부 클릭) */
  exitGroupEdit(): boolean {
    if (this.editingGroupId === null) return false;

    const gid = this.editingGroupId;
    this.editingGroupId = null;
    this.clearGroupBBox();

    debugLog(`[SelectionManager] 그룹 편집 모드 종료: Group-${gid}`);
    return true;
  }

  /** 현재 그룹 편집 모드인지 */
  isInGroupEditMode(): boolean {
    return this.editingGroupId !== null;
  }

  /** 현재 편집 중인 그룹 ID */
  getEditingGroupId(): number | null {
    return this.editingGroupId;
  }

  /** 그룹 편집 모드에서 클릭 처리 — 그룹 내부 face만 선택 가능 */
  handleGroupEditClick(faceId: number, shiftKey: boolean, ctrlKey: boolean): boolean {
    if (this.editingGroupId === null) return false;

    const groupFaces = this.groups.get(this.editingGroupId);
    if (!groupFaces) return false;

    // 그룹 외부 face 클릭 → 편집 모드 종료
    if (faceId >= 0 && !groupFaces.has(faceId)) {
      this.exitGroupEdit();
      return false;
    }

    // 빈 공간 클릭 → 그룹 내 선택 해제 (편집 모드는 유지)
    if (faceId < 0) {
      this.selected.clear();
      this.rebuildSelectionMesh();
      this.notifyChange();
      return true;
    }

    // 그룹 내부 face 선택
    this.handleClick(faceId, shiftKey, ctrlKey);
    return true;
  }

  /** 그룹 면 전체 선택 (그룹 단위 선택) */
  selectGroup(groupId: number) {
    const faces = this.groups.get(groupId);
    if (!faces) return;

    this.clearXiaDots();
    this.selected.clear();
    this.selectedEdges.clear();

    for (const fid of faces) {
      this.selected.add(fid);
    }

    // 그룹 경계 edge 추가
    if (this.edgeMap && this.edgeLines) {
      this.addBorderEdgesForFaces(faces);
    }

    this.isXiaSelected = true;
    this.rebuildSelectionMesh();
    this.rebuildEdgeSelectionLine();
    this.rebuildXiaDots();
    this.notifyChange();
  }

  /** 외부에서 그룹 데이터 동기화 (WASM에서 가져온 데이터로 업데이트) */
  syncGroupsFromWasm(groups: Array<{ id: number; faceIds: number[] }>) {
    this.groups.clear();
    this.faceToGroup.clear();

    for (const g of groups) {
      const faceSet = new Set(g.faceIds);
      this.groups.set(g.id, faceSet);
      for (const fid of g.faceIds) {
        this.faceToGroup.set(fid, g.id);
      }
    }

    // nextGroupId 갱신
    let maxId = 0;
    for (const g of groups) {
      if (g.id > maxId) maxId = g.id;
    }
    this.nextGroupId = maxId + 1;
  }

  // ── 그룹 바운딩 박스 시각화 ──

  private rebuildGroupBBox(faceIds: Set<number>) {
    this.clearGroupBBox();

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let tri = 0; tri < this.faceMap.length; tri++) {
      if (!faceIds.has(this.faceMap[tri])) continue;
      const base = tri * 3;
      if (base + 2 >= this.indices.length) continue;

      for (let j = 0; j < 3; j++) {
        const vi = this.indices[base + j];
        const x = this.positions[vi * 3];
        const y = this.positions[vi * 3 + 1];
        const z = this.positions[vi * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }

    if (!isFinite(minX)) return;

    const pad = 2.0;
    const x0 = minX - pad, y0 = minY - pad, z0 = minZ - pad;
    const x1 = maxX + pad, y1 = maxY + pad, z1 = maxZ + pad;

    const bboxVerts = new Float32Array([
      x0,y0,z0, x1,y0,z0,  x1,y0,z0, x1,y0,z1,
      x1,y0,z1, x0,y0,z1,  x0,y0,z1, x0,y0,z0,
      x0,y1,z0, x1,y1,z0,  x1,y1,z0, x1,y1,z1,
      x1,y1,z1, x0,y1,z1,  x0,y1,z1, x0,y1,z0,
      x0,y0,z0, x0,y1,z0,  x1,y0,z0, x1,y1,z0,
      x1,y0,z1, x1,y1,z1,  x0,y0,z1, x0,y1,z1,
    ]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(bboxVerts, 3));

    const mat = new THREE.LineDashedMaterial({
      color: 0xff9800,  // 오렌지 — 편집 모드 표시
      dashSize: 6,
      gapSize: 4,
      linewidth: 1,
      depthTest: false,
      depthWrite: false,
    });

    this.groupBBoxLines = new THREE.LineSegments(geo, mat);
    this.groupBBoxLines.name = 'group-edit-bbox';
    this.groupBBoxLines.computeLineDistances();
    this.groupBBoxLines.renderOrder = 998;
    this.highlightGroup.add(this.groupBBoxLines);
  }

  private clearGroupBBox() {
    if (this.groupBBoxLines) {
      this.highlightGroup.remove(this.groupBBoxLines);
      this.groupBBoxLines.geometry.dispose();
      (this.groupBBoxLines.material as THREE.Material).dispose();
      this.groupBBoxLines = null;
    }
  }

  // ════════════════════════════════════════════════
  // Hover
  // ════════════════════════════════════════════════

  /** 호버 업데이트 */
  setHover(faceId: number) {
    if (faceId === this.hovered) return;
    this.hovered = faceId;
    this.rebuildHoverMesh();
  }

  clearHover() {
    if (this.hovered < 0) return;
    this.hovered = -1;
    this.rebuildHoverMesh();
  }

  // ════════════════════════════════════════════════
  // 하이라이트 메시 빌드
  // ════════════════════════════════════════════════

  private rebuildSelectionMesh() {
    if (this.selectionMesh) {
      this.highlightGroup.remove(this.selectionMesh);
      this.selectionMesh.geometry.dispose();
      (this.selectionMesh.material as THREE.Material).dispose();
      this.selectionMesh = null;
    }
    if (this.selectionOutline) {
      this.highlightGroup.remove(this.selectionOutline);
      this.selectionOutline.geometry.dispose();
      (this.selectionOutline.material as THREE.Material).dispose();
      this.selectionOutline = null;
    }

    if (this.selected.size === 0) return;

    const geo = this.buildFaceGeometry(this.selected);
    if (!geo) return;

    // 반투명 오버레이
    const mat = new THREE.MeshBasicMaterial({
      color: SelectionManager.SELECT_COLOR,
      opacity: SelectionManager.SELECT_OPACITY,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.selectionMesh = new THREE.Mesh(geo, mat);
    this.selectionMesh.name = 'selection-overlay';
    this.highlightGroup.add(this.selectionMesh);

    // 윤곽선 (선택된 face의 경계 에지)
    const edgeGeo = this.buildBoundaryEdges(this.selected);
    if (edgeGeo) {
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x1565c0,
        linewidth: 2,
        depthTest: true,
      });
      this.selectionOutline = new THREE.LineSegments(edgeGeo, edgeMat);
      this.selectionOutline.name = 'selection-outline';
      this.selectionOutline.renderOrder = 2;
      this.highlightGroup.add(this.selectionOutline);
    }
  }

  private rebuildHoverMesh() {
    if (this.hoverMesh) {
      this.highlightGroup.remove(this.hoverMesh);
      this.hoverMesh.geometry.dispose();
      (this.hoverMesh.material as THREE.Material).dispose();
      this.hoverMesh = null;
    }
    if (this.hoverOutline) {
      this.highlightGroup.remove(this.hoverOutline);
      this.hoverOutline.geometry.dispose();
      (this.hoverOutline.material as THREE.Material).dispose();
      this.hoverOutline = null;
    }

    if (this.hovered < 0) return;
    // 이미 선택된 face는 hover 하이라이트 생략
    if (this.selected.has(this.hovered)) return;

    const faceSet = new Set([this.hovered]);
    const geo = this.buildFaceGeometry(faceSet);
    if (!geo) return;

    // 반투명 오버레이
    const mat = new THREE.MeshBasicMaterial({
      color: SelectionManager.HOVER_COLOR,
      opacity: SelectionManager.HOVER_OPACITY,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.hoverMesh = new THREE.Mesh(geo, mat);
    this.hoverMesh.name = 'hover-overlay';
    this.highlightGroup.add(this.hoverMesh);

    // 호버 윤곽선
    const edgeGeo = this.buildBoundaryEdges(faceSet);
    if (edgeGeo) {
      const edgeMat = new THREE.LineBasicMaterial({
        color: SelectionManager.HOVER_COLOR,
        linewidth: 1,
        depthTest: true,
      });
      this.hoverOutline = new THREE.LineSegments(edgeGeo, edgeMat);
      this.hoverOutline.name = 'hover-outline';
      this.hoverOutline.renderOrder = 2;
      this.highlightGroup.add(this.hoverOutline);
    }
  }

  /** faceId 집합에 해당하는 삼각형들로 BufferGeometry 생성 */
  private buildFaceGeometry(faceIds: Set<number>): THREE.BufferGeometry | null {
    if (this.positions.length === 0 || this.indices.length === 0) return null;

    const triIndices: number[] = [];

    for (let tri = 0; tri < this.faceMap.length; tri++) {
      if (faceIds.has(this.faceMap[tri])) {
        const base = tri * 3;
        if (base + 2 < this.indices.length) {
          triIndices.push(this.indices[base], this.indices[base + 1], this.indices[base + 2]);
        }
      }
    }

    if (triIndices.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array(this.positions), 3
    ));
    geo.setIndex(triIndices);
    return geo;
  }

  /** faceId 집합의 외곽 경계 에지를 LineSegments 용 BufferGeometry로 생성 */
  private buildBoundaryEdges(faceIds: Set<number>): THREE.BufferGeometry | null {
    if (this.positions.length === 0 || this.indices.length === 0) return null;

    // 에지 카운트: 선택된 face 내 삼각형들의 에지 중, 1번만 등장하는 에지 = 경계.
    // Position 기반 μm 양자화 키로 dedup (index 기반은 face 복제된 vertex에서 오류 유발).
    const posKey = (i: number) => {
      const x = Math.round(this.positions[i * 3] * 1000);
      const y = Math.round(this.positions[i * 3 + 1] * 1000);
      const z = Math.round(this.positions[i * 3 + 2] * 1000);
      return `${x},${y},${z}`;
    };
    const edgeKey = (a: number, b: number) => {
      const ka = posKey(a), kb = posKey(b);
      return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    };

    type EdgeRec = { a: number; b: number; keyA: string; keyB: string };
    const edgeEndpoints = new Map<string, EdgeRec>();
    const edgeHits = new Map<string, number>();

    for (let tri = 0; tri < this.faceMap.length; tri++) {
      if (!faceIds.has(this.faceMap[tri])) continue;
      const base = tri * 3;
      if (base + 2 >= this.indices.length) continue;

      const i0 = this.indices[base], i1 = this.indices[base + 1], i2 = this.indices[base + 2];
      const tris: [number, number][] = [[i0, i1], [i1, i2], [i2, i0]];

      for (const [a, b] of tris) {
        const key = edgeKey(a, b);
        if (!edgeEndpoints.has(key)) {
          edgeEndpoints.set(key, { a, b, keyA: posKey(a), keyB: posKey(b) });
        }
        edgeHits.set(key, (edgeHits.get(key) || 0) + 1);
      }
    }

    // 경계 에지 추출 (count == 1)
    const perimeter: EdgeRec[] = [];
    for (const [key, rec] of edgeEndpoints) {
      if ((edgeHits.get(key) || 0) === 1) perimeter.push(rec);
    }
    if (perimeter.length === 0) return null;

    // ── Chain 재구성 (position adjacency로 연속 edge 묶기) ──
    const adj = new Map<string, EdgeRec[]>();
    for (const e of perimeter) {
      (adj.get(e.keyA) ?? adj.set(e.keyA, []).get(e.keyA)!).push(e);
      (adj.get(e.keyB) ?? adj.set(e.keyB, []).get(e.keyB)!).push(e);
    }
    const visited = new Set<EdgeRec>();
    const chains: EdgeRec[][] = [];
    for (const start of perimeter) {
      if (visited.has(start)) continue;
      const chain: EdgeRec[] = [start];
      visited.add(start);
      let frontier = start.keyB;
      while (true) {
        const neighbors = adj.get(frontier) ?? [];
        const next = neighbors.find(e => !visited.has(e));
        if (!next) break;
        visited.add(next);
        chain.push(next);
        frontier = next.keyA === frontier ? next.keyB : next.keyA;
        if (frontier === start.keyA) break;
      }
      let back = start.keyA;
      while (true) {
        const neighbors = adj.get(back) ?? [];
        const prev = neighbors.find(e => !visited.has(e));
        if (!prev) break;
        visited.add(prev);
        chain.unshift(prev);
        back = prev.keyA === back ? prev.keyB : prev.keyA;
      }
      chains.push(chain);
    }

    const lineVerts: number[] = [];
    const AGGREGATE_MIN_EDGES = 8;
    const SMOOTH_SEGMENTS = 96; // 원형으로 감지된 체인은 이 해상도로 부드럽게 렌더

    for (const chain of chains) {
      const isClosed = chain.length > 1 &&
        (chain[0].keyA === chain[chain.length - 1].keyB ||
         chain[0].keyA === chain[chain.length - 1].keyA ||
         chain[0].keyB === chain[chain.length - 1].keyB ||
         chain[0].keyB === chain[chain.length - 1].keyA);

      // 체인의 모든 정점 수집 (position 기반, 중복 제거)
      const vertsMap = new Map<string, THREE.Vector3>();
      for (const e of chain) {
        if (!vertsMap.has(e.keyA)) {
          vertsMap.set(e.keyA, new THREE.Vector3(
            this.positions[e.a * 3], this.positions[e.a * 3 + 1], this.positions[e.a * 3 + 2]));
        }
        if (!vertsMap.has(e.keyB)) {
          vertsMap.set(e.keyB, new THREE.Vector3(
            this.positions[e.b * 3], this.positions[e.b * 3 + 1], this.positions[e.b * 3 + 2]));
        }
      }
      const verts = Array.from(vertsMap.values());

      // 원형 체인 감지 (닫힘 + 등거리 + 8+ 세그먼트)
      let isCircular = false;
      let center = new THREE.Vector3();
      let radius = 0;
      let planeNormal = new THREE.Vector3(0, 1, 0);

      if (isClosed && chain.length >= AGGREGATE_MIN_EDGES && verts.length >= AGGREGATE_MIN_EDGES) {
        for (const v of verts) center.add(v);
        center.divideScalar(verts.length);
        let sumR = 0;
        for (const v of verts) sumR += v.distanceTo(center);
        const avgR = sumR / verts.length;
        let maxDev = 0;
        for (const v of verts) {
          const d = Math.abs(v.distanceTo(center) - avgR);
          if (d > maxDev) maxDev = d;
        }
        if (maxDev < avgR * 0.01) {
          isCircular = true;
          radius = avgR;
          // 평면 법선: 두 반지름 벡터의 외적
          const r0 = verts[0].clone().sub(center).normalize();
          const r1 = verts[Math.floor(verts.length / 4)].clone().sub(center).normalize();
          planeNormal = r0.clone().cross(r1);
          if (planeNormal.lengthSq() < 1e-8) {
            planeNormal = new THREE.Vector3(0, 1, 0);
          } else {
            planeNormal.normalize();
          }
        }
      }

      if (isCircular) {
        // 부드러운 원 — SMOOTH_SEGMENTS 각도 분할로 LineSegments 방출
        // (시각적으로 하나의 연속된 원 곡선)
        const axis0 = verts[0].clone().sub(center).normalize();
        const axis1 = planeNormal.clone().cross(axis0).normalize();
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k < SMOOTH_SEGMENTS; k++) {
          const t = (2 * Math.PI * k) / SMOOTH_SEGMENTS;
          const p = center.clone()
            .add(axis0.clone().multiplyScalar(Math.cos(t) * radius))
            .add(axis1.clone().multiplyScalar(Math.sin(t) * radius));
          pts.push(p);
        }
        for (let k = 0; k < SMOOTH_SEGMENTS; k++) {
          const p = pts[k];
          const q = pts[(k + 1) % SMOOTH_SEGMENTS];
          lineVerts.push(p.x, p.y, p.z, q.x, q.y, q.z);
        }
      } else {
        // 원형이 아닌 체인: 원본 chord edge 그대로
        for (const e of chain) {
          lineVerts.push(
            this.positions[e.a * 3], this.positions[e.a * 3 + 1], this.positions[e.a * 3 + 2],
            this.positions[e.b * 3], this.positions[e.b * 3 + 1], this.positions[e.b * 3 + 2],
          );
        }
      }
    }

    if (lineVerts.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
    return geo;
  }

  // ════════════════════════════════════════════════
  // 곡면(Smooth) 그룹 탐색
  // ════════════════════════════════════════════════

  /**
   * 클릭된 면에서 시작하여, 인접 면의 법선 각도가 threshold 이내인
   * 모든 면을 BFS로 탐색하여 곡면 그룹을 반환합니다.
   * 원통 옆면, 구면 등을 하나의 곡면으로 인식합니다.
   * 직각 모서리(90°)는 넘지 않으므로 상자의 각 면은 개별 선택됩니다.
   */
  private findSmoothGroup(seedFaceId: number): Set<number> {
    // Lower bound: angle < SMOOTH_GROUP_ANGLE_DEG → merge into smooth group
    // Upper bound: angle > EXACT_COPLANAR_ANGLE_DEG → must NOT be split sibling
    // → 결합 조건: EXACT_COPLANAR < angle < SMOOTH_GROUP
    //   즉, dot in (COS_SMOOTH_GROUP, COS_EXACT_COPLANAR)
    // 자세한 상수 관계는 constants.ts / tolerances.rs 참조.
    const cosThreshold = COS_SMOOTH_GROUP;
    const EXACT_COPLANAR = COS_EXACT_COPLANAR;

    if (this.faceMap.length === 0 || this.positions.length === 0 || this.indices.length === 0) {
      return new Set([seedFaceId]);
    }

    // 1) faceId → 삼각형 인덱스 목록
    const faceTriangles = new Map<number, number[]>();
    for (let tri = 0; tri < this.faceMap.length; tri++) {
      const fid = this.faceMap[tri];
      let list = faceTriangles.get(fid);
      if (!list) { list = []; faceTriangles.set(fid, list); }
      list.push(tri);
    }

    // 2) faceId별 대표 법선 계산 (면적 가중 합산)
    const faceNormals = new Map<number, THREE.Vector3>();
    for (const [fid, tris] of faceTriangles) {
      let sx = 0, sy = 0, sz = 0;
      for (const t of tris) {
        const i0 = this.indices[t * 3], i1 = this.indices[t * 3 + 1], i2 = this.indices[t * 3 + 2];
        const ax = this.positions[i0 * 3], ay = this.positions[i0 * 3 + 1], az = this.positions[i0 * 3 + 2];
        const bx = this.positions[i1 * 3], by = this.positions[i1 * 3 + 1], bz = this.positions[i1 * 3 + 2];
        const cx = this.positions[i2 * 3], cy = this.positions[i2 * 3 + 1], cz = this.positions[i2 * 3 + 2];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        sx += e1y * e2z - e1z * e2y;
        sy += e1z * e2x - e1x * e2z;
        sz += e1x * e2y - e1y * e2x;
      }
      const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
      faceNormals.set(fid, len > 1e-10
        ? new THREE.Vector3(sx / len, sy / len, sz / len)
        : new THREE.Vector3(0, 1, 0));
    }

    // 3) 논리 정점 ID (양자화된 위치 기반, 부동소수점 오차 방지)
    //    정수 * 100 = 0.01mm 정밀도
    const posKey = (idx: number) => {
      const x = Math.round(this.positions[idx * 3] * 100);
      const y = Math.round(this.positions[idx * 3 + 1] * 100);
      const z = Math.round(this.positions[idx * 3 + 2] * 100);
      return `${x}_${y}_${z}`;
    };

    // 4) 논리 엣지 기반 인접 판단 (정렬된 정점 쌍)
    //    같은 엣지를 공유하는 faceId 쌍만 인접으로 판정
    //    → 대각선 정점만 공유하는 면은 인접이 아님 (정확성 ↑)
    const edgeToFaces = new Map<string, Set<number>>();
    const makeEdgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;

    for (const [fid, tris] of faceTriangles) {
      for (const t of tris) {
        const i0 = this.indices[t * 3], i1 = this.indices[t * 3 + 1], i2 = this.indices[t * 3 + 2];
        const k0 = posKey(i0), k1 = posKey(i1), k2 = posKey(i2);
        for (const [a, b] of [[k0, k1], [k1, k2], [k2, k0]]) {
          const key = makeEdgeKey(a as string, b as string);
          let set = edgeToFaces.get(key);
          if (!set) { set = new Set(); edgeToFaces.set(key, set); }
          set.add(fid);
        }
      }
    }

    // faceId → 인접 faceId 집합
    const adjacency = new Map<number, Set<number>>();
    for (const faces of edgeToFaces.values()) {
      if (faces.size < 2) continue;
      const arr = [...faces];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          let adj = adjacency.get(arr[i]);
          if (!adj) { adj = new Set(); adjacency.set(arr[i], adj); }
          adj.add(arr[j]);
          adj = adjacency.get(arr[j]);
          if (!adj) { adj = new Set(); adjacency.set(arr[j], adj); }
          adj.add(arr[i]);
        }
      }
    }

    debugLog(`[SmoothGroup] seed=${seedFaceId}, totalFaces=${faceTriangles.size}, adjacency entries=${adjacency.size}`);
    const seedAdj = adjacency.get(seedFaceId);
    debugLog(`[SmoothGroup] seed neighbors=${seedAdj ? seedAdj.size : 0}`);

    // 5) BFS: 인접 면의 법선 각도 < threshold이면 확장
    const group = new Set<number>([seedFaceId]);
    const queue = [seedFaceId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentNormal = faceNormals.get(current);
      if (!currentNormal) continue;

      const neighbors = adjacency.get(current);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (group.has(neighbor)) continue;
        const neighborNormal = faceNormals.get(neighbor);
        if (!neighborNormal) continue;

        // 인접 면과의 각도 체크 (current vs neighbor)
        // 조건: 각도 < 30° (smooth) AND 완전 코플래너 아님 (split sibling 제외)
        const dot = currentNormal.dot(neighborNormal);
        if (dot >= cosThreshold && dot < EXACT_COPLANAR) {
          group.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    debugLog(`[SmoothGroup] result: ${group.size} faces selected`);
    return group;
  }

  // ════════════════════════════════════════════════
  // 솔리드 연결 탐색 (BFS)
  // ════════════════════════════════════════════════

  /** seedFaceId에서 출발, DCEL 위상(topology)으로 연결된 모든 face를 탐색.
   *  Rust WASM 엔진의 half-edge radial traversal을 사용하므로
   *  좌표 비교 없이 순수 위상 구조만으로 정확한 연결 판정.
   *  → 서로 다른 Volume은 DCEL edge를 공유하지 않으므로 확실히 분리.
   */
  private findConnectedFaces(seedFaceId: number): Set<number> {
    // ① WASM DCEL 토폴로지 사용 (최우선)
    if (this.bridge) {
      const connected = this.bridge.getConnectedFaces(seedFaceId);
      if (connected.length > 0) {
        debugLog('[Selection] DCEL connected faces:', connected.length, 'from seed:', seedFaceId);
        return new Set(connected);
      }
    }

    // ② Fallback: faceMap만 있으면 seed face만 반환 (안전한 최소 동작)
    debugWarn('[Selection] No DCEL bridge — returning seed face only');
    return new Set([seedFaceId]);
  }

  // ════════════════════════════════════════════════
  // Edge 하이라이트 렌더링
  // ════════════════════════════════════════════════

  private rebuildEdgeSelectionLine() {
    if (this.edgeSelectionLine) {
      this.highlightGroup.remove(this.edgeSelectionLine);
      this.edgeSelectionLine.geometry.dispose();
      (this.edgeSelectionLine.material as THREE.Material).dispose();
      this.edgeSelectionLine = null;
    }

    if (this.selectedEdges.size === 0 || !this.edgeLines || !this.edgeMap) return;

    const verts: number[] = [];
    for (let i = 0; i < this.edgeMap.length; i++) {
      if (this.selectedEdges.has(this.edgeMap[i])) {
        const base = i * 6;
        if (base + 5 < this.edgeLines.length) {
          verts.push(
            this.edgeLines[base], this.edgeLines[base+1], this.edgeLines[base+2],
            this.edgeLines[base+3], this.edgeLines[base+4], this.edgeLines[base+5],
          );
        }
      }
    }

    if (verts.length === 0) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: SelectionManager.EDGE_SELECT_COLOR,  // 오렌지 — face 선택(파랑)과 구분
      linewidth: 3,  // 대부분 브라우저가 clamp(1)하지만 지원 시 굵게
      depthTest: false,
    });
    this.edgeSelectionLine = new THREE.LineSegments(geo, mat);
    this.edgeSelectionLine.renderOrder = 999;
    this.highlightGroup.add(this.edgeSelectionLine);
  }

  private rebuildEdgeHoverLine() {
    if (this.edgeHoverLine) {
      this.highlightGroup.remove(this.edgeHoverLine);
      this.edgeHoverLine.geometry.dispose();
      (this.edgeHoverLine.material as THREE.Material).dispose();
      this.edgeHoverLine = null;
    }

    if (this.hoveredEdgeSegIndex < 0 || !this.edgeLines) return;

    const base = this.hoveredEdgeSegIndex * 6;
    if (base + 5 >= this.edgeLines.length) return;

    // 이미 선택된 edge는 hover 표시 생략
    if (this.edgeMap && this.selectedEdges.has(this.edgeMap[this.hoveredEdgeSegIndex])) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      this.edgeLines[base], this.edgeLines[base+1], this.edgeLines[base+2],
      this.edgeLines[base+3], this.edgeLines[base+4], this.edgeLines[base+5],
    ], 3));
    const mat = new THREE.LineBasicMaterial({
      color: SelectionManager.HOVER_COLOR,
      linewidth: 2,
      depthTest: false,
    });
    this.edgeHoverLine = new THREE.Line(geo, mat);
    this.edgeHoverLine.renderOrder = 998;
    this.highlightGroup.add(this.edgeHoverLine);
  }

  // ════════════════════════════════════════════════
  // XIA 도트 표시 (스케치업 스타일 트리플클릭)
  // ════════════════════════════════════════════════

  /** XIA 전체 선택 시: 정점 도트 + 점선 바운딩 박스 표시 */
  private rebuildXiaDots() {
    // 기존 도트/박스만 제거 (isXiaSelected 플래그는 유지)
    this.removeXiaVisuals();
    if (!this.isXiaSelected || this.selected.size === 0) return;

    // 1) 선택된 face의 고유 꼭짓점(코너) 좌표 수집
    //    Push/Pull은 면별 독립 정점을 사용하므로 좌표 기반 중복 제거 필요
    const PREC = 1; // mm 정밀도
    const uniqueVerts = new Map<string, [number, number, number]>();
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let tri = 0; tri < this.faceMap.length; tri++) {
      if (!this.selected.has(this.faceMap[tri])) continue;
      const base = tri * 3;
      if (base + 2 >= this.indices.length) continue;

      for (let j = 0; j < 3; j++) {
        const vi = this.indices[base + j];
        const x = this.positions[vi * 3];
        const y = this.positions[vi * 3 + 1];
        const z = this.positions[vi * 3 + 2];
        const key = `${x.toFixed(PREC)},${y.toFixed(PREC)},${z.toFixed(PREC)}`;

        if (!uniqueVerts.has(key)) {
          uniqueVerts.set(key, [x, y, z]);
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
      }
    }

    if (uniqueVerts.size === 0) return;

    // 고유 꼭짓점 좌표 배열 생성
    const dotVerts: number[] = [];
    for (const [, [x, y, z]] of uniqueVerts) {
      dotVerts.push(x, y, z);
    }

    // 2) 꼭짓점 도트 (Points) — 스케치업 스타일 파란 점
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dotVerts, 3));

    const dotMat = new THREE.PointsMaterial({
      color: 0x4285f4,          // 스케치업 블루
      size: 7,
      sizeAttenuation: false,
      depthTest: false,         // 항상 보이도록
      depthWrite: false,
    });
    this.xiaDotPoints = new THREE.Points(dotGeo, dotMat);
    this.xiaDotPoints.name = 'xia-dot-points';
    this.xiaDotPoints.renderOrder = 999;
    this.highlightGroup.add(this.xiaDotPoints);

    // 3) 점선 바운딩 박스 — 스케치업 스타일
    const pad = 1.0; // 약간의 여유
    const x0 = minX - pad, y0 = minY - pad, z0 = minZ - pad;
    const x1 = maxX + pad, y1 = maxY + pad, z1 = maxZ + pad;

    // 12개 edge of a box
    const bboxVerts = new Float32Array([
      // bottom face
      x0,y0,z0, x1,y0,z0,
      x1,y0,z0, x1,y0,z1,
      x1,y0,z1, x0,y0,z1,
      x0,y0,z1, x0,y0,z0,
      // top face
      x0,y1,z0, x1,y1,z0,
      x1,y1,z0, x1,y1,z1,
      x1,y1,z1, x0,y1,z1,
      x0,y1,z1, x0,y1,z0,
      // vertical pillars
      x0,y0,z0, x0,y1,z0,
      x1,y0,z0, x1,y1,z0,
      x1,y0,z1, x1,y1,z1,
      x0,y0,z1, x0,y1,z1,
    ]);

    const bboxGeo = new THREE.BufferGeometry();
    bboxGeo.setAttribute('position', new THREE.BufferAttribute(bboxVerts, 3));

    const bboxMat = new THREE.LineDashedMaterial({
      color: 0x4285f4,          // 스케치업 블루
      dashSize: 4,
      gapSize: 3,
      linewidth: 1,
      depthTest: false,
      depthWrite: false,
    });
    this.xiaBBoxLines = new THREE.LineSegments(bboxGeo, bboxMat);
    this.xiaBBoxLines.name = 'xia-bbox-dashed';
    this.xiaBBoxLines.computeLineDistances(); // 점선 렌더링에 필수
    this.xiaBBoxLines.renderOrder = 999;
    this.highlightGroup.add(this.xiaBBoxLines);
  }

  /** XIA 도트 + 바운딩 박스 시각 요소만 제거 (플래그 유지) */
  private removeXiaVisuals() {
    if (this.xiaDotPoints) {
      this.highlightGroup.remove(this.xiaDotPoints);
      this.xiaDotPoints.geometry.dispose();
      (this.xiaDotPoints.material as THREE.Material).dispose();
      this.xiaDotPoints = null;
    }
    if (this.xiaBBoxLines) {
      this.highlightGroup.remove(this.xiaBBoxLines);
      this.xiaBBoxLines.geometry.dispose();
      (this.xiaBBoxLines.material as THREE.Material).dispose();
      this.xiaBBoxLines = null;
    }
  }

  /** XIA 도트 모드 완전 해제 (플래그 + 시각 요소 모두 제거) */
  private clearXiaDots() {
    this.isXiaSelected = false;
    this.removeXiaVisuals();
  }

  private notifyChange() {
    const faces = this.getSelectedFaces();
    for (const cb of this.selectionChangeListeners) {
      cb(faces);
    }
  }

  /** 정리 */
  dispose() {
    this.clearXiaDots();
    this.highlightGroup.parent?.remove(this.highlightGroup);
  }
}
