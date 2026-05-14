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

      // ADR-087 K-ζ migration — legacy `drawRect` (XIA producer) was
      // removed; use `drawRectAsShape` (form-layer Shape producer).
      // Boolean ops operate on FaceId regardless of owner layer, so
      // this is a drop-in for fixtures. Resolve Shape → face_ids.
      const shapeA = bridge.drawRectAsShape(0, 0, zA, 0, 0, 1, 1, 0, 0, 10, 10);
      const shapeB = bridge.drawRectAsShape(0, 0, zB, 0, 0, 1, 1, 0, 0, 10, 10);
      const faceIdsA = bridge.getShapeFaceIds(shapeA);
      const faceIdsB = bridge.getShapeFaceIds(shapeB);
      if (faceIdsA.length === 0 || faceIdsB.length === 0) {
        throw new Error(
          `drawRectAsShape produced no faces (shapeA=${shapeA} faces=${faceIdsA.length}, ` +
          `shapeB=${shapeB} faces=${faceIdsB.length})`,
        );
      }
      const faceA = faceIdsA[0];
      const faceB = faceIdsB[0];

      // ADR-087 K-δ semantics — drawRectAsShape AUTO-attaches a Plane
      // surface (LOCKED #34). See setupNPlaneFaces for full rationale.
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
      } else {
        // ADR-087 K-δ post-attach mitigation — explicit clear.
        bridge.clearFaceSurface(faceA);
        bridge.clearFaceSurface(faceB);
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
 * ADR-077 V-3 helper — halt the Three.js rAF render loop before a visual
 * snapshot. Playwright's `toHaveScreenshot` (and `--update-snapshots`)
 * requires two consecutive screenshots to match within a pixel threshold
 * before it writes the baseline. A continuously rendering WebGL canvas
 * never stabilizes within the default 5 s timeout (per-frame jitter from
 * AA / SSAO / dithering), so the assertion times out indefinitely.
 *
 * Calling `viewport.stop()` cancels the `requestAnimationFrame` chain
 * (Viewport.ts:3164) but leaves the last rendered frame on the canvas,
 * which is what we want to snapshot. Safe to call multiple times.
 */
export async function stopViewportRenderLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    try {
      const v = w.__axia?.get?.('viewport');
      v?.stop?.();
    } catch {
      // viewport not yet registered or already stopped — no-op
    }
  });
}

// ADR-076 Step 2 — Removed: invokeBooleanDispatchDcel (single-face
// helper). Bridge.booleanDispatchDcel and the underlying WASM export
// were sunset in ADR-076 Step 2. Multi (invokeBooleanDispatchDcelMulti
// below) covers the same case via Y-1 1×1 degenerate.

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
        // ADR-087 K-ζ migration — drawRect → drawRectAsShape (see
        // setupTwoPlaneFaces comment for rationale).
        const shape = bridge.drawRectAsShape(0, 0, z, 0, 0, 1, 1, 0, 0, 10, 10);
        const ids = bridge.getShapeFaceIds(shape);
        if (ids.length === 0) {
          throw new Error(`drawRectAsShape Shape ${shape} produced no faces (i=${i})`);
        }
        const faceId = ids[0];
        // ADR-087 K-δ semantics — drawRectAsShape AUTO-attaches a Plane
        // surface (LOCKED #34). To preserve the legacy `withSurfaces`
        // contract:
        //   - withSurfaces:true → keep the auto-attached Plane (the
        //     explicit setFaceSurfacePlane re-attach below is harmless
        //     redundancy; it overrides u/v ranges to match test
        //     expectations).
        //   - withSurfaces:false → CLEAR the auto-attached Plane so
        //     `Face.surface = None`. This is what enables Y-E ineligibility
        //     (Mesh fallback) testing — without this clear, every face
        //     would be NURBS-eligible.
        if (withSurfaces) {
          bridge.engine.setFaceSurfacePlane(
            faceId,
            0, 0, z,        // origin
            0, 0, 1,        // normal +Z
            1, 0, 0,        // basis_u +X
            -5, 5,          // u_range
            -5, 5,          // v_range
          );
        } else {
          // ADR-087 K-δ post-attach mitigation — explicit clear.
          bridge.clearFaceSurface(faceId);
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

/**
 * ADR-075 E4-4 — Mesh state snapshot for undo round-trip verification.
 *
 * `faceCount` / `vertCount` from `bridge.getStats()` plus undo/redo
 * availability. Per E4-4-b, this is the contract verified across an
 * op + undo cycle. Deep mesh diff (face IDs, edge topology) is
 * deferred to E4-5 / future ADR.
 */
export interface MeshSnapshot {
  faceCount: number;
  vertCount: number;
  edgeCount: number;
  canUndo: boolean;
  canRedo: boolean;
}

export async function captureMeshSnapshot(page: Page): Promise<MeshSnapshot> {
  return await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = (window as any).__axia.get('bridge');
    const s = bridge.getStats();
    return {
      faceCount: s.faces,
      vertCount: s.verts,
      edgeCount: s.edges,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
    };
  });
}

