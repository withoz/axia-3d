/**
 * Draw Rectangle Tool — Cardinal Ground Plane STRICT (LOCKED #7 + #43)
 *
 * 사용자 결재 (2026-05-18, rewrite):
 * > "rect 명령 제거하고 새로 만듭니다. 무조건 z=0에서 그려져야 합니다."
 *
 * Invariant (canonical, ADR-046 P31 #4 정합):
 *   - **모든 vertex 의 cardinal axis 좌표 = exactly 0** (z=0 / y=0 / x=0)
 *   - View mode 기반 cardinal ground plane 결정:
 *       3d/top/bottom → normal=+Z, **z=0 강제** (LOCKED #43 ADR-103 Z-up)
 *       front/back    → normal=+Y, y=0 강제
 *       right/left    → normal=+X, x=0 강제
 *   - **face hit / ray-plane drift / snap drift 모두 무시** — cardinal
 *     projection 으로 0 강제 assign (수학적 truth = ground plane)
 *   - Sketch mode (user explicit): sketch plane 의 normal 이 cardinal 이면
 *     동일 projection, 아니면 sketch plane projection (사용자 explicit
 *     의도 보존)
 *
 * 폐기된 동작 (legacy DrawRectTool 의 결함 source):
 *   - face hit 시 onFace=true 의 plane 사용 → 다른 RECT 의 z drift 전파
 *   - ray-plane intersect 의 drift 가 cardinal snap (|z| < 1e-3) 통과
 *     못 하면 drift 누적
 *   - snap 결과의 다른 vertex z 가 그대로 사용됨
 *
 * 위 invariant 에 의해:
 *   - 어떤 mouse 위치에서 click 해도 vertex.z = exactly 0
 *   - 어떤 view 에서 click 해도 cardinal axis 좌표 = exactly 0
 *   - 다른 face 위 click 도 ground plane 으로 강제 projection
 *
 * Anchor:
 *   - LOCKED #7 ADR-026 P12 (cardinal snap SSOT — defense layer 2,
 *     bridge 단 1e-3 tol)
 *   - LOCKED #43 ADR-103 (Z-up + XY ground = Z=0 plane)
 *   - 메타-원칙 #14 (면은 닫힌 경계로부터 유도된다 — 그 경계는 정확한
 *     평면 위)
 *   - ADR-087 K-ζ canonical (legacy deletion + rewrite pattern)
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';

/** Max distance from first click — generous (200 m) to accommodate
 *  large layouts. Only protects against grazing-ray runaway intersections. */
const MAX_DRAW_DISTANCE = 200000;

/** Min RECT width/height (mm) to accept commit — 0.001 mm to allow precision work. */
const MIN_RECT_DIMENSION = 0.001;

type ZeroAxis = 'x' | 'y' | 'z';

interface CardinalPlane {
  normal: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;
  /** Which axis coord is force-assigned to 0. */
  zeroAxis: ZeroAxis;
  /** 0-coord plane offset (sketch mode may be nonzero; cardinal ground = 0). */
  zeroValue: number;
  /** True if from sketch session (user explicit); false if cardinal ground. */
  isSketch: boolean;
}

export class DrawRectTool implements ITool {
  readonly name = 'rect';

