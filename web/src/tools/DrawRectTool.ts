/**
 * Draw Rectangle Tool — Face-aware drawing plane via getDrawPlane SSOT
 * (ADR-181), with cardinal ground z=0 invariant preserved (LOCKED #63/#7/#43).
 *
 * 사용자 결재 흐름:
 * > (2026-05-18) "rect 명령 제거하고 새로 만듭니다. 무조건 z=0에서
 * >  그려져야 합니다." → PR #101 cardinal-strict rewrite.
 * > (2026-06-01) "rect는 입체면에 작성이 안됌" → ADR-178 face-aware.
 * > (2026-06-01) "보이는 면에 커서를 가져가면 도형을 그려야 합니다. 서클은
 * >  되는데 rect는 안됩니다. 서클과 차이점을 검토하세요." → ADR-181:
 * >  DrawCircle 과 동일한 `getDrawPlane` SSOT 로 통일.
 *
 * Plane resolution (ADR-181 — `resolvePlane`, DrawCircleTool 과 동일 SSOT):
 *   - `ctx.getDrawPlane(e)` 단일 진실 원천 (메타-원칙 #4):
 *       face hit (ADR-140 surface-aware) → 그 face 의 plane (onFace:true)
 *       plane lock (ADR-166) auto-unlock-on-different-plane
 *       sticky fallback (ADR-164) — pick 순간 miss 에도 직전 plane 유지
 *       sketch plane (user explicit)
 *       view-mode default (3d/top/bottom→Z=0 / front/back→Y=0 / right/left→X=0)
 *
 * **LOCKED #63 z=0 invariant 보존**:
 *   - face / sketch / plane-lock 가 *아닌* cardinal 기본 평면 (빈 ground /
 *     wall-view default) → cardinal-axis 좌표 = exactly 0 강제 (drift 차단).
 *   - 즉 빈 공간 그리기는 여전히 정확히 z=0 (또는 y=0 / x=0).
 *
 * 왜 DrawRect 만 깨졌었나 (ADR-181 진단):
 *   - DrawCircle/Polygon/Arc/Bezier/Freehand 는 이미 getDrawPlane 사용 →
 *     보이는 면에 그려짐. DrawRect 만 PR #101 rewrite 에서 자체 cardinal
 *     경로로 갈라졌고, ADR-178 의 `resolveFacePlane` 은 getDrawPlane 의
 *     sticky / lock / surface-aware robustness 가 전무 → pick 살짝 빗나가면
 *     null → ground 로 떨어짐. 본 도구는 그 정합을 회복.
 *
 * Anchor:
 *   - 메타-원칙 #4 (SSOT — getDrawPlane 단일 진실 원천)
 *   - LOCKED #7 ADR-026 P12 (cardinal snap SSOT — defense layer 2, 1e-3 tol)
 *   - LOCKED #43 ADR-103 (Z-up + XY ground = Z=0 plane)
 *   - LOCKED #63 (z=0 invariant — !onFace 일 때 보존)
 *   - ADR-140 (surface-aware getDrawPlane) / ADR-164 (sticky) / ADR-166 (lock)
 *   - 메타-원칙 #14 (면은 닫힌 경계로부터 유도된다 — 그 경계는 정확한 평면 위)
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';

/** Max distance from first click — generous (200 m) to accommodate
 *  large layouts. Only protects against grazing-ray runaway intersections. */
const MAX_DRAW_DISTANCE = 200000;

/** Min RECT width/height (mm) to accept commit — 0.001 mm to allow precision work. */
const MIN_RECT_DIMENSION = 0.001;

/** ADR-179 — coplanarity tolerance (mm) for "the cursor's picked face hit lies
 *  on the locked drawing plane". Faces are ≥ mm apart, so 1mm cleanly accepts
 *  the same plane and rejects a different (off-plane) face the cursor drifts
 *  over → precise on-face point vs grazing ray∩plane blowup. */
const COPLANAR_PICK_TOL = 1.0;

type ZeroAxis = 'x' | 'y' | 'z';

