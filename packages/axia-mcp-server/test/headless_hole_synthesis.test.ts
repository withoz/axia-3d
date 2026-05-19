// ADR-101 H-γ — Headless hole synthesis regression.
//
// Validates LOCKED #40 + 메타-원칙 #15 invariants:
//   1. `draw_*_as_shape` × 2 (outer + inner) sequential 호출은 자동 hole
//      promote 안 함 — 2 개의 coplanar overlapping face 잔존.
//   2. `mergeCoplanarContaining(outer, inner, tol)` 명시 호출이 정답
//      경로 — 1 face + 1 inner hole loop + invariants 0 violations.
//
// 절대 #[ignore] 금지 (LOCKED 정책).

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const wasmPath = resolve(__dirname, '../../axia-wasm-node/dist/axia_wasm.js');
const wasmBuilt = existsSync(wasmPath);

interface HeadlessEngine {
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
  mergeCoplanarContaining(outer: number, inner: number, tol_deg: number): number;
  faceArea(face_id: number): number;
  faceInnerLoopCount(face_id: number): number;
  verifyInvariants(): string;
  get_face_map(): Uint32Array;
  get_stats(): string;
  lastError?(): string | undefined;
}

type EngineCtor = new () => HeadlessEngine;

async function loadEngine(): Promise<EngineCtor> {
  const mod = (await import(wasmPath)) as { AxiaEngine: EngineCtor };
  return mod.AxiaEngine;
}

function activeFaceIds(eng: HeadlessEngine): number[] {
  return [...new Set(eng.get_face_map())];
}

function facesByAreaDesc(eng: HeadlessEngine): Array<{ fid: number; area: number }> {
  const faces = activeFaceIds(eng).map((fid) => ({ fid, area: eng.faceArea(fid) }));
  faces.sort((a, b) => b.area - a.area);
  return faces;
}

describe.skipIf(!wasmBuilt)('ADR-101 H-γ — headless hole synthesis', () => {
  it('headless_two_shapes_overlap_until_explicit_merge: rect + inner circle leaves 2 coplanar overlapping faces (no auto-promote)', async () => {
    const AxiaEngine = await loadEngine();
    const eng = new AxiaEngine();

    const outerId = eng.draw_rect_as_shape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 4000);
    expect(outerId).toBeGreaterThanOrEqual(0);

    const innerId = eng.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 500, 64);
    expect(innerId).toBeGreaterThanOrEqual(0);

    // LOCKED #40 anchor: 자동 hole-promote 안 됨 — 두 face 가 별개 잔존.
    const faces = facesByAreaDesc(eng);
    expect(faces.length).toBe(2);

    // 외곽 사각형 면적 보존 (ring 으로 변환 안 됨)
    expect(faces[0].area).toBeCloseTo(2000 * 4000, -3);
    // 내부 disk (64-seg polygon 의 면적은 π·r² 보다 약간 작음)
    expect(faces[1].area).toBeGreaterThan(700_000);
    expect(faces[1].area).toBeLessThan(800_000);

    // 두 face 모두 *simple* (hole loop 없음)
    expect(eng.faceInnerLoopCount(faces[0].fid)).toBe(0);
    expect(eng.faceInnerLoopCount(faces[1].fid)).toBe(0);
  });

  it('merge_coplanar_containing_promotes_to_hole_loop: explicit merge produces 1 face + 1 hole loop + invariants 0 violations (rect outer)', async () => {
    const AxiaEngine = await loadEngine();
    const eng = new AxiaEngine();

    eng.draw_rect_as_shape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 4000);
    eng.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 500, 64);

    const [outer, inner] = facesByAreaDesc(eng);
    const merged = eng.mergeCoplanarContaining(outer.fid, inner.fid, 1.0);
    expect(merged).toBeGreaterThanOrEqual(0);

    // 1 face 만 잔존, inner hole loop 1 개
    expect(activeFaceIds(eng).length).toBe(1);
    expect(eng.faceInnerLoopCount(merged)).toBe(1);

    // ADR-007 invariants — 0 violations
    const report = JSON.parse(eng.verifyInvariants());
    expect(report.valid).toBe(true);
    expect(report.violationCount).toBe(0);
  });

  it('merge_coplanar_containing_disk_outer: big-disk + small-disk variant also promotes to hole loop', async () => {
    const AxiaEngine = await loadEngine();
    const eng = new AxiaEngine();

    eng.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 2000, 128); // outer r=2m
    eng.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 500, 64);   // inner r=0.5m

    const [outer, inner] = facesByAreaDesc(eng);
    const merged = eng.mergeCoplanarContaining(outer.fid, inner.fid, 1.0);
    expect(merged).toBeGreaterThanOrEqual(0);

    expect(activeFaceIds(eng).length).toBe(1);
    expect(eng.faceInnerLoopCount(merged)).toBe(1);
    const report = JSON.parse(eng.verifyInvariants());
    expect(report.valid).toBe(true);
  });

  it('merge_coplanar_containing_rejects_non_containing: small-disk as outer + big-disk as inner returns -1 (no containment)', async () => {
    const AxiaEngine = await loadEngine();
    const eng = new AxiaEngine();

    eng.draw_rect_as_shape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 4000);
    eng.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 500, 64);

    const [outer, inner] = facesByAreaDesc(eng);
    // outer/inner 를 *swap* — 큰 face 가 작은 face 에 들어갈 수 없음
    const merged = eng.mergeCoplanarContaining(inner.fid, outer.fid, 1.0);
    expect(merged).toBeLessThan(0);

    // 실패 시 mesh 상태 보존 — 두 face 그대로
    expect(activeFaceIds(eng).length).toBe(2);
  });
});
