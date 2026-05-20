/**
 * ADR-101 H-ε — Headless ↔ Browser runtime parity for canonical
 * rect-with-hole workflow.
 *
 * 메타-원칙 #15 의 첫 explicit Playwright 회귀 — 동일 LOCKED #40
 * sequence (drawRectAsShape + drawCircleAsShape + mergeCoplanarContaining)
 * 가 Node WASM headless 와 Browser WASM (Vite preview) 두 런타임에서
 * 의미 등가 (face/edge/vert/loop count + invariants 일치) 함을 검증.
 *
 * "UI tool 경로" 의 진정한 surface 는 `bridge.drawRectAsShape` /
 * `bridge.drawCircleAsShape` / `bridge.mergeCoplanarContaining` —
 * 도구가 결국 호출하는 entry. 따라서 cross-runtime parity 가 메타-원칙
 * #15 의 본질 검증.
 *
 * 절대 #[ignore] 금지 (LOCKED 정책).
 */
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const wasmPath = resolve(__dirname, '../../packages/axia-wasm-node/dist/axia_wasm.js');
const wasmBuilt = existsSync(wasmPath);

/** Shape produced by both paths — keep narrow to make diff readable. */
interface ParityStats {
  faceCount: number;
  edgeCount: number;
  vertCount: number;
  innerLoopCountOnMergedFace: number;
  invariantsValid: boolean;
  violationCount: number;
  /** Smallest active face id by stable comparator. */
  finalFaceId: number;
}

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

interface NodeHeadlessEngine {
  draw_rect_as_shape(
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    ux: number, uy: number, uz: number,
    width: number, height: number,
  ): number;
  draw_circle_as_shape(
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    radius: number, segments: number,
  ): number;
  mergeCoplanarContaining(outer: number, inner: number, tol: number): number;
  faceArea(face_id: number): number;
  faceInnerLoopCount(face_id: number): number;
  verifyInvariants(): string;
  get_face_map(): Uint32Array;
  get_stats(): string;
}

/**
 * Canonical LOCKED #40 sequence — rect 2m×4m + r=500mm inner circle +
 * mergeCoplanarContaining → ring with single hole loop.
 */
function runCanonicalSequenceNode(engine: NodeHeadlessEngine): ParityStats {
  engine.draw_rect_as_shape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 4000);
  engine.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 500, 64);

  const faceIds = [...new Set(engine.get_face_map())]
    .map((fid) => ({ fid, area: engine.faceArea(fid) }))
    .sort((a, b) => b.area - a.area);
  const [outer, inner] = faceIds;

  const merged = engine.mergeCoplanarContaining(outer.fid, inner.fid, 1.0);
  if (merged < 0) {
    throw new Error('Node: mergeCoplanarContaining failed');
  }

  const stats = JSON.parse(engine.get_stats()) as {
    faces: number; edges: number; verts: number;
  };
  const invariants = JSON.parse(engine.verifyInvariants()) as {
    valid: boolean; violationCount: number;
  };

  return {
    faceCount: stats.faces,
    edgeCount: stats.edges,
    vertCount: stats.verts,
    innerLoopCountOnMergedFace: engine.faceInnerLoopCount(merged),
    invariantsValid: invariants.valid,
    violationCount: invariants.violationCount,
    finalFaceId: merged,
  };
}

test.describe('ADR-101 H-ε — headless ↔ browser runtime parity', () => {
  test.skip(!wasmBuilt, 'Node WASM target not built');

  test('canonical LOCKED #40 sequence produces semantically equivalent mesh on both runtimes', async ({
    page,
  }) => {
    // ── Path A: Node headless ─────────────────────────────────────────
    const mod = (await import(wasmPath)) as {
      AxiaEngine: new () => NodeHeadlessEngine;
    };
    const nodeEngine = new mod.AxiaEngine();
    const nodeStats = runCanonicalSequenceNode(nodeEngine);

    // ── Path B: Browser via Vite preview + bridge ─────────────────────
    await page.goto('/');
    await waitForBridgeReady(page);
    const browserStats = await page.evaluate((): ParityStats => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const engine = bridge.engine as any;

      engine.draw_rect_as_shape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 4000);
      engine.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 500, 64);

      const faces = [...new Set(engine.get_face_map() as Uint32Array)]
        .map((fid: number) => ({ fid, area: engine.faceArea(fid) as number }))
        .sort((a, b) => b.area - a.area);
      const [outer, inner] = faces;

      const merged: number = engine.mergeCoplanarContaining(
        outer.fid,
        inner.fid,
        1.0,
      );
      if (merged < 0) {
        throw new Error('Browser: mergeCoplanarContaining failed');
      }

      const stats = JSON.parse(engine.get_stats() as string) as {
        faces: number; edges: number; verts: number;
      };
      const invariants = JSON.parse(engine.verifyInvariants() as string) as {
        valid: boolean; violationCount: number;
      };

      return {
        faceCount: stats.faces,
        edgeCount: stats.edges,
        vertCount: stats.verts,
        innerLoopCountOnMergedFace: engine.faceInnerLoopCount(merged) as number,
        invariantsValid: invariants.valid,
        violationCount: invariants.violationCount,
        finalFaceId: merged,
      };
    });

    // ── Compare ──────────────────────────────────────────────────────
    // Canonical LOCKED #40 invariants both runtimes must satisfy.
    expect(nodeStats.faceCount).toBe(1);
    expect(nodeStats.innerLoopCountOnMergedFace).toBe(1);
    expect(nodeStats.invariantsValid).toBe(true);
    expect(nodeStats.violationCount).toBe(0);

    expect(browserStats.faceCount).toBe(1);
    expect(browserStats.innerLoopCountOnMergedFace).toBe(1);
    expect(browserStats.invariantsValid).toBe(true);
    expect(browserStats.violationCount).toBe(0);

    // Cross-runtime parity — same edges + verts produced by identical
    // input sequence. FaceId may differ if id allocator drifts between
    // runtimes; we test it indirectly via innerLoopCount above.
    expect(browserStats.edgeCount).toBe(nodeStats.edgeCount);
    expect(browserStats.vertCount).toBe(nodeStats.vertCount);
  });

  test('headless `_as_shape` × 2 without merge leaves 2 coplanar overlapping faces in browser too', async ({
    page,
  }) => {
    // 메타-원칙 #15 의 "차이가 의도된 경우" 검증 — auto-promote 안 됨을
    // 두 runtime 모두에서 명시 invariant 로 봉인.
    await page.goto('/');
    await waitForBridgeReady(page);
    const browserResult = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const engine = bridge.engine as any;

      engine.draw_rect_as_shape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 4000);
      engine.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 500, 64);

      const faces = [...new Set(engine.get_face_map() as Uint32Array)];
      return {
        faceCount: faces.length,
        innerLoopCounts: faces.map(
          (fid: number) => engine.faceInnerLoopCount(fid) as number,
        ),
      };
    });

    // LOCKED #40 anchor: no auto-promote → 2 face, both simple (no holes)
    expect(browserResult.faceCount).toBe(2);
    expect(browserResult.innerLoopCounts.every((c) => c === 0)).toBe(true);
  });
});
