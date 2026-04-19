/**
 * ConstraintCommands — Level 1 one-shot parametric constraint operations.
 *
 * 사용자가 2개의 엔티티를 선택하고 명령을 실행하면 즉시 기하를 조정한다.
 * 지속적 관계는 저장하지 않는다(Level 2/3에서 constraint graph 도입 예정).
 *
 * 지원 연산
 * ─────────
 * - **makeParallel(edgeA, edgeB)**: edgeB를 자기 midpoint 기준으로 회전하여
 *   edgeA와 평행하게 만든다.
 * - **makePerpendicular(edgeA, edgeB)**: edgeB를 자기 midpoint 기준으로
 *   회전하여 edgeA와 수직이 되게 한다. 공통 평면은 두 엣지의 현 방향이
 *   span하는 평면(둘이 평행이면 임의 평면).
 * - **makeCollinear(edgeA, edgeB)**: edgeB를 edgeA 직선 위로 이동 + 정렬.
 *   (평행 정렬 + edgeA 라인으로 평행이동)
 *
 * 모든 연산은 단일 undo 트랜잭션.
 */

import * as THREE from 'three';
import type { WasmBridge } from '../bridge/WasmBridge';
import { debugLog } from '../utils/debug';

const EPS_ANGLE = 1e-9;

export class ConstraintCommands {
  constructor(private bridge: WasmBridge) {}

  // ───────────────────────────────────────────────────────────
  // Public API (Level 2 — persistent constraint graph)
  // ───────────────────────────────────────────────────────────

  /**
   * edgeB를 edgeA와 평행하게 만들고, 제약을 Scene에 영속 저장한다.
   * 이후 transform 연산이 일어날 때마다 Rust 엔진이 자동 재해결.
   * @returns 제약 ID (>=1) 성공, 0 실패
   */
  addParallel(edgeA: number, edgeB: number): number {
    const a = this.bridge.getEdgeEndpoints(edgeA);
    const b = this.bridge.getEdgeEndpoints(edgeB);
    if (a.length !== 2 || b.length !== 2) return 0;
    return this.bridge.addEdgeConstraint('parallel', a[0], a[1], b[0], b[1]);
  }

  addPerpendicular(edgeA: number, edgeB: number): number {
    const a = this.bridge.getEdgeEndpoints(edgeA);
    const b = this.bridge.getEdgeEndpoints(edgeB);
    if (a.length !== 2 || b.length !== 2) return 0;
    return this.bridge.addEdgeConstraint('perpendicular', a[0], a[1], b[0], b[1]);
  }

  addCollinear(edgeA: number, edgeB: number): number {
    const a = this.bridge.getEdgeEndpoints(edgeA);
    const b = this.bridge.getEdgeEndpoints(edgeB);
    if (a.length !== 2 || b.length !== 2) return 0;
    return this.bridge.addEdgeConstraint('collinear', a[0], a[1], b[0], b[1]);
  }

  addDistance(vA: number, vB: number, distance: number): number {
    if (!(distance > 0)) return 0;
    return this.bridge.addDistanceConstraint(vA, vB, distance);
  }

  // ───────────────────────────────────────────────────────────
  // Legacy one-shot API (Level 1) — kept for callers who want
  // non-persistent apply. Uses same math via client-side rotation.
  // ───────────────────────────────────────────────────────────

  /**
   * edgeB를 edgeA와 평행하게 만든다 (일회성 적용, 제약 저장 안 함).
   * edgeB의 midpoint는 유지되고 그 주위로 회전된다.
   * @returns 성공 시 true, 실패 시 false (+ bridge.lastError 세팅)
   */
  makeParallel(edgeA: number, edgeB: number): boolean {
    const a = this.edgeGeometry(edgeA);
    const b = this.edgeGeometry(edgeB);
    if (!a || !b) return false;

    const targetDir = a.dir.clone();
    return this.rotateEdgeToDirection(b, targetDir, 'makeParallel');
  }

  /**
   * edgeB를 edgeA와 수직으로 만든다 (공통 평면 내).
   * 공통 평면 법선 = normalize(dirA × dirB). 두 엣지가 거의 평행이면
   * 수직 방향이 정의되지 않으므로 실패 반환.
   */
  makePerpendicular(edgeA: number, edgeB: number): boolean {
    const a = this.edgeGeometry(edgeA);
    const b = this.edgeGeometry(edgeB);
    if (!a || !b) return false;

    // target direction = (a.dir × normal) for a chosen plane normal.
    // Use current dirB to construct the plane that contains both.
    const planeNormal = new THREE.Vector3().crossVectors(a.dir, b.dir);
    if (planeNormal.lengthSq() < 1e-12) {
      debugLog('[Constraint] makePerpendicular: edges nearly parallel — ambiguous plane');
      return false;
    }
    planeNormal.normalize();
    const targetDir = new THREE.Vector3().crossVectors(planeNormal, a.dir).normalize();
    // pick the sign that minimizes rotation from current dirB
    if (targetDir.dot(b.dir) < 0) targetDir.negate();

    return this.rotateEdgeToDirection(b, targetDir, 'makePerpendicular');
  }

