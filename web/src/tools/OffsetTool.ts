/**
 * Offset Tool — Dimension-aware offset (ADR-080).
 *
 * Principle 1 (2026-04-24, face-only) was superseded by ADR-080 V-α:
 * dimension-driven dispatch resolves the ambiguity between edge-offset
 * and face-boundary-offset by routing on active selection's geometric
 * dimension:
 *  - Face selection (or no selection → click-to-pick) → existing
 *    face-boundary offset (V-γ may switch to surface-normal in future).
 *  - Edge selection → edge curve offset on host face's surface.
 *    V-α placeholder: shows a Toast indicating V-β availability; the
 *    Rust core (`Mesh::offset_edge` typed contract) lands in V-β.
 *  - Mixed selection (edges + faces) → reject + Toast (force user to
 *    pick one dimension).
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';

/**
 * ADR-080 V-β-α-bridge — Aggregate per-reason failure counts into a
 * single user-facing message. Forward-defer cases name the V-β-β /
 * V-β-γ / V-δ scope explicitly so users know it's coming, not broken.
 */
function formatEdgeOffsetFailureToast(
  reasonCount: Map<string, number>,
  unsupportedKinds: Set<string>,
): string | null {
  if (reasonCount.size === 0) return null;
  const parts: string[] = [];
  for (const [reason, count] of reasonCount) {
    switch (reason) {
      case 'unsupported_surface':
        parts.push(
          `${count}개: 호스트 면 (${[...unsupportedKinds].join(',')}) — V-β-γ 에서 활성됩니다`,
        );
        break;
      case 'unsupported_curve':
        parts.push(
          `${count}개: 곡선 종류 (${[...unsupportedKinds].join(',')}) — V-β-β 에서 활성됩니다`,
        );
        break;
      case 'no_incident_face':
        parts.push(`${count}개: 자유 와이어 — V-δ 에서 활성됩니다`);
        break;
      case 'ambiguous_host':
        parts.push(`${count}개: 호스트 면이 모호합니다`);
        break;
      case 'multi_loop':
        parts.push(`${count}개: hole 면 (multi-loop) 거부 (ADR-016)`);
        break;
      case 'degenerate_distance':
        parts.push(`${count}개: 거리가 너무 작습니다`);
        break;
      case 'arc_plane_mismatch':
        parts.push(`${count}개: arc 평면이 호스트 면과 일치하지 않습니다`);
        break;
      case 'radius_collapse':
        parts.push(`${count}개: 반지름이 0 이하로 축소됩니다 (방향 반전 필요)`);
        break;
      case 'unsupported_curve_on_surface':
        parts.push(
          `${count}개: 곡선이 호스트 면 (${[...unsupportedKinds].join(',')}) 위에 자연스럽게 놓이지 않습니다`,
        );
        break;
      case 'axial_out_of_range':
        parts.push(`${count}개: 축 방향 위치가 호스트 범위를 벗어납니다`);
        break;
      case 'wire_not_planar':
        parts.push(`${count}개: 자유 와이어가 평면이 아닙니다 (V-δ-β 명시 평면 필요)`);
        break;
      case 'no_reference_plane':
        parts.push(
          `${count}개: 기준 평면을 찾을 수 없습니다 (단일 엣지 또는 직선) — V-δ-β 활성 시 명시 평면 입력 가능`,
        );
        break;
      case 'bridge_unavailable':
        parts.push(`${count}개: WASM 미가용`);
        break;
      default:
        parts.push(`${count}개: 기타 오류 (${reason})`);
    }
  }
  return `엣지 offset 실패 — ${parts.join(' · ')}`;
}

export class OffsetTool implements ITool {
  readonly name = 'offset';

