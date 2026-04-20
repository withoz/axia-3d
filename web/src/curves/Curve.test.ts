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
      expect(pts.length).toBe(17); // seg + 1 (열린 호)
      expect(pts[0].x).toBeCloseTo(100, 2);
      expect(pts[0].z).toBeCloseTo(0, 2);
      expect(pts[pts.length - 1].x).toBeCloseTo(0, 2);
      expect(pts[pts.length - 1].z).toBeCloseTo(100, 2);
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
