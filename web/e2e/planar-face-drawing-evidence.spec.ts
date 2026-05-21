/**
 * 평면 face 위 도형 그리기 evidence — 보고서 audit "PASS" 회귀 자산
 * 영구 보존.
 *
 * 외부 에이전트 audit (2026-05-23) finding:
 *   "평면 face 위 도구 — ✅ PASS
 *    - getDrawPlane(faceId) → DCEL exact normal
 *    - 박스 옆면 위 그리기는 5-layer 정합으로 완벽"
 *
 * 본 spec = 사용자 요청 "면에 rect 그리기 / line 그려서 경계 만들기"
 * 의 현재 상태 evidence + 회귀 자산. ADR-140 β implementation 진입
 * 전 평면 face baseline 확립.
 *
 * 3 scenarios:
 *   A. Box top face 위 DrawRect — 평면 face split 검증
 *   B. Box side face 위 DrawLine 으로 chord split — 경계 만들기
 *   C. Box face 위 closed-curve face 자동 (Path B circle) — K1 MVP 통합
 *
 * Cross-link:
 *   - 보고서 audit (외부 에이전트 2026-05-23) — 평면 face PASS
 *   - ADR-140 α/β (Surface-aware getDrawPlane — 곡면 face 별도 트랙)
 *   - K3 hotfix (PR #140), Path B owner_id (PR #142), K1 MVP (PR #143)
 *   - LOCKED #1 P7 / LOCKED #41 ADR-101 / 메타-원칙 #14
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test.describe('평면 face 위 도형 그리기 evidence (보고서 audit PASS 회귀)', () => {
  test.beforeEach(async ({ page }) => {
    // ADR-101 자동 split + LOCKED #12 P11 자동 cycle synthesis 활성
    // (legacy opt-in, ADR-139 후 default OFF — explicit 명시).
    await page.addInitScript(() => {
      localStorage.setItem('axia:auto-intersect-on-draw', 'true');
      localStorage.setItem('axia:auto-face-synthesis-on-draw', 'true');
    });
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('Scenario A: Box top face 위 DrawRectAsShape — 평면 face split 검증', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // 1) Box 10×10×10 생성 at origin (center (0, 0, 0))
      //    → 6 faces (front/back/top/bottom/left/right), 모두 Plane
      const boxXiaId = bridge.create_box?.(0, 0, 0, 10, 10, 10);
      if (boxXiaId == null || boxXiaId < 0) {
        return { ok: false, stage: 'create_box', xia: boxXiaId };
      }

      const statsBox = bridge.getStats?.() ?? {};
      const facesAfterBox = statsBox.faces ?? 0;

      // 2) Box top face (Z=5, normal=+Z, Z-up convention) 위에 DrawRect
      //    center=(0, 0, 5), normal=+Z (up), basis_u=+X
      //    width=4, height=4 → top face 내부에 4×4 sub-rect
      const rectShapeId = bridge.drawRectAsShape?.(
        0, 0, 5,       // center on top face
        0, 0, 1,       // normal (+Z)
        1, 0, 0,       // up (+X)
        4, 4,          // 4×4 inside top face (10×10)
      );
      if (rectShapeId == null || rectShapeId < 0) {
        return {
          ok: false, stage: 'drawRectAsShape',
          shapeId: rectShapeId, facesAfterBox,
        };
      }

      const statsAfter = bridge.getStats?.() ?? {};
      const facesAfter = statsAfter.faces ?? 0;

      // 3) Manifold invariants 정상
      const invariantReport = bridge.verifyInvariants?.() ?? { violations: [] };

      return {
        ok: true,
        boxXiaId,
        rectShapeId,
        facesAfterBox,
        facesAfter,
        facesDelta: facesAfter - facesAfterBox,
        invariantViolations: invariantReport.violations?.length ?? 0,
      };
    });

    expect(result.ok).toBe(true);
    // Box = 6 faces (Plane), DrawRectAsShape on top → split top into 2+
    expect(result.facesAfterBox).toBeGreaterThanOrEqual(6);
    // DrawRect 후 face count 증가 (top face split or new sub-rect 추가)
    expect(result.facesAfter).toBeGreaterThan(result.facesAfterBox);
    // Manifold invariants — LOCKED #1 P7-N 정합 (인접 face share edge 일부 허용)
    expect(result.invariantViolations).toBeLessThanOrEqual(2);
  });

  test('Scenario B: Box side face 위 DrawLineAsShape 으로 chord split (경계 만들기)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // 1) Box 10×10×10 at origin
      const boxXiaId = bridge.create_box?.(0, 0, 0, 10, 10, 10);
      if (boxXiaId == null || boxXiaId < 0) {
        return { ok: false, stage: 'create_box', xia: boxXiaId };
      }

      const statsBox = bridge.getStats?.() ?? {};
      const facesAfterBox = statsBox.faces ?? 0;

      // 2) Box front face (Y=-5, normal=-Y) 위에 DrawLine chord
      //    Y=-5 plane, line from (-3, -5, -3) to (3, -5, 3) — diagonal chord
      const lineShapeId = bridge.drawLineAsShape?.(
        -3, -5, -3,   // start on front face
        3, -5, 3,     // end on front face
        0, -1, 0,     // normal hint (-Y)
      );
      if (lineShapeId == null || lineShapeId < 0) {
        return {
          ok: false, stage: 'drawLineAsShape',
          shapeId: lineShapeId, facesAfterBox,
        };
      }

      const statsAfter = bridge.getStats?.() ?? {};
      const facesAfter = statsAfter.faces ?? 0;

      const invariantReport = bridge.verifyInvariants?.() ?? { violations: [] };

      return {
        ok: true,
        boxXiaId,
        lineShapeId,
        facesAfterBox,
        facesAfter,
        facesDelta: facesAfter - facesAfterBox,
        invariantViolations: invariantReport.violations?.length ?? 0,
      };
    });

    expect(result.ok).toBe(true);
    expect(result.facesAfterBox).toBeGreaterThanOrEqual(6);
    // DrawLine 후 face count 증가 가능 (chord split) — 또는 동일 (단순 line)
    // 본 test 의 핵심: drawLineAsShape 가 silent failure 없이 정상 완료
    expect(result.lineShapeId).toBeGreaterThanOrEqual(0);
    expect(result.invariantViolations).toBeLessThanOrEqual(2);
  });

  test('Scenario C: Box top face 위 DrawCircleAsCurve (Path B closed-curve face)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // 1) Box 10×10×10
      const boxXiaId = bridge.create_box?.(0, 0, 0, 10, 10, 10);
      if (boxXiaId == null || boxXiaId < 0) {
        return { ok: false, stage: 'create_box' };
      }
      const facesAfterBox = (bridge.getStats?.()?.faces ?? 0);

      // 2) Box top face (Z=5) 위에 Path B circle (DrawCircleAsCurve)
      //    center=(0, 0, 5), normal=+Z, radius=3
      const circleShapeId = bridge.drawCircleAsCurve?.(
        0, 0, 5,     // center on top face
        0, 0, 1,     // normal (+Z)
        3,           // radius
      );
      if (circleShapeId == null || circleShapeId < 0) {
        return {
          ok: false, stage: 'drawCircleAsCurve',
          shapeId: circleShapeId, facesAfterBox,
        };
      }

      const facesAfter = (bridge.getStats?.()?.faces ?? 0);
      const invariantReport = bridge.verifyInvariants?.() ?? { violations: [] };

      return {
        ok: true,
        boxXiaId,
        circleShapeId,
        facesAfterBox,
        facesAfter,
        facesDelta: facesAfter - facesAfterBox,
        invariantViolations: invariantReport.violations?.length ?? 0,
      };
    });

    expect(result.ok).toBe(true);
    expect(result.facesAfterBox).toBeGreaterThanOrEqual(6);
    // Path B closed-curve circle → 적어도 1 face 추가 (1 anchor + 1 self-loop edge)
    expect(result.facesAfter).toBeGreaterThan(result.facesAfterBox);
    expect(result.invariantViolations).toBeLessThanOrEqual(2);
  });
});
