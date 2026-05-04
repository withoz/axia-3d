/**
 * ADR-075 E4-2 — Browser fixtures for Boolean E2E tests.
 *
 * Reusable helpers that exercise the WasmBridge from inside the browser
 * page context. Per E4-2-c, these are extracted out of test files so
 * E4-3 (multi-face) / E4-4 (undo) / E4-5 (edge cases) can share setup.
 *
 * All helpers run via page.evaluate — they execute in browser context
 * with access to window.__axia (ServiceContainer) registered by main.ts.
 */
import type { Page } from '@playwright/test';

/**
 * Setup result — face IDs of the two created faces.
 */
export interface TwoPlaneFaces {
  faceA: number;
  faceB: number;
}

/**
 * Draw two horizontal plane rects at given z heights and optionally
 * attach Plane surfaces. Returns the new face IDs.
 *
 * Geometry:
 *   - Both rects centered at origin (cx=0, cy=0)
 *   - Normal = (0, 0, 1), basis_u = (1, 0, 0)
 *   - 10x10 mm extent
 *   - face_a at z = zA, face_b at z = zB
 *
 * If withSurfaces=true, both faces receive matching `AnalyticSurface::Plane`
 * (origin = face center, normal = +Z, basis_u = +X, ranges 0..10).
 */
export async function setupTwoPlaneFaces(
  page: Page,
  opts: { withSurfaces: boolean; zA?: number; zB?: number },
): Promise<TwoPlaneFaces> {
  const zA = opts.zA ?? 0.0;
  const zB = opts.zB ?? 5.0;
  const withSurfaces = opts.withSurfaces;
  return await page.evaluate(
    ({ withSurfaces, zA, zB }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const bridge = w.__axia.get('bridge');

      // drawRect returns XIA ID (semantic object), not FaceId — per
      // crates/axia-wasm/src/lib.rs:660. Resolve XIA → its face IDs and
      // pick the first one (single-face XIA per drawRect contract).
      const xiaA = bridge.drawRect(0, 0, zA, 0, 0, 1, 1, 0, 0, 10, 10);
      const xiaB = bridge.drawRect(0, 0, zB, 0, 0, 1, 1, 0, 0, 10, 10);
      const faceIdsA = bridge.getXiaFaceIds(xiaA);
      const faceIdsB = bridge.getXiaFaceIds(xiaB);
      if (faceIdsA.length === 0 || faceIdsB.length === 0) {
        throw new Error(
          `drawRect XIA produced no faces (xiaA=${xiaA} faces=${faceIdsA.length}, ` +
          `xiaB=${xiaB} faces=${faceIdsB.length})`,
        );
      }
      const faceA = faceIdsA[0];
      const faceB = faceIdsB[0];

      if (withSurfaces) {
        // setFaceSurfacePlane: (faceId, ox, oy, oz, nx, ny, nz,
        //                      ux, uy, uz, u_min, u_max, v_min, v_max)
        bridge.engine.setFaceSurfacePlane(
          faceA,
          0, 0, zA,         // origin
          0, 0, 1,          // normal +Z
          1, 0, 0,          // basis_u +X
          -5, 5,            // u_range (drawRect centers around origin)
          -5, 5,            // v_range
        );
        bridge.engine.setFaceSurfacePlane(
          faceB,
          0, 0, zB,
          0, 0, 1,
          1, 0, 0,
          -5, 5,
          -5, 5,
        );
      }
      return { faceA, faceB };
    },
    { withSurfaces, zA, zB },
  );
}

/**
 * Wait for `window.__axia` ServiceContainer + bridge.isReady() === true.
 * Centralized boot wait used by every E2E test (E4-1 pattern parity).
 */
export async function waitForBridgeReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (!w.__axia) return false;
      try {
        const bridge = w.__axia.get('bridge');
        return bridge && bridge.isReady() === true;
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 10_000 },
  );
}

/**
 * Invoke `bridge.booleanDispatchDcel(faceA, faceB, op)` in browser
 * context and return the parsed BooleanDispatchDcelResult.
 */
export async function invokeBooleanDispatchDcel(
  page: Page,
  args: {
    faceA: number;
    faceB: number;
    op: 'union' | 'subtract' | 'intersect';
    tolGeometric?: number;
  },
): Promise<unknown> {
  return await page.evaluate(({ faceA, faceB, op, tolGeometric }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = (window as any).__axia.get('bridge');
    return bridge.booleanDispatchDcel(faceA, faceB, op, tolGeometric ?? 1e-3);
  }, args);
}

/**
 * ADR-075 E4-3 — N parallel plane faces at evenly-spaced z heights.
 *
 * Each face is a 10×10 mm horizontal rect centered at origin (in x/y).
 * z[i] = i * zStep (default 5.0 mm) — guarantees pairwise disjoint
 * (no intersection) for any cartesian product (a, b) where a ≠ b.
 *
 * Returns the resolved FaceIds (XIA→FaceId conversion already applied).
 */
export interface NPlaneFaces {
  faces: number[];
}

export async function setupNPlaneFaces(
  page: Page,
  opts: { count: number; withSurfaces: boolean; zStep?: number },
): Promise<NPlaneFaces> {
  const count = opts.count;
  const withSurfaces = opts.withSurfaces;
  const zStep = opts.zStep ?? 5.0;
  return await page.evaluate(
    ({ count, withSurfaces, zStep }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const bridge = w.__axia.get('bridge');
      const faces: number[] = [];
      for (let i = 0; i < count; i++) {
        const z = i * zStep;
        const xia = bridge.drawRect(0, 0, z, 0, 0, 1, 1, 0, 0, 10, 10);
        const ids = bridge.getXiaFaceIds(xia);
        if (ids.length === 0) {
          throw new Error(`drawRect XIA ${xia} produced no faces (i=${i})`);
        }
        const faceId = ids[0];
        if (withSurfaces) {
          bridge.engine.setFaceSurfacePlane(
            faceId,
            0, 0, z,        // origin
            0, 0, 1,        // normal +Z
            1, 0, 0,        // basis_u +X
            -5, 5,          // u_range
            -5, 5,          // v_range
          );
        }
        faces.push(faceId);
      }
      return { faces };
    },
    { count, withSurfaces, zStep },
  );
}

/**
 * Invoke `bridge.booleanDispatchDcelMulti(facesA, facesB, op)` in
 * browser context and return the parsed BooleanDispatchDcelMultiResult.
 */
export async function invokeBooleanDispatchDcelMulti(
  page: Page,
  args: {
    facesA: number[];
    facesB: number[];
    op: 'union' | 'subtract' | 'intersect';
    tolGeometric?: number;
  },
): Promise<unknown> {
  return await page.evaluate(({ facesA, facesB, op, tolGeometric }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = (window as any).__axia.get('bridge');
    return bridge.booleanDispatchDcelMulti(
      facesA, facesB, op, tolGeometric ?? 1e-3,
    );
  }, args);
}