/**
 * Invoke `bridge.undo()` in browser context. Returns the engine's
 * boolean response (true = undo applied, false = nothing to undo).
 */
export async function invokeUndo(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = (window as any).__axia.get('bridge');
    return bridge.undo();
  });
}

/**
 * ADR-074 U-4 — Setup faces + selection + Boolean Group A/B tags.
 *
 * Routes through `toolManager.selection` (NOT a separately-registered
 * 'selection' service — verified against main.ts container.register
 * calls: only 'bridge', 'viewport', 'toolManager' etc. registered).
 *
 * Defensive throws expose ADR-074 build drift early — distinguish
 * between bridge boot failure vs container shape change vs missing
 * U-1 method 배포.
 *
 * @param faces — face IDs to add to selection (must already exist
 *   in the mesh; caller is responsible for setupNPlaneFaces)
 * @param groupA — face IDs to tag as Group A (subset of `faces`)
 * @param groupB — face IDs to tag as Group B (subset of `faces`)
 */
export async function setupGroupedSelection(
  page: Page,
  args: { faces: number[]; groupA: number[]; groupB: number[] },
): Promise<void> {
  await page.evaluate(({ faces, groupA, groupB }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (!w.__axia) {
      throw new Error(
        'setupGroupedSelection: window.__axia missing — bridge boot incomplete',
      );
    }
    const tm = w.__axia.get('toolManager');
    if (!tm) {
      throw new Error(
        'setupGroupedSelection: toolManager not registered in container',
      );
    }
    const sm = tm.selection;
    if (!sm) {
      throw new Error(
        'setupGroupedSelection: toolManager.selection missing — ' +
          'SelectionManager wiring drift',
      );
    }
    if (
      typeof sm.selectFaces !== 'function' ||
      typeof sm.setGroupTag !== 'function' ||
      typeof sm.hasGroupSelection !== 'function' ||
      typeof sm.clearSelection !== 'function'
    ) {
      throw new Error(
        'setupGroupedSelection: SelectionManager group methods missing — ' +
          'ADR-074 U-1 build state out of date (missing ' +
          'selectFaces / setGroupTag / hasGroupSelection / clearSelection)',
      );
    }
    sm.clearSelection();  // clean baseline
    sm.selectFaces(faces);
    if (groupA.length > 0) sm.setGroupTag(groupA, 'A');
    if (groupB.length > 0) sm.setGroupTag(groupB, 'B');
  }, args);
}

/**
 * ADR-074 U-4 — Install a spy on `bridge.booleanDispatchDcelMulti`
 * that captures the dispatched (facesA, facesB, op) args while
 * still calling the real engine method. Capture is stored on
 * `window.__capturedMultiArgs` so the test can read it back.
 *
 * Also installs a `__multiCallCount` so tests can assert "exactly N
 * calls happened" (e.g., 0 calls when group routing decided to use
 * non-multi path).
 */
export async function installMultiDispatchSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const bridge = w.__axia.get('bridge');
    if (typeof bridge.booleanDispatchDcelMulti !== 'function') {
      throw new Error(
        'installMultiDispatchSpy: bridge.booleanDispatchDcelMulti missing — ' +
          'ADR-066 Y-3 wrapper not deployed',
      );
    }
    const orig = bridge.booleanDispatchDcelMulti.bind(bridge);
    w.__capturedMultiArgs = null;
    w.__multiCallCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bridge.booleanDispatchDcelMulti = (...callArgs: any[]) => {
      w.__capturedMultiArgs = {
        facesA: callArgs[0],
        facesB: callArgs[1],
        op: callArgs[2],
        tolGeometric: callArgs[3],
      };
      w.__multiCallCount++;
      return orig(...callArgs);
    };
  });
}

