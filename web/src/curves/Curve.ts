/**
 * Curve Layer — AXiA 자유 곡선 데이터 모델 (Phase I, 2026-04-20)
 *
 * DCEL(Half-Edge)은 직선 segments만 저장하므로, 곡선은 이 layer에서
 * 원본 정의(중심, 반지름, 제어점 등)를 보존하고 tessellate 결과만
 * DCEL에 드로잉한다.
 *
 * 아키텍처:
 *   [Curve Layer]  ← 원본 곡선 정의 (편집·재tessellate 가능)
 *        ↓ tessellate(segments)
 *   [DCEL Polyline] ← 엔진 연산 대상 (merge/pushpull/boolean)
 *
 * ADR-007 호환:
 *   - Tessellation 결과가 DCEL 규칙 준수 (≥3 verts, 일관 winding)
 *   - 곡선 자체엔 normal 없음 — DCEL 면 생성 시 normal 계산
 */

import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════
//  타입 정의
// ═══════════════════════════════════════════════════════════════

export type CurveKind = 'arc' | 'ellipse' | 'bezier' | 'catmull-rom' | 'freehand';

/** 곡선 공통 베이스 — 저장/로드용 직렬화 타입 */
export interface CurveBase {
  kind: CurveKind;
  /** 고유 ID (scene 단위) */
  id: number;
  /** 곡선을 포함하는 평면 normal (2D 곡선은 3D 평면 위에서 정의됨) */
  planeNormal: [number, number, number];
  /** 테셀레이션 분할 수 (해상도) */
  segments: number;
  /** 닫힌 곡선 여부 (face 생성 가능) */
  closed: boolean;
}

/** 원호 — 3점 정의 또는 중심·반지름·각도 */
export interface ArcCurve extends CurveBase {
  kind: 'arc';
  /** 중심점 */
  center: [number, number, number];
  /** 반지름 */
  radius: number;
  /** 시작 각도 (rad) */
  startAngle: number;
  /** 끝 각도 (rad) */
  endAngle: number;
  /** 평면 내 회전 기준 vector (내부 basis) */
  xAxis: [number, number, number];
}

/** 타원 / 타원호 */
export interface EllipseCurve extends CurveBase {
  kind: 'ellipse';
  center: [number, number, number];
  xAxis: [number, number, number];
  yAxis: [number, number, number];
  /** x방향 반지름 */
  xRadius: number;
  /** y방향 반지름 */
  yRadius: number;
  startAngle: number;
  endAngle: number;
}

/** Cubic Bezier — 4점 (시작, 제어1, 제어2, 끝) */
export interface BezierCurve extends CurveBase {
  kind: 'bezier';
  /** 제어점 4개 (P0, P1, P2, P3) */
  controlPoints: [number, number, number][];
}

/** Catmull-Rom — 통과점 배열 (곡선이 점들을 통과) */
export interface CatmullRomCurve extends CurveBase {
  kind: 'catmull-rom';
  /** 통과점 배열 */
  points: [number, number, number][];
  /** 장력 (0=uniform, 0.5=centripetal, 1=chordal). 기본 0.5 */
  tension?: number;
}

/** Freehand — 사용자가 그린 raw 점 + smoothing 여부 */
export interface FreehandCurve extends CurveBase {
  kind: 'freehand';
  /** 사용자 샘플 점 (smoothing 전) */
  rawPoints: [number, number, number][];
  /** RDP 단순화 tolerance (mm) */
  simplifyTolerance?: number;
}

export type Curve = ArcCurve | EllipseCurve | BezierCurve | CatmullRomCurve | FreehandCurve;

// ═══════════════════════════════════════════════════════════════
//  Tessellator — Curve → 3D 정점 배열
// ═══════════════════════════════════════════════════════════════

/**
 * 곡선을 지정 해상도로 tessellate하여 3D 정점 배열 반환.
 * 반환된 점들은 인접쌍이 DCEL edge로 변환될 수 있음.
 */
export function tessellateCurve(curve: Curve): THREE.Vector3[] {
  switch (curve.kind) {
    case 'arc': return tessellateArc(curve);
    case 'ellipse': return tessellateEllipse(curve);
    case 'bezier': return tessellateBezier(curve);
    case 'catmull-rom': return tessellateCatmullRom(curve);
    case 'freehand': return tessellateFreehand(curve);
  }
}

// ─── Arc ──────────────────────────────────────────────────────

