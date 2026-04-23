/**
 * Draw Polygon Tool — Regular N-gon (SketchUp "Polygon" equivalent).
 *
 * Flow:
 *   tool activation → prompt for N (3~24), default 6
 *   1st click → set center + detect plane
 *   mouse move → preview polygon with radius = distance to cursor
 *   2nd click → commit
 *
 * Implementation: delegates to bridge.drawCircle with the chosen segment
 * count. A circle with 6 segments is a hexagonal face, 8 is an octagon,
 * etc. The DCEL mesh already treats such low-segment "circles" as
 * proper N-sided polygon faces.
 *
 * Like DrawCircleTool, all subsequent positions are projected onto the
 * drawing plane detected at the first click so the result is planar
 * even on tilted surfaces.
 */

import * as THREE from 'three';
import { ITool, ToolContext, DrawPlaneInfo } from './ITool';
import { debugLog } from '../utils/debug';

const MAX_DRAW_DISTANCE = 50000;

export class DrawPolygonTool implements ITool {
  readonly name = 'polygon';

  private ctx: ToolContext;
  private center: THREE.Vector3 | null = null;
  private preview: THREE.Line | null = null;
  private plane: DrawPlaneInfo | null = null;
  private drawPlane3: THREE.Plane | null = null;

  /** Number of sides — asked once per activation, stored for the session. */
  private sides: number = 6;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    // Prompt user for side count; remember last value via localStorage.
    const stored = parseInt(localStorage.getItem('axia:polygon:sides') ?? 'NaN', 10);
    const defaultN = Number.isFinite(stored) && stored >= 3 && stored <= 24 ? stored : 6;
    const input = prompt(
      '다각형 변의 수 (3~24)\n\n6 = 육각형 (벌집/기하)\n5 = 오각형\n8 = 팔각형 (볼트 헤드)',
      String(defaultN),
    );
    if (input === null) {
      // User cancelled — keep last sides and let the tool stay active (they
      // can press Esc to fully cancel, or just stop clicking).
      this.sides = defaultN;
      return;
    }
    const n = parseInt(input, 10);
    if (!Number.isFinite(n) || n < 3 || n > 24) {
      alert('3에서 24 사이의 숫자를 입력해주세요.');
      this.sides = defaultN;
      return;
    }
    this.sides = n;
    try { localStorage.setItem('axia:polygon:sides', String(n)); } catch { /* ignore */ }
    debugLog(`[Polygon] sides=${n}`);
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(_e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.center) {
      // First click — center + plane detection.
      if (!point) return;
      this.plane = this.ctx.getDrawPlane(_e);
      this.center = point.clone();
      this.drawPlane3 = new THREE.Plane().setFromNormalAndCoplanarPoint(
        this.plane.normal, this.center,
      );
      this.ctx.snap.setReferencePoint(point);
    } else {
      // Second click — commit.
      const planePoint = this.getPointOnDrawPlane(_e);
      if (!planePoint || !this.plane) { this.cleanup(); return; }
      const radius = this.center.distanceTo(planePoint);
      if (radius > 1) {
        const n = this.plane.normal;
        this.ctx.bridge.drawCircle(
          this.center.x, this.center.y, this.center.z,
          n.x, n.y, n.z,
          radius, this.sides,
        );
        debugLog(`[Polygon] ${this.sides}-gon R=${radius.toFixed(2)}`);
        this.ctx.syncMesh();
      }
      this.cleanup();
    }
  }

  onMouseMove(e: MouseEvent, _point: THREE.Vector3 | null): void {
    if (!this.center || !this.plane) { this.removePreview(); return; }
    const planePoint = this.getPointOnDrawPlane(e);
    if (!planePoint) { this.removePreview(); return; }
    const radius = this.center.distanceTo(planePoint);
    if (radius > 0.1) {
      this.updatePreview(this.center, radius);
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: this.center.clone(), to: planePoint,
          text: `${this.sides}-gon R ` + this.ctx.units.format(radius), color: '#da77f2' },
      ]);
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.cleanup();
  }

  applyVCBValue(value: number): void {
    if (!this.center || !this.plane) return;
    const n = this.plane.normal;
    this.ctx.bridge.drawCircle(
      this.center.x, this.center.y, this.center.z,
      n.x, n.y, n.z,
      value, this.sides,
    );
    debugLog(`[VCB/Polygon] ${this.sides}-gon R=${value}`);
    this.cleanup();
    this.ctx.syncMesh();
  }

  isBusy(): boolean { return this.center !== null; }

  cleanup(): void {
    this.center = null;
    this.plane = null;
    this.drawPlane3 = null;
    this.removePreview();
    this.ctx.dimLabel.clear();
    this.ctx.snap.setReferencePoint(null);
  }

  // ──────────────────────────────────────────────────────

  private getPointOnDrawPlane(e: MouseEvent): THREE.Vector3 | null {
    if (!this.drawPlane3 || !this.center) return null;
    const rawPt = this.ctx.get3DPoint(e);
    const snapped = this.ctx.getSnappedPoint(e, rawPt);
    if (snapped) return this.projectOntoPlane(snapped);
    const ray = this.ctx.getRay(e);
    const target = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(this.drawPlane3, target);
    if (!hit) return null;
    if (target.distanceTo(this.center) > MAX_DRAW_DISTANCE) return null;
    return target;
  }

  private projectOntoPlane(p: THREE.Vector3): THREE.Vector3 {
    if (!this.drawPlane3) return p;
    const projected = new THREE.Vector3();
    this.drawPlane3.projectPoint(p, projected);
    return projected;
  }

  private updatePreview(center: THREE.Vector3, radius: number): void {
    this.removePreview();
    if (!this.plane) return;

    // Build N vertices on a circle in the plane, rotating around center.
    const u = this.plane.right;
    const v = this.plane.up;
    const positions: number[] = [];
    for (let i = 0; i <= this.sides; i++) {
      const theta = (i / this.sides) * Math.PI * 2;
      const x = center.x + radius * (Math.cos(theta) * u.x + Math.sin(theta) * v.x);
      const y = center.y + radius * (Math.cos(theta) * u.y + Math.sin(theta) * v.y);
      const z = center.z + radius * (Math.cos(theta) * u.z + Math.sin(theta) * v.z);
      positions.push(x, y, z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xda77f2, transparent: true, opacity: 0.9 });
    this.preview = new THREE.Line(geo, mat);
    this.preview.renderOrder = 999;
    this.ctx.viewport.scene.add(this.preview);
  }

  private removePreview(): void {
    if (this.preview) {
      this.ctx.viewport.scene.remove(this.preview);
      this.preview.geometry.dispose();
      (this.preview.material as THREE.Material).dispose();
      this.preview = null;
    }
  }
}
