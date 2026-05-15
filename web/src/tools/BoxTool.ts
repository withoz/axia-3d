/**
 * Box Tool — Interactive 3-click box creation (SketchUp-style).
 *
 *   Click 1: anchor corner on the ground (or detected plane)
 *   Click 2: opposite ground corner — defines width × depth rectangle
 *   Click 3: top corner — defines height (Z in world up axis, ADR-103 Z-up)
 *
 * Mouse-move shows live preview between clicks. Esc cancels.
 *
 * Auto-intersect on draw fires inside the WASM `create_box` call when
 * the user has it enabled (Settings → "그릴 때 자동 교차").
 *
 * ADR-103-δ-2: rectangle on XY ground plane (Z=const), height extrudes
 * along +Z. Industry CAD parity (SketchUp / Fusion / SolidWorks).
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';

type Phase = 'idle' | 'awaiting_corner2' | 'awaiting_height';

const PREVIEW_COLOR = 0x4a90e2;
const PREVIEW_OUTLINE = 0x1a5cb8;

export class BoxTool implements ITool {
  readonly name = 'box';

  private ctx: ToolContext;
  private phase: Phase = 'idle';
  private corner1: THREE.Vector3 | null = null;
  private corner2: THREE.Vector3 | null = null;

  // Preview meshes
  private rectPreview: THREE.Mesh | null = null;
  private rectOutline: THREE.LineLoop | null = null;
  private boxPreview: THREE.Mesh | null = null;
  private boxOutline: THREE.LineSegments | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  isBusy(): boolean {
    return this.phase !== 'idle';
  }

  onActivate(): void {
    debugLog('[BoxTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    // For phases 1-2 we need the snapped 3D point. Phase 3 uses ray
    //   projection and doesn't require a `point`.
    if (this.phase !== 'awaiting_height' && !point) return;
    if (this.phase === 'idle') {
      if (!point) return;
      this.corner1 = point.clone();
      this.phase = 'awaiting_corner2';
      debugLog('[Box] click 1 — corner1', this.corner1.toArray());
    } else if (this.phase === 'awaiting_corner2') {
      if (!this.corner1 || !point) return;
      // ADR-103-δ-2 (Z-up): snap corner2 to same Z as corner1
      // (rectangle on horizontal XY ground plane).
      const c2 = point.clone();
      c2.z = this.corner1.z;
      // If the user clicked exactly on corner1 (degenerate), bail.
      if (this.corner1.distanceTo(c2) < 0.5) {
        Toast.warning('박스의 가로/세로 코너를 다른 위치에 클릭하세요');
        return;
      }
      this.corner2 = c2;
      this.phase = 'awaiting_height';
      debugLog('[Box] click 2 — corner2', this.corner2.toArray());
    } else if (this.phase === 'awaiting_height') {
      if (!this.corner1 || !this.corner2) return;
      // Use the same ray-vs-vertical-line projection that drives the
      //   live preview so the click commits to whatever the user is
      //   visually seeing. Sign preserved (negative = box grows down).
      const h = this.heightFromCursor(e);
      if (Math.abs(h) < 0.5) {
        Toast.warning('높이가 0 입니다 — 위/아래로 이동 후 다시 클릭');
        return;
      }
      this.commit(h);
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (this.phase === 'awaiting_corner2' && this.corner1 && point) {
      const c2 = point.clone();
      // ADR-103-δ-2 (Z-up): rect on XY plane, Z fixed.
      c2.z = this.corner1.z;
      this.updateRectPreview(this.corner1, c2);
    } else if (this.phase === 'awaiting_height' && this.corner1 && this.corner2) {
      // ADR-103-δ-2 (Z-up): ground point.z = corner1.z 이므로 그것만으론
      // height 변화 없음. 마우스 → 카메라 ray 를 사각형 중심을 지나는
      // 수직선(world Z 축)에 투영해 Z(=height) 도출. cursor 가 화면에서
      // 위로 가면 box 가 위로 자라남.
      const h = this.heightFromCursor(e);
      this.updateBoxPreview(this.corner1, this.corner2, h);
    }
  }

  /** Phase 3 — derive box height from cursor screen position by
   *  projecting the camera ray onto the vertical line through the
   *  rectangle's center. Returns world-Z delta from corner1 (ADR-103-δ-2). */
  private heightFromCursor(e: MouseEvent): number {
    if (!this.corner1 || !this.corner2) return 0;
    const viewport = this.ctx.viewport;
    const camera = viewport.activeCamera;
    const rect = viewport.renderer.domElement.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Build ray from camera through cursor.
    const rayDir = new THREE.Vector3(ndcX, ndcY, 0.5)
      .unproject(camera as THREE.PerspectiveCamera)
      .sub(camera.position)
      .normalize();
    const rayOrigin = camera.position.clone();

    // ADR-103-δ-2 (Z-up): vertical line through rectangle center (world
    // Z axis at midpoint). lineDir = +Z, lineOrigin uses corner1.z as
    // ground level.
    const cx = (this.corner1.x + this.corner2.x) * 0.5;
    const cy = (this.corner1.y + this.corner2.y) * 0.5;
    const lineOrigin = new THREE.Vector3(cx, cy, this.corner1.z);
    const lineDir = new THREE.Vector3(0, 0, 1);

    // Closest point on the line to the ray (skew-line-distance closed form).
    //   p1 = rayOrigin, d1 = rayDir
    //   p2 = lineOrigin, d2 = lineDir
    //   t2 minimises distance; we want lineOrigin + t2*lineDir
    const w0 = rayOrigin.clone().sub(lineOrigin);
    const a = rayDir.dot(rayDir);     // 1 (unit)
    const b = rayDir.dot(lineDir);
    const c = lineDir.dot(lineDir);   // 1 (unit)
    const d = rayDir.dot(w0);
    const e2 = lineDir.dot(w0);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-6) return 0; // ray parallel to line — no height change
    const t2 = (a * e2 - b * d) / denom;
    return t2; // Z delta from corner1.z along world Z (ADR-103-δ-2)
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      Toast.info('박스 도구 취소');
      this.cleanup();
    }
  }

  /** VCB numeric input — sets height directly when in awaiting_height phase. */
  applyVCBValue?(value: number): void {
    if (this.phase === 'awaiting_height' && this.corner1 && this.corner2) {
      this.commit(Math.abs(value));
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  private commit(height: number): void {
    if (!this.corner1 || !this.corner2) return;
    // ADR-103-δ-2 (Z-up): rectangle spans XY plane, height extrudes +Z.
    const minX = Math.min(this.corner1.x, this.corner2.x);
    const maxX = Math.max(this.corner1.x, this.corner2.x);
    const minY = Math.min(this.corner1.y, this.corner2.y);
    const maxY = Math.max(this.corner1.y, this.corner2.y);
    const w = maxX - minX;      // X extent = width
    const d = maxY - minY;      // Y extent = depth
    const absH = Math.abs(height);
    if (w < 0.5 || d < 0.5 || absH < 0.5) {
      Toast.warning(`박스 크기가 너무 작습니다 (${w.toFixed(1)} × ${d.toFixed(1)} × ${absH.toFixed(1)})`);
      return;
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    // Signed height: negative grows the box downward (-Z) from corner1.
    const cz = this.corner1.z + height * 0.5;
    const h = absH;             // Z extent = height

    debugLog(`[Box] commit center=(${cx},${cy},${cz}) size=${w}×${h}×${d}`);

    const baseFace = this.ctx.bridge.create_box(cx, cy, cz, w, h, d);
    if (baseFace < 0) {
      Toast.error('박스 생성 실패: ' + (this.ctx.bridge.lastError() || ''));
    } else {
      this.ctx.syncMesh();
      Toast.success(`박스 ${w.toFixed(0)} × ${h.toFixed(0)} × ${d.toFixed(0)} mm 생성됨`, 2000);
    }
    this.cleanup();
  }

  private updateRectPreview(c1: THREE.Vector3, c2: THREE.Vector3): void {
    // ADR-103-δ-2 (Z-up): rect on XY plane (z=const).
    const minX = Math.min(c1.x, c2.x), maxX = Math.max(c1.x, c2.x);
    const minY = Math.min(c1.y, c2.y), maxY = Math.max(c1.y, c2.y);
    const z = c1.z;
    const verts = new Float32Array([
      minX, minY, z,
      maxX, minY, z,
      maxX, maxY, z,
      minX, maxY, z,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    if (!this.rectPreview) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      const mat = new THREE.MeshBasicMaterial({
        color: PREVIEW_COLOR, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false,
      });
      this.rectPreview = new THREE.Mesh(geo, mat);
      this.ctx.viewport.scene.add(this.rectPreview);

      const outlineGeo = new THREE.BufferGeometry();
      outlineGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const outlineMat = new THREE.LineBasicMaterial({ color: PREVIEW_OUTLINE, depthTest: false });
      this.rectOutline = new THREE.LineLoop(outlineGeo, outlineMat);
      this.rectOutline.renderOrder = 1000;
      this.ctx.viewport.scene.add(this.rectOutline);
    } else {
      const posAttr = this.rectPreview.geometry.getAttribute('position') as THREE.BufferAttribute;
      (posAttr.array as Float32Array).set(verts);
      posAttr.needsUpdate = true;
      const outlineAttr = this.rectOutline!.geometry.getAttribute('position') as THREE.BufferAttribute;
      (outlineAttr.array as Float32Array).set(verts);
      outlineAttr.needsUpdate = true;
    }
  }

  private updateBoxPreview(c1: THREE.Vector3, c2: THREE.Vector3, h: number): void {
    // ADR-103-δ-2 (Z-up): rect spans XY (z=const), height extrudes ±Z.
    const minX = Math.min(c1.x, c2.x), maxX = Math.max(c1.x, c2.x);
    const minY = Math.min(c1.y, c2.y), maxY = Math.max(c1.y, c2.y);
    const z0 = c1.z;
    const z1 = c1.z + h;
    // Rebuild as BoxGeometry sized to dims (Three.js local: X=w, Y=d, Z=|h|).
    const w = maxX - minX, d = maxY - minY;
    if (this.boxPreview) {
      this.ctx.viewport.scene.remove(this.boxPreview);
      this.boxPreview.geometry.dispose();
    }
    if (this.boxOutline) {
      this.ctx.viewport.scene.remove(this.boxOutline);
      this.boxOutline.geometry.dispose();
    }
    const geo = new THREE.BoxGeometry(w, d, Math.abs(h));
    const mat = new THREE.MeshBasicMaterial({
      color: PREVIEW_COLOR, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false,
    });
    this.boxPreview = new THREE.Mesh(geo, mat);
    this.boxPreview.position.set(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (z0 + z1) / 2,
    );
    this.ctx.viewport.scene.add(this.boxPreview);

    const edges = new THREE.EdgesGeometry(geo);
    const outlineMat = new THREE.LineBasicMaterial({ color: PREVIEW_OUTLINE, depthTest: false });
    this.boxOutline = new THREE.LineSegments(edges, outlineMat);
    this.boxOutline.position.copy(this.boxPreview.position);
    this.boxOutline.renderOrder = 1000;
    this.ctx.viewport.scene.add(this.boxOutline);
  }

  cleanup(): void {
    this.phase = 'idle';
    this.corner1 = null;
    this.corner2 = null;
    if (this.rectPreview) {
      this.ctx.viewport.scene.remove(this.rectPreview);
      this.rectPreview.geometry.dispose();
      (this.rectPreview.material as THREE.Material).dispose();
      this.rectPreview = null;
    }
    if (this.rectOutline) {
      this.ctx.viewport.scene.remove(this.rectOutline);
      this.rectOutline.geometry.dispose();
      (this.rectOutline.material as THREE.Material).dispose();
      this.rectOutline = null;
    }
    if (this.boxPreview) {
      this.ctx.viewport.scene.remove(this.boxPreview);
      this.boxPreview.geometry.dispose();
      (this.boxPreview.material as THREE.Material).dispose();
      this.boxPreview = null;
    }
    if (this.boxOutline) {
      this.ctx.viewport.scene.remove(this.boxOutline);
      this.boxOutline.geometry.dispose();
      (this.boxOutline.material as THREE.Material).dispose();
      this.boxOutline = null;
    }
  }
}
