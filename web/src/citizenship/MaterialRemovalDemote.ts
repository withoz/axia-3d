/**
 * ADR-091 D-δ — Material Removal → Shape 가역 강등 (UI orchestration).
 *
 * When the user clears a Xia's material via the Inspector (dropdown
 * "없음" or "재질 해제" 버튼), the property-layer citizen reverts to
 * the form layer. This module gathers the unique XiaIds that own the
 * affected faces, attempts a `bridge.demoteXiaToShape` for each one
 * (skipping faces with no owning Xia, e.g., already form-layer
 * Shapes), and reports the outcome so the caller can show a 5-second
 * "되돌리기" Toast (Lock-in D-E=a).
 *
 * The bridge call already throws on validation failure
 * (`MaterialNotFormSentinel` etc.). This helper catches those errors
 * and accumulates them — a partial demote (e.g., 2 of 3 Xias eligible)
 * still produces a successful result for the eligible ones.
 *
 * Lock-ins applied:
 * - D-A=a: implicit — caller must have already cleared materials to
 *   `FORM_MATERIAL`. The bridge enforces this; we don't re-check.
 * - D-F=c: helper is called from BOTH Inspector entry points
 *   (dropdown "없음" + 재질 해제 버튼).
 *
 * Out of scope (별도 sub-step):
 * - Bulk-Undo support (TransactionManager already covers this — the
 *   caller invokes `bridge.undo()` once via the Toast button).
 * - Material restoration on demote rejection — currently a partial
 *   failure leaves the cleared materials in place. Q5 사건 2~4 is
 *   ADR-054 territory.
 */

import type { WasmBridge } from '../bridge/WasmBridge';

export interface DemoteOutcome {
  /** ShapeId returned by `bridge.demoteXiaToShape`. */
  shapeId: number;
  /** True iff the original ShapeId was restored (round-trip preserved). */
  originalIdRestored: boolean;
  /** Source XiaId (now removed from the scene). */
  xiaId: number;
}

export interface MaterialRemovalDemoteResult {
  /** Successful demotions, in iteration order. */
  demoted: DemoteOutcome[];
  /**
   * Failures encountered. Each entry is the original engine throw
   * message (e.g., "demoteXiaToShape: ..."). The caller may show
   * these in a separate Toast at warning severity.
   */
  errors: string[];
  /**
   * Distinct XiaIds visited (deduped from the supplied face list).
   * Always equal to `demoted.length + skipped + errors.length` after
   * iteration.
   */
  visited: number[];
}

/**
 * Resolve the unique XiaIds that own the supplied faces. Faces with no
 * owning Xia (e.g., already form-layer Shapes, or stray geometry) are
 * silently skipped — they don't contribute a Xia to demote.
 */
export function resolveOwningXiaIds(
  bridge: WasmBridge,
  faceIds: number[],
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const fid of faceIds) {
    const xid = bridge.getXiaForFace(fid);
    if (xid >= 0 && !seen.has(xid)) {
      seen.add(xid);
      out.push(xid);
    }
  }
  return out;
}

/**
 * Attempt to demote each Xia owning a face in `faceIds` back to a
 * Shape. Returns a structured result so the Inspector can drive its
 * Toast UX (Lock-in D-E=a) and the test surface stays inspectable.
 */
export function attemptMaterialRemovalDemote(
  bridge: WasmBridge,
  faceIds: number[],
): MaterialRemovalDemoteResult {
  const visited = resolveOwningXiaIds(bridge, faceIds);
  const demoted: DemoteOutcome[] = [];
  const errors: string[] = [];

  for (const xid of visited) {
    try {
      const r = bridge.demoteXiaToShape(xid);
      demoted.push({
        shapeId: r.shapeId,
        originalIdRestored: r.originalIdRestored,
        xiaId: xid,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
    }
  }

  return { demoted, errors, visited };
}