  private ctx: ToolContext;
  private rectStart: THREE.Vector3 | null = null;
  private plane: CardinalPlane | null = null;
  private rectPreview: THREE.Mesh | null = null;
  private rectOutline: THREE.LineLoop | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[DrawRectTool] Activated (cardinal-plane strict, z=0 forced)');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.rectStart) {
      // ═══ First click: lock cardinal plane + force start point to z=0 ═══
      const plane = this.resolveCardinalPlane();
      const start = this.projectClickToCardinalPlane(e, point, plane);
      if (!start) return;
      this.plane = plane;
      this.rectStart = start;
      this.ctx.snap.setReferencePoint(start);
    } else {
      // ═══ Second click: project to cardinal plane + commit ═══
      const planePoint = this.projectClickToCardinalPlane(e, point, this.plane!);
      if (!planePoint) {
        // eslint-disable-next-line no-console
        console.warn('[DrawRectTool] 2nd click: projectClickToCardinalPlane returned null — ray-plane intersect fail or beyond MAX_DRAW_DISTANCE. cleanup.');
        this.cleanup();
        return;
      }

      const { width, height } = this.computeLocalSize(this.rectStart, planePoint, this.plane!);
      const absW = Math.abs(width);
      const absH = Math.abs(height);

      if (absW >= MIN_RECT_DIMENSION && absH >= MIN_RECT_DIMENSION) {
        const center = this.computeCenter(this.rectStart, planePoint, this.plane!);
        const n = this.plane!.normal;
        const u = this.plane!.up;

        // ADR-087 K-ε — kernel-aware drawRectAsShape only path.
        // Bridge applies cardinal snap as defense-in-depth (LOCKED #7).
        const shapeRaw = this.ctx.bridge.drawRectAsShape(
          center.x, center.y, center.z,
          n.x, n.y, n.z,
          u.x, u.y, u.z,
          absW, absH,
        );
        if (typeof shapeRaw === 'number' && shapeRaw < 0) {
          // eslint-disable-next-line no-console
          console.warn(`[DrawRectTool] drawRectAsShape returned ${shapeRaw} — engine rejected. center=(${center.x},${center.y},${center.z}), normal=(${n.x},${n.y},${n.z}), size=${absW}×${absH}`);
        } else {
          debugLog(`[Rect] Created on ${this.plane!.isSketch ? 'sketch' : 'cardinal'} plane (axis=${this.plane!.zeroAxis}=${this.plane!.zeroValue}): ${absW.toFixed(2)} × ${absH.toFixed(2)}`);
          // ADR-164 β-2 — Sticky last drawn plane (Q1=a default — face
          // 합성 *성공* 후만 호출). Source = 'sketch' if sketch mode,
          // else 'view' (cardinal plane). 'face' source는 sketch-aware
          // 도구들이 미래에 향상 가능.
          this.ctx.setLastDrawnPlane?.({
            origin: center,
            normal: n,
            up: u,
            source: this.plane!.isSketch ? 'sketch' : 'view',
          });
        }
        this.ctx.syncMesh();
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[DrawRectTool] 2nd click: degenerate RECT (${absW.toFixed(4)} × ${absH.toFixed(4)} mm < ${MIN_RECT_DIMENSION} mm). cleanup.`);
      }
      this.cleanup();
    }
  }

  onMouseMove(e: MouseEvent, _point: THREE.Vector3 | null): void {
    if (!this.rectStart || !this.plane) {
      this.removePreview();
      return;
    }
    const planePoint = this.projectClickToCardinalPlane(e, null, this.plane);
    if (!planePoint) {
      this.removePreview();
      return;
    }
    const { width, height } = this.computeLocalSize(this.rectStart, planePoint, this.plane);
    const absW = Math.abs(width);
    const absH = Math.abs(height);
    if (absW < 0.001 && absH < 0.001) return;
    this.updatePreview(this.rectStart, planePoint, absW, absH);
    if (absW > 0.1 || absH > 0.1) {
      this.updateDimLabels(this.rectStart, planePoint, absW, absH);
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  applyVCBValue(value: number, value2?: number): void {
    const w = value;
    const h = value2 != null ? value2 : value;
    const plane = this.plane ?? this.resolveCardinalPlane();
    const origin = this.rectStart ?? new THREE.Vector3(0, 0, 0);

    const center = origin.clone()
      .addScaledVector(plane.right, w / 2)
      .addScaledVector(plane.up, h / 2);
    // Force cardinal axis = 0 (defense, plane vectors are exact cardinals)
    this.forceCardinalAxis(center, plane);

    this.ctx.bridge.drawRectAsShape(
      center.x, center.y, center.z,
      plane.normal.x, plane.normal.y, plane.normal.z,
      plane.up.x, plane.up.y, plane.up.z,
      w, h,
    );
    debugLog(`[VCB/Rect] ${w}×${h} on cardinal plane (axis=${plane.zeroAxis}=${plane.zeroValue})`);
    this.cleanup();
    this.ctx.syncMesh();
  }

  isBusy(): boolean {
    return this.rectStart !== null;
  }

  cleanup(): void {
    this.rectStart = null;
    this.plane = null;
    this.removePreview();
    this.ctx.dimLabel.clear();
    this.ctx.snap.setReferencePoint(null);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Cardinal plane resolution (CORE INVARIANT)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Resolve the *active* cardinal plane based on view mode + sketch session.
   *
   * Sketch mode (user explicit) takes precedence. Otherwise:
   *   3d/top/bottom → Z=0 (XY ground) per LOCKED #43 ADR-103 Z-up
   *   front/back    → Y=0 (XZ wall)
   *   right/left    → X=0 (YZ wall)
   */
  private resolveCardinalPlane(): CardinalPlane {
    const sketchInfo = this.ctx.getSketchInfo?.();
    if (sketchInfo) {
      // Sketch plane — user explicit. Determine zeroAxis from sketch normal.
      const n = sketchInfo.normal;
      let zeroAxis: ZeroAxis = 'z';
      if (Math.abs(n.x) > 0.999) zeroAxis = 'x';
      else if (Math.abs(n.y) > 0.999) zeroAxis = 'y';
      else if (Math.abs(n.z) > 0.999) zeroAxis = 'z';
      // For non-cardinal sketch plane, fall back to z (won't be force-applied
      // since |n.z| won't be > 0.999 — projection handled differently below).
      const zeroValue = zeroAxis === 'x'
        ? sketchInfo.origin.x
        : zeroAxis === 'y' ? sketchInfo.origin.y : sketchInfo.origin.z;
      // For sketch mode compute up/right from normal
      const normal = n.clone().normalize();
      const fallbackUp = Math.abs(normal.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const right = new THREE.Vector3().crossVectors(fallbackUp, normal).normalize();
      const up = new THREE.Vector3().crossVectors(normal, right).normalize();
      return { normal, up, right, zeroAxis, zeroValue, isSketch: true };
    }

    const vm = this.ctx.viewport.viewMode;
    switch (vm) {
      case 'front':
      case 'back':
        return {
          normal: new THREE.Vector3(0, 1, 0),
          up: new THREE.Vector3(0, 0, 1),
          right: new THREE.Vector3(1, 0, 0),
          zeroAxis: 'y',
          zeroValue: 0,
          isSketch: false,
        };
      case 'right':
      case 'left':
        return {
          normal: new THREE.Vector3(1, 0, 0),
          up: new THREE.Vector3(0, 0, 1),
          right: new THREE.Vector3(0, 1, 0),
          zeroAxis: 'x',
          zeroValue: 0,
          isSketch: false,
        };
      default:
        // 3d / top / bottom → XY ground (Z=0) per LOCKED #43 ADR-103 Z-up
        return {
          normal: new THREE.Vector3(0, 0, 1),
          up: new THREE.Vector3(0, 1, 0),
          right: new THREE.Vector3(1, 0, 0),
          zeroAxis: 'z',
          zeroValue: 0,
          isSketch: false,
        };
    }
  }

  /**
   * Project a click position onto the cardinal plane with **strict axis = 0
   * force** (the architectural invariant).
   *
   * **No snap dependency** (사용자 결재 2026-05-18 "스냅에 걸리는것 같습니다.
   * 작동이 제대로 되지 않습니다."):
   *   - DrawRectTool 의 ToolManager-supplied `point` (snap 통과 결과) 와
   *     ctx.getSnappedPoint 모두 *무시*. RECT 는 precision-first 도구 —
   *     사용자가 명시 click 한 위치 정확 반영.
   *   - 직접 mouse ray ∩ cardinal plane → cardinal axis = 0 강제.
   *   - snap re-introduction 은 별도 ADR (e.g., grid snap or VCB
   *     alignment) — DrawRectTool 의 single-call 패턴은 snap 도움
   *     필수 아님.
   *
   * Whatever is chosen, the cardinal-axis coord is **exactly assigned to
   * `plane.zeroValue`** — drift from any source is discarded.
   */
  private projectClickToCardinalPlane(
    e: MouseEvent,
    _point: THREE.Vector3 | null,
    plane: CardinalPlane,
  ): THREE.Vector3 | null {
    // **No snap dependency** — directly mouse ray ∩ cardinal plane.
    if (typeof this.ctx.getRay !== 'function') {
      // Test mock fallback: use _point if available + force cardinal.
      if (_point) {
        const result = _point.clone();
        this.forceCardinalAxis(result, plane);
        return result;
      }
      return null;
    }
    const ray = this.ctx.getRay(e);
    const three = new THREE.Plane(plane.normal, -plane.zeroValue);
    const target = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(three, target);
    if (!hit) return null;

    // **THE INVARIANT**: force cardinal-axis coord = exact zeroValue
    this.forceCardinalAxis(target, plane);

    if (this.rectStart && target.distanceTo(this.rectStart) > MAX_DRAW_DISTANCE) return null;
    return target;
  }

  /** In-place force point's cardinal-axis coord to plane.zeroValue (exact). */
  private forceCardinalAxis(pt: THREE.Vector3, plane: CardinalPlane): void {
    if (plane.zeroAxis === 'x') pt.x = plane.zeroValue;
    else if (plane.zeroAxis === 'y') pt.y = plane.zeroValue;
    else pt.z = plane.zeroValue;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Geometry computation (uses local right/up basis)
  // ═══════════════════════════════════════════════════════════════════

  private computeLocalSize(start: THREE.Vector3, end: THREE.Vector3, plane: CardinalPlane): { width: number; height: number } {
    const delta = new THREE.Vector3().subVectors(end, start);
    return {
      width: delta.dot(plane.right),
      height: delta.dot(plane.up),
    };
  }

  private computeCenter(start: THREE.Vector3, end: THREE.Vector3, plane: CardinalPlane): THREE.Vector3 {
    const { width, height } = this.computeLocalSize(start, end, plane);
    const center = start.clone()
      .addScaledVector(plane.right, width / 2)
      .addScaledVector(plane.up, height / 2);
    // Defense: cardinal axis = 0 (start.zeroAxis already 0, basis vectors exact)
    this.forceCardinalAxis(center, plane);
    return center;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Preview rendering
  // ═══════════════════════════════════════════════════════════════════

  private updatePreview(start: THREE.Vector3, end: THREE.Vector3, absW: number, absH: number): void {
    this.removePreview();
    if (!this.plane || absW < 0.001 || absH < 0.001) return;

    const center = this.computeCenter(start, end, this.plane);
    const n = this.plane.normal;

    // ── Filled preview ──
    const geo = new THREE.PlaneGeometry(absW, absH);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.rectPreview = new THREE.Mesh(geo, mat);

    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const quat = new THREE.Quaternion().setFromUnitVectors(defaultNormal, n);
    this.rectPreview.quaternion.copy(quat);
    const offset = center.clone().addScaledVector(n, 0.5);
    this.rectPreview.position.copy(offset);
    this.rectPreview.renderOrder = 998;
    this.ctx.viewport.scene.add(this.rectPreview);

    // ── Outline ──
    const { width, height } = this.computeLocalSize(start, end, this.plane);
    const r = this.plane.right;
    const u = this.plane.up;
    const hw = width / 2;
    const hh = height / 2;
    const corners = [
      center.clone().addScaledVector(r, -hw).addScaledVector(u, -hh).addScaledVector(n, 0.5),
      center.clone().addScaledVector(r,  hw).addScaledVector(u, -hh).addScaledVector(n, 0.5),
      center.clone().addScaledVector(r,  hw).addScaledVector(u,  hh).addScaledVector(n, 0.5),
      center.clone().addScaledVector(r, -hw).addScaledVector(u,  hh).addScaledVector(n, 0.5),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(corners);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x2266dd, linewidth: 1 });
    this.rectOutline = new THREE.LineLoop(lineGeo, lineMat);
    this.rectOutline.renderOrder = 999;
    this.ctx.viewport.scene.add(this.rectOutline);
  }

  private updateDimLabels(start: THREE.Vector3, end: THREE.Vector3, absW: number, absH: number): void {
    if (!this.plane) return;
    const center = this.computeCenter(start, end, this.plane);
    const { width, height } = this.computeLocalSize(start, end, this.plane);
    const r = this.plane.right;
    const u = this.plane.up;
    const hw = width / 2;
    const hh = height / 2;
    const gap = Math.max(absW, absH) * 0.08 + 50;
    const wFrom = center.clone().addScaledVector(r, -hw).addScaledVector(u, hh).addScaledVector(u, Math.sign(height) * gap / absH * Math.abs(hh) || gap);
    const wTo   = center.clone().addScaledVector(r,  hw).addScaledVector(u, hh).addScaledVector(u, Math.sign(height) * gap / absH * Math.abs(hh) || gap);
    const hFrom = center.clone().addScaledVector(r, hw).addScaledVector(u, -hh).addScaledVector(r, Math.sign(width) * gap / absW * Math.abs(hw) || gap);
    const hTo   = center.clone().addScaledVector(r, hw).addScaledVector(u,  hh).addScaledVector(r, Math.sign(width) * gap / absW * Math.abs(hw) || gap);

    this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
      { from: wFrom, to: wTo, text: this.ctx.units.format(absW), color: '#ff6b6b' },
      { from: hFrom, to: hTo, text: this.ctx.units.format(absH), color: '#51cf66' },
    ]);
  }

  private removePreview(): void {
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
  }
}
