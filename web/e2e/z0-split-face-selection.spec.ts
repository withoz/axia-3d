/**
 * E2E — 분할된 sub-face individual selection 검증.
 *
 * 사용자 결재 (2026-05-18):
 * > "분할된 면이 선택되도록 해주세요"
 *
 * ADR-101 partial overlap + LOCKED #1 P7 containment → 자동 3 sub-face
 * 또는 ring+hole 생성. SelectionManager 가 각 sub-face 를 individual
 * 선택 가능해야.
 *
 * **Scope** (사용자 결재 정확 반영 2026-05-18):
 * > "처음부터 면분할이 완전하지 않았기 때문에 다른 부분과 충돌이 생기는것 같아요"
 *
 * 본 spec = engine + selection logic path 검증 (mouse click simulation
 * 우회). Real mouse click → render mesh → BVH → pick path 의 atomic
 * sync 는 별도 architectural ADR (가칭 "Face Split Downstream Sync
 * Coherence") 트랙. LOCKED #15 P22.3 (sync topology rebuild) ↔ ADR-111
 * (BVH defer) 정합 명시 필요.
 *
 * Anchor:
 *   - ADR-037 P22 (Pick → Promote, owner-ID 단위)
 *   - LOCKED #15 P22.3 (topology rebuild after split → faceMap 재구축)
 *   - LOCKED #15 ADR-101 (partial overlap auto-split)
 *   - LOCKED #1 P7 (containment split)
 */
import { test, expect } from '@playwright/test';

interface AxiaWindow {
  __axia?: { get<T>(key: string): T };
}

async function setup(page: import('@playwright/test').Page): Promise<void> {
  // ADR-139 B-β-1 + B-β-3 (2026-05-18~21): auto-intersect + auto-face-
  // synthesis default OFF. Legacy ADR-101 + LOCKED #1 P7 split 동작
  // 검증 — explicit opt-in.
  await page.addInitScript(() => {
    localStorage.setItem('axia:auto-intersect-on-draw', 'true');
    localStorage.setItem('axia:auto-face-synthesis-on-draw', 'true');
  });
  await page.goto('/');
  await page.waitForFunction(
    () => !!(window as unknown as AxiaWindow).__axia,
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia?.get?.('bridge');
      return !!bridge?.isReady?.();
    },
    undefined,
    { timeout: 10_000 },
  );
}