/**
 * Read back the latest capture from `installMultiDispatchSpy`.
 */
export async function readCapturedMultiDispatch(
  page: Page,
): Promise<{
  args: {
    facesA: number[];
    facesB: number[];
    op: string;
    tolGeometric: number;
  } | null;
  callCount: number;
}> {
  return await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    return {
      args: w.__capturedMultiArgs,
      callCount: w.__multiCallCount ?? 0,
    };
  });
}

/**
 * ADR-074 U-4 — Click a `[data-action="..."]` element to invoke the
 * application's main toolbar/menu dispatcher (which calls
 * `dispatchToolbarAction` → `startBooleanOp` for bool-* actions).
 *
 * Uses `page.evaluate(btn.click())` rather than Playwright's
 * `.click()` to bypass dropdown visibility issues — main.ts uses
 * event delegation on data-action so any element with that attribute
 * triggers the handler regardless of CSS visibility.
 */
export async function clickToolbarAction(
  page: Page,
  action: string,
): Promise<void> {
  await page.evaluate((act) => {
    const sel = `[data-action="${act}"]`;
    const btn = document.querySelector(sel) as HTMLElement | null;
    if (!btn) {
      throw new Error(`clickToolbarAction: no element matches ${sel}`);
    }
    btn.click();
  }, action);
}

// ════════════════════════════════════════════════════════════════════════
// ADR-078 P-4 — Project Save/Load Round-trip Real Chromium E2E.
//
// Per P-4 lock-ins:
// - P-4-a (b): bridge call sequence simulation (no DOM file dialog).
// - P-4-c (a): page reload between save and load — true fresh state.
// - P-4-h: fixture replays the same logical push/pull flow that
//   ProjectSerializer.saveProject/openProject performs.
//
// The simulate* helpers below are the persistence-layer equivalent of
// ProjectSerializer.pushGroupTagsToBridge / pullGroupTagsFromBridge.
// They exercise the same WasmBridge surface; only the trigger point
// (test code vs UI button) differs.
// ════════════════════════════════════════════════════════════════════════

/**
 * ADR-078 P-3 L1 — Save sync push (clear → set(A) → set(B)).
 *
 * Mirrors `ProjectSerializer.pushGroupTagsToBridge`. Reads UI runtime
 * state from `toolManager.selection.getGroupA / getGroupB`, then pushes
 * to WasmBridge via clear + set(A) + set(B). Idempotent: if both
 * groups empty, only clear is invoked.
 */
export async function simulateProjectSavePush(page: Page): Promise<void> {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const bridge = w.__axia.get('bridge');
    const sm = w.__axia.get('toolManager').selection;
    bridge.clearBooleanGroupTags();
    const a: number[] = sm.getGroupA?.() ?? [];
    const b: number[] = sm.getGroupB?.() ?? [];
    if (a.length > 0) bridge.setBooleanGroupTag(a, 'A');
    if (b.length > 0) bridge.setBooleanGroupTag(b, 'B');
  });
}

/**
 * Export the current scene snapshot as a portable number[] (Playwright
 * cannot serialize Uint8Array directly across page.evaluate boundary
 * → convert via Array.from at the source).
 *
 * Mirrors `bridge.exportSnapshot()` in ProjectSerializer.saveProject.
 */
export async function exportSnapshotBytes(page: Page): Promise<number[]> {
  return await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = (window as any).__axia.get('bridge');
    const bytes: Uint8Array = bridge.exportSnapshot();
    if (!bytes) {
      throw new Error('exportSnapshotBytes: bridge.exportSnapshot returned null');
    }
    return Array.from(bytes);
  });
}

/**
 * Import a previously-exported snapshot byte array. Mirrors
 * `bridge.importSnapshot(data)` + `toolManager.syncMesh()` in
 * ProjectSerializer.openProject (load path).
 *
 * Returns true on successful import (P-1 SNAPSHOT_VERSION = 2 check
 * passed + bincode deserialization OK).
 */
