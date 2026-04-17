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
  private ppScreenDir: THREE.Vector2 = new THREE.Vector2(0, -1);
  private ppGhost: THREE.Group | null = null;
  private ppHitPoint: THREE.Vector3 = new THREE.Vector3();
  private ppFaceVerts: THREE.Vector3[] = [];
  private lastPPDist: number = 0;

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

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
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
        this.ppFaceId = rustFaceId;
        this.ppStartX = e.clientX;
        this.ppStartY = e.clientY;
        this.ppActive = true;

        // 곡면 그룹 감지
        this.smoothGroupFaces = this.ctx.selection.getSmoothGroup(rustFaceId);
        this.isSmoothGroup = this.smoothGroupFaces.length > 1;

        const normal = this.ctx.bridge.getFaceNormal(rustFaceId);
        if (!normal || (normal[0] === 0 && normal[1] === 0 && normal[2] === 0)) {
          debugWarn('[PP] Invalid face normal for faceId=', rustFaceId);
          this.ppNormal = new THREE.Vector3(0, 1, 0);
        } else {
          this.ppNormal = new THREE.Vector3(normal[0], normal[1], normal[2]);
        }

        // Project normal direction to screen space
        const pA = hitPoint.clone().project(this.ctx.viewport.activeCamera);
        const pB = hitPoint.clone().add(this.ppNormal.clone().multiplyScalar(1000)).project(this.ctx.viewport.activeCamera);
        this.ppScreenDir = new THREE.Vector2(pB.x - pA.x, pB.y - pA.y);
        if (this.ppScreenDir.length() > 0.0001) {
          this.ppScreenDir.normalize();
        } else {
          this.ppScreenDir.set(0, -1);
        }

        this.ppHitPoint = hitPoint;
        this.createPPGhost(rustFaceId, hitPoint);
        this.ctx.selection.handleClick(rustFaceId, false, false);

        if (this.isSmoothGroup) {
          debugLog('[PP] Phase 1: SMOOTH GROUP selected,', this.smoothGroupFaces.length, 'faces, seed=', rustFaceId);
        } else {
          debugLog('[PP] Phase 1: face selected, faceId=', rustFaceId,
            'normal=', this.ppNormal.toArray().map(v => v.toFixed(3)));
        }
      }
    } else {
      // Phase 2: confirm distance (second click)
      const dist = this.ppRayDist(e);
      debugLog('[PP] Phase 2: confirm dist=', dist.toFixed(2));

      if (Math.abs(dist) > 0.5) {
        if (this.isSmoothGroup && this.smoothGroupFaces.length > 1) {
          // 곡면 그룹: Seamless offset (Rhino 스타일, 갭 없이 wall face 생성)
          const faceArray = new Uint32Array(this.smoothGroupFaces);
          const ok = this.ctx.bridge.engine?.push_pull_smooth_group_seamless?.(faceArray, dist) ?? false;

          debugLog('[PP] Smooth group seamless offset:', ok ? 'OK' : 'FAILED',
            'faces=', this.smoothGroupFaces.length, 'dist=', dist.toFixed(2));

          if (ok) {
            this.lastPPDist = dist;
            this.ctx.syncMesh();
          } else {
            const err = this.ctx.bridge.lastError();
            if (err) {
              Toast.error(`곡면 Push/Pull 실패: ${err}`, 3500);
            }
          }
        } else {
          // 단일 면 push/pull
          const success = this.ctx.bridge.pushPull(this.ppFaceId, dist);
          debugLog('[PP] pushPull result=', success, 'dist=', dist.toFixed(2));
          if (success) {
            this.lastPPDist = dist;
            this.ctx.syncMesh();
          } else {
            // ADR-003: degenerate 거부 등 실패 사유를 사용자에게 피드백
            const err = this.ctx.bridge.lastError();
            if (err) {
              Toast.error(`Push/Pull 실패: ${err}`, 3500);
            } else {
              Toast.warning('Push/Pull이 실행되지 않았습니다', 2500);
            }
          }
        }
      }
      this.cleanup();
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.ppActive || !this.ppGhost) return;

    const dist = this.ppRayDist(e);
    this.updatePPGhost(dist);

    // Show dimension
    if (this.ppFaceVerts.length >= 2 && Math.abs(dist) > 0.001) {
      const absDist = Math.abs(dist);
      const sign = dist >= 0 ? '' : '-';
      const text = sign + this.ctx.units.format(absDist);
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
        { from: edgeFrom, to: edgeTo, text, color: '#ffd43b' },
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
    if (this.isSmoothGroup && this.smoothGroupFaces.length > 1) {
      // 곡면 그룹 VCB 입력
      let successCount = 0;
      for (const fid of this.smoothGroupFaces) {
        if (this.ctx.bridge.pushPull(fid, value)) successCount++;
      }
      if (successCount > 0) {
        this.lastPPDist = value;
        this.ctx.syncMesh();
      }
    } else {
      const faceId = this.ppFaceId >= 0 ? this.ppFaceId : this.ctx.getSelectedFaces()[0];
      if (faceId >= 0) {
        const success = this.ctx.bridge.pushPull(faceId, value);
        if (success) {
          this.lastPPDist = value;
          this.ctx.syncMesh();
        }
      }
    }
    this.cleanup();
  }

  isBusy(): boolean {
    return this.ppActive;
  }

  cleanup(): void {
    this.ppActive = false;
    this.ppFaceId = -1;
    this.smoothGroupFaces = [];
    this.isSmoothGroup = false;
    this.removePPGhost();
    this.ctx.selection.clearSelection();
    this.ctx.dimLabel.clear();
  }

  private createPPGhost(faceId: number, _hitPoint: THREE.Vector3): void {
    this.removePPGhost();
    this.ppFaceVerts = this.ctx.extractFaceBoundary(faceId);
    if (this.ppFaceVerts.length < 3) return;

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

    const n = this.ppFaceVerts.length;
    const offset = this.ppNormal.clone().multiplyScalar(dist);
    const offsetVerts = this.ppFaceVerts.map(v => v.clone().add(offset));

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

    const faceMesh = new THREE.Mesh(makeFaceGeo(offsetVerts), new THREE.MeshBasicMaterial({
      color: 0x5b9bd5, side: THREE.FrontSide,
      transparent: true, opacity: 0.3,
      depthWrite: false,
    }));
    faceMesh.renderOrder = 999;
    this.ppGhost.add(faceMesh);

    const wallMesh = new THREE.Mesh(makeWallGeo(this.ppFaceVerts, offsetVerts), new THREE.MeshBasicMaterial({
      color: 0x5b9bd5, side: THREE.FrontSide,
      transparent: true, opacity: 0.2,
      depthWrite: false,
    }));
    wallMesh.renderOrder = 998;
    this.ppGhost.add(wallMesh);

    const linePositions: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      linePositions.push(offsetVerts[i].x, offsetVerts[i].y, offsetVerts[i].z);
      linePositions.push(offsetVerts[j].x, offsetVerts[j].y, offsetVerts[j].z);
    }
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