  /**
   * edgeB를 edgeA와 같은 직선 위로 이동 + 정렬 (collinear).
   * 1) edgeB를 edgeA와 평행하도록 회전
   * 2) edgeB의 midpoint를 edgeA의 직선 위로 수평 이동
   */
  makeCollinear(edgeA: number, edgeB: number): boolean {
    const a = this.edgeGeometry(edgeA);
    const b = this.edgeGeometry(edgeB);
    if (!a || !b) return false;

    // Step 1: parallel align (rotate B around its midpoint to match A's dir)
    const targetDir = a.dir.clone();
    const rotated = this.rotateEdgeToDirection(b, targetDir, 'makeCollinear.rotate');
    if (!rotated) return false;

    // After rotation, re-fetch b geometry (positions changed)
    const b2 = this.edgeGeometry(edgeB);
    if (!b2) return false;

    // Step 2: translate B's midpoint onto A's infinite line.
    // Closest point on line A (passing through a.mid, direction a.dir) from b2.mid:
    //   target = a.mid + a.dir * ((b2.mid - a.mid) · a.dir)
    const fromAmidToBmid = b2.mid.clone().sub(a.mid);
    const projLen = fromAmidToBmid.dot(a.dir);
    const targetMid = a.mid.clone().add(a.dir.clone().multiplyScalar(projLen));
    const delta = targetMid.clone().sub(b2.mid);
    if (delta.lengthSq() < EPS_ANGLE) return true; // already aligned

    return this.bridge.translateVerts([b2.v0, b2.v1], delta.x, delta.y, delta.z);
  }

  // ───────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────

  private edgeGeometry(edgeId: number): {
    v0: number; v1: number;
    p0: THREE.Vector3; p1: THREE.Vector3;
    mid: THREE.Vector3; dir: THREE.Vector3;
  } | null {
    const eps = this.bridge.getEdgeEndpoints(edgeId);
    if (eps.length !== 2) return null;
    const [v0, v1] = eps;
    const p0 = this.bridge.getVertexPos(v0);
    const p1 = this.bridge.getVertexPos(v1);
    if (!p0 || !p1) return null;
    const P0 = new THREE.Vector3(p0[0], p0[1], p0[2]);
    const P1 = new THREE.Vector3(p1[0], p1[1], p1[2]);
    const mid = P0.clone().add(P1).multiplyScalar(0.5);
    const diff = P1.clone().sub(P0);
    const len = diff.length();
    if (len < 1e-9) return null;
    const dir = diff.divideScalar(len);
    return { v0, v1, p0: P0, p1: P1, mid, dir };
  }

  /**
   * Rotate `edge`'s two vertices around its midpoint so that its direction
   * aligns to `targetDir`. Returns true on success.
   */
  private rotateEdgeToDirection(
    edge: ReturnType<ConstraintCommands['edgeGeometry']> & {},
    targetDir: THREE.Vector3,
    opName: string,
  ): boolean {
    const currentDir = edge.dir;
    const target = targetDir.clone().normalize();
    const dot = currentDir.dot(target);

    // Already aligned?
    if (Math.abs(dot - 1.0) < EPS_ANGLE) {
      debugLog(`[Constraint] ${opName}: already aligned`);
      return true;
    }

    // Antipodal (180°) — flip endpoints is equivalent to rotating by π around
    // any axis perpendicular to currentDir. Pick an arbitrary stable one.
    let axis: THREE.Vector3;
    let angleRad: number;
    if (Math.abs(dot + 1.0) < EPS_ANGLE) {
      // Any perpendicular axis
      const arbitrary = Math.abs(currentDir.x) < 0.9
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
      axis = new THREE.Vector3().crossVectors(currentDir, arbitrary).normalize();
      angleRad = Math.PI;
    } else {
      axis = new THREE.Vector3().crossVectors(currentDir, target);
      if (axis.lengthSq() < 1e-12) return false;
      axis.normalize();
      angleRad = Math.acos(Math.max(-1, Math.min(1, dot)));
    }

    const angleDeg = angleRad * 180 / Math.PI;
    const ok = this.bridge.rotateVerts(
      [edge.v0, edge.v1],
      edge.mid.x, edge.mid.y, edge.mid.z,
      axis.x, axis.y, axis.z,
      angleDeg,
    );
    if (!ok) {
      debugLog(`[Constraint] ${opName}: rotateVerts failed`);
    }
    return ok;
  }
}
