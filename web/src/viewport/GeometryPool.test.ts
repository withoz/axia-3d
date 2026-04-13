/**
 * Tests for GeometryPool — Three.js object pooling.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeometryPool } from './GeometryPool';
import { BufferGeometry, Material, Mesh, LineSegments } from 'three';

describe('GeometryPool', () => {
  let pool: GeometryPool;

  beforeEach(() => {
    pool = new GeometryPool();
  });

  describe('acquireMesh()', () => {
    it('creates a new mesh when pool is empty', () => {
      const geo = new BufferGeometry();
      const mat = new Material();
      const mesh = pool.acquireMesh(geo, mat);
      expect(mesh).toBeInstanceOf(Mesh);
      expect(mesh.geometry).toBe(geo);
      expect(mesh.material).toBe(mat);
    });

    it('reuses mesh from pool', () => {
      const geo1 = new BufferGeometry();
      const mat1 = new Material();
      const mesh1 = pool.acquireMesh(geo1, mat1);

      // Release it back
      pool.release(mesh1);

      // Acquire again — should get the same mesh object
      const geo2 = new BufferGeometry();
      const mat2 = new Material();
      const mesh2 = pool.acquireMesh(geo2, mat2);
      expect(mesh2).toBe(mesh1);
      expect(mesh2.geometry).toBe(geo2);
      expect(mesh2.material).toBe(mat2);
    });
  });

  describe('acquireLines()', () => {
    it('creates new line segments when pool is empty', () => {
      const geo = new BufferGeometry();
      const mat = new Material();
      const lines = pool.acquireLines(geo, mat);
      expect(lines).toBeInstanceOf(LineSegments);
    });

    it('reuses line segments from pool', () => {
      const geo1 = new BufferGeometry();
      const mat1 = new Material();
      const lines1 = pool.acquireLines(geo1, mat1);
      pool.release(lines1);

      const geo2 = new BufferGeometry();
      const mat2 = new Material();
      const lines2 = pool.acquireLines(geo2, mat2);
      expect(lines2).toBe(lines1);
    });
  });

  describe('release()', () => {
    it('returns mesh to pool', () => {
      const mesh = pool.acquireMesh(new BufferGeometry(), new Material());
      pool.release(mesh);
      expect(pool.getStats().meshPoolSize).toBe(1);
    });

    it('returns lines to pool', () => {
      const lines = pool.acquireLines(new BufferGeometry(), new Material());
      pool.release(lines);
      expect(pool.getStats().linePoolSize).toBe(1);
    });

    it('disposes geometry on release', () => {
      const geo = new BufferGeometry();
      const disposeSpy = vi.spyOn(geo, 'dispose');
      const mesh = pool.acquireMesh(geo, new Material());
      pool.release(mesh);
      expect(disposeSpy).toHaveBeenCalled();
    });

    it('does not exceed pool size limit', () => {
      // Fill pool beyond limit (default 20)
      for (let i = 0; i < 25; i++) {
        const mesh = pool.acquireMesh(new BufferGeometry(), new Material());
        pool.release(mesh);
      }
      expect(pool.getStats().meshPoolSize).toBeLessThanOrEqual(20);
    });
  });

  describe('getStats()', () => {
    it('returns 0 for empty pool', () => {
      const stats = pool.getStats();
      expect(stats.meshPoolSize).toBe(0);
      expect(stats.linePoolSize).toBe(0);
    });
  });

  describe('dispose()', () => {
    it('empties both pools', () => {
      pool.acquireMesh(new BufferGeometry(), new Material());
      const mesh = pool.acquireMesh(new BufferGeometry(), new Material());
      pool.release(mesh);

      const lines = pool.acquireLines(new BufferGeometry(), new Material());
      pool.release(lines);

      pool.dispose();
      expect(pool.getStats().meshPoolSize).toBe(0);
      expect(pool.getStats().linePoolSize).toBe(0);
    });
  });
});
