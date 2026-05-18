/**
 * ADR-083 T-δ — Real Chromium round-trip test (slow channel).
 *
 * **Slow channel** — Drift #5 (ADR-082 C-ε) 의 timing 한계로 default CI
 * smoke 에서 *제외*. 환경변수 `AXIA_E2E_SLOW=1` 설정 시 활성:
 *
 *   AXIA_E2E_SLOW=1 npx playwright test e2e/occt-roundtrip.spec.ts
 *
 * **목적**: ADR-083 T-α~T-γ 의 ground truth 검증 — production build 가
 * minimal STEP fixture 를 import 하면 viewport 표시 가능한 Three.js Group
 * 으로 정상 round-trip 되는지.
 *
 * **Test flow**:
 *   1. `loadOcct()` 로 OCCT.js init (libs: ocCore, ocModelingAlgorithms,
 *      ocDataExchangeBase, ocDataExchangeExtra) — drift #4 답습
 *   2. `loadStepIgesImporter()` 로 import module 접근
 *   3. `web/e2e/fixtures/corpus/test_part_1.step` (hand-crafted minimal
 *      AP203 single quad face) 의 byte 를 page.evaluate 인자로 전달
 *   4. `StepIgesImporter.importFile(file)` 호출
 *   5. 검증:
 *      - `result.faceCount >= 1` (single planar quad)
 *      - `result.group.children.length >= 1` (T-γ wiring)
 *      - `result.group.children[0]` 가 face-N THREE.Group
 *      - `result.traversal?.faces.length >= 1`
 *
 * **Drift #5 timeout**: 5 minutes (300s). OCCT init + libs load + STEP
 * parse + tessellate 의 cumulative cost.
 *
 * **Failure modes** (P21.7 답습): warnings 누적, fatal 아님 — test 가
 * 통과해도 부분적 실패 가능. 우리 회귀는 minimum invariant 만 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface AxiaWindow {
  __axia?: {
    get<T>(key: string): T;
  };
}

const RUN_SLOW = process.env.AXIA_E2E_SLOW === '1';

test.describe('ADR-083 T-δ — STEP corpus real round-trip (slow channel)', () => {
  test('minimal STEP corpus → traversal + group with face mesh', async ({ page }) => {
    test.skip(
      !RUN_SLOW,
      'Slow channel — set AXIA_E2E_SLOW=1 to run (5 min OCCT init).',
    );
    test.setTimeout(600_000);  // 10 min — Drift #5 (ADR-082) + O-δ injectIntoAxia budget

    // Read corpus on Node side (Playwright host)
    const corpusPath = resolve('e2e/fixtures/corpus/test_part_1.step');
    const stepText = readFileSync(corpusPath, 'utf-8');
    expect(stepText.length).toBeGreaterThan(100);
    expect(stepText.startsWith('ISO-10303-21')).toBe(true);

    await page.goto('/');
    await page.waitForFunction(
      () => !!(window as unknown as AxiaWindow).__axia,
      undefined,
      { timeout: 10_000 },
    );

    const result = await page.evaluate(async (stepBody: string) => {
      try {
        const w = window as unknown as AxiaWindow;
        const c = w.__axia!;

        // Step 1: load StepIgesImporter module
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loadStepIgesImporter = c.get<() => Promise<any>>('loadStepIgesImporter');
        const mod = await loadStepIgesImporter();
        const StepIgesImporter = mod.StepIgesImporter;
        if (!StepIgesImporter) {
          return { ok: false, reason: 'StepIgesImporter export missing' };
        }
        StepIgesImporter.resetInstance();
        const importer = StepIgesImporter.getInstance();

        // Step 2: import minimal STEP corpus
        const file = new File(
          [stepBody],
          'test_part_1.step',
          { type: 'application/step' },
        );
        const importResult = await importer.importFile(file);

        // Step 3 — ADR-086 O-δ axia DCEL injection (manual call, since
        // FileImporter wiring is at higher layer).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bridge = c.get<any>('bridge');
        let axiaFaceCount = 0;
        let injectFaceMappingSize = 0;
        let firstFaceAxiaId: number | null = null;
        let faceMetadataSize = 0;
        if (bridge && typeof bridge.injectExternalFaceNoSurface === 'function') {
          const injectResult = importer.injectIntoAxia(bridge, importResult.group);
          injectFaceMappingSize = injectResult.faceIndexToAxiaId.size;
          axiaFaceCount = bridge.getStats?.()?.faces ?? 0;
          // ADR-126 β: faceMetadata side-table is SSOT for per-face data.
          // Per-face Group children no longer exist (replaced by faces-front
          // + faces-back merged Meshes). First face's axiaFaceId via map.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const metadata = (importResult.group?.userData as any)?.faceMetadata as
            Map<number, { axiaFaceId?: number }> | undefined;
          faceMetadataSize = metadata?.size ?? 0;
          if (metadata && metadata.size > 0) {
            const firstMeta = metadata.values().next().value;
            firstFaceAxiaId = firstMeta?.axiaFaceId ?? null;
          }
        }

        // Step 4: extract verifiable invariants
        // ADR-126 β: child structure changed — faces-front + faces-back +
        // optional edges sub-group (replaces N face-{N} Groups).
        const childNames = (importResult.group?.children ?? []).map(
          (c: { name?: string }) => c?.name ?? null,
        );
        return {
          ok: true,
          format: importResult.format,
          faceCount: importResult.faceCount,
          edgeCount: importResult.edgeCount,
          groupChildrenCount: importResult.group?.children?.length ?? 0,
          childNames,  // ADR-126 β: should include 'faces-front', 'faces-back'
          traversalFaceCount: importResult.traversal?.faces?.length ?? 0,
          traversalEdgeCount: importResult.traversal?.edges?.length ?? 0,
          warningsCount: importResult.warnings?.length ?? 0,
          warningsSample: importResult.warnings?.slice(0, 5) ?? [],
          // ADR-086 O-δ + ADR-126 β ground truth invariants
          injectFaceMappingSize,
          axiaFaceCount,
          firstFaceAxiaId,
          faceMetadataSize,
          bridgeAvailable: !!bridge,
        };
      } catch (e) {
        return { ok: false, reason: String(e).slice(0, 500) };
      }
    }, stepText);

    // Diagnostic on failure
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.log('[T-δ DIAG] Failure:', result);
    }

    expect(result.ok).toBe(true);
    if (result.ok) {
      // **Ground truth invariants** (ADR-083 T-α §3.4 spec, ADR-126 β refactor):
      expect(result.format).toBe('step');
      expect(result.faceCount).toBeGreaterThanOrEqual(1);
      expect(result.traversalFaceCount).toBeGreaterThanOrEqual(1);
      expect(result.groupChildrenCount).toBeGreaterThanOrEqual(2);
      // ADR-126 β: top-level children include 'faces-front' + 'faces-back'
      // (replaces per-face 'face-{N}' Groups — drawcalls collapsed N×2 → 2).
      expect(result.childNames).toContain('faces-front');
      expect(result.childNames).toContain('faces-back');
      // ADR-126 β: faceMetadata side-table has at least 1 entry (corpus = 1 quad).
      expect(result.faceMetadataSize).toBeGreaterThanOrEqual(1);

      // ADR-086 O-ε — axia DCEL injection ground truth invariants
      expect(result.bridgeAvailable).toBe(true);
      // Injection mapping has at least 1 face (corpus has 1 quad)
      expect(result.injectFaceMappingSize).toBeGreaterThanOrEqual(1);
      // axia engine FaceCount >= 1 (DCEL inject succeeded)
      expect(result.axiaFaceCount).toBeGreaterThanOrEqual(1);
      // ADR-126 β: first face's axiaFaceId from side-table (not per-face userData).
      expect(result.firstFaceAxiaId).not.toBeNull();
      expect(typeof result.firstFaceAxiaId).toBe('number');
    }
  });
});
