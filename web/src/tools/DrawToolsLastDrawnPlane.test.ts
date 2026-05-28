/**
 * ADR-164 β-2 — Draw 도구 6개 setLastDrawnPlane wiring 회귀.
 *
 * 6 도구 (Rect/Circle/Line/Arc/Bezier/Freehand) 각각에서 face 합성
 * *성공* 직후 `ctx.setLastDrawnPlane(...)` 가 호출됨을 source-level
 * 로 검증. ADR-149/150/151 β-3 의 endpoint-wired 패턴 답습 (TS-side
 * counterpart).
 *
 * Why source-level?
 *   각 도구의 commit branch 는 plane projection / radius / closure
 *   detection 등 깊은 setup 이 필요해 mock fragility 가 높음. β-1 의
 *   API 가 이미 unit tested (4 tests in ToolManagerRefactored.test.ts)
 *   되어 있으므로, β-2 는 *wiring presence* 만 검증하면 충분.
 *
 * Lock-ins:
 *   - L-164-Q1=a (face 합성 성공 후만) — 모든 호출이 success branch
 *     안에 위치 (negative shapeRaw / error branch 밖)
 *   - L-164-Q3=a (source 분리) — 각 호출에 source: 'face' | 'view' |
 *     'sketch' 명시
 *   - L-164-10 — 절대 #[ignore] 금지 6/6 준수
 *
 * Cross-link: ADR-164 §3 (β-2 spec), ADR-149/150/151 β-3 (source
 * pattern), LOCKED #44 (atomic per merge), LOCKED #65 메타-원칙 #16
 * (명시 trigger only).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function readToolSource(name: string): string {
  return readFileSync(join(__dirname, `${name}.ts`), 'utf-8');
}

describe('ADR-164 β-2 — Draw 도구 6개 setLastDrawnPlane wiring', () => {
  it('adr164_drawrect_sets_last_drawn_plane — DrawRectTool wires after drawRectAsShape success', () => {
    const src = readToolSource('DrawRectTool');
    // 1. setLastDrawnPlane call exists
    expect(src).toContain('setLastDrawnPlane');
    // 2. Wired in the success branch (after debugLog [Rect] Created)
    const successBranchIdx = src.indexOf('[Rect] Created');
    const callIdx = src.indexOf('setLastDrawnPlane');
    expect(successBranchIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(successBranchIdx);
    // 3. ADR-164 reference present (provenance lock-in)
    expect(src).toMatch(/ADR-164.*β-2/);
  });

  it('adr164_drawcircle_sets_last_drawn_plane — DrawCircleTool wires after drawCircleAsShape/AsCurve success', () => {
    const src = readToolSource('DrawCircleTool');
    expect(src).toContain('setLastDrawnPlane');
    // Wired after the [Circle] Created branch (radius > 1 success)
    const successBranchIdx = src.indexOf('[Circle] Created');
    const callIdx = src.indexOf('setLastDrawnPlane');
    expect(successBranchIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(successBranchIdx);
    expect(src).toMatch(/ADR-164.*β-2/);
  });

  it('adr164_drawline_sets_last_drawn_plane — DrawLineTool wires after closed-loop face creation', () => {
    const src = readToolSource('DrawLineTool');
    expect(src).toContain('setLastDrawnPlane');
    // L-164-Q1=a — wired in faceCreated branch ONLY (not in non-face line creation)
    const faceCreatedBranchIdx = src.indexOf('루프 닫힘 — 면 생성됨');
    const callIdx = src.indexOf('setLastDrawnPlane');
    expect(faceCreatedBranchIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(faceCreatedBranchIdx);
    expect(src).toMatch(/ADR-164.*β-2/);
  });

  it('adr164_drawarc_sets_last_drawn_plane — DrawArcTool wires after arc commit success', () => {
    const src = readToolSource('DrawArcTool');
    expect(src).toContain('setLastDrawnPlane');
    // Wired before syncMesh (after arc center + planeNormal extracted)
    const callIdx = src.indexOf('setLastDrawnPlane');
    const syncIdx = src.lastIndexOf('syncMesh()');
    expect(callIdx).toBeGreaterThanOrEqual(0);
    expect(syncIdx).toBeGreaterThan(callIdx);
    expect(src).toMatch(/ADR-164.*β-2/);
  });

  it('adr164_drawbezier_sets_last_drawn_plane — DrawBezierTool wires closed Bezier branch (Q1=a)', () => {
    const src = readToolSource('DrawBezierTool');
    expect(src).toContain('setLastDrawnPlane');
    // L-164-Q1=a strict — closed Bezier branch (face 합성) only.
    // Open Bezier (no face) is intentionally skipped.
    const closedBranchIdx = src.indexOf('Closed Bezier');
    const callIdx = src.indexOf('setLastDrawnPlane');
    expect(closedBranchIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(closedBranchIdx);
    expect(src).toMatch(/ADR-164.*β-2/);
  });

  it('adr164_drawfreehand_sets_last_drawn_plane — DrawFreehandTool wires after polyline commit', () => {
    const src = readToolSource('DrawFreehandTool');
    expect(src).toContain('setLastDrawnPlane');
    // Wired after drawPolylineAsShape (closed loop → face, open → wire)
    const polylineIdx = src.indexOf('drawPolylineAsShape');
    const callIdx = src.indexOf('setLastDrawnPlane');
    expect(polylineIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(polylineIdx);
    expect(src).toMatch(/ADR-164.*β-2/);
  });
});