  private ctx: ToolContext;
  private offsetPhase: 0 | 1 | 2 = 0;
  private offsetFaceId: number = -1;
  private offsetNormal: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private offsetHitPoint: THREE.Vector3 = new THREE.Vector3();
  private offsetGhost: THREE.Group | null = null;
  private offsetFaceVerts: THREE.Vector3[] = [];
  private lastOffsetDist: number = 0;
  private offsetHoverHighlight: THREE.Line | null = null;
  private offsetCurrentSign: number = 1;
  // ADR-080 V-α — Dimension dispatch state. Set on onActivate based on
  // active selection. 'edge' / 'face' / null (= will be set on first
  // face-pick click).
  private dimMode: 'edge' | 'face' | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  /** ADR-080 V-α — classify active selection's geometric dimension. */
  private detectDimension(): 'edge' | 'face' | 'mixed' | 'none' {
    const faces = this.ctx.getSelectedFaces();
    const edges = this.ctx.selection.getSelectedEdges();
    const hasFaces = faces.length > 0;
    const hasEdges = edges.length > 0;
    if (hasFaces && hasEdges) return 'mixed';
    if (hasFaces) return 'face';
    if (hasEdges) return 'edge';
    return 'none';
  }

  onActivate(): void {
    const canvas = this.ctx.viewport.renderer.domElement;
    canvas.style.cursor = 'none';

    // ADR-080 V-α — Dimension dispatch on activation.
    const dim = this.detectDimension();
    if (dim === 'mixed') {
      // L5 — Mixed selection rejected, force user to disambiguate.
      Toast.warning(
        '선과 면을 동시에 선택했습니다. Offset 명령은 한 차원만 사용합니다 (선 또는 면).',
        3500,
      );
      this.ctx.selection.clearSelection();
      this.dimMode = null;
      debugLog('[OffsetTool] Activated; mixed selection rejected (ADR-080 L5)');
    } else if (dim === 'edge') {
      // L3 — Edge dimension routes to in-plane curve offset (V-β-α).
      // V-β-α-bridge: actually performs Line-on-Plane offsets via
      // `bridge.offsetEdgeOnHost`. Forward-defer reasons (Cylinder host,
      // Arc curve, free wire, etc.) surface as reason-specific Toasts at
      // VCB-apply time. No upfront placeholder Toast.
      this.dimMode = 'edge';
      debugLog('[OffsetTool] Activated; edge dimension (V-β-α)');
    } else if (dim === 'face') {
      // L4 — Face dimension. Existing behavior kept (V-γ may swap to
      // surface-normal offset in a future ADR).
      this.dimMode = 'face';
      debugLog('[OffsetTool] Activated; face dimension');
    } else {
      // No selection — wait for click-to-pick (legacy Phase 0 path).
      this.dimMode = null;
      debugLog('[OffsetTool] Activated; awaiting face pick');
    }
  }

  onDeactivate(): void {
    const canvas = this.ctx.viewport.renderer.domElement;
    canvas.style.cursor = '';
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, _point: THREE.Vector3 | null): void {
    // ADR-080 V-β-α-bridge — Edge dimension waits for VCB input (no face
    // pick). Click on canvas does nothing in edge mode; user enters
    // distance via VCB to apply, ESC to cancel.
    if (this.dimMode === 'edge') {
      Toast.info('엣지 offset: 거리(VCB)를 입력하세요. ESC 로 취소.', 2000);
      return;
    }

    if (this.offsetPhase === 0) {
      // Phase 0 → 1: pick a face.
      if (this.pickFaceTarget(e)) {
        this.offsetPhase = 1;
        this.dimMode = 'face';
        this.removeOffsetHover();
        debugLog('[Offset] Phase 1: faceId=', this.offsetFaceId);
      }
    } else if (this.offsetPhase === 1) {
      // Phase 1 → execute: direction from click.
      const clickPt = this.ctx.getGroundPoint(e);
      if (!clickPt) return;

      let dist = this.offsetRayDist(e);
      if (this.lastOffsetDist > 0) {
        const sign = dist >= 0 ? 1 : -1;
        dist = this.lastOffsetDist * sign;
      }

      if (Math.abs(dist) > 0.1 && this.offsetFaceId >= 0) {
        const result = this.ctx.bridge.offsetFace(this.offsetFaceId, dist);
        if (result && result.ok) {
          this.lastOffsetDist = Math.abs(dist);
          debugLog('[Offset/Face] Applied: dist=', dist.toFixed(1), 'innerFace=', result.innerFace);
        }
      }

      this.ctx.syncMesh();
      this.resetOffsetState();
    }
  }