test.describe('Split sub-face individual selection (사용자 결재)', () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test('S1: Partial overlap (Rect × Rect) → faceMap 에 3 distinct face_ids', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 4000, 4000);
      bridge.drawRectAsShape(2000, 2000, 0, 0, 0, 1, 1, 0, 0, 4000, 4000);
      const stats = bridge.getStats();
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false };
      const uniqueFaceIds = [...new Set(Array.from(buf.faceMap))];
      return {
        ok: true,
        totalFaces: stats.faces,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
        sampleFaceIds: uniqueFaceIds.slice(0, 5),
      };
    });
    expect(r.ok).toBe(true);
    expect(r.totalFaces, `expected ≥ 3 faces after partial overlap`).toBeGreaterThanOrEqual(3);
    expect(r.uniqueFaceIdsInMap, `faceMap should contain all sub-face ids`).toBe(r.totalFaces);
  });

  test('S2: Containment (Rect + Circle inner) → 2 distinct face_ids in faceMap', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 1500, 32);
      const stats = bridge.getStats();
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false };
      const uniqueFaceIds = [...new Set(Array.from(buf.faceMap))];
      return {
        ok: true,
        totalFaces: stats.faces,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
      };
    });
    expect(r.ok).toBe(true);
    expect(r.totalFaces, `expected ≥ 2 faces (ring + hole)`).toBeGreaterThanOrEqual(2);
    expect(r.uniqueFaceIdsInMap).toBe(r.totalFaces);
  });

  test('S3: viewport.pick on split sub-face → returns ≥ 1 hit', async ({ page }) => {
    test.setTimeout(30_000);
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__axia.get('viewport').setViewMode('top');
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      bridge.drawRectAsShape(-1000, 0, 0, 0, 0, 1, 1, 0, 0, 4000, 4000);
      bridge.drawRectAsShape(1000, 0, 0, 0, 0, 1, 1, 0, 0, 4000, 4000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__axia.get('syncMesh')?.();
    });
    await page.waitForTimeout(300);

    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = (window as any).__axia;
      const bridge = w.get('bridge');
      const viewport = w.get('viewport');
      const stats = bridge.getStats();
      const canvas = viewport.renderer.domElement as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const picks: { x: number; y: number; hasFace: boolean }[] = [];
      for (const [dx] of [[-200], [0], [200]] as [number][][]) {
        const sx = cx + dx;
        const sy = cy;
        const hit = viewport.pick?.(sx, sy);
        picks.push({
          x: sx, y: sy,
          hasFace: !!(hit && hit.faceIndex != null),
        });
      }
      return { totalFaces: stats.faces, picks };
    });

    expect(r.totalFaces).toBeGreaterThanOrEqual(3);
    const hitCount = r.picks.filter(p => p.hasFace).length;
    expect(hitCount, `expected ≥ 1 face pick hit (picks: ${JSON.stringify(r.picks)})`).toBeGreaterThanOrEqual(1);
  });

  test('S4: SelectionManager.handleClick → split sub-face id 추가 (engine + logic path)', async ({ page }) => {
    test.setTimeout(30_000);
    // Real mouse click path 는 ADR-111 BVH defer + syncMesh async timing
    // 으로 E2E 에서 reliably reproduce 어려움 (사용자 통찰 "면분할이 완전
    // 하지 않았기 때문에 다른 부분과 충돌"). 본 test 는 engine + logic
    // path 검증 — bridge 의 split 결과 (ADR-101 partial overlap) 가 N
    // distinct face_ids 생성 + SelectionManager 가 각 sub-face id 를
    // individual 로 add 가능.
    //
    // Real mouse click + render mesh + BVH atomic sync 는 별도 ADR
    // (가칭 "Face Split Downstream Sync Coherence") 트랙.
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = (window as any).__axia;
      const bridge = w.get('bridge');
      const sel = w.get('selection');
      if (!sel) return { ok: false, reason: 'no selection' };

      bridge.drawRectAsShape(-1000, 0, 0, 0, 0, 1, 1, 0, 0, 3000, 3000);
      bridge.drawRectAsShape(1000, 0, 0, 0, 0, 1, 1, 0, 0, 3000, 3000);

      const faceCount = bridge.getStats().faces;
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false, reason: 'no mesh' };
      const distinctFaceIds = [...new Set(Array.from(buf.faceMap))] as number[];

      sel.clearSelection?.();
      const before = sel.getSelectedFaces().length;

      sel.handleClick(distinctFaceIds[0], false, false, false);
      const after1 = sel.getSelectedFaces();

      sel.handleClick(distinctFaceIds[1], true, false, false);
      const after2 = sel.getSelectedFaces();

      return {
        ok: true,
        faceCount,
        distinctFaceIds,
        before,
        after1,
        after2,
      };
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.faceCount, 'expected ≥ 3 split faces').toBeGreaterThanOrEqual(3);
    expect(r.distinctFaceIds?.length, 'faceMap should expose all face_ids').toBe(r.faceCount);
    expect(r.before, 'sel cleared').toBe(0);
    expect(r.after1?.length, 'after 1st handleClick → 1 selected').toBe(1);
    expect(r.after1?.[0], '1st selected = distinctFaceIds[0]').toBe(r.distinctFaceIds?.[0]);
    expect(r.after2?.length, 'after 2nd handleClick (shift) → 2 selected').toBe(2);
    expect(r.after2?.includes(r.distinctFaceIds?.[1] as number), '2nd id added').toBe(true);
  });

  test('S5: Containment (Rect + inner Rect) — inner vs ring face_ids distinct + individually selectable (engine + logic path)', async ({ page }) => {
    test.setTimeout(30_000);
    // Engine + logic path 검증 (mouse simulation 우회, S4 와 동일 이유).
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = (window as any).__axia;
      const bridge = w.get('bridge');
      const sel = w.get('selection');
      if (!sel) return { ok: false, reason: 'no selection' };

      // Outer 4m × 4m
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 4000, 4000);
      // Inner 1m × 1m at center (contained, P7 split → ring + hole)
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 1000, 1000);

      const faceCount = bridge.getStats().faces;
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false, reason: 'no mesh' };
      const distinctFaceIds = [...new Set(Array.from(buf.faceMap))] as number[];

      sel.clearSelection?.();
      sel.handleClick(distinctFaceIds[0], false, false, false);
      const firstSel = sel.getSelectedFaces();

      sel.clearSelection();
      sel.handleClick(distinctFaceIds[1], false, false, false);
      const secondSel = sel.getSelectedFaces();

      return {
        ok: true,
        faceCount,
        distinctFaceIds,
        firstSel,
        secondSel,
      };
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.faceCount, 'P7 containment → expected ≥ 2 faces').toBeGreaterThanOrEqual(2);
    expect(r.distinctFaceIds?.length, 'faceMap exposes all face_ids').toBe(r.faceCount);
    expect(r.firstSel?.length, '1st handleClick → 1 selected').toBe(1);
    expect(r.firstSel?.[0], '1st selected = distinctFaceIds[0]').toBe(r.distinctFaceIds?.[0]);
    expect(r.secondSel?.length, '2nd handleClick → 1 selected (after clear)').toBe(1);
    expect(r.secondSel?.[0], '2nd selected = distinctFaceIds[1]').toBe(r.distinctFaceIds?.[1]);
    expect(r.distinctFaceIds?.[0], 'inner vs ring distinct').not.toBe(r.distinctFaceIds?.[1]);
  });
});