export async function importSnapshotBytes(
  page: Page,
  bytes: number[],
): Promise<boolean> {
  return await page.evaluate((bytesArr) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const bridge = w.__axia.get('bridge');
    const tm = w.__axia.get('toolManager');
    const ok = bridge.importSnapshot(new Uint8Array(bytesArr));
    if (ok) {
      tm.syncMesh();
    }
    return ok;
  }, bytes);
}

/**
 * ADR-078 P-3 L2 — Load sync pull (getA + getB + restoreGroupTags).
 *
 * Mirrors `ProjectSerializer.pullGroupTagsFromBridge`. Reads persistent
 * group_tags from Scene via WasmBridge.getBooleanGroup{A,B}Faces, then
 * applies via SelectionManager.restoreGroupTags (P-3 L3 policy:
 * groupTags fully replaced + selection ∪ (A ∪ B) + 1 notifyChange).
 *
 * Must be invoked AFTER importSnapshotBytes + syncMesh (P-3 L2 lock-in
 * — face IDs must be stable before pull).
 */
export async function simulateProjectLoadPull(page: Page): Promise<void> {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const bridge = w.__axia.get('bridge');
    const sm = w.__axia.get('toolManager').selection;
    if (typeof sm.restoreGroupTags !== 'function') {
      throw new Error(
        'simulateProjectLoadPull: SelectionManager.restoreGroupTags missing — ' +
          'ADR-078 P-3 build state out of date',
      );
    }
    const a: number[] = bridge.getBooleanGroupAFaces();
    const b: number[] = bridge.getBooleanGroupBFaces();
    sm.restoreGroupTags(a, b);
  });
}

/**
 * Read SelectionManager.getGroupA / getGroupB / hasGroupSelection +
 * selection size for round-trip verification. Sorted ascending so
 * tests can use deep-equality without ordering concerns.
 */
export async function readSelectionGroups(
  page: Page,
): Promise<{
  groupA: number[];
  groupB: number[];
  hasSelection: boolean;
  selectionSize: number;
}> {
  return await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const sm = w.__axia.get('toolManager').selection;
    const a: number[] = sm.getGroupA();
    const b: number[] = sm.getGroupB();
    const sel: number[] = sm.getSelectedFaces();
    return {
      groupA: a.slice().sort((x: number, y: number) => x - y),
      groupB: b.slice().sort((x: number, y: number) => x - y),
      hasSelection: sm.hasGroupSelection(),
      selectionSize: sel.length,
    };
  });
}

/**
 * Build a cylinder via the ADR-089 Path B kernel-native flow:
 *
 *   `drawCircleAsCurve` (closed-curve face, 1 anchor + 1 self-loop edge)
 *   → `createSolidExtrude` (Path B annulus topology: 3 face / 2 edge / 2 vert)
 *
 * This is the exact codepath that exercises LOCKED #40's render
 * chord_tol on both the top/bottom rims (closed-curve face fast-path)
 * and the side surface (Cylinder uv-slice). Visual specs that compare
 * pixels against a baseline will detect any regression of
 * `ANALYTIC_CHORD_TOL` (0.1 → 0.02 type changes), top-rim Arc curve
 * attachment, or surface-aware Gouraud shading.
 *
 * Geometry defaults to radius 1000mm + height 2000mm, centered at origin,
 * normal +Z. Override via opts for stress scenarios.
 *
 * Returns the resolved face IDs so tests can target hover / selection
 * on a specific rim edge.
 */
export interface CylinderHandle {
  shapeId: number;
  profileFaceId: number;
  /** Face IDs for top / bottom / annulus side, in DCEL order. */
  faceIds: number[];
  /** Edge ID of the top rim self-loop (Path B). */
  topRimEdgeId: number;
  /** Edge ID of the bottom rim self-loop (Path B). */
  bottomRimEdgeId: number;
}