function tessellateArc(c: ArcCurve): THREE.Vector3[] {
  const center = new THREE.Vector3(...c.center);
  const n = new THREE.Vector3(...c.planeNormal).normalize();
  const xAxis = new THREE.Vector3(...c.xAxis).normalize();
  // ── Bug fix (2026-05-16, 사용자 시연 evidence) ──
  // yAxis = planeNormal × xAxis (standard right-handed convention).
  // Mirrors `axia-wasm/src/lib.rs:1070` (drawArcWithCurve): basis_v =
  // normal.cross(basis_u). UI/engine convention 통일.
  //
  // 이전 (`xAxis × planeNormal`) 은 -basis_v (mirror). arcFrom3Points
  // 가 계산한 angle 을 engine 에 전달 시 결과 점이 의도와 y-축 대칭
  // (사용자 "호를 정확히 그리지 못함" 결함의 root cause).
  const yAxis = new THREE.Vector3().crossVectors(n, xAxis).normalize();

  const pts: THREE.Vector3[] = [];
  const seg = Math.max(3, c.segments | 0);
  const totalAngle = c.endAngle - c.startAngle;
  // 닫힌 arc(원)면 segments 수만큼, 열린 arc면 seg+1 (양끝 포함)
  const steps = c.closed ? seg : seg + 1;
  const dAngle = totalAngle / (steps - 1);

  for (let i = 0; i < steps; i++) {
    const a = c.startAngle + dAngle * i;
    const p = center.clone()
      .addScaledVector(xAxis, c.radius * Math.cos(a))
      .addScaledVector(yAxis, c.radius * Math.sin(a));
    pts.push(p);
  }
  // closed arc(원)이면 마지막에 첫 점 복제하지 않음 — caller가 닫힘 처리
  return pts;
}

// ─── Ellipse ──────────────────────────────────────────────────

function tessellateEllipse(c: EllipseCurve): THREE.Vector3[] {
  const center = new THREE.Vector3(...c.center);
  const xAxis = new THREE.Vector3(...c.xAxis).normalize();
  const yAxis = new THREE.Vector3(...c.yAxis).normalize();

  const pts: THREE.Vector3[] = [];
  const seg = Math.max(3, c.segments | 0);
  const totalAngle = c.endAngle - c.startAngle;
  const steps = c.closed ? seg : seg + 1;
  const dAngle = totalAngle / (steps - 1);

  for (let i = 0; i < steps; i++) {
    const a = c.startAngle + dAngle * i;
    const p = center.clone()
      .addScaledVector(xAxis, c.xRadius * Math.cos(a))
      .addScaledVector(yAxis, c.yRadius * Math.sin(a));
    pts.push(p);
  }
  return pts;
}

// ─── Cubic Bezier ─────────────────────────────────────────────

function tessellateBezier(c: BezierCurve): THREE.Vector3[] {
  if (c.controlPoints.length < 4) {
    throw new Error('BezierCurve requires 4 control points');
  }
  const [p0, p1, p2, p3] = c.controlPoints.map(p => new THREE.Vector3(...p));
  const seg = Math.max(4, c.segments | 0);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const p = p0.clone().multiplyScalar(mt3)
      .addScaledVector(p1, 3 * mt2 * t)
      .addScaledVector(p2, 3 * mt * t2)
      .addScaledVector(p3, t3);
    pts.push(p);
  }
  return pts;
}

// ─── Catmull-Rom ──────────────────────────────────────────────

function tessellateCatmullRom(c: CatmullRomCurve): THREE.Vector3[] {
  if (c.points.length < 2) {
    throw new Error('CatmullRomCurve requires at least 2 points');
  }
  const pts3 = c.points.map(p => new THREE.Vector3(...p));
  // Three.js 내장 — 장력/중심형/현 길이 옵션 지원
  const three = new THREE.CatmullRomCurve3(
    pts3,
    c.closed,
    'centripetal',
    c.tension ?? 0.5,
  );
  const seg = Math.max(c.points.length * 4, c.segments | 0);
  return three.getPoints(seg);
}

// ─── Freehand ──────────────────────────────────────────────────

function tessellateFreehand(c: FreehandCurve): THREE.Vector3[] {
  if (c.rawPoints.length < 2) return c.rawPoints.map(p => new THREE.Vector3(...p));
  const raw = c.rawPoints.map(p => new THREE.Vector3(...p));

  // RDP 단순화로 노이즈 제거
  const tol = c.simplifyTolerance ?? 1.0; // 1mm 기본
  const simplified = rdpSimplify3D(raw, tol);

  // 부드럽게 — Catmull-Rom 통과점으로 재샘플
  if (simplified.length >= 3) {
    const curve = new THREE.CatmullRomCurve3(simplified, c.closed, 'centripetal', 0.5);
    const seg = Math.max(simplified.length * 3, c.segments | 0);
    return curve.getPoints(seg);
  }
  return simplified;
}

// ═══════════════════════════════════════════════════════════════
//  유틸: RDP (Ramer-Douglas-Peucker) 3D 단순화
// ═══════════════════════════════════════════════════════════════

/**
 * 3D 점 배열을 RDP 알고리즘으로 단순화. 노이즈 많은 freehand 입력을
 * 대표 특징점으로 축소.
 */