  onMouseMove(e: MouseEvent, _point: THREE.Vector3 | null): void {
    const pickBox = this.ctx.pickBox;
    if (pickBox) {
      pickBox.visible = true;
      pickBox.update(e.clientX, e.clientY);
    }

    if (this.offsetPhase === 0) {
      // Hover: face highlight only (no edge picking).
      const hit = this.ctx.viewport.pick(e.clientX, e.clientY);
      if (hit && hit.faceIndex != null && hit.faceIndex >= 0) {
        // Viewport's built-in hover paints the face; we do nothing here.
      } else {
        this.removeOffsetHover();
      }
    } else if (this.offsetPhase === 1 && this.offsetFaceId >= 0) {
      const dist = this.offsetRayDist(e);
      if (Math.abs(dist) > 0.1) {
        this.offsetCurrentSign = dist >= 0 ? 1 : -1;
      }
      const previewDist = this.lastOffsetDist > 0
        ? this.lastOffsetDist * this.offsetCurrentSign
        : dist;
      this.updateOffsetGhost(previewDist);

      if (Math.abs(previewDist) > 0.1 && this.offsetFaceVerts.length >= 2) {
        const text = this.ctx.units.format(Math.abs(previewDist));
        const label = previewDist >= 0 ? 'Inset' : 'Outset';
        const midA = new THREE.Vector3().addVectors(
          this.offsetFaceVerts[0], this.offsetFaceVerts[1],
        ).multiplyScalar(0.5);
        const edge = new THREE.Vector3().subVectors(
          this.offsetFaceVerts[1], this.offsetFaceVerts[0],
        );
        const inward = new THREE.Vector3().crossVectors(edge, this.offsetNormal).normalize();
        const midB = midA.clone().add(inward.multiplyScalar(previewDist));
        this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
          { from: midA, to: midB, text: `${label}: ${text}`, color: '#ff9f43' },
        ]);
      } else {
        this.ctx.dimLabel.clear();
      }
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  applyVCBValue(value: number): void {
    // ADR-080 V-β-α-bridge — Edge dimension dispatch via Mesh::offset_edge_
    // on_host_face. Forward-defer cases (Cylinder host, Arc curve, free wire,
    // multi-loop, etc.) surface as reason-specific Toasts.
    if (this.dimMode === 'edge') {
      this.applyEdgeOffset(value);
      this.ctx.dimLabel.clear();
      this.resetOffsetState();
      return;
    }

    if (this.offsetPhase === 0) {
      this.lastOffsetDist = value;
      debugLog('[VCB/Offset] Distance set:', value);
    } else if (this.offsetPhase === 1 && this.offsetFaceId >= 0) {
      const signedValue = value * this.offsetCurrentSign;
      const result = this.ctx.bridge.offsetFace(this.offsetFaceId, signedValue);
      if (result && result.ok) {
        this.lastOffsetDist = value;
        debugLog('[VCB/Offset/Face] Applied:', signedValue, 'innerFace=', result.innerFace);
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
    this.offsetCurrentSign = 1;
    this.dimMode = null;
    this.removeOffsetGhost();
    this.removeOffsetHover();
    this.ctx.selection.clearSelection();
  }

  /**
   * ADR-080 V-β-α-bridge — Edge mode VCB handler.
   *
   * Iterates over each selected edge, invokes `bridge.offsetEdgeOnHost`,
   * and surfaces a reason-specific Toast for failed edges. On any
   * success, syncs the mesh and reports the count.
   */
  private applyEdgeOffset(dist: number): void {
    const edges = this.ctx.selection.getSelectedEdges();
    if (edges.length === 0) {
      Toast.info('Offset 적용할 엣지가 없습니다.', 2500);
      return;
    }

    const distFmt = this.ctx.units.format(Math.abs(dist));
    let successCount = 0;
    const reasonCount = new Map<string, number>();
    const unsupportedKinds = new Set<string>();

    // ADR-080 V-δ-γ — Cascade fallback for free wire failures:
    //   Layer 1: bridge.offsetEdgeOnHost (host face / V-δ-α wire planarity)
    //   Layer 2: if active sketch session, retry with V-δ-β explicit plane
    //   Layer 3 (deferred): ground plane (intentionally NOT default-on —
    //                        user must explicitly opt in via sketch)
    const sketch = this.ctx.getSketchInfo();
    let sketchFallbackCount = 0;

    for (const edgeId of edges) {
      let r = this.ctx.bridge.offsetEdgeOnHost(edgeId, dist);
      if (r.ok) {
        successCount++;
        continue;
      }
      // V-δ-γ Layer 2: free-wire-specific failures + active sketch →
      // retry with caller-supplied plane.
      const isFreeWireFailure =
        r.reason === 'no_reference_plane' || r.reason === 'wire_not_planar';
      if (isFreeWireFailure && sketch) {
        const sr = this.ctx.bridge.offsetEdgeWithReferencePlane(
          edgeId, dist,
          [sketch.origin.x, sketch.origin.y, sketch.origin.z],
          [sketch.normal.x, sketch.normal.y, sketch.normal.z],
        );
        if (sr.ok) {
          successCount++;
          sketchFallbackCount++;
          continue;
        }
        r = sr; // record sketch-fallback failure reason for Toast
      }
      const key = r.reason;
      reasonCount.set(key, (reasonCount.get(key) ?? 0) + 1);
      if (r.reason === 'unsupported_surface' || r.reason === 'unsupported_curve') {
        unsupportedKinds.add(r.kind);
      } else if (r.reason === 'unsupported_curve_on_surface') {
        unsupportedKinds.add(`${r.curveKind}@${r.surfaceKind}`);
      }
      debugLog('[OffsetTool] edge offset failed', { edgeId, ...r });
    }

    if (sketchFallbackCount > 0) {
      debugLog('[OffsetTool] sketch fallback applied', { count: sketchFallbackCount });
    }

    if (successCount > 0) {
      this.ctx.syncMesh();
      Toast.success(
        `엣지 offset (${distFmt}) — ${successCount}개 성공${
          edges.length > successCount ? ` / ${edges.length - successCount}개 실패` : ''
        }`,
        2500,
      );
    }

    // Surface a single reason-aggregated Toast for failed edges.
    if (successCount < edges.length) {
      const msg = formatEdgeOffsetFailureToast(reasonCount, unsupportedKinds);
      if (msg) Toast.warning(msg, 4000);
    }
  }

  private pickFaceTarget(e: MouseEvent): boolean {
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
      const normal = this.ctx.bridge.getFaceNormal(rustFaceId);
      this.offsetNormal = new THREE.Vector3(normal[0], normal[1], normal[2]);
      this.offsetHitPoint = hitPoint;
      this.createOffsetGhost(rustFaceId);
      this.ctx.selection.handleClick(rustFaceId, false, false);
      return true;
    }
    return false;
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
        this.offsetFaceVerts[i].clone().add(bisector.multiplyScalar(clampedDist * direction)),
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

  private removeOffsetHover(): void {
    if (this.offsetHoverHighlight) {
      this.offsetHoverHighlight.geometry.dispose();
      (this.offsetHoverHighlight.material as THREE.Material).dispose();
      this.ctx.viewport.scene.remove(this.offsetHoverHighlight);
      this.offsetHoverHighlight = null;
    }
  }
}