export async function setupCylinder(
  page: Page,
  opts: { radius?: number; height?: number } = {},
): Promise<CylinderHandle> {
  const radius = opts.radius ?? 1000;
  const height = opts.height ?? 2000;
  return await page.evaluate(
    ({ radius, height }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const bridge = w.__axia.get('bridge');

      // ADR-089 A-π Path B default — drawCircleAsCurve creates a
      // closed-curve face. createSolidExtrude routes via Path B
      // (kernel-native annulus) when `cylinder_path_b_default` is true,
      // which it is in production (ADR-094 B-η).
      const shapeId: number = bridge.drawCircleAsCurve(
        0, 0, 0,
        0, 0, 1,
        radius,
      );
      if (shapeId == null || shapeId < 0) {
        throw new Error(`drawCircleAsCurve failed: ${shapeId}`);
      }
      const profileFaceIds: number[] = bridge.getShapeFaceIds(shapeId);
      if (!profileFaceIds || profileFaceIds.length === 0) {
        throw new Error(`Shape ${shapeId} produced no faces`);
      }
      const profileFaceId: number = profileFaceIds[0];

      const ok: boolean = bridge.createSolidExtrude(profileFaceId, height);
      if (!ok) {
        throw new Error(
          `createSolidExtrude(${profileFaceId}, ${height}) returned false`,
        );
      }

      // Read back the solid's face IDs. Path B produces 3 faces; Path A
      // produces many more. We accept either; the caller uses faceIds[0]
      // / faceIds[1] for rim hover regardless of topology.
      const afterFaces: number[] = bridge.getShapeFaceIds(shapeId);

      // Find rim edges — self-loop edges with a Circle curve attached.
      // These are unique to Path B; Path A has N polygon edges per rim.
      // Returning -1 lets the test decide whether the assertion is
      // path-conditional.
      const edgeMap: Uint32Array = bridge.getEdgeMap();
      const edgeOwnerCounts = new Map<number, number>();
      for (let i = 0; i < edgeMap.length; i++) {
        const eid = edgeMap[i];
        edgeOwnerCounts.set(eid, (edgeOwnerCounts.get(eid) ?? 0) + 1);
      }
      const multiSegmentEdges = [...edgeOwnerCounts.entries()]
        .filter(([_, count]) => count >= 2)
        .map(([eid]) => eid)
        .sort((a, b) => a - b);

      // Heuristic: in Path B, the two multi-segment edges are top and
      // bottom rims. Lower-numbered = bottom (created earlier in extrude).
      const bottomRimEdgeId = multiSegmentEdges[0] ?? -1;
      const topRimEdgeId = multiSegmentEdges[1] ?? -1;

      return {
        shapeId,
        profileFaceId,
        faceIds: afterFaces,
        topRimEdgeId,
        bottomRimEdgeId,
      };
    },
    { radius, height },
  );
}

/**
 * Switch the viewport to one of the canonical view modes — deterministic
 * camera state for reproducible screenshots. Without this, the default
 * orbital state is implementation-defined and could drift between
 * sessions, causing spurious visual diffs.
 *
 * Valid modes: `'3d' | 'top' | 'bottom' | 'front' | 'back' | 'right' | 'left'`.
 */
export async function setViewportMode(
  page: Page,
  mode: '3d' | 'top' | 'bottom' | 'front' | 'back' | 'right' | 'left',
): Promise<void> {
  await page.evaluate((mode) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const viewport = w.__axia?.get?.('viewport');
    if (viewport && typeof viewport.setViewMode === 'function') {
      viewport.setViewMode(mode);
    }
  }, mode);
}

/**
 * Programmatically hover over an edge by simulating a mouse move at the
 * screen position corresponding to its midpoint. The visual specs use
 * this to capture the unified hover highlight (all segments of one
 * Edge ID drawn in HOVER_COLOR — ADR-088 + LOCKED #40 L3).
 *
 * Returns the screen-space [x, y] hovered (for screenshot positioning).
 */
