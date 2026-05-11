/**
 * ADR-100 R-δ — MaterialRemovalRecoveryOrchestrator tests.
 *
 * ADR-097 TopologyRecoveryOrchestrator.test 1:1 mirror — material-layer variant.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  attemptMaterialRecoveryWithDialog,
  humanizeOrphanReport,
} from './MaterialRemovalRecoveryOrchestrator';
import type { OrphanMaterialReport } from '../bridge/WasmBridge';

interface BridgeStub {
  detectOrphanMaterialAssignments: ReturnType<typeof vi.fn>;
  attemptMaterialRemovalRecovery: ReturnType<typeof vi.fn>;
  undo: ReturnType<typeof vi.fn>;
  demoteXiaToShape: ReturnType<typeof vi.fn>;
}

function makeBridge(): BridgeStub {
  return {
    detectOrphanMaterialAssignments: vi.fn(),
    attemptMaterialRemovalRecovery: vi.fn(),
    undo: vi.fn(() => true),
    demoteXiaToShape: vi.fn(() => ({ shapeId: 1, originalIdRestored: true })),
  };
}

const REPORT_CLEAN: OrphanMaterialReport = {
  affectedXias: [],
};

const REPORT_AFFECTED: OrphanMaterialReport = {
  affectedXias: [
    { xiaId: 5, staleMaterialId: 100, faceCount: 3 },
    { xiaId: 7, staleMaterialId: 100, faceCount: 2 },
  ],
};

describe('MaterialRemovalRecoveryOrchestrator (R-δ)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('humanizeOrphanReport', () => {
    it('returns "재질 손상 없음" for clean report', () => {
      expect(humanizeOrphanReport(REPORT_CLEAN)).toBe('재질 손상 없음');
    });

    it('formats Xia count + face total in Korean', () => {
      const text = humanizeOrphanReport(REPORT_AFFECTED);
      expect(text).toContain('Xia 2개');
      expect(text).toContain('면 5개'); // 3 + 2
    });
  });

  describe('attemptMaterialRecoveryWithDialog', () => {
    it('returns "unavailable" when detectOrphan returns null', async () => {
      const b = makeBridge();
      b.detectOrphanMaterialAssignments.mockReturnValue(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await attemptMaterialRecoveryWithDialog(b as any, { silent: true });
      expect(r.status).toBe('unavailable');
      expect(b.attemptMaterialRemovalRecovery).not.toHaveBeenCalled();
    });

    it('returns "clean" without invoking recovery on clean scene', async () => {
      const b = makeBridge();
      b.detectOrphanMaterialAssignments.mockReturnValue(REPORT_CLEAN);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await attemptMaterialRecoveryWithDialog(b as any, { silent: true });
      expect(r.status).toBe('clean');
      expect(r.initialAffected).toBe(0);
      expect(b.attemptMaterialRemovalRecovery).not.toHaveBeenCalled();
    });

    it('returns "recovered" on full success', async () => {
      const b = makeBridge();
      b.detectOrphanMaterialAssignments.mockReturnValue(REPORT_AFFECTED);
      b.attemptMaterialRemovalRecovery.mockReturnValue({
        kind: 'Recovered', affectedXias: 2, facesDemoted: 5, facesFallback: 0,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await attemptMaterialRecoveryWithDialog(b as any, { silent: true });
      expect(r.status).toBe('recovered');
      expect(r.initialAffected).toBe(2);
      expect(r.remainingOrphans).toBe(0);
    });

    it('escalates to dialog on PartialFailure → Undo click → "undone"', async () => {
      const b = makeBridge();
      b.detectOrphanMaterialAssignments.mockReturnValue(REPORT_AFFECTED);
      b.attemptMaterialRemovalRecovery.mockReturnValue({
        kind: 'PartialFailure', affectedXias: 2, remainingOrphans: 1,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = attemptMaterialRecoveryWithDialog(b as any, { silent: true });

      await new Promise((r) => setTimeout(r, 0));
      document.querySelector<HTMLButtonElement>('[data-choice="undo"]')!.click();

      const r = await promise;
      expect(r.status).toBe('undone');
      expect(b.undo).toHaveBeenCalledTimes(1);
    });

    it('escalates to dialog on PartialFailure → manual click → "manual"', async () => {
      const b = makeBridge();
      b.detectOrphanMaterialAssignments.mockReturnValue(REPORT_AFFECTED);
      b.attemptMaterialRemovalRecovery.mockReturnValue({
        kind: 'PartialFailure', affectedXias: 2, remainingOrphans: 2,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = attemptMaterialRecoveryWithDialog(b as any, { silent: true });

      await new Promise((r) => setTimeout(r, 0));
      document.querySelector<HTMLButtonElement>('[data-choice="manual"]')!.click();

      const r = await promise;
      expect(r.status).toBe('manual');
      expect(b.undo).not.toHaveBeenCalled();
      expect(b.demoteXiaToShape).not.toHaveBeenCalled();
    });

    it('demote click invokes resolver + bridge.demoteXiaToShape', async () => {
      const b = makeBridge();
      b.detectOrphanMaterialAssignments.mockReturnValue(REPORT_AFFECTED);
      b.attemptMaterialRemovalRecovery.mockReturnValue({
        kind: 'PartialFailure', affectedXias: 2, remainingOrphans: 2,
      });
      const resolver = vi.fn(() => 5);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = attemptMaterialRecoveryWithDialog(b as any, {
        silent: true,
        demoteResolver: resolver,
      });

      await new Promise((r) => setTimeout(r, 0));
      document.querySelector<HTMLButtonElement>('[data-choice="demote"]')!.click();

      const r = await promise;
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(b.demoteXiaToShape).toHaveBeenCalledWith(5);
      expect(r.status).toBe('demoted');
    });

    it('demote button hidden when no resolver (graceful)', async () => {
      const b = makeBridge();
      b.detectOrphanMaterialAssignments.mockReturnValue(REPORT_AFFECTED);
      b.attemptMaterialRemovalRecovery.mockReturnValue({
        kind: 'PartialFailure', affectedXias: 2, remainingOrphans: 2,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = attemptMaterialRecoveryWithDialog(b as any, { silent: true });
      await new Promise((r) => setTimeout(r, 0));
      const demoteBtn = document.querySelector('[data-choice="demote"]');
      expect(demoteBtn).toBeNull();
      document.querySelector<HTMLButtonElement>('[data-choice="manual"]')!.click();
      await promise;
    });

    it('returns "unavailable" when attemptRecovery returns null', async () => {
      const b = makeBridge();
      b.detectOrphanMaterialAssignments.mockReturnValue(REPORT_AFFECTED);
      b.attemptMaterialRemovalRecovery.mockReturnValue(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await attemptMaterialRecoveryWithDialog(b as any, { silent: true });
      expect(r.status).toBe('unavailable');
      expect(r.initialAffected).toBe(2);
    });

    it('NoOp outcome (engine reports clean despite initial detection)', async () => {
      const b = makeBridge();
      b.detectOrphanMaterialAssignments.mockReturnValue(REPORT_AFFECTED);
      b.attemptMaterialRemovalRecovery.mockReturnValue({ kind: 'NoOp' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await attemptMaterialRecoveryWithDialog(b as any, { silent: true });
      // Defensive — engine NoOp wins; orchestrator returns 'clean'.
      expect(r.status).toBe('clean');
    });
  });
});