export function rdpSimplify3D(points: THREE.Vector3[], epsilon: number): THREE.Vector3[] {
  if (points.length < 3) return [...points];

  // 최대 수직 거리 점 찾기
  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegmentDistance3D(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }

  if (maxDist > epsilon) {
    // 재귀
    const left = rdpSimplify3D(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify3D(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  } else {
    return [first, last];
  }
}

function pointToSegmentDistance3D(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ap = new THREE.Vector3().subVectors(p, a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-12) return ap.length();
  const t = Math.max(0, Math.min(1, ap.dot(ab) / lenSq));
  const proj = a.clone().addScaledVector(ab, t);
  return p.distanceTo(proj);
}

// ═══════════════════════════════════════════════════════════════
//  Curve 편의 생성 함수
// ═══════════════════════════════════════════════════════════════

let _nextCurveId = 1;
export function nextCurveId(): number {
  return _nextCurveId++;
}

/** 3점으로 Arc 생성 (시작·통과·끝) */
export function arcFrom3Points(
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  segments = 32,
): ArcCurve | null {
  // 3점 외접원 중심 계산 (세 점 평면 내)
  const a = p1; const b = p2; const c = p3;
  const ac = new THREE.Vector3().subVectors(c, a);
  const ab = new THREE.Vector3().subVectors(b, a);
  const abXac = new THREE.Vector3().crossVectors(ab, ac);
  const d = 2 * abXac.lengthSq();
  if (d < 1e-10) return null; // collinear

  const toCenter = ac.clone().cross(abXac).multiplyScalar(ab.lengthSq())
    .add(abXac.clone().cross(ab).multiplyScalar(ac.lengthSq()))
    .divideScalar(d);
  const center = a.clone().add(toCenter);
  const radius = toCenter.length();
  const planeNormal = abXac.clone().normalize();

  // xAxis = from center to p1, 정규화
  const xAxis = new THREE.Vector3().subVectors(a, center).normalize();
  // ── Bug fix (2026-05-16, 사용자 시연 evidence) ──
  // yAxis = planeNormal × xAxis (standard right-handed, tessellateArc 와 동기).
  // 이전 (`xAxis × planeNormal`) 은 engine convention (basis_v = normal.cross
  // (basis_u), axia-wasm/lib.rs:1070) 와 mirror — angle 계산 부호 inverted
  // → engine 에 전달 시 y-축 대칭 결과. 사용자 facing visual 결함 root cause.
  const yAxis = new THREE.Vector3().crossVectors(planeNormal, xAxis);

  const angle = (p: THREE.Vector3): number => {
    const v = new THREE.Vector3().subVectors(p, center);
    return Math.atan2(v.dot(yAxis), v.dot(xAxis));
  };
  const a1 = angle(a); // 시작 = 0
  const a2 = angle(b);
  const a3 = angle(c);

  // a1~a3 경로가 a2를 경유하는 방향 선택
  let startAngle = a1;
  let endAngle = a3;
  // a2가 a1→a3 CCW 경로 안에 있는지?
  const ccwAngle = (from: number, to: number): number => {
    let d = to - from; while (d < 0) d += 2 * Math.PI; return d;
  };
  const ccwThrough = ccwAngle(a1, a2) < ccwAngle(a1, a3);
  if (!ccwThrough) {
    // CW 경로
    endAngle = a3 - 2 * Math.PI;
  }

  return {
    kind: 'arc',
    id: nextCurveId(),
    center: [center.x, center.y, center.z],
    radius,
    startAngle,
    endAngle,
    xAxis: [xAxis.x, xAxis.y, xAxis.z],
    planeNormal: [planeNormal.x, planeNormal.y, planeNormal.z],
    segments,
    closed: false,
  };
}

/** Freehand raw points에서 curve 생성 */
export function freehandFromPoints(
  rawPoints: THREE.Vector3[],
  simplifyTolerance = 1.0,
  segments = 0,
  closed = false,
): FreehandCurve {
  // 평면 normal 추정 — 3점이 non-collinear하면 cross product, 아니면 +Y
  let normal: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  if (rawPoints.length >= 3) {
    const a = rawPoints[0];
    const b = rawPoints[Math.floor(rawPoints.length / 2)];
    const c = rawPoints[rawPoints.length - 1];
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const n = new THREE.Vector3().crossVectors(ab, ac);
    if (n.lengthSq() > 1e-10) normal = n.normalize();
  }
  return {
    kind: 'freehand',
    id: nextCurveId(),
    rawPoints: rawPoints.map(p => [p.x, p.y, p.z] as [number, number, number]),
    simplifyTolerance,
    segments: segments || rawPoints.length * 2,
    planeNormal: [normal.x, normal.y, normal.z],
    closed,
  };
}
