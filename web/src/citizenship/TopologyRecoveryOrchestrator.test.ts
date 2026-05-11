/**
 * ADR-097 T-δ — TopologyRecoveryOrchestrator tests.
 *
 * Verifies the 5-stage flow:
 *   1. unavailable → status 'unavailable'
 *   2. clean scene → status 'clean', no recovery call
 *   3. Recovered → success Toast, status 'recovered'
 *   4. PartialFailure + Undo click → bridge.undo, status 'undone'
 *   5. PartialFailure + manual → warning Toast, status 'manual'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  attemptRecoveryWithDialog,
  humanizeDamageReport,
} from './TopologyRecoveryOrchestrator';
import type { TopologyDamageReport } from '../bridge/WasmBridge';

interface BridgeStub {
  detectTopologyDamage: ReturnType<typeof vi.fn>;
  attemptAutoRecovery: ReturnType<typeof vi.fn>;
  undo: ReturnType<typeof vi.fn>;
  demoteXiaToShape: ReturnType<typeof vi.fn>;
}

function makeBridge(): BridgeStub {
  return {
    detectTopologyDamage: vi.fn(),
    attemptAutoRecovery: vi.fn(),
    undo: vi.fn(() => true),
    demoteXiaToShape: vi.fn(() => ({ shapeId: 1, originalIdRestored: true })),
  };
}

const REPORT_CLEAN: TopologyDamageReport = {
  damages: [],
  checkedFaces: 5,
  checkedEdges: 20,
};

const REPORT_DAMAGED: TopologyDamageReport = {
  damages: [
    { kind: 'Degenerate', face_id: 1, reason: 'zero_normal' },
    { kind: 'NonManifold', edge_id: 2, face_count: 3 },
  ],
  checkedFaces: 5,
  checkedEdges: 20,
};

describe('TopologyRecoveryOrchestrator (T-δ)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('humanizeDamageReport', () => {
    it('returns "손상 없음" for clean report', () => {
      expect(humanizeDamageReport(REPORT_CLEAN)).toBe('손상 없음');
    });

    it('joins kind counts in Korean', () => {
      const text = humanizeDamageReport(REPORT_DAMAGED);
      expect(text).toContain('1개 면 degenerate');
      expect(text).toContain('1개 엣지 non-manifold');
    });

    it('counts all 4 kinds', () => {
      const r: TopologyDamageReport = {
        damages: [
          { kind: 'BoundaryEdge', edge_id: 1, incident_face: 1 },
          { kind: 'NonManifold', edge_id: 2, face_count: 3 },
          { kind: 'Degenerate', face_id: 3, reason: 'x' },
          { kind: 'Orphan', face_id: 4 },
        ],
        checkedFaces: 0,
        checkedEdges: 0,
      };
      const text = humanizeDamageReport(r);
      expect(text).toContain('1개 면 degenerate');
      expect(text).toContain('1개 엣지 non-manifold');
      expect(text).toContain('1개 boundary edge');
      expect(text).toContain('1개 orphan face');
    });
  });

  describe('attemptRecoveryWithDialog', () => {
    it('returns "unavailable" when detectTopologyDamage returns null', async () => {
      const b = makeBridge();
      b.detectTopologyDamage.mockReturnValue(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await attemptRecoveryWithDialog(b as any, { silent: true });
      expect(r.status).toBe('unavailable');
      expect(b.attemptAutoRecovery).not.toHaveBeenCalled();
    });

    it('returns "clean" without invoking recovery on damage-free scene', async () => {
      const b = makeBridge();
      b.detectTopologyDamage.mockReturnValue(REPORT_CLEAN);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await attemptRecoveryWithDialog(b as any, { silent: true });
      expect(r.status).toBe('clean');
      expect(r.initialDamages).toBe(0);
      expect(b.attemptAutoRecovery).not.toHaveBeenCalled();
    });

    it('returns "recovered" on full success', async () => {
      const b = makeBridge();
      b.detectTopologyDamage.mockReturnValue(REPORT_DAMAGED);
      b.attemptAutoRecovery.mockReturnValue({
        kind: 'Recovered', fixesApplied: 2, initialDamages: 2,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await attemptRecoveryWithDialog(b as any, { silent: true });
      expect(r.status).toBe('recovered');
      expect(r.initialDamages).toBe(2);
      expect(r.remainingDamages).toBe(0);
    });

    it('escalates to dialog on PartialFailure → Undo click → status "undone"', async () => {
      const b = makeBridge();
      b.detectTopologyDamage.mockReturnValue(REPORT_DAMAGED);
      b.attemptAutoRecovery.mockReturnValue({
        kind: 'PartialFailure', fixesApplied: 1, remainingCount: 1,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = attemptRecoveryWithDialog(b as any, { silent: true });

      // Wait microtask for dialog to mount, then click Undo.
      await new Promise((r) => setTimeout(r, 0));
      const undoBtn = document.querySelector<HTMLButtonElement>('[data-choice="undo"]');
      expect(undoBtn).not.toBeNull();
      undoBtn!.click();

      const r = await promise;
      expect(r.status).toBe('undone');
      expect(b.undo).toHaveBeenCalledTimes(1);
    });

    it('escalates to dialog on PartialFailure → manual click → status "manual"', async () => {
      const b = makeBridge();
      b.detectTopologyDamage.mockReturnValue(REPORT_DAMAGED);
      b.attemptAutoRecovery.mockReturnValue({
        kind: 'PartialFailure', fixesApplied: 0, remainingCount: 2,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = attemptRecoveryWithDialog(b as any, { silent: true });

      await new Promise((r) => setTimeout(r, 0));
      document.querySelector<HTMLButtonElement>('[data-choice="manual"]')!.click();

      const r = await promise;
      expect(r.status).toBe('manual');
      expect(b.undo).not.toHaveBeenCalled();
      expect(b.demoteXiaToShape).not.toHaveBeenCalled();
    });

    it('demote click invokes resolver + bridge.demoteXiaToShape', async () => {
      const b = makeBridge();
      b.detectTopologyDamage.mockReturnValue(REPORT_DAMAGED);
      b.attemptAutoRecovery.mockReturnValue({
        kind: 'PartialFailure', fixesApplied: 0, remainingCount: 2,
      });
      const resolver = vi.fn(() => 7);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = attemptRecoveryWithDialog(b as any, {
        silent: true,
        demoteResolver: resolver,
      });

      await new Promise((r) => setTimeout(r, 0));
      document.querySelector<HTMLButtonElement>('[data-choice="demote"]')!.click();

      const r = await promise;
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(b.demoteXiaToShape).toHaveBeenCalledWith(7);
      expect(r.status).toBe('demoted');
    });

    it('demote click without resolver hides 강등 button (graceful)', async () => {
      const b = makeBridge();
      b.detectTopologyDamage.mockReturnValue(REPORT_DAMAGED);
      b.attemptAutoRecovery.mockReturnValue({
        kind: 'PartialFailure', fixesApplied: 0, remainingCount: 2,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = attemptRecoveryWithDialog(b as any, { silent: true });
      await new Promise((r) => setTimeout(r, 0));
      const demoteBtn = document.querySelector('[data-choice="demote"]');
      expect(demoteBtn).toBeNull(); // hidden when no resolver
      document.querySelector<HTMLButtonElement>('[data-choice="manual"]')!.click();
      await promise;
    });
  });
});
