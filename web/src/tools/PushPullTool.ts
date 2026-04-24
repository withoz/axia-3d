/**
 * Push/Pull Tool — SketchUp style extrude (click → move → click)
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog, debugWarn } from '../utils/debug';
import { Toast } from '../ui/Toast';

export class PushPullTool implements ITool {
  readonly name = 'pushpull';

  private ctx: ToolContext;
  private ppFaceId: number = -1;
  private ppStartX: number = 0;
  private ppStartY: number = 0;
  private ppActive: boolean = false;
  private ppNormal: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private ppGhost: THREE.Group | null = null;
  private ppHitPoint: THREE.Vector3 = new THREE.Vector3();
  private ppFaceVerts: THREE.Vector3[] = [];
  /** smooth group 전체의 face별 boundary (고스트 프리뷰에서 모든 면 표시용) */
  private ppAllFaceVerts: THREE.Vector3[][] = [];
  private lastPPDist: number = 0;
  /** align-to-geometry 발동 시 저장되는 현재 드래그 거리 (Phase 2 클릭 commit용) */
  private currentDragDist: number = 0;

  /** 최소 유효 거리 (mm) — 이보다 작으면 무시 (프리뷰 확정용 threshold) */
  private static readonly MIN_COMMIT_DIST = 0.5;

  // ═══ 곡면 그룹 Push/Pull ═══
  private smoothGroupFaces: number[] = [];  // 곡면 그룹의 모든 faceId
  private isSmoothGroup: boolean = false;   // 곡면 그룹 모드 여부

  // ═══ Pooled/reusable objects (avoid GC pressure in hot paths) ═══
  private static readonly _mouse = new THREE.Vector2();
  private static readonly _ray = new THREE.Raycaster();
  private static readonly _camRight = new THREE.Vector3();
  private static readonly _camUp = new THREE.Vector3();
  private static readonly _planeNormal = new THREE.Vector3();
  private static readonly _intersection = new THREE.Vector3();
  private static readonly _plane = new THREE.Plane();
  private static readonly _mouseNdc = new THREE.Vector2();
  private static readonly _projTmp = new THREE.Vector3();

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[PushPullTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, _point: THREE.Vector3 | null): void {
    if (!this.ppActive) {
      // Phase 1: select face (first click)
      const hit = this.ctx.viewport.pick(e.clientX, e.clientY);
      let rustFaceId = -1;
      let hitPoint: THREE.Vector3 | null = null;

      if (hit && hit.faceIndex != null && hit.faceIndex >= 0) {
        rustFaceId = this.ctx.getFaceId(hit.faceIndex);
        hitPoint = hit.point ? hit.point.clone() : null;
      }

      // Fallback to already-selected face
      if (rustFaceId < 0) {
        const selected = this.ctx.getSelectedFaces();
        if (selected.length === 1) {
          rustFaceId = selected[0];
          const centroid = this.ctx.bridge.facesCentroid(selected);
          if (centroid) hitPoint = centroid;
        }
      }

      if (rustFaceId >= 0 && hitPoint) {
        // ── Bug E fix: 법선이 degenerate면 Push/Pull 시작 거부 ──
        const normalArr = this.ctx.bridge.getFaceNormal(rustFaceId);
        if (!normalArr ||
            (normalArr[0] === 0 && normalArr[1] === 0 && normalArr[2] === 0)) {
          debugWarn('[PP] Invalid face normal for faceId=', rustFaceId);
          Toast.error('이 면의 법선을 계산할 수 없습니다 (degenerate)');
          return;
        }
        this.ppNormal = new THREE.Vector3(normalArr[0], normalArr[1], normalArr[2]);

        this.ppFaceId = rustFaceId;
        this.ppStartX = e.clientX;
        this.ppStartY = e.clientY;
        this.ppActive = true;

        // ── Bug D fix: 사용자가 이미 여러 면을 선택했으면 그 선택을 존중 ──
        // 단, 모든 선택면이 클릭한 면과 같은 smooth group일 때만 그룹 Push/Pull로 간주.
        // 그렇지 않으면 단일 면 Push/Pull (seed만).
        const manualSelected = this.ctx.getSelectedFaces();
        if (manualSelected.length > 1 && manualSelected.includes(rustFaceId)) {
          this.smoothGroupFaces = [...manualSelected];
          this.isSmoothGroup = true;
          debugLog('[PP] Phase 1: using manual selection of', manualSelected.length, 'faces');
        } else {
          // 자동 smooth group 감지 (법선 각도 기반)
          this.smoothGroupFaces = this.ctx.selection.getSmoothGroup(rustFaceId);
          this.isSmoothGroup = this.smoothGroupFaces.length > 1;
        }

        this.ppHitPoint = hitPoint;
        this.createPPGhost(rustFaceId, hitPoint);

        // ── Bug G fix: smooth group은 전체 face 선택 표시 (seed만 X) ──
        if (this.isSmoothGroup) {
          this.ctx.selection.selectFaces(this.smoothGroupFaces);
        } else {
          this.ctx.selection.handleClick(rustFaceId, false, false);
        }

        if (this.isSmoothGroup) {
          debugLog('[PP] Phase 1: SMOOTH GROUP selected,', this.smoothGroupFaces.length, 'faces, seed=', rustFaceId);
        } else {
          debugLog('[PP] Phase 1: face selected, faceId=', rustFaceId,
            'normal=', this.ppNormal.toArray().map(v => v.toFixed(3)));
        }
      }
    } else {
      // Phase 2: confirm distance (second click)
      // align 스냅이 발동됐다면 currentDragDist가 그 값을 담고 있음
      const dist = this.currentDragDist !== 0 ? this.currentDragDist : this.ppRayDist(e);
      debugLog('[PP] Phase 2: confirm dist=', dist.toFixed(2));

      if (Math.abs(dist) >= PushPullTool.MIN_COMMIT_DIST) {
        this.commitPushPull(dist);
      } else if (Math.abs(dist) > 0.001) {
        // Bug C fix: 0 < |dist| < 0.5mm 일 때 조용히 실패하지 않고 피드백
        Toast.warning(`Push/Pull 거리가 너무 짧습니다 (최소 ${PushPullTool.MIN_COMMIT_DIST}mm)`, 2500);
      }
      this.cleanup();
    }
  }

  onMouseMove(e: MouseEvent, _point: THREE.Vector3 | null): void {
    if (!this.ppActive || !this.ppGhost) return;

    let dist = this.ppRayDist(e);
    let isAligned = false;
    let alignedTargetType: 'vertex' | 'edge' | 'face' | null = null;

    // ── Align-to-geometry (v1): 단일 면만 지원, smooth group은 비활성 ──
    if (!this.isSmoothGroup) {
      const aligned = this.ctx.snap.findAlignedDistance(
        e.clientX, e.clientY,
        this.ctx.viewport.activeCamera,
        this.ctx.viewport.renderer.domElement,
        this.ppFaceId,
        this.ppHitPoint,
        this.ppNormal,
      );
      if (aligned) {
        dist = aligned.dist;
        isAligned = true;
        alignedTargetType = aligned.targetType;
        // 타겟에 snap marker 표시
        const s = aligned.target.clone().project(this.ctx.viewport.activeCamera);
        const rect = this.ctx.viewport.renderer.domElement.getBoundingClientRect();
        const screenPos = new THREE.Vector2(
          (s.x * 0.5 + 0.5) * rect.width + rect.left,
          (-s.y * 0.5 + 0.5) * rect.height + rect.top,
        );
        const markerType = aligned.targetType === 'vertex' ? 'endpoint'
                         : aligned.targetType === 'edge' ? 'nearest'
                         : 'onFace';
        this.ctx.snapVisual.update({
          type: markerType,
          position: aligned.target,
          screenPos,
        }, this.ctx.viewport.activeCamera);
      } else {
        this.ctx.snapVisual.clear();
      }
    }

    this.currentDragDist = dist;
    this.updatePPGhost(dist);

    // Show dimension
    if (this.ppFaceVerts.length >= 2 && Math.abs(dist) > 0.001) {
      const absDist = Math.abs(dist);
      const sign = dist >= 0 ? '' : '-';
      const alignPrefix = isAligned ? (alignedTargetType === 'face' ? '⊡ ' : alignedTargetType === 'edge' ? '／ ' : '■ ') : '';
      const text = alignPrefix + sign + this.ctx.units.format(absDist);
      const labelColor = isAligned ? '#66ff99' : '#ffd43b';
      // 저장: dim label 렌더에서 사용하도록
      const _labelColor = labelColor; void _labelColor;
      const offset = this.ppNormal.clone().multiplyScalar(dist);

      // Find closest vertex to mouse
      const canvasRect = this.ctx.viewport.renderer.domElement.getBoundingClientRect();
      const mouseNdc = PushPullTool._mouseNdc;
      mouseNdc.set(
        ((e.clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
        -((e.clientY - canvasRect.top) / canvasRect.height) * 2 + 1,
      );
      let bestIdx = 0;
      let bestScreenDist = Infinity;
      const projTmp = PushPullTool._projTmp;
      for (let i = 0; i < this.ppFaceVerts.length; i++) {
        projTmp.copy(this.ppFaceVerts[i]).project(this.ctx.viewport.activeCamera);
        const dx = projTmp.x - mouseNdc.x;
        const dy = projTmp.y - mouseNdc.y;
        const sd = Math.sqrt(dx * dx + dy * dy);
        if (sd < bestScreenDist) {
          bestScreenDist = sd;
          bestIdx = i;
        }
      }

      const edgeFrom = this.ppFaceVerts[bestIdx].clone();
      const edgeTo = edgeFrom.clone().add(offset);

      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: edgeFrom, to: edgeTo, text, color: isAligned ? '#66ff99' : '#ffd43b' },
      ]);
    } else {
      this.ctx.dimLabel.clear();
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  applyVCBValue(value: number): void {
    // Bug B fix: VCB 입력도 drag 경로와 동일하게 commitPushPull 사용
    // (곡면 그룹은 seamless, 단일 면은 pushPull, 둘 다 fallback 포함)
    if (this.ppFaceId < 0 && !this.isSmoothGroup) {
      // ppActive 진입 전 VCB 입력: 선택된 면으로 seed
      const sel = this.ctx.getSelectedFaces();
      if (sel.length >= 1) {
        this.ppFaceId = sel[0];
      }
    }
    if (this.ppFaceId >= 0 || this.isSmoothGroup) {
      this.commitPushPull(value);
    }
    this.cleanup();
  }

  /**
   * Push/Pull 커밋 — drag / VCB 공통 경로
   * - 곡면 그룹: seamless 우선, 실패/미지원 시 per-face fallback (Bug F)
   * - 단일 면: pushPull
   */
  private commitPushPull(dist: number): void {
    if (this.isSmoothGroup && this.smoothGroupFaces.length > 1) {
      const faceArray = new Uint32Array(this.smoothGroupFaces);
      const seamlessFn = this.ctx.bridge.engine?.push_pull_smooth_group_seamless;
      let ok = false;
      if (typeof seamlessFn === 'function') {
        ok = seamlessFn.call(this.ctx.bridge.engine, faceArray, dist) ?? false;
      }
      debugLog('[PP] Smooth group seamless:', ok ? 'OK' : 'FAILED/UNAVAILABLE',
        'faces=', this.smoothGroupFaces.length, 'dist=', dist.toFixed(2));

      if (ok) {
        this.lastPPDist = dist;
        this.ctx.syncMesh();
        return;
      }

      // Bug F fix: seamless 미지원 또는 실패 → per-face fallback
      let successCount = 0;
      for (const fid of this.smoothGroupFaces) {
        if (this.ctx.bridge.pushPull(fid, dist)) successCount++;
      }
      if (successCount > 0) {
        debugLog('[PP] Fallback per-face:', successCount, '/', this.smoothGroupFaces.length);
        this.lastPPDist = dist;
        this.ctx.syncMesh();
      } else {
        const err = this.ctx.bridge.lastError();
        Toast.error(err ? `곡면 Push/Pull 실패: ${err}` : 'Push/Pull이 실행되지 않았습니다', 3500);
      }
    } else {
      const faceId = this.ppFaceId >= 0 ? this.ppFaceId : this.ctx.getSelectedFaces()[0];
      if (faceId < 0) return;
      const success = this.ctx.bridge.pushPull(faceId, dist);
      debugLog('[PP] pushPull result=', success, 'dist=', dist.toFixed(2));
      if (success) {
        this.lastPPDist = dist;
        this.ctx.syncMesh();
      } else {
        const err = this.ctx.bridge.lastError();
        Toast.error(err ? `Push/Pull 실패: ${err}` : 'Push/Pull이 실행되지 않았습니다', 3500);
      }
    }
  }

  isBusy(): boolean {
    return this.ppActive;
  }

  cleanup(): void {
    this.ppActive = false;
    this.ppFaceId = -1;
    this.smoothGroupFaces = [];
    this.isSmoothGroup = false;
    this.currentDragDist = 0;
    this.removePPGhost();
    this.ctx.selection.clearSelection();
    this.ctx.dimLabel.clear();
    this.ctx.snapVisual.clear();
  }

  private createPPGhost(faceId: number, _hitPoint: THREE.Vector3): void {
    this.removePPGhost();
    this.ppFaceVerts = this.ctx.extractFaceBoundary(faceId);
    if (this.ppFaceVerts.length < 3) return;

    // Bug A fix: smooth group 전체의 boundary 수집
    // (seed 외의 면은 ghost에 포함되지만 치수 라벨 anchor는 seed 유지)
    if (this.isSmoothGroup && this.smoothGroupFaces.length > 1) {
      this.ppAllFaceVerts = this.smoothGroupFaces
        .map(fid => this.ctx.extractFaceBoundary(fid))
        .filter(v => v.length >= 3);
    } else {
      this.ppAllFaceVerts = [this.ppFaceVerts];
    }

    this.ppGhost = new THREE.Group();
    this.ppGhost.renderOrder = 999;
    this.ctx.viewport.scene.add(this.ppGhost);
    this.rebuildPPGhost(0);
  }

  private rebuildPPGhost(dist: number): void {
    if (!this.ppGhost || this.ppFaceVerts.length < 3) return;

    while (this.ppGhost.children.length > 0) {
      const child = this.ppGhost.children[0];
      this.ppGhost.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }

    if (Math.abs(dist) < 0.001) return;

    const offset = this.ppNormal.clone().multiplyScalar(dist);

    // Bug A fix: smooth group의 모든 face 각각 ghost로 렌더
    // (단일 면일 때는 ppAllFaceVerts.length === 1)
    const allLinePositions: number[] = [];

    for (const verts of this.ppAllFaceVerts) {
      if (verts.length < 3) continue;
      const offsetVerts = verts.map(v => v.clone().add(offset));
      const n = verts.length;

      // Top face (per-face BufferGeometry, fan triangulation)
      const topGeo = new THREE.BufferGeometry();
      topGeo.setAttribute('position', new THREE.BufferAttribute(
        new Float32Array(offsetVerts.flatMap(v => [v.x, v.y, v.z])), 3));
      const localIdx: number[] = [];
      for (let i = 1; i < n - 1; i++) localIdx.push(0, i, i + 1);
      topGeo.setIndex(localIdx);
      topGeo.computeVertexNormals();
      const topMesh = new THREE.Mesh(topGeo, new THREE.MeshBasicMaterial({
        color: 0x5b9bd5, side: THREE.FrontSide,
        transparent: true, opacity: 0.3,
        depthWrite: false,
      }));
      topMesh.renderOrder = 999;
      this.ppGhost.add(topMesh);

      // Wall quads per boundary edge
      const wallGeo = new THREE.BufferGeometry();
      const wallPos: number[] = [];
      const wallIdx: number[] = [];
      let wi = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = verts[i], b = verts[j], c = offsetVerts[j], d = offsetVerts[i];
        wallPos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
        wallIdx.push(wi, wi + 1, wi + 2, wi, wi + 2, wi + 3);
        wi += 4;
      }
      wallGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wallPos), 3));
      wallGeo.setIndex(wallIdx);
      wallGeo.computeVertexNormals();
      const wallMesh = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({
        color: 0x5b9bd5, side: THREE.FrontSide,
        transparent: true, opacity: 0.2,
        depthWrite: false,
      }));
      wallMesh.renderOrder = 998;
      this.ppGhost.add(wallMesh);

      // Boundary lines (top + vertical)
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        allLinePositions.push(offsetVerts[i].x, offsetVerts[i].y, offsetVerts[i].z);
        allLinePositions.push(offsetVerts[j].x, offsetVerts[j].y, offsetVerts[j].z);
      }
      for (let i = 0; i < n; i++) {
        allLinePositions.push(verts[i].x, verts[i].y, verts[i].z);
        allLinePositions.push(offsetVerts[i].x, offsetVerts[i].y, offsetVerts[i].z);
      }
    }

    // 모든 face의 outline을 통합된 LineSegments 하나로
    if (allLinePositions.length > 0) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(
        new Float32Array(allLinePositions), 3));
      const lineSegs = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
        color: 0x2a6cb8, depthTest: false,
      }));
      lineSegs.renderOrder = 1000;
      this.ppGhost.add(lineSegs);
    }
  }

  private updatePPGhost(dist: number): void {
    this.rebuildPPGhost(dist);
  }

  private removePPGhost(): void {
    if (this.ppGhost) {
      while (this.ppGhost.children.length > 0) {
        const child = this.ppGhost.children[0];
        this.ppGhost.remove(child);
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      }
      this.ctx.viewport.scene.remove(this.ppGhost);
      this.ppGhost = null;
    }
    this.ppFaceVerts = [];
  }

  private ppRayDist(e: MouseEvent): number {
    const canvas = this.ctx.viewport.renderer.domElement;
    const rect = canvas.getBoundingClientRect();

    // Reuse pooled objects to avoid GC pressure
    const mouse = PushPullTool._mouse;
    mouse.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = PushPullTool._ray;
    ray.setFromCamera(mouse, this.ctx.viewport.activeCamera);

    const camRight = PushPullTool._camRight;
    camRight.setFromMatrixColumn(this.ctx.viewport.activeCamera.matrixWorld, 0).normalize();

    const planeNormal = PushPullTool._planeNormal;
    planeNormal.crossVectors(this.ppNormal, camRight).normalize();
    if (planeNormal.length() < 0.001) {
      const camUp = PushPullTool._camUp;
      camUp.setFromMatrixColumn(this.ctx.viewport.activeCamera.matrixWorld, 1).normalize();
      planeNormal.crossVectors(this.ppNormal, camUp).normalize();
    }

    const plane = PushPullTool._plane;
    plane.setFromNormalAndCoplanarPoint(planeNormal, this.ppHitPoint);
    const intersection = PushPullTool._intersection;
    const hit = ray.ray.intersectPlane(plane, intersection);

    if (!hit) return 0;

    const diff = intersection.sub(this.ppHitPoint);
    return diff.dot(this.ppNormal);
  }
}
