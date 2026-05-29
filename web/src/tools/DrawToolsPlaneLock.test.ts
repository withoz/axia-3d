/**
 * ADR-166 β-2 — Draw 도구 6개 lockPlane wiring 회귀.
 *
 * 6 도구 (Rect/Circle/Line/Arc/Bezier/Freehand) 각각에서 first_click
 * 시점 (start point 설정 직후, commit 전) 에 `ctx.lockPlane(...)` 가
 * 호출됨을 source-level 로 검증.
 *
 * Why source-level?
 *   - β-1 의 API (lockPlane idempotent + getPlaneLock + isPlaneLocked +
 *     unlockPlane + 4 reset hooks) 가 이미 unit tested (4 tests in
 *     ToolManagerRefactored.test.ts) 되어 있음.
 *   - β-2 는 *wiring presence* 만 검증하면 충분.
 *   - ADR-164 DrawToolsLastDrawnPlane.test.ts 답습 패턴 (post-commit
 *     wiring 검증) 의 *pre-commit (first_click)* 대응.
 *
 * Lock-ins:
 *   - L-166-1 Q1=a — first_click trigger (모든 호출이 start point 설정
 *     직후 위치, before commit branch)
 *   - L-166-2 idempotent — `ctx.lockPlane?.(...)` 호출 자체는 unconditional
 *     (ToolManager.lockPlane 이 이미 locked 시 no-op 처리)
 *   - L-166-10 ADR-164 답습 패턴 — source ID 'first_click' 명시
 *   - L-166-11 절대 #[ignore] 금지 6/6 준수
 *
 * Cross-link: ADR-166 §3 (β-2 spec), ADR-164 §3 (β-2 pattern source),
 * LOCKED #44 (atomic per merge), LOCKED #65 메타-원칙 #16.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function readToolSource(name: string): string {
  return readFileSync(join(__dirname, `${name}.ts`), 'utf-8');
}

describe('ADR-166 β-2 — Draw 도구 6개 lockPlane wiring (first_click)', () => {
  it('adr166_drawrect_first_click_sets_plane_lock — DrawRectTool wires after rectStart set', () => {
    const src = readToolSource('DrawRectTool');
    // 1. lockPlane call exists
    expect(src).toContain('lockPlane');
    // 2. Wired in the first_click branch (after rectStart = start)
    const firstClickIdx = src.indexOf('this.rectStart = start');
    const callIdx = src.indexOf('ctx.lockPlane');
    expect(firstClickIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(firstClickIdx);
    // 3. source 'first_click' present (L-166-10 provenance lock-in)
    expect(src).toMatch(/source:\s*'first_click'/);
    // 4. ADR-166 reference present
    expect(src).toMatch(/ADR-166.*β-2/);
  });

  it('adr166_drawcircle_first_click_sets_plane_lock — DrawCircleTool wires after circleCenter set', () => {
    const src = readToolSource('DrawCircleTool');
    expect(src).toContain('lockPlane');
    // Wired in first_click branch (after circleCenter cardinal snap)
    const firstClickIdx = src.indexOf('this.circleCenter = point.clone()');
    const callIdx = src.indexOf('ctx.lockPlane');
    expect(firstClickIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(firstClickIdx);
    expect(src).toMatch(/source:\s*'first_click'/);
    expect(src).toMatch(/ADR-166.*β-2/);
  });

  it('adr166_drawline_first_click_sets_plane_lock — DrawLineTool wires after establishDrawingPlane', () => {
    const src = readToolSource('DrawLineTool');
    expect(src).toContain('lockPlane');
    // Wired after establishDrawingPlane(e) in Armed → Drawing transition
    const establishIdx = src.indexOf('this.establishDrawingPlane(e)');
    const callIdx = src.indexOf('ctx.lockPlane');
    expect(establishIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(establishIdx);
    expect(src).toMatch(/source:\s*'first_click'/);
    expect(src).toMatch(/ADR-166.*β-2/);
  });

  it('adr166_drawarc_first_click_sets_plane_lock — DrawArcTool wires after startPoint set', () => {
    const src = readToolSource('DrawArcTool');
    expect(src).toContain('lockPlane');
    // Wired in 1st click branch (after startPoint + drawPlane3 setup)
    const firstClickIdx = src.indexOf('this.startPoint = point.clone()');
    const callIdx = src.indexOf('ctx.lockPlane');
    expect(firstClickIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(firstClickIdx);
    expect(src).toMatch(/source:\s*'first_click'/);
    expect(src).toMatch(/ADR-166.*β-2/);
  });

  it('adr166_drawbezier_first_click_sets_plane_lock — DrawBezierTool wires after P0 push', () => {
    const src = readToolSource('DrawBezierTool');
    expect(src).toContain('lockPlane');
    // Wired in P0 (points.length === 0) branch after points.push(point.clone())
    const firstClickIdx = src.indexOf('this.points.push(point.clone())');
    const callIdx = src.indexOf('ctx.lockPlane');
    expect(firstClickIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(firstClickIdx);
    expect(src).toMatch(/source:\s*'first_click'/);
    expect(src).toMatch(/ADR-166.*β-2/);
  });

  it('adr166_drawfreehand_first_click_sets_plane_lock — DrawFreehandTool wires after drawing flag set', () => {
    const src = readToolSource('DrawFreehandTool');
    expect(src).toContain('lockPlane');
    // Wired after this.drawing = true + rawPoints = [point.clone()]
    const firstClickIdx = src.indexOf('this.drawing = true');
    const callIdx = src.indexOf('ctx.lockPlane');
    expect(firstClickIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(firstClickIdx);
    expect(src).toMatch(/source:\s*'first_click'/);
    expect(src).toMatch(/ADR-166.*β-2/);
  });
});