export async function hoverOverEdge(
  page: Page,
  edgeId: number,
): Promise<[number, number] | null> {
  return await page.evaluate((edgeId) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const bridge = w.__axia.get('bridge');
    const lines: Float32Array = bridge.getEdgeLines();
    const edgeMap: Uint32Array = bridge.getEdgeMap();
    // Find first segment of edgeId in edgeMap, compute its midpoint in
    // world coordinates, project to screen.
    let segIdx = -1;
    for (let i = 0; i < edgeMap.length; i++) {
      if (edgeMap[i] === edgeId) { segIdx = i; break; }
    }
    if (segIdx < 0) return null;
    const base = segIdx * 6;
    const mx = (lines[base] + lines[base + 3]) / 2;
    const my = (lines[base + 1] + lines[base + 4]) / 2;
    const mz = (lines[base + 2] + lines[base + 5]) / 2;
    const viewport = w.__axia?.get?.('viewport');
    if (!viewport) return null;
    const cam = viewport.activeCamera;
    // THREE.js Vector3 is not globally exposed in the bundled app;
    // clone the camera's position vector (which IS a THREE.Vector3)
    // and overwrite its coords. The `.project(cam)` call then maps
    // world coords to NDC space [-1, +1].
    const vec = cam.position.clone();
    vec.set(mx, my, mz);
    vec.project(cam);
    const rect = viewport.renderer.domElement.getBoundingClientRect();
    const x = ((vec.x + 1) / 2) * rect.width + rect.left;
    const y = ((1 - vec.y) / 2) * rect.height + rect.top;
    return [x, y];
  }, edgeId).then(async (screenXY) => {
    if (screenXY) {
      await page.mouse.move(screenXY[0], screenXY[1]);
      // Allow hover state to propagate (mousemove → pickEdgeOrFace →
      // setEdgeHoverGroup → rebuildEdgeHoverLine).
      await page.waitForTimeout(50);
    }
    return screenXY;
  });
}

/**
 * Build a sphere primitive via the `create_sphere` bridge entry.
 *
 * Visual regression coverage for analytic Sphere surface tessellation:
 * the renderer's uv-slice + analytic normal pipeline produces a smooth
 * Gouraud-shaded ball. Any regression of `ANALYTIC_CHORD_TOL` (LOCKED
 * #40) or `SurfaceOps::tessellate` for Sphere would shift pixels on
 * the curved silhouette and fail the baseline diff.
 *
 * Defaults: r=1000mm, 32×16 segments — same magnitude as setupCylinder
 * so the sphere reads at a similar screen-space scale at the default
 * camera distance.
 */
export interface SphereHandle {
  xiaId: number;
  faceIds: number[];
}

export async function setupSphere(
  page: Page,
  opts: { radius?: number; uSegments?: number; vSegments?: number } = {},
): Promise<SphereHandle> {
  const radius = opts.radius ?? 1000;
  const u = opts.uSegments ?? 32;
  const v = opts.vSegments ?? 16;
  return await page.evaluate(
    ({ radius, u, v }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const bridge = w.__axia.get('bridge');
      const xiaId: number = bridge.create_sphere(0, 0, 0, radius, u, v);
      if (xiaId == null || xiaId < 0) {
        throw new Error(`create_sphere failed: ${xiaId}`);
      }
      const faceIds: number[] = bridge.getXiaFaceIds
        ? bridge.getXiaFaceIds(xiaId)
        : [];
      return { xiaId, faceIds };
    },
    { radius, u, v },
  );
}

/**
 * Build a cone primitive via the `create_cone` bridge entry.
 *
 * Visual regression coverage for analytic Cone surface tessellation
 * AND the bottom rim's chord polygon — the cone exercises a different
 * slant of the same `tessellate_face_surface` + uv-slice machinery
 * that drives Cylinder, so a regression that hits one usually hits
 * the other.
 *
 * Defaults: r=1000mm, h=2000mm, 32 rim segments.
 */
export interface ConeHandle {
  xiaId: number;
  faceIds: number[];
}

export async function setupCone(
  page: Page,
  opts: { radius?: number; height?: number; segments?: number } = {},
): Promise<ConeHandle> {
  const radius = opts.radius ?? 1000;
  const height = opts.height ?? 2000;
  const segments = opts.segments ?? 32;
  return await page.evaluate(
    ({ radius, height, segments }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const bridge = w.__axia.get('bridge');
      const xiaId: number = bridge.create_cone(0, 0, 0, radius, height, segments);
      if (xiaId == null || xiaId < 0) {
        throw new Error(`create_cone failed: ${xiaId}`);
      }
      const faceIds: number[] = bridge.getXiaFaceIds
        ? bridge.getXiaFaceIds(xiaId)
        : [];
      return { xiaId, faceIds };
    },
    { radius, height, segments },
  );
}
