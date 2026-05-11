// ADR-047 P32 — Chain self-touch prevention via SnapManager exclude list.
//
// Verifies that vertex positions registered via setExcludePositions are
// removed from endpoint / nearest snap candidates, while non-excluded
// vertices (including chainStart) remain snappable.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SnapManager } from './SnapManager';

const W = 800;
const H = 600;

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, right: W, bottom: H,
    width: W, height: H, x: 0, y: 0, toJSON() { return {}; },
  });
  return canvas;
}

// The Three.js mock's Vector3.project() is a no-op (returns `this`), so
// vertex world coords ARE already in NDC space. Camera object is unused
// by the mock — pass any object.
function makeStubCamera(): THREE.Camera {
  return {} as unknown as THREE.Camera;
}

/**
 * NDC-space (x, y) → screen pixel (matches SnapManager.toScreenPx):
 *   sx = (ndc.x * 0.5 + 0.5) * 800
 *   sy = (-ndc.y * 0.5 + 0.5) * 600
 *
 * In our tests, vertex.x = ndc.x and vertex.y = ndc.y, vertex.z = 0
 * (passes the |ndc.z| ≤ 1 check).
 */
function worldToScreen(p: THREE.Vector3): { x: number; y: number } {
  return {
    x: (p.x * 0.5 + 0.5) * 800,
    y: (-p.y * 0.5 + 0.5) * 600,
  };
}

describe('ADR-047 P32 — SnapManager.setExcludePositions', () => {
  let snap: SnapManager;
  let canvas: HTMLCanvasElement;
  let camera: THREE.Camera;

  // Three vertices in NDC space (project()=identity in the mock). Spaced
  // far enough apart (~200px) that the 15px threshold isolates each.
  const vA = new THREE.Vector3(-0.5, 0, 0);   // chainStart   → screen (200, 300)
  const vB = new THREE.Vector3(   0, 0, 0);   // chain mid 1  → screen (400, 300)
  const vC = new THREE.Vector3( 0.5, 0, 0);   // chain mid 2  → screen (600, 300)

  beforeEach(() => {
    snap = new SnapManager();
    canvas = makeCanvas();
    camera = makeStubCamera();
    // Inject vertices directly into the cache.
    (snap as unknown as { vertices: THREE.Vector3[] }).vertices = [
      vA.clone(), vB.clone(), vC.clone(),
    ];
  });

  it('chain_vertex_excluded_from_snap_during_polyline', () => {
    snap.setExcludePositions([vB]);

    const sB = worldToScreen(vB);
    const result = snap.findSnap(sB.x, sB.y, camera, canvas, vB.clone());

    if (result?.type === 'endpoint') {
      expect(result.position.distanceTo(vB)).toBeGreaterThan(1e-3);
    }
  });

  it('chain_start_remains_snappable_for_close', () => {
    snap.setExcludePositions([vB, vC]);

    const sA = worldToScreen(vA);
    const result = snap.findSnap(sA.x, sA.y, camera, canvas, vA.clone());

    expect(result).not.toBeNull();
    expect(result!.type).toBe('endpoint');
    expect(result!.position.distanceTo(vA)).toBeLessThan(1e-3);
  });

  it('external_vertex_not_excluded_by_active_chain', () => {
    snap.setExcludePositions([vB]);

    const sC = worldToScreen(vC);
    const result = snap.findSnap(sC.x, sC.y, camera, canvas, vC.clone());

    expect(result).not.toBeNull();
    expect(result!.type).toBe('endpoint');
    expect(result!.position.distanceTo(vC)).toBeLessThan(1e-3);
  });

  it('clearing_exclude_list_restores_snap', () => {
    snap.setExcludePositions([vB]);
    snap.setExcludePositions([]);

    const sB = worldToScreen(vB);
    const result = snap.findSnap(sB.x, sB.y, camera, canvas, vB.clone());

    expect(result).not.toBeNull();
    expect(result!.type).toBe('endpoint');
    expect(result!.position.distanceTo(vB)).toBeLessThan(1e-3);
  });

  it('findNearestEndpoint_also_respects_exclude', () => {
    snap.setExcludePositions([vB]);

    const sB = worldToScreen(vB);
    const result = snap.findNearestEndpoint(sB.x, sB.y, camera, canvas);

    if (result) {
      expect(result.position.distanceTo(vB)).toBeGreaterThan(1e-3);
    }
  });

  /**
   * ADR-047 P32 — when the excluded vertex was the top candidate, snap must
   * gracefully fall back to lower-priority candidates (grid here, but in
   * production also onFace / nearest). NEVER silently return null at a
   * location where some valid snap exists, otherwise the user perceives
   * "snap suddenly stopped working" right where they need it most.
   *
   * This test guards against a regression where someone might "fix" the
   * filter to short-circuit findSnap once the highest-priority candidate
   * is excluded, dropping all lower-priority candidates with it.
   */
  it('snap_excluded_falls_back_to_grid_or_ground', () => {
    // Enable grid snap with a spacing of 0.1 NDC. Grid points within ±0.05
    // of cursor in NDC coords yield a snap target.
    snap.setMode('grid', true);
    (snap as unknown as { config: { gridSpacing: number } }).config.gridSpacing = 0.1;

    // Exclude vB (the would-be top-priority endpoint).
    snap.setExcludePositions([vB]);

    const sB = worldToScreen(vB);
    // Provide a groundPoint exactly at vB so the grid snap rounds to (0,0,0)
    // = same world location as vB — cursor still gets a target.
    const result = snap.findSnap(sB.x, sB.y, camera, canvas, vB.clone());

    // The excluded endpoint must NOT win.
    if (result?.type === 'endpoint') {
      expect(result.position.distanceTo(vB)).toBeGreaterThan(1e-3);
    }
    // But SOMETHING (grid here) should still snap — we must not leave the
    // cursor stranded with no target at this location.
    expect(result).not.toBeNull();
    expect(result!.type).toBe('grid');
  });
});