interface CardinalPlane {
  normal: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;
  /** Which axis coord is force-assigned to `zeroValue`. */
  zeroAxis: ZeroAxis;
  /** Signed plane offset along `normal` (`normal·p`). Cardinal ground = 0,
   *  cardinal face at z=200 = 200, slanted face = normal·hitPoint. */
  zeroValue: number;
  /** True if from sketch session (user explicit); false if cardinal/face. */
  isSketch: boolean;
  /**
   * ADR-179 — true when this plane was resolved from a solid-face hit
   * (resolveFacePlane). Drives the on-face preview color so the user can
   * tell at a glance they are drawing on a face plane (vs ground).
   */
  isFace?: boolean;
  /**
   * ADR-178 — when true, the cardinal-axis coord is force-assigned to
   * `zeroValue` (drift defense for axis-aligned planes: ground + cardinal
   * faces). When false (non-cardinal/slanted face plane), the ray→plane
   * projection is trusted as-is (no axis force).
   */
  forceCardinal: boolean;
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
      // ═══ First click: lock plane (face-aware, ADR-181 SSOT) + project start ═══
      // ADR-181: DrawCircle 와 동일하게 canonical `ctx.getDrawPlane(e)` 사용
      //   (face hit + plane lock + sticky fallback + sketch + ADR-140
      //   surface-aware). 빈 공간 → cardinal ground (z=0 강제 보존, !onFace).
      const plane = this.resolvePlane(e, point);
      const start = this.projectClickToCardinalPlane(e, point, plane);
      if (!start) return;
      this.plane = plane;
      this.rectStart = start;
      this.ctx.snap.setReferencePoint(start);
      // ADR-166 β-2 — first_click plane lock (idempotent: no-op when
      // already locked, L-166-2). Cross-tool 유지 활성화: 후속 도구
      // (DrawCircle / DrawLine 등) 가 같은 plane 강제 사용.
      this.ctx.lockPlane?.({
        origin: start,
        normal: plane.normal,
        up: plane.up,
        source: 'first_click',
      });
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
      return { normal, up, right, zeroAxis, zeroValue, isSketch: true, forceCardinal: true };
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
          forceCardinal: true,
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
          forceCardinal: true,
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
          forceCardinal: true,
        };
    }
  }

  /**
   * ADR-181 — Unified face-aware drawing plane via the canonical
   * `ctx.getDrawPlane(e)` SSOT (메타-원칙 #4), **exactly like DrawCircleTool**.
   *
   * 사용자 결재 2026-06-01:
   * > "보이는 면에 커서를 가져가면 도형을 그려야 합니다. 서클은 되는데
   * >  rect는 안됩니다. 서클과 차이점을 검토하세요."
   *
   * 진단 (Claude Preview ground-truth): DrawCircle 은 `ctx.getDrawPlane(e)` 를
   * 쓴다 — 이 캐논 경로는 face hit (ADR-140 surface-aware) + plane lock
   * auto-unlock (ADR-166) + **sticky fallback** (ADR-164) + sketch 를 모두
   * 처리한다. DrawRect 의 (ADR-178) `resolveFacePlane` 은 그 robustness 가
   * *전무* 했다 — `viewport.pick` 이 살짝 빗나가면 (실제 마우스의 가장자리/
   * 경사각/순간 miss) `null` 을 반환해 `resolveCardinalPlane` (= ground z=0)
   * 으로 떨어졌고, 그래서 "면이 아닌 다른 위치에 생성" 됐다. DrawCircle 은
   * 같은 pick miss 에도 sticky fallback 으로 면 plane 을 유지한다.
   *
   * 본 메서드가 그 divergence 를 제거한다 — DrawRect 가 DrawCircle 과 *동일한*
   * face-aware 견고성을 얻는다.
   *
   * **LOCKED #63 z=0 invariant 보존**: face / sketch / plane-lock 가 *아닌*
   * cardinal 기본 평면 (빈 ground / wall-view default) 은 zeroValue = 0 강제.
   */
  private resolvePlane(e: MouseEvent, point: THREE.Vector3 | null): CardinalPlane {
    const dp = this.ctx.getDrawPlane(e);
    const normal = dp.normal.clone().normalize();
    const up = dp.up.clone().normalize();
    const right = (dp.right
      ? dp.right.clone()
      : new THREE.Vector3().crossVectors(up, normal)).normalize();
    const onFace = dp.onFace === true;
    const isSketch = !!this.ctx.getSketchInfo?.();

    // Dominant cardinal axis (drift defense for axis-aligned planes).
    // Non-cardinal (slanted / tangent) plane → trust ray→plane (no force).
    let zeroAxis: ZeroAxis = 'z';
    let forceCardinal = false;
    if (Math.abs(normal.x) > 0.999) { zeroAxis = 'x'; forceCardinal = true; }
    else if (Math.abs(normal.y) > 0.999) { zeroAxis = 'y'; forceCardinal = true; }
    else if (Math.abs(normal.z) > 0.999) { zeroAxis = 'z'; forceCardinal = true; }

    // Plane offset (zeroValue along normal):
    //   · face / sketch / plane-lock → normal · referencePoint (plane's offset)
    //   · cardinal ground/wall-view default → 0 (LOCKED #63 z=0 invariant)
    // dp.origin is set for plane-lock (ADR-166) and surface-aware (ADR-140);
    // else the actual 3D click point carries the offset. Fall back to a fresh
    // face pick when `point` is null but a face is under the cursor.
    let ref: THREE.Vector3 | null = dp.origin ?? point ?? null;
    if (!ref && onFace && typeof this.ctx.viewport?.pick === 'function') {
      const h = this.ctx.viewport.pick(e.clientX, e.clientY);
      if (h && h.point) ref = h.point;
    }
    let zeroValue = 0;
    if ((onFace || isSketch || dp.origin != null) && ref) {
      zeroValue = normal.dot(ref);
    }

    return { normal, up, right, zeroAxis, zeroValue, isSketch, forceCardinal, isFace: onFace };
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

    // ADR-179 precision — if the cursor is over a face *coplanar* with the
    // locked plane, use the exact raycast hit point. On grazing planes (a face
    // viewed at a shallow angle), ray∩plane shoots the projected point far away
    // (사용자 시연: RECT 미리보기 9,893mm 폭발). The face pick gives the precise
    // in-plane point. Off-plane cursors (different face / empty space) fall
    // through to ray∩plane below → infinite-plane extension (사용자 결재 보존).
    if (typeof this.ctx.viewport?.pick === 'function') {
      const fhit = this.ctx.viewport.pick(e.clientX, e.clientY);
      if (fhit && fhit.point) {
        const d = plane.normal.x * fhit.point.x
                + plane.normal.y * fhit.point.y
                + plane.normal.z * fhit.point.z - plane.zeroValue;
        if (Math.abs(d) < COPLANAR_PICK_TOL) {
          const pt = fhit.point.clone();
          this.forceCardinalAxis(pt, plane);
          if (this.rectStart && pt.distanceTo(this.rectStart) > MAX_DRAW_DISTANCE) return null;
          return pt;
        }
      }
    }

    const three = new THREE.Plane(plane.normal, -plane.zeroValue);
    const target = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(three, target);
    if (!hit) return null;

    // **THE INVARIANT**: force cardinal-axis coord = exact zeroValue
    this.forceCardinalAxis(target, plane);

    if (this.rectStart && target.distanceTo(this.rectStart) > MAX_DRAW_DISTANCE) return null;
    return target;
  }

  /**
   * In-place force point's cardinal-axis coord to plane.zeroValue (exact).
   * ADR-178: skipped for non-cardinal (slanted) face planes — the ray→plane
   * projection is already exact, and forcing a single axis would corrupt it.
   */
  private forceCardinalAxis(pt: THREE.Vector3, plane: CardinalPlane): void {
    if (!plane.forceCardinal) return;
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

    // ADR-179 — on-face preview clarity. When drawing on a solid face the
    // preview is amber + more opaque so the user can tell at a glance the
    // rect is being placed on a face plane (vs blue on the ground). The
    // rect still extends onto the face's infinite plane (사용자 결재
    // "무한 plane 연장 유지") — this only makes *where* it lands legible.
    const onFace = this.plane.isFace === true;
    const fillColor = onFace ? 0xffaa33 : 0x4488ff;
    const fillOpacity = onFace ? 0.4 : 0.3;
    const lineColor = onFace ? 0xff8800 : 0x2266dd;

    // ── Filled preview ──
    const geo = new THREE.PlaneGeometry(absW, absH);
    const mat = new THREE.MeshBasicMaterial({
      color: fillColor,
      transparent: true,
      opacity: fillOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.rectPreview = new THREE.Mesh(geo, mat);

    // ADR-179 fix — orient the filled preview with the EXPLICIT in-plane basis
    // (right=X, up=Y, normal=Z). `setFromUnitVectors(+Z, n)` left the in-plane
    // twist arbitrary → the fill's width/height axes did not match the
    // outline's plane.right/plane.up → preview/outline mismatch (사용자 시연:
    // amber 채움이 외곽선과 다른 방향). makeBasis ties both to the same basis.
    const basis = new THREE.Matrix4().makeBasis(this.plane.right, this.plane.up, n);
    this.rectPreview.quaternion.setFromRotationMatrix(basis);
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
    const lineMat = new THREE.LineBasicMaterial({ color: lineColor, linewidth: 1 });
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
