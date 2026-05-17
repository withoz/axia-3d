import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  tessellateCurve,
  arcFrom3Points,
  freehandFromPoints,
  rdpSimplify3D,
  ArcCurve,
  BezierCurve,
  CatmullRomCurve,
} from './Curve';

describe('Curve tessellation', () => {
  describe('Arc', () => {
    it('tessellates quarter circle with correct endpoints', () => {
      const arc: ArcCurve = {
        kind: 'arc',
        id: 1,
        center: [0, 0, 0],
        radius: 100,
        startAngle: 0,
        endAngle: Math.PI / 2,
        xAxis: [1, 0, 0],
        planeNormal: [0, 1, 0],
        segments: 16,
        closed: false,
      };
      const pts = tessellateCurve(arc);
      // ── Fix (2026-05-16) — standard math right-handed convention ──
      // yAxis = planeNormal × xAxis (canonical CAD/math).
      //   planeNormal=+Y, xAxis=+X → yAxis = +Y × +X = -Z
      // Quarter circle (angle 0 → π/2) endpoint:
      //   center + xAxis*cos(π/2) + yAxis*sin(π/2)
      //     = (0,0,0) + 0 + (0,0,-1)*100 = (0, 0, -100)
      // 이전 expect (+100) 는 mirror convention (xAxis × normal) 가정.
      // Engine convention (axia-wasm/lib.rs:1070 `normal.cross(basis_u)`) 와
      // 통일 — 사용자 "호를 정확히 그리지 못함" root cause fix.
      expect(pts.length).toBe(17); // seg + 1 (열린 호)
      expect(pts[0].x).toBeCloseTo(100, 2);
      expect(pts[0].z).toBeCloseTo(0, 2);
      expect(pts[pts.length - 1].x).toBeCloseTo(0, 2);
      expect(pts[pts.length - 1].z).toBeCloseTo(-100, 2);
    });

    it('tessellates closed circle with correct vertex count', () => {
      const arc: ArcCurve = {
        kind: 'arc',
        id: 1,
        center: [0, 0, 0],
        radius: 50,
        startAngle: 0,
        endAngle: 2 * Math.PI,
        xAxis: [1, 0, 0],
        planeNormal: [0, 1, 0],
        segments: 24,
        closed: true,
      };
      const pts = tessellateCurve(arc);
      expect(pts.length).toBe(24); // 닫힌 원은 segments 개
      // 모든 점이 반지름 50에 있음
      for (const p of pts) {
        expect(p.length()).toBeCloseTo(50, 1);
      }
    });
  });

  describe('arcFrom3Points', () => {
    it('creates arc passing through 3 points', () => {
      const a = new THREE.Vector3(100, 0, 0);
      const b = new THREE.Vector3(0, 0, 100);
      const c = new THREE.Vector3(-100, 0, 0);
      const arc = arcFrom3Points(a, b, c, 32);
      expect(arc).not.toBeNull();
      expect(arc!.radius).toBeCloseTo(100, 1);
      expect(arc!.center[0]).toBeCloseTo(0, 1);
      expect(arc!.center[2]).toBeCloseTo(0, 1);
    });

    it('returns null for collinear points', () => {
      const a = new THREE.Vector3(0, 0, 0);
      const b = new THREE.Vector3(10, 0, 0);
      const c = new THREE.Vector3(20, 0, 0);
      const arc = arcFrom3Points(a, b, c);
      expect(arc).toBeNull();
    });

    // ── Bug fix regression (2026-05-16) — yAxis right-handed convention ──
    //
    // 사용자 시연 evidence — arcFrom3Points 의 yAxis 가 engine convention
    // (axia-wasm/lib.rs:1070 `basis_v = normal.cross(basis_u)`) 와 mirror
    // (이전 `xAxis × planeNormal`) → engine 에 angle 전달 시 결과 점 y-축
    // 대칭 (사용자 "호를 정확히 그리지 못함" root cause).
    //
    // Fix: yAxis = `planeNormal × xAxis` (standard right-handed).
    // tessellateArc + arcFrom3Points 동기.
    //
    // 본 회귀 자산 — UI tessellation 의 mid-point 가 사용자 의도 (upper half)
    // 와 일치 검증 (이전 fix 안 된 상태 = lower half, 즉 z<0).
    it('upper-half arc through (1,0,0) → (0,1,0) → (-1,0,0) tessellates upper (y>0)', () => {
      const a = new THREE.Vector3(1, 0, 0);
      const b = new THREE.Vector3(0, 1, 0); // upper midpoint (y > 0)
      const c = new THREE.Vector3(-1, 0, 0);
      const arc = arcFrom3Points(a, b, c, 16);
      expect(arc).not.toBeNull();

      const pts = tessellateCurve(arc!);
      // Mid-point of tessellation should be near b (0, 1, 0), specifically
      // y > 0.5 (upper half), NOT y < -0.5 (lower half mirror).
      const midIdx = Math.floor(pts.length / 2);
      const midPt = pts[midIdx];
      expect(midPt.y).toBeGreaterThan(0.5);
      // X near zero (top of arc)
      expect(Math.abs(midPt.x)).toBeLessThan(0.5);
    });

    it('xy-plane arc center+radius+xAxis consistent with engine convention', () => {
      // Symmetric arc — verify center / radius / xAxis trivially correct
      // regardless of yAxis convention.
      const a = new THREE.Vector3(5, 0, 0);
      const b = new THREE.Vector3(0, 5, 0);
      const c = new THREE.Vector3(-5, 0, 0);
      const arc = arcFrom3Points(a, b, c, 32);
      expect(arc).not.toBeNull();
      expect(arc!.radius).toBeCloseTo(5, 5);
      expect(arc!.center[0]).toBeCloseTo(0, 5);
      expect(arc!.center[1]).toBeCloseTo(0, 5);
      expect(arc!.center[2]).toBeCloseTo(0, 5);
      // xAxis = a - center direction, normalized → (1, 0, 0)
      expect(arc!.xAxis[0]).toBeCloseTo(1, 5);
      expect(arc!.xAxis[1]).toBeCloseTo(0, 5);
    });
  });

  describe('Bezier', () => {
    it('tessellates cubic bezier with endpoints fixed', () => {
      const bezier: BezierCurve = {
        kind: 'bezier',
        id: 1,
        controlPoints: [
          [0, 0, 0],
          [0, 0, 100],
          [100, 0, 100],
          [100, 0, 0],
        ],
        segments: 20,
        planeNormal: [0, 1, 0],
        closed: false,
      };
      const pts = tessellateCurve(bezier);
      expect(pts.length).toBe(21);
      expect(pts[0].x).toBeCloseTo(0, 2);
      expect(pts[0].z).toBeCloseTo(0, 2);
      expect(pts[pts.length - 1].x).toBeCloseTo(100, 2);
      expect(pts[pts.length - 1].z).toBeCloseTo(0, 2);
    });
  });

  describe('Catmull-Rom', () => {
    it('passes through all specified points (open)', () => {
      const crm: CatmullRomCurve = {
        kind: 'catmull-rom',
        id: 1,
        points: [
          [0, 0, 0],
          [50, 0, 100],
          [100, 0, 0],
        ],
        segments: 30,
        planeNormal: [0, 1, 0],
        closed: false,
      };
      const pts = tessellateCurve(crm);
      expect(pts.length).toBeGreaterThan(10);
      // 시작·끝점 통과
      expect(pts[0].distanceTo(new THREE.Vector3(0, 0, 0))).toBeLessThan(1);
      expect(pts[pts.length - 1].distanceTo(new THREE.Vector3(100, 0, 0))).toBeLessThan(1);
    });
  });

  describe('Freehand + RDP', () => {
    it('simplifies dense points to representatives', () => {
      // 매우 단순한 선 (A-B)에 노이즈 점 다수
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        pts.push(new THREE.Vector3(i * 10, 0, 0.01 * (Math.random() - 0.5)));
      }
      const simplified = rdpSimplify3D(pts, 1.0);
      expect(simplified.length).toBeLessThan(pts.length);
      expect(simplified.length).toBeGreaterThanOrEqual(2);
    });

    it('keeps corners in L-shape', () => {
      // L자형 — 모서리 점은 반드시 보존
      const pts: THREE.Vector3[] = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(25, 0, 0),
        new THREE.Vector3(50, 0, 0),   // 중간
        new THREE.Vector3(50, 0, 50),  // 모서리
        new THREE.Vector3(50, 0, 100),
      ];
      const simplified = rdpSimplify3D(pts, 1.0);
      // 최소한 시작, 모서리, 끝점 포함
      expect(simplified.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('freehandFromPoints', () => {
    it('generates curve from raw points', () => {
      const raw: THREE.Vector3[] = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(50, 0, 25),
        new THREE.Vector3(100, 0, 0),
      ];
      const curve = freehandFromPoints(raw);
      expect(curve.kind).toBe('freehand');
      expect(curve.rawPoints.length).toBe(3);
      const pts = tessellateCurve(curve);
      expect(pts.length).toBeGreaterThan(5);
    });
  });
});
