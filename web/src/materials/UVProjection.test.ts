import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  planarUV,
  boxUV,
  cylindricalUV,
  computeUV,
  computeUVsFromBuffers,
  DEFAULT_PROJECTION,
} from './UVProjection';

describe('UVProjection — planar', () => {
  it('projects XZ plane vertices with distinct UVs along both axes', () => {
    const n = new THREE.Vector3(0, 1, 0);
    const [u0, v0] = planarUV(new THREE.Vector3(0, 0, 0), n, 1.0);
    const [uZ, vZ] = planarUV(new THREE.Vector3(0, 0, 10), n, 1.0);
    const [uX, vX] = planarUV(new THREE.Vector3(10, 0, 0), n, 1.0);
    // Moving along tangent plane → UV must change
    expect(uZ !== u0 || vZ !== v0).toBe(true);
    expect(uX !== u0 || vX !== v0).toBe(true);
  });

  it('planar projection magnitude matches world distance', () => {
    const n = new THREE.Vector3(0, 1, 0);
    const [u1, v1] = planarUV(new THREE.Vector3(0, 0, 0), n, 1.0);
    const [u2, v2] = planarUV(new THREE.Vector3(10, 0, 0), n, 1.0);
    const d = Math.hypot(u2 - u1, v2 - v1);
    expect(d).toBeCloseTo(10, 4); // Distance preserved at scale 1.0
  });

  it('respects scale parameter', () => {
    const n = new THREE.Vector3(0, 1, 0);
    const [u1] = planarUV(new THREE.Vector3(100, 0, 0), n, 0.001);
    const [u2] = planarUV(new THREE.Vector3(100, 0, 0), n, 0.01);
    expect(u2).toBeCloseTo(u1 * 10, 4);
  });

  it('applies rotation correctly', () => {
    const n = new THREE.Vector3(0, 1, 0);
    const pt = new THREE.Vector3(1, 0, 0);
    const [u0, v0] = planarUV(pt, n, 1.0, 0);
    const [u90, v90] = planarUV(pt, n, 1.0, Math.PI / 2);
    // 90° rotation should swap U→V (up to sign)
    expect(Math.abs(u0)).toBeCloseTo(Math.abs(v90), 4);
    expect(Math.abs(v0)).toBeCloseTo(Math.abs(u90), 4);
  });
});

describe('UVProjection — box', () => {
  it('selects Y-axis UV for top face', () => {
    const normal = new THREE.Vector3(0, 1, 0);
    const [u, v] = boxUV(new THREE.Vector3(5, 100, 3), normal, 1.0);
    expect(u).toBe(5);       // X component
    expect(v).toBe(-3);      // -Z component (for +Y face)
  });

  it('selects X-axis UV for side face', () => {
    const normal = new THREE.Vector3(1, 0, 0);
    const [u, v] = boxUV(new THREE.Vector3(100, 2, 7), normal, 1.0);
    expect(u).toBe(7);       // Z component for +X face
    expect(v).toBe(2);       // Y component
  });

  it('selects Z-axis UV for front face', () => {
    const normal = new THREE.Vector3(0, 0, 1);
    const [u, v] = boxUV(new THREE.Vector3(4, 8, 100), normal, 1.0);
    expect(u).toBe(-4);      // -X for +Z face
    expect(v).toBe(8);       // Y component
  });

  it('handles negative normal direction', () => {
    const posNorm = new THREE.Vector3(1, 0, 0);
    const negNorm = new THREE.Vector3(-1, 0, 0);
    const pt = new THREE.Vector3(100, 2, 7);
    const [u1] = boxUV(pt, posNorm, 1.0);
    const [u2] = boxUV(pt, negNorm, 1.0);
    // +X and -X faces use opposite U orientation
    expect(u1).not.toBe(u2);
  });
});

describe('UVProjection — cylindrical', () => {
  it('wraps U coordinate around axis — diametrically opposite points differ by 0.5', () => {
    const pt1 = new THREE.Vector3(10, 0, 0);
    const pt2 = new THREE.Vector3(-10, 0, 0);
    const [u1] = cylindricalUV(pt1, 1.0);
    const [u2] = cylindricalUV(pt2, 1.0);
    // Opposite sides of the cylinder must be half a revolution apart in U.
    const diff = Math.abs(u2 - u1);
    const wrapped = Math.min(diff, Math.abs(1 - diff));
    expect(wrapped).toBeCloseTo(0.5, 3);
  });

  it('V coordinate tracks height along Y axis', () => {
    const [, v1] = cylindricalUV(new THREE.Vector3(1, 0, 0), 1.0);
    const [, v2] = cylindricalUV(new THREE.Vector3(1, 50, 0), 1.0);
    expect(v2 - v1).toBeCloseTo(50, 4);
  });

  it('respects custom axis', () => {
    // Axis = X → height is X coordinate
    const axis = new THREE.Vector3(1, 0, 0);
    const [, v] = cylindricalUV(new THREE.Vector3(42, 0, 1), 1.0, axis);
    expect(v).toBeCloseTo(42, 4);
  });
});

describe('computeUV dispatcher', () => {
  it('routes planar mode', () => {
    const [u, v] = computeUV(
      new THREE.Vector3(5, 0, 0),
      new THREE.Vector3(0, 1, 0),
      { mode: 'planar', scale: 1.0 },
    );
    expect(Number.isFinite(u) && Number.isFinite(v)).toBe(true);
  });

  it('routes box mode', () => {
    const [u] = computeUV(
      new THREE.Vector3(5, 0, 0),
      new THREE.Vector3(0, 1, 0),
      { mode: 'box', scale: 1.0 },
    );
    expect(u).toBe(5);
  });

  it('routes cylindrical mode', () => {
    const [u, v] = computeUV(
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(0, 1, 0),
      { mode: 'cylindrical', scale: 1.0 },
    );
    // U must be within [0, 1] wrap range; V=0 since pt is on axis origin plane.
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThanOrEqual(1);
    expect(v).toBeCloseTo(0, 4);
  });
});

describe('computeUVsFromBuffers', () => {
  it('produces 2 UVs per vertex', () => {
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10]);
    const normals   = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const uvs = computeUVsFromBuffers(positions, normals, DEFAULT_PROJECTION);
    expect(uvs.length).toBe(6); // 3 verts × 2 components
  });

  it('all UV components are finite', () => {
    const positions = new Float32Array([0, 0, 0, 1, 2, 3, 4, 5, 6]);
    const normals = new Float32Array([0, 1, 0, 0, 0, 1, 1, 0, 0]);
    const uvs = computeUVsFromBuffers(positions, normals, { mode: 'box', scale: 0.001 });
    for (const v of uvs) expect(Number.isFinite(v)).toBe(true);
  });
});
