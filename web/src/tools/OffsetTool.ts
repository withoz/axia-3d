/**
 * Offset Tool — CAD style offset (select object → click side → repeat)
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';

export class OffsetTool implements ITool {
  readonly name = 'offset';

  private ctx: ToolContext;
  private offsetPhase: 0 | 1 | 2 = 0;
  private offsetFaceId: number = -1;
  private offsetEdgeId: number = -1;
  private offsetNormal: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private offsetHitPoint: THREE.Vector3 = new THREE.Vector3();
  private offsetGhost: THREE.Group | null = null;
  private offsetFaceVerts: THREE.Vector3[] = [];
  private lastOffsetDist: number = 0;
  private offsetEdgeDir: THREE.Vector3 = new THREE.Vector3();
  private offsetEdgeP0: THREE.Vector3 = new THREE.Vector3();
  private offsetEdgeP1: THREE.Vector3 = new THREE.Vector3();
  private offsetEdgeHighlight: THREE.Line | null = null;
  private offsetHoverHighlight: THREE.Line | null = null;
  private offsetCurrentSign: number = 1;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    const canvas = this.ctx.viewport.renderer.domElement;
    canvas.style.cursor = 'none';
    debugLog('[OffsetTool] Activated');
  }

  onDeactivate(): void {
    const canvas = this.ctx.viewport.renderer.domElement;
    canvas.style.cursor = '';
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (this.offsetPhase === 0) {
      // Phase 0 → 1: select object
      const picked = this.pickOffsetTarget(e);
      if (picked) {
        this.offsetPhase = 1;
        this.removeOffsetHover();
        debugLog('[Offset] Phase 1: object selected,',
          picked.type === 'edge' ? 'edgeId=' + this.offsetEdgeId : 'faceId=' + this.offsetFaceId);
      }
    } else if (this.offsetPhase === 1) {
      // Phase 1 → execute: determine direction (second click)
      const clickPt = this.ctx.getGroundPoint(e);
      if (!clickPt) return;

      let dist = 0;

      if (this.offsetEdgeId >= 0) {
        const midPt = new THREE.Vector3().addVectors(this.offsetEdgeP0, this.offsetEdgeP1).multiplyScalar(0.5);
        const clickDir = new THREE.Vector3().subVectors(clickPt, midPt);
        const side = clickDir.dot(this.offsetEdgeDir) >= 0 ? 1 : -1;

        if (this.lastOffsetDist > 0) {
          dist = this.lastOffsetDist * side;
        } else {
          dist = clickDir.dot(this.offsetEdgeDir);
        }

        if (Math.abs(dist) > 0.1) {
          const planeN: [number, number, number] = [
            this.offsetNormal.x, this.offsetNormal.y, this.offsetNormal.z
          ];
          const result = this.ctx.bridge.offsetEdge(this.offsetEdgeId, dist, planeN);
          if (result && result.ok) {
            this.lastOffsetDist = Math.abs(dist);
            debugLog('[Offset/Edge] Applied: dist=', dist.toFixed(1), 'newEdge=', result.newEdge);
          }
        }
      } else if (this.offsetFaceId >= 0) {
        dist = this.offsetRayDist(e);
        if (this.lastOffsetDist > 0) {
          const sign = dist >= 0 ? 1 : -1;
          dist = this.lastOffsetDist * sign;
        }

        if (Math.abs(dist) > 0.1) {
          const result = this.ctx.bridge.offsetFace(this.offsetFaceId, dist);
          if (result && result.ok) {
            this.lastOffsetDist = Math.abs(dist);
            debugLog('[Offset/Face] Applied: dist=', dist.toFixed(1), 'innerFace=', result.innerFace);
          }
        }
      }

      this.ctx.syncMesh();
      this.resetOffsetState();
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    const pickBox = this.ctx.pickBox;
    if (pickBox) {
      pickBox.visible = true;
      pickBox.update(e.clientX, e.clientY);
    }

    if (this.offsetPhase === 0) {
      // Phase 0: object hover highlight
      const edgeHit = this.ctx.viewport.pickEdge(e.clientX, e.clientY);
      if (edgeHit && edgeHit.index != null && this.ctx.edgeMap) {
        const segIndex = Math.floor(edgeHit.index / 2);
        this.showEdgeHover(segIndex);
      } else {
        this.removeOffsetHover();
      }
    } else if (this.offsetPhase === 1) {
      // Phase 1: direction preview + dimension display
      if (this.offsetEdgeId >= 0) {
        const groundPt = this.ctx.getGroundPoint(e);
        if (groundPt) {
          const midPt = new THREE.Vector3().addVectors(this.offsetEdgeP0, this.offsetEdgeP1).multiplyScalar(0.5);
          const clickDir = new THREE.Vector3().subVectors(groundPt, midPt);
          const projDist = clickDir.dot(this.offsetEdgeDir);

          if (Math.abs(projDist) > 0.1) {
            this.offsetCurrentSign = projDist >= 0 ? 1 : -1;
          }

          let previewDist = this.lastOffsetDist > 0
            ? this.lastOffsetDist * this.offsetCurrentSign
            : projDist;

          if (Math.abs(previewDist) > 0.1) {
            const offset = this.offsetEdgeDir.clone().multiplyScalar(previewDist);
            const prevP0 = this.offsetEdgeP0.clone().add(offset);
            const prevP1 = this.offsetEdgeP1.clone().add(offset);

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
            this.ctx.viewport.scene.add(this.offsetHoverHighlight);

            const text = this.ctx.units.format(Math.abs(previewDist));
            const midFrom = new THREE.Vector3().addVectors(this.offsetEdgeP0, this.offsetEdgeP1).multiplyScalar(0.5);
            const midTo = midFrom.clone().add(this.offsetEdgeDir.clone().multiplyScalar(previewDist));
            this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
              { from: midFrom, to: midTo, text, color: '#ff9f43' },
            ]);
          }
        }
      } else if (this.offsetFaceId >= 0) {
        const dist = this.offsetRayDist(e);
        if (Math.abs(dist) > 0.1) {
          this.offsetCurrentSign = dist >= 0 ? 1 : -1;
        }
        let previewDist = this.lastOffsetDist > 0
          ? this.lastOffsetDist * this.offsetCurrentSign
          : dist;
        this.updateOffsetGhost(previewDist);

        if (Math.abs(previewDist) > 0.1) {
          const text = this.ctx.units.format(Math.abs(previewDist));
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
            this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
              { from: midA, to: midB, text: `${label}: ${text}`, color: '#ff9f43' },
            ]);
          }
        } else {
          this.ctx.dimLabel.clear();
        }
      }
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  applyVCBValue(value: number): void {
    if (this.offsetPhase === 0) {
      this.lastOffsetDist = value;
      debugLog('[VCB/Offset] Distance set:', value);
    } else if (this.offsetPhase === 1) {
      const signedValue = value * this.offsetCurrentSign;
      if (this.offsetEdgeId >= 0) {
        const planeN: [number, number, number] = [
          this.offsetNormal.x, this.offsetNormal.y, this.offsetNormal.z
        ];
        const result = this.ctx.bridge.offsetEdge(this.offsetEdgeId, signedValue, planeN);
        if (result && result.ok) {
          this.lastOffsetDist = value;
          debugLog('[VCB/Offset/Edge] Applied:', signedValue, 'newEdge=', result.newEdge);
        }
      } else if (this.offsetFaceId >= 0) {
        const result = this.ctx.bridge.offsetFace(this.offsetFaceId, signedValue);
        if (result && result.ok) {
          this.lastOffsetDist = value;
          debugLog('[VCB/Offset/Face] Applied:', signedValue, 'innerFace=', result.innerFace);
        }
      }
      this.ctx.syncMesh();
      this.resetOffsetState();
    }
    this.ctx.dimLabel.clear();
  }

  isBusy(): boolean {
    return this.offsetPhase > 0;
  }

  cleanup(): void {
    this.resetOffsetState();
  }

  private resetOffsetState(): void {
    this.offsetPhase = 0;
    this.offsetFaceId = -1;
    this.offsetEdgeId = -1;
    this.offsetCurrentSign = 1;
    this.removeOffsetGhost();
    this.removeEdgeHighlight();
    this.removeOffsetHover();
    this.ctx.selection.clearSelection();
  }

  private pickOffsetTarget(e: MouseEvent): { type: 'face' | 'edge' } | null {
    const hit = this.ctx.viewport.pick(e.clientX, e.clientY);
    let rustFaceId = -1;
    let hitPoint: THREE.Vector3 | null = null;

    if (hit && hit.faceIndex != null && hit.faceIndex >= 0) {
      rustFaceId = this.ctx.getFaceId(hit.faceIndex);
      hitPoint = hit.point ? hit.point.clone() : null;
    }

    if (rustFaceId < 0) {
      const selected = this.ctx.getSelectedFaces();
      if (selected.length === 1) {
        rustFaceId = selected[0];
        const centroid = this.ctx.bridge.facesCentroid(selected);
        if (centroid) hitPoint = centroid;
      }
    }

    if (rustFaceId >= 0 && hitPoint) {
      this.offsetFaceId = rustFaceId;
      this.offsetEdgeId = -1;
      const normal = this.ctx.bridge.getFaceNormal(rustFaceId);
      this.offsetNormal = new THREE.Vector3(normal[0], normal[1], normal[2]);
      this.offsetHitPoint = hitPoint;
      this.createOffsetGhost(rustFaceId);
      this.ctx.selection.handleClick(rustFaceId, false, false);
      return { type: 'face' };
    }

    const edgeHit = this.ctx.viewport.pickEdge(e.clientX, e.clientY);
    if (edgeHit && edgeHit.index != null && this.ctx.edgeMap) {
      const segIndex = Math.floor(edgeHit.index / 2);
      const edgeId = this.ctx.edgeMap[segIndex];
      if (edgeId != null) {
        this.offsetEdgeId = edgeId;
        this.offsetFaceId = -1;
        this.offsetNormal = new THREE.Vector3(0, 1, 0);

        const edgeLines = this.ctx.bridge.getEdgeLines();
        if (edgeLines) {
          const base = segIndex * 6;
          this.offsetEdgeP0 = new THREE.Vector3(edgeLines[base], edgeLines[base+1], edgeLines[base+2]);
          this.offsetEdgeP1 = new THREE.Vector3(edgeLines[base+3], edgeLines[base+4], edgeLines[base+5]);
          const edgeDir = new THREE.Vector3().subVectors(this.offsetEdgeP1, this.offsetEdgeP0).normalize();
          this.offsetEdgeDir = new THREE.Vector3().crossVectors(edgeDir, this.offsetNormal).normalize();

          const midPt = new THREE.Vector3().addVectors(this.offsetEdgeP0, this.offsetEdgeP1).multiplyScalar(0.5);
          this.offsetHitPoint = midPt;

          this.showEdgeSelected(this.offsetEdgeP0, this.offsetEdgeP1);
        }
        return { type: 'edge' };
      }
    }

    return null;
  }

  private offsetRayDist(e: MouseEvent): number {
    const canvas = this.ctx.viewport.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this.ctx.viewport.activeCamera);

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.offsetNormal, this.offsetHitPoint);
    const intersection = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(plane, intersection);

    if (!hit) return 0;

    const diff = new THREE.Vector3().subVectors(intersection, this.offsetHitPoint);
    const absDist = diff.length();

    if (this.offsetEdgeId >= 0 && this.offsetEdgeDir.lengthSq() > 0.001) {
      const sign = diff.dot(this.offsetEdgeDir) >= 0 ? 1 : -1;
      return absDist * sign;
    }

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

  private createOffsetGhost(faceId: number): void {
    this.removeOffsetGhost();
    this.removeEdgeHighlight();
    this.offsetFaceVerts = this.ctx.extractFaceBoundary(faceId);
    if (this.offsetFaceVerts.length < 3) return;

    this.offsetGhost = new THREE.Group();
    this.offsetGhost.renderOrder = 999;
    this.ctx.viewport.scene.add(this.offsetGhost);
    this.rebuildOffsetGhost(0);
  }

  private rebuildOffsetGhost(dist: number): void {
    if (!this.offsetGhost || this.offsetFaceVerts.length < 3) return;

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

    const normal = this.offsetNormal.clone().normalize();
    const inwards: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const edge = new THREE.Vector3().subVectors(this.offsetFaceVerts[j], this.offsetFaceVerts[i]);
      const inward = new THREE.Vector3().crossVectors(edge, normal).normalize();
      inwards.push(inward);
    }

    const direction = dist >= 0 ? 1 : -1;
    const offsetVerts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n;
      const inA = inwards[prev];
      const inB = inwards[i];

      const bisector = new THREE.Vector3().addVectors(inA, inB).normalize();
      const cosHalf = bisector.dot(inA);
      const moveDist = cosHalf > 0.1 ? absDist / cosHalf : absDist;
      const clampedDist = Math.min(moveDist, absDist * 3);

      offsetVerts.push(
        this.offsetFaceVerts[i].clone().add(bisector.multiplyScalar(clampedDist * direction))
      );
    }

    // Interior face
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

    // Interior outline
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

    // Connection lines
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

  private updateOffsetGhost(dist: number): void {
    this.rebuildOffsetGhost(dist);
  }

  private removeOffsetGhost(): void {
    if (this.offsetGhost) {
      while (this.offsetGhost.children.length > 0) {
        const child = this.offsetGhost.children[0];
        this.offsetGhost.remove(child);
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      }
      this.ctx.viewport.scene.remove(this.offsetGhost);
      this.offsetGhost = null;
    }
    this.offsetFaceVerts = [];
  }

  private removeEdgeHighlight(): void {
    if (this.offsetEdgeHighlight) {
      this.offsetEdgeHighlight.geometry.dispose();
      (this.offsetEdgeHighlight.material as THREE.Material).dispose();
      this.ctx.viewport.scene.remove(this.offsetEdgeHighlight);
      this.offsetEdgeHighlight = null;
    }
  }

  private removeOffsetHover(): void {
    if (this.offsetHoverHighlight) {
      this.offsetHoverHighlight.geometry.dispose();
      (this.offsetHoverHighlight.material as THREE.Material).dispose();
      this.ctx.viewport.scene.remove(this.offsetHoverHighlight);
      this.offsetHoverHighlight = null;
    }
  }

  private showEdgeHover(segIndex: number): void {
    this.removeOffsetHover();
    const edgeLines = this.ctx.bridge.getEdgeLines();
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
    this.ctx.viewport.scene.add(this.offsetHoverHighlight);
  }

  private showEdgeSelected(p0: THREE.Vector3, p1: THREE.Vector3): void {
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
    this.ctx.viewport.scene.add(this.offsetEdgeHighlight);
  }
}
