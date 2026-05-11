/**
 * Rotate Tool — CAD 스타일 3-click 회전 (AutoCAD ROTATE 방식).
 *
 * 흐름:
 *   1. 면 선택 후 Q
 *   2. 1st click: 기준점 (base point / pivot)
 *   3. 2nd click: 참조 방향 (reference vector) — 시작 각도 정의
 *   4. 드래그 중: 목표 방향 (target vector) 미리보기 + 각도 표시
 *   5. 3rd click: 확정 or VCB 숫자 입력
 *
 * 축 지정: 화살표 키로 X/Y/Z 축 잠금 가능.
 *          기본은 화면 뷰에 수직인 축 (또는 Y축 fallback).
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';

type Phase = 'idle' | 'pick-base' | 'pick-reference' | 'pick-target';

type Target =
  | { kind: 'faces'; ids: number[] }
  | { kind: 'verts'; ids: number[]; edgeCount: number };

export class RotateTool implements ITool {
  readonly name = 'rotate';

  private ctx: ToolContext;
  private phase: Phase = 'idle';
  private target: Target | null = null;

  private basePoint: THREE.Vector3 | null = null;
  private referencePoint: THREE.Vector3 | null = null;
  private rotationAxis: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 };
  /** 현재 회전 축 레이블 ('X' | 'Y' | 'Z') */
  private axisLabel: 'X' | 'Y' | 'Z' = 'Y';

  /** 최종 적용될 누적 각도 (도) — preview 중 incremental 적용된 합계 */
  private appliedAngleDeg: number = 0;
  /** 현재 preview 각도 (아직 미확정) — 3rd click 전 상태 */
  private previewAngleDeg: number = 0;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  /** 선택을 회전 대상으로 변환. 면 우선, 없으면 에지→정점. */
  private resolveTarget(): Target | null {
    const faces = this.ctx.getSelectedFaces();
    if (faces.length > 0) return { kind: 'faces', ids: faces };
    const edges = this.ctx.selection.getSelectedEdges();
    if (edges.length === 0) return null;
    const vertSet = new Set<number>();
    for (const eid of edges) {
      const eps = this.ctx.bridge.getEdgeEndpoints(eid);
      if (eps.length === 2) { vertSet.add(eps[0]); vertSet.add(eps[1]); }
    }
    if (vertSet.size === 0) return null;
    return { kind: 'verts', ids: Array.from(vertSet), edgeCount: edges.length };
  }

  private rotate(t: Target, cx: number, cy: number, cz: number,
                 ax: number, ay: number, az: number, deg: number): void {
    if (t.kind === 'faces') {
      this.ctx.bridge.rotateFaces(t.ids, cx, cy, cz, ax, ay, az, deg);
    } else {
      this.ctx.bridge.rotateVerts(t.ids, cx, cy, cz, ax, ay, az, deg);
    }
  }

  /** 대상의 중심점 (legacy VCB용). */
  private targetCentroid(t: Target): THREE.Vector3 | null {
    if (t.kind === 'faces') {
      return this.ctx.bridge.facesCentroid(t.ids);
    }
    const sum = new THREE.Vector3();
    let n = 0;
    for (const v of t.ids) {
      const p = this.ctx.bridge.getVertexPos(v);
      if (p) { sum.x += p[0]; sum.y += p[1]; sum.z += p[2]; n++; }
    }
    if (n === 0) return null;
    return sum.multiplyScalar(1 / n);
  }

  onActivate(): void {
    const t = this.resolveTarget();
    if (!t) {
      Toast.info('회전할 면 또는 에지를 먼저 선택하세요', 2500);
      return;
    }
    this.target = t;
    this.phase = 'pick-base';
    // 시작 시 축 기본값 해결 — axisLock 있으면 그것, 없으면 Y
    this.applyAxisFromLabel(this.inferInitialAxis());
    Toast.info(`① 기준점(회전 중심)을 클릭하세요 · 축: ${this.axisLabel} (X/Y/Z로 변경)`, 3500);
    debugLog('[RotateTool] Activated — awaiting base point, axis=', this.axisLabel);
  }

  private inferInitialAxis(): 'X' | 'Y' | 'Z' {
    const ax = this.ctx.axisLock || this.ctx.inferredAxis;
    if (ax === 'x') return 'X';
    if (ax === 'z') return 'Z';
    return 'Y';
  }

  private applyAxisFromLabel(label: 'X' | 'Y' | 'Z'): void {
    this.axisLabel = label;
    if (label === 'X') this.rotationAxis = { x: 1, y: 0, z: 0 };
    else if (label === 'Z') this.rotationAxis = { x: 0, y: 0, z: 1 };
    else this.rotationAxis = { x: 0, y: 1, z: 0 };
  }

  onDeactivate(): void {
    this.cleanup();
  }

  /** axisLock에 따라 회전축 선택 — 기본 Y */
  private resolveRotationAxis(): { x: number; y: number; z: number } {
    const ax = this.ctx.axisLock || this.ctx.inferredAxis;
    if (ax === 'x') return { x: 1, y: 0, z: 0 };
    if (ax === 'z') return { x: 0, y: 0, z: 1 };
    return { x: 0, y: 1, z: 0 };
  }

  /** 회전축 기준 평면에서의 각도 계산 — radians */
  private angleInRotationPlane(p: THREE.Vector3, center: THREE.Vector3): number {
    const ax = this.rotationAxis;
    if (ax.x === 1) return Math.atan2(p.z - center.z, p.y - center.y); // YZ
    if (ax.z === 1) return Math.atan2(p.y - center.y, p.x - center.x); // XY
    return Math.atan2(p.z - center.z, p.x - center.x);                 // XZ (Y축)
  }

  onMouseDown(_e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!point) return;

    if (this.phase === 'pick-base') {
      // ① 기준점 확정
      this.basePoint = point.clone();
      this.rotationAxis = this.resolveRotationAxis();
      this.ctx.snap.setReferencePoint(point);
      this.phase = 'pick-reference';
      const axLabel = this.rotationAxis.x === 1 ? 'X'
        : this.rotationAxis.z === 1 ? 'Z' : 'Y';
      Toast.info(`② 참조 방향을 클릭하세요 (${axLabel}축 회전)`, 2500);
      debugLog('[Rotate] Base point set:', point);
      return;
    }

    if (this.phase === 'pick-reference') {
      // ② 참조 방향 확정
      if (!this.basePoint) return;
      if (point.distanceTo(this.basePoint) < 1) {
        Toast.warning('참조점이 기준점과 너무 가까움', 2000);
        return;
      }
      this.referencePoint = point.clone();
      this.ctx.snap.setReferencePoint(point);
      this.phase = 'pick-target';
      this.appliedAngleDeg = 0;
      this.previewAngleDeg = 0;
      Toast.info('③ 목표 방향 클릭 또는 각도 입력', 3000);
      debugLog('[Rotate] Reference set:', point);
      return;
    }

    if (this.phase === 'pick-target') {
      // ③ 목표 방향 확정 — 현재 preview 각도로 확정
      this.commit();
      this.cleanup();
      return;
    }
  }

  onMouseMove(_e: MouseEvent, point: THREE.Vector3 | null): void {
    if (this.phase !== 'pick-target' || !point || !this.basePoint || !this.referencePoint) return;

    const startAngle = this.angleInRotationPlane(this.referencePoint, this.basePoint);
    const currentAngle = this.angleInRotationPlane(point, this.basePoint);
    let deltaRad = currentAngle - startAngle;
    while (deltaRad > Math.PI) deltaRad -= 2 * Math.PI;
    while (deltaRad < -Math.PI) deltaRad += 2 * Math.PI;
    const targetDeg = deltaRad * (180 / Math.PI);

    // Incremental 적용 — 이전 preview와 차이만 회전
    const incDeg = targetDeg - this.appliedAngleDeg;
    if (Math.abs(incDeg) > 0.1 && this.target) {
      const ax = this.rotationAxis;
      this.rotate(this.target,
        this.basePoint.x, this.basePoint.y, this.basePoint.z,
        ax.x, ax.y, ax.z,
        incDeg,
      );
      this.appliedAngleDeg = targetDeg;
      this.previewAngleDeg = targetDeg;
      this.ctx.syncMesh();

      const axLabel = ax.x === 1 ? 'X' : ax.z === 1 ? 'Z' : 'Y';
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: this.basePoint.clone(), to: this.referencePoint.clone(),
          text: '참조', color: '#868e96' },
        { from: this.basePoint.clone(), to: point.clone(),
          text: `${targetDeg.toFixed(1)}° · ${axLabel}축`, color: '#da77f2' },
      ]);
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // pick-target 단계에서 Esc — preview 회전을 역방향으로 되돌림
      if (this.phase === 'pick-target' && this.basePoint && this.target
          && Math.abs(this.appliedAngleDeg) > 0.001) {
        const ax = this.rotationAxis;
        this.rotate(this.target,
          this.basePoint.x, this.basePoint.y, this.basePoint.z,
          ax.x, ax.y, ax.z,
          -this.appliedAngleDeg,
        );
        this.ctx.syncMesh();
      }
      this.cleanup();
      Toast.info('회전 취소됨', 1500);
      return;
    }

    // X/Y/Z 축 전환 (대소문자 무관, 수정자 없을 때만)
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && this.phase !== 'idle') {
      const k = e.key.toUpperCase();
      if (k === 'X' || k === 'Y' || k === 'Z') {
        e.preventDefault();
        this.switchAxis(k as 'X' | 'Y' | 'Z');
      }
    }
  }

  /** 활성 상태에서 축 변경 — pick-target이면 preview 되감고 새 축으로 재적용 */
  private switchAxis(label: 'X' | 'Y' | 'Z'): void {
    if (this.axisLabel === label) return;

    if (this.phase === 'pick-target' && this.basePoint && this.target
        && Math.abs(this.appliedAngleDeg) > 0.001) {
      // 기존 축으로 적용된 preview 회전 되감기
      const oldAx = this.rotationAxis;
      this.rotate(this.target,
        this.basePoint.x, this.basePoint.y, this.basePoint.z,
        oldAx.x, oldAx.y, oldAx.z,
        -this.appliedAngleDeg,
      );
      this.appliedAngleDeg = 0;
      this.previewAngleDeg = 0;
      this.ctx.syncMesh();
    }

    this.applyAxisFromLabel(label);
    Toast.info(`축 전환 → ${label}축 회전`, 1500);
    debugLog('[Rotate] Axis switched to', label);
  }

  applyVCBValue(value: number): void {
    // VCB는 각도 값 직접 입력 — 어느 phase든 base 확정 후면 작동.
    if (this.phase === 'idle') {
      // 선택 없이 VCB만 호출 — 기본 centroid 사용 (레거시 호환)
      const t = this.resolveTarget();
      if (!t) {
        Toast.info('회전할 면 또는 에지를 먼저 선택하세요', 2000);
        return;
      }
      const centroid = this.targetCentroid(t);
      if (!centroid) return;
      const ax = this.resolveRotationAxis();
      this.rotate(t,
        centroid.x, centroid.y, centroid.z,
        ax.x, ax.y, ax.z, value);
      this.ctx.syncMesh();
      debugLog(`[VCB/Rotate] legacy centroid ${value}° → ${t.kind}`);
      return;
    }

    if (this.phase === 'pick-target' && this.basePoint && this.target) {
      // CAD 방식 — preview 상태에서 VCB로 정확한 각도 지정
      const incDeg = value - this.appliedAngleDeg;
      if (Math.abs(incDeg) > 0.001) {
        const ax = this.rotationAxis;
        this.rotate(this.target,
          this.basePoint.x, this.basePoint.y, this.basePoint.z,
          ax.x, ax.y, ax.z, incDeg);
        this.appliedAngleDeg = value;
        this.ctx.syncMesh();
      }
      this.cleanup();
      return;
    }

    if (this.phase === 'pick-base' || this.phase === 'pick-reference') {
      Toast.warning('기준점·참조점을 먼저 클릭한 뒤 각도를 입력하세요', 3000);
    }
  }

  /** 확정 — preview 각도 그대로 유지 (이미 적용됨) */
  private commit(): void {
    debugLog(`[Rotate] Committed ${this.appliedAngleDeg.toFixed(2)}°`);
  }

  isBusy(): boolean {
    return this.phase !== 'idle';
  }

  cleanup(): void {
    this.phase = 'idle';
    this.basePoint = null;
    this.referencePoint = null;
    this.target = null;
    this.appliedAngleDeg = 0;
    this.previewAngleDeg = 0;
    this.ctx.dimLabel.clear();
    this.ctx.snap.setReferencePoint(null);
  }
}
