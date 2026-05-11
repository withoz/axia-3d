/**
 * Slice Tool — Plane-cut a closed volume into two volumes.
 *
 * Workflow:
 *   1. Select a face of the target volume (or any face of the volume).
 *      The volume = the XIA owning the selected face. All faces of that
 *      XIA are passed to the slice operation.
 *   2. Activate Slice tool (menu / keyboard / action).
 *   3. Click 1 — first point on cutting plane.
 *   4. Click 2 — second point. Together with click 1 these define a line
 *      on the plane.
 *   5. Click 3 — third (non-collinear) point. The three points fully
 *      define the cutting plane.
 *      Alternative quick mode: pressing ENTER / SPACE after click 2
 *      finishes with a VERTICAL plane (normal perpendicular to both
 *      points and world-up axis) — common case for architectural cuts.
 *
 * Esc cancels at any time.
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';

type Phase = 'idle' | 'awaiting_p2' | 'awaiting_p3';

const PREVIEW_COLOR = 0xff8c00;       // orange — distinct from blue draw previews
const PREVIEW_OUTLINE = 0xc25500;
const PLANE_PATCH_SIZE = 5000;        // mm — 5m square preview patch

export class SliceTool implements ITool {
  readonly name = 'slice';

  private ctx: ToolContext;
  private phase: Phase = 'idle';
  private p1: THREE.Vector3 | null = null;
  private p2: THREE.Vector3 | null = null;

  // Captured volume face ids at activation time.
  private volumeFaceIds: number[] = [];

  // Preview meshes
  private linePreview: THREE.Line | null = null;
  private planePatch: THREE.Mesh | null = null;
  private planeOutline: THREE.LineLoop | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  isBusy(): boolean { return this.phase !== 'idle'; }

  onActivate(): void {
    debugLog('[SliceTool] activated');
    // Capture the volume from the current selection.
    const selected = this.ctx.selection.getSelectedFaces();
    if (selected.length === 0) {
      Toast.warning('Slice: 자를 볼륨의 면을 먼저 선택하세요', 4000);
      this.phase = 'idle';
      return;
    }
    // Volume = all faces of the XIA owning the first selected face.
    const bridge = this.ctx.bridge;
    const xiaIds = new Set<number>();
    for (const fid of selected) {
      const xid = bridge.engine?.get_xia_for_face?.(fid);
      if (xid !== undefined && xid >= 0) xiaIds.add(xid);
    }
    if (xiaIds.size === 0) {
      Toast.error('Slice: 선택된 면에 소속 볼륨(XIA)이 없습니다');
      this.phase = 'idle';
      return;
    }
    if (xiaIds.size > 1) {
      Toast.warning('Slice: 한 번에 하나의 볼륨만 자를 수 있습니다 — 단일 솔리드의 면을 선택하세요', 5000);
      this.phase = 'idle';
      return;
    }
    const xiaId = [...xiaIds][0];
    // Fetch the XIA's face_ids via bridge.
    const xiaFaces = bridge.engine?.getXiaFaceIds?.(xiaId);
    if (!xiaFaces || xiaFaces.length === 0) {
      Toast.error(`Slice: XIA ${xiaId}에 면이 없습니다`);
      this.phase = 'idle';
      return;
    }
    this.volumeFaceIds = Array.from(xiaFaces);
    debugLog(`[SliceTool] target volume: XIA ${xiaId}, ${this.volumeFaceIds.length} faces`);
    Toast.info(`Slice: 평면 정의를 위해 3점을 클릭하세요 (Esc 취소)`, 4000);
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(_e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!point) return;
    if (this.phase === 'idle') {
      this.p1 = point.clone();
      this.phase = 'awaiting_p2';
      debugLog('[Slice] click 1', this.p1.toArray());
    } else if (this.phase === 'awaiting_p2') {
      if (!this.p1) return;
      if (this.p1.distanceTo(point) < 1.0) {
        Toast.warning('두 번째 점은 첫 번째와 다른 위치여야 합니다');
        return;
      }
      this.p2 = point.clone();
      this.phase = 'awaiting_p3';
      debugLog('[Slice] click 2', this.p2.toArray());
    } else if (this.phase === 'awaiting_p3') {
      if (!this.p1 || !this.p2) return;
      const p3 = point.clone();
      // Reject if collinear with p1-p2.
      const d12 = new THREE.Vector3().subVectors(this.p2, this.p1);
      const d13 = new THREE.Vector3().subVectors(p3, this.p1);
      const cross = new THREE.Vector3().crossVectors(d12, d13);
      if (cross.lengthSq() < 1e-6) {
        Toast.warning('세 점이 일직선 — 다른 위치를 클릭하세요');
        return;
      }
      this.commit(this.p1, this.p2, p3);
    }
  }

  onMouseMove(_e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!point) return;
    if (this.phase === 'awaiting_p2' && this.p1) {
      this.updateLinePreview(this.p1, point);
    } else if (this.phase === 'awaiting_p3' && this.p1 && this.p2) {
      // Compute plane from p1, p2, point and show patch.
      const d12 = new THREE.Vector3().subVectors(this.p2, this.p1);
      const d13 = new THREE.Vector3().subVectors(point, this.p1);
      const normal = new THREE.Vector3().crossVectors(d12, d13);
      if (normal.lengthSq() < 1e-6) {
        this.clearPlanePatch();
        return;
      }
      normal.normalize();
      this.updatePlanePatch(this.p1, this.p2, point, normal);
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      Toast.info('Slice 취소');
      this.cleanup();
      return;
    }
    if (this.phase === 'awaiting_p3' && (e.key === 'Enter' || e.key === ' ')) {
      // Quick mode: vertical plane through p1-p2 with world-up normal direction.
      if (!this.p1 || !this.p2) return;
      const d12 = new THREE.Vector3().subVectors(this.p2, this.p1);
      const up = new THREE.Vector3(0, 1, 0);
      const normal = new THREE.Vector3().crossVectors(d12, up);
      if (normal.lengthSq() < 1e-6) {
        Toast.warning('수직 평면 모드: p1-p2가 세로축과 평행 — 세 번째 점을 클릭하세요');
        return;
      }
      normal.normalize();
      // Run slice directly with this plane.
      e.preventDefault();
      this.commitWithNormal(this.p1, normal);
    }
  }

  // ── Commit ──────────────────────────────────────────────────────

  private commit(p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3): void {
    const d12 = new THREE.Vector3().subVectors(p2, p1);
    const d13 = new THREE.Vector3().subVectors(p3, p1);
    const normal = new THREE.Vector3().crossVectors(d12, d13).normalize();
    this.commitWithNormal(p1, normal);
  }

  private commitWithNormal(origin: THREE.Vector3, normal: THREE.Vector3): void {
    const bridge = this.ctx.bridge;
    if (!bridge.engine?.sliceVolumeByPlane) {
      Toast.error('Slice: WASM 엔진에 sliceVolumeByPlane 함수가 없습니다 (rebuild 필요)');
      this.cleanup();
      return;
    }
    const fids = new Uint32Array(this.volumeFaceIds);
    const json = bridge.engine.sliceVolumeByPlane(
      fids,
      origin.x, origin.y, origin.z,
      normal.x, normal.y, normal.z,
    );
    let result: { ok: boolean; newXia?: number; error?: string };
    try {
      result = JSON.parse(json);
    } catch {
      Toast.error('Slice: 응답 파싱 실패');
      this.cleanup();
      return;
    }
    if (!result.ok) {
      Toast.error(`Slice 실패: ${result.error ?? '알 수 없는 오류'}`, 6000);
      debugLog('[Slice] error:', result.error);
      this.cleanup();
      return;
    }
    Toast.success(`Slice 완료 — 위쪽은 원본 볼륨에 유지, 아래쪽은 새 볼륨 (XIA ${result.newXia})`, 3000);
    bridge.markDirty();
    this.ctx.syncMesh();
    this.cleanup();
  }

  // ── Preview helpers ─────────────────────────────────────────────

  private updateLinePreview(a: THREE.Vector3, b: THREE.Vector3): void {
    const verts = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]);
    if (!this.linePreview) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const mat = new THREE.LineBasicMaterial({ color: PREVIEW_OUTLINE, depthTest: false });
      this.linePreview = new THREE.Line(geo, mat);
      this.linePreview.renderOrder = 1000;
      this.ctx.viewport.scene.add(this.linePreview);
    } else {
      const attr = this.linePreview.geometry.getAttribute('position') as THREE.BufferAttribute;
      (attr.array as Float32Array).set(verts);
      attr.needsUpdate = true;
    }
  }

  private updatePlanePatch(
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3,
    normal: THREE.Vector3,
  ): void {
    // Centroid.
    const c = p1.clone().add(p2).add(p3).multiplyScalar(1 / 3);
    // Build orthonormal basis on plane.
    const u = new THREE.Vector3().subVectors(p2, p1).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();
    const r = PLANE_PATCH_SIZE * 0.5;
    const corners = [
      c.clone().addScaledVector(u, -r).addScaledVector(v, -r),
      c.clone().addScaledVector(u,  r).addScaledVector(v, -r),
      c.clone().addScaledVector(u,  r).addScaledVector(v,  r),
      c.clone().addScaledVector(u, -r).addScaledVector(v,  r),
    ];
    const verts = new Float32Array(12);
    for (let i = 0; i < 4; ++i) {
      verts[i * 3] = corners[i].x;
      verts[i * 3 + 1] = corners[i].y;
      verts[i * 3 + 2] = corners[i].z;
    }
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    if (!this.planePatch) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      const mat = new THREE.MeshBasicMaterial({
        color: PREVIEW_COLOR,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.planePatch = new THREE.Mesh(geo, mat);
      this.ctx.viewport.scene.add(this.planePatch);

      const og = new THREE.BufferGeometry();
      og.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const om = new THREE.LineBasicMaterial({ color: PREVIEW_OUTLINE, depthTest: false });
      this.planeOutline = new THREE.LineLoop(og, om);
      this.planeOutline.renderOrder = 1000;
      this.ctx.viewport.scene.add(this.planeOutline);
    } else {
      const a1 = this.planePatch.geometry.getAttribute('position') as THREE.BufferAttribute;
      (a1.array as Float32Array).set(verts);
      a1.needsUpdate = true;
      const a2 = this.planeOutline!.geometry.getAttribute('position') as THREE.BufferAttribute;
      (a2.array as Float32Array).set(verts);
      a2.needsUpdate = true;
    }
  }

  private clearPlanePatch(): void {
    if (this.planePatch) {
      this.ctx.viewport.scene.remove(this.planePatch);
      this.planePatch.geometry.dispose();
      (this.planePatch.material as THREE.Material).dispose();
      this.planePatch = null;
    }
    if (this.planeOutline) {
      this.ctx.viewport.scene.remove(this.planeOutline);
      this.planeOutline.geometry.dispose();
      (this.planeOutline.material as THREE.Material).dispose();
      this.planeOutline = null;
    }
  }

  cleanup(): void {
    this.phase = 'idle';
    this.p1 = null;
    this.p2 = null;
    this.volumeFaceIds = [];
    if (this.linePreview) {
      this.ctx.viewport.scene.remove(this.linePreview);
      this.linePreview.geometry.dispose();
      (this.linePreview.material as THREE.Material).dispose();
      this.linePreview = null;
    }
    this.clearPlanePatch();
  }
}
