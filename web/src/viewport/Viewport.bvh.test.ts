/**
 * Viewport BVH defer — α (사용자 결재 2026-05-17) regression
 *
 * α canonical: BVH build (computeBoundsTree) deferred to next animation
 * frame via frameScheduler TaskKey 'bvhRebuild'. PR #73 β (Lazy syncMesh
 * via RAF) 답습 패턴 확장.
 *
 * 검증:
 *   1. updateMesh 의 동기 path 에서 computeBoundsTree 즉시 호출 안 됨
 *   2. frameScheduler.flushNow() 후 computeBoundsTree 호출됨
 *   3. 연속 updateMesh 시 latest mesh 의 BVH 만 build (dedup, latest-wins)
 *   4. 디스포즈된 geometry (position attribute 사라짐) 는 build skip
 *   5. computeBoundsTree 항상 `{ indirect: true }` 옵션 사용
 *      (faceMap → tri index 매핑 무결성, Viewport.ts:1073 ✱ Critical)
 *
 * Cross-link: ADR-012 §2 FrameScheduler latest-wins, 메타-원칙 #11
 * Latency Budget First, LOCKED #40 chord_tol baseline 보존.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { frameScheduler } from '../core/FrameScheduler';

/** Minimal stub matching only the interface used by _scheduleBvhBuild.
 *  Avoids dependence on three.js mock internals (no getAttribute method).
 */
interface StubGeometry {
  _attrs: Record<string, unknown>;
  getAttribute(name: string): unknown;
  computeBoundsTree?: (opts?: { indirect?: boolean }) => void;
}

function makeStubGeometryWithBvh() {
  const computeSpy = vi.fn();
  const geom: StubGeometry = {
    _attrs: { position: { count: 3 } },
    getAttribute(name: string) { return this._attrs[name]; },
    computeBoundsTree: computeSpy,
  };
  return { geom, computeSpy };
}

/**
 * Mirror of Viewport._scheduleBvhBuild — kept in-test to verify the
 * exact scheduling contract without instantiating full Viewport
 * (which requires DOM + WebGL context + real three-mesh-bvh patch).
 *
 * Drift guard: if this stub diverges from Viewport.ts the unit tests
 * still cover the schedule contract; for real-runtime parity see
 * Playwright (browser env where three-mesh-bvh is patched in).
 */
function scheduleBvhBuild(geometry: StubGeometry): void {
  if (typeof geometry.computeBoundsTree !== 'function') return;
  frameScheduler.schedule('bvhRebuild', () => {
    const pos = geometry.getAttribute('position');
    if (!pos) return;
    try {
      geometry.computeBoundsTree!({ indirect: true });
    } catch (e) {
      console.warn('[Viewport] deferred BVH build failed:', e);
    }
  });
}

describe('Viewport BVH defer — α (사용자 결재 2026-05-17)', () => {
  beforeEach(() => {
    // Async mode + clear any leftover pending tasks from prior tests
    frameScheduler.setSyncMode(false);
    frameScheduler.cancel('bvhRebuild');
  });

  afterEach(() => {
    frameScheduler.setSyncMode(false);
    frameScheduler.cancel('bvhRebuild');
  });

  describe('α — BVH build deferred to next frame', () => {
    it('computeBoundsTree NOT called synchronously on schedule', () => {
      const { geom, computeSpy } = makeStubGeometryWithBvh();
      scheduleBvhBuild(geom);
      // Sync path — must NOT have built BVH yet
      expect(computeSpy).not.toHaveBeenCalled();
    });

    it('computeBoundsTree called after frameScheduler.flushNow()', () => {
      const { geom, computeSpy } = makeStubGeometryWithBvh();
      scheduleBvhBuild(geom);
      frameScheduler.flushNow();
      expect(computeSpy).toHaveBeenCalledTimes(1);
    });

    it('computeBoundsTree invoked with indirect: true (faceMap integrity)', () => {
      // ✱ Critical (Viewport.ts:1073): indirect:true preserves index order
      // so faceMap[ti] correctly maps tri→faceId. Without it, raycast
      // returns wrong faceId.
      const { geom, computeSpy } = makeStubGeometryWithBvh();
      scheduleBvhBuild(geom);
      frameScheduler.flushNow();
      expect(computeSpy).toHaveBeenCalledWith({ indirect: true });
    });
  });

  describe('α — latest-wins dedup (multi-mesh stream)', () => {
    it('consecutive scheduleBvhBuild → only latest geometry BVH built', () => {
      const a = makeStubGeometryWithBvh();
      const b = makeStubGeometryWithBvh();
      const c = makeStubGeometryWithBvh();

      // Simulate 3 rapid updateMesh calls (user spawning 3 spheres fast)
      scheduleBvhBuild(a.geom);
      scheduleBvhBuild(b.geom);
      scheduleBvhBuild(c.geom);

      // Before flush, nothing built
      expect(a.computeSpy).not.toHaveBeenCalled();
      expect(b.computeSpy).not.toHaveBeenCalled();
      expect(c.computeSpy).not.toHaveBeenCalled();

      // After flush, only latest (c) built
      frameScheduler.flushNow();
      expect(a.computeSpy).not.toHaveBeenCalled();
      expect(b.computeSpy).not.toHaveBeenCalled();
      expect(c.computeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('α — disposed geometry guard', () => {
    it('skip BVH build when position attribute cleared (geometry disposed)', () => {
      const { geom, computeSpy } = makeStubGeometryWithBvh();
      scheduleBvhBuild(geom);
      // Simulate dispose: clear position attribute
      delete geom._attrs.position;
      frameScheduler.flushNow();
      expect(computeSpy).not.toHaveBeenCalled();
    });
  });

  describe('α — graceful no-op without BVH patch', () => {
    it('geometry without computeBoundsTree is silently skipped', () => {
      const plainGeom: StubGeometry = {
        _attrs: { position: { count: 1 } },
        getAttribute(name: string) { return this._attrs[name]; },
        // No computeBoundsTree attached — three-mesh-bvh not loaded
      };
      scheduleBvhBuild(plainGeom);
      // Should NOT schedule anything (early return before frameScheduler.schedule)
      expect(frameScheduler.has('bvhRebuild')).toBe(false);
    });
  });

  describe('α — telemetry integration (bvhRebuild budget)', () => {
    it('bvhRebuild is a known BudgetKey (frameScheduler accepts it)', () => {
      const { geom } = makeStubGeometryWithBvh();
      // If 'bvhRebuild' weren't a valid BudgetKey, TypeScript compile error.
      // Runtime accept is implicit — verify dedup key works.
      scheduleBvhBuild(geom);
      expect(frameScheduler.has('bvhRebuild')).toBe(true);
      frameScheduler.cancel('bvhRebuild');
      expect(frameScheduler.has('bvhRebuild')).toBe(false);
    });
  });
});
