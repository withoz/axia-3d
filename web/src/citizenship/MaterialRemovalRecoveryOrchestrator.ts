/**
 * ADR-100 R-δ — Material Removal Recovery Orchestrator.
 *
 * ADR-097 TopologyRecoveryOrchestrator 1:1 mirror — material-layer
 * variant. Phase 5-C flow:
 *   1. `bridge.detectOrphanMaterialAssignments()` — assess current state.
 *   2. If clean → `NoOp`, return immediately.
 *   3. Otherwise call `bridge.attemptMaterialRemovalRecovery()`.
 *   4. On `Recovered` → success Toast, return.
 *   5. On `PartialFailure` → escalate to dialog.
 *      - [Undo]    → `bridge.undo()`
 *      - [강등]   → demote chosen Xia (caller-supplied resolver)
 *      - [수동수정] → warning Toast with humanized reason.
 *
 * Lock-ins applied (ADR-100):
 *   - R-A=a: orchestrator is the SSOT entry point — Settings + Inspector
 *     + Tools all funnel here.
 *   - R-B 3-tier cascade in engine; orchestrator only handles escalation.
 *   - R-C UI: ADR-097 Dialog/Orchestrator helper 답습 (1:1 mirror).
 *   - R-H8 (R-δ): humanize reason text (Korean) before passing to dialog;
 *     engine labels stay structured for telemetry.
 *
 * Out of scope (별도 sub-step):
 *   - R-ε Settings flag (`axia:auto-material-recovery`) — Settings
 *     module wires this orchestrator to a localStorage toggle.
 *   - R-ζ Real Chromium 시연.
 */

import type {
  WasmBridge, OrphanMaterialReport, MaterialRecoveryOutcome,
} from '../bridge/WasmBridge';
import { Toast } from '../ui/Toast';
import {
  showMaterialRecoveryDialog,
  type MaterialRecoveryChoice,
} from './MaterialRemovalRecoveryDialog';

export interface MaterialRecoveryOrchestratorResult {
  /** Final disposition of the run. */
  status: 'clean' | 'recovered' | 'undone' | 'demoted' | 'manual' | 'unavailable';
  /** Affected Xia count BEFORE recovery (0 when clean). */
  initialAffected: number;
  /** Remaining orphan count AFTER recovery (0 when clean/recovered/undone). */
  remainingOrphans: number;
  /** Engine outcome for telemetry. Undefined when bridge endpoints absent. */
  outcome?: MaterialRecoveryOutcome;
}

/**
 * Caller hook to resolve a XiaId for the [강등] button when the
 * orchestrator escalates. ADR-097 mirror pattern.
 */
export type MaterialDemoteResolver = (
  bridge: WasmBridge,
  report: OrphanMaterialReport,
) => number | null;

export interface MaterialRecoveryOrchestratorOptions {
  /** Resolver for the [강등] button. Required when enableDemote=true. */
  demoteResolver?: MaterialDemoteResolver;
  /** Toast facade override — used by tests. */
  toast?: typeof Toast;
  /** Document override — passed to dialog (jsdom support). */
  doc?: Document;
  /** Skip Toast surfaces (silent mode for tests). */
  silent?: boolean;
}

/**
 * Convert engine orphan-material report into a Korean summary for the
 * dialog. Lock-in R-H8 — humanize at the orchestrator boundary.
 */
export function humanizeOrphanReport(report: OrphanMaterialReport): string {
  if (report.affectedXias.length === 0) return '재질 손상 없음';
  const xiaCount = report.affectedXias.length;
  const faceTotal = report.affectedXias.reduce(
    (sum, e) => sum + e.faceCount, 0,
  );
  return `Xia ${xiaCount}개 / 면 ${faceTotal}개 재질 부재`;
}

/**
 * Run the full Phase 5-C flow. Idempotent — calling on a clean scene
 * is a no-op (NoOp + status='clean').
 */
export async function attemptMaterialRecoveryWithDialog(
  bridge: WasmBridge,
  options: MaterialRecoveryOrchestratorOptions = {},
): Promise<MaterialRecoveryOrchestratorResult> {
  const toast = options.toast ?? Toast;
  const showToast = (fn: 'success' | 'warning' | 'info', msg: string) => {
    if (!options.silent) toast[fn](msg);
  };

  // Step 1 — assess.
  const report = bridge.detectOrphanMaterialAssignments();
  if (!report) {
    return { status: 'unavailable', initialAffected: 0, remainingOrphans: 0 };
  }
  if (report.affectedXias.length === 0) {
    return { status: 'clean', initialAffected: 0, remainingOrphans: 0 };
  }

  // Step 2 — auto-recovery.
  const outcome = bridge.attemptMaterialRemovalRecovery();
  if (!outcome) {
    return {
      status: 'unavailable',
      initialAffected: report.affectedXias.length,
      remainingOrphans: report.affectedXias.length,
    };
  }

  if (outcome.kind === 'NoOp') {
    return {
      status: 'clean',
      initialAffected: 0,
      remainingOrphans: 0,
      outcome,
    };
  }

  if (outcome.kind === 'Recovered') {
    showToast(
      'success',
      `재질 손상 ${outcome.affectedXias}개 자동 복구 완료 (강등 ${outcome.facesDemoted} / fallback ${outcome.facesFallback})`,
    );
    return {
      status: 'recovered',
      initialAffected: outcome.affectedXias,
      remainingOrphans: 0,
      outcome,
    };
  }

  // PartialFailure — escalate.
  const reason = humanizeOrphanReport(report);
  const enableDemote = !!options.demoteResolver;
  const choice: MaterialRecoveryChoice = await showMaterialRecoveryDialog({
    reason: `자동 복구 후 잔존 ${outcome.remainingOrphans}건. (${reason})`,
    enableDemote,
    doc: options.doc,
  });

  if (choice === 'undo') {
    bridge.undo();
    showToast('info', '재질 복구를 되돌렸습니다.');
    return {
      status: 'undone',
      initialAffected: report.affectedXias.length,
      remainingOrphans: 0,
      outcome,
    };
  }

  if (choice === 'demote' && options.demoteResolver) {
    const xid = options.demoteResolver(bridge, report);
    if (xid !== null && xid >= 0) {
      try {
        bridge.demoteXiaToShape(xid);
        showToast('success', 'XIA를 형태 (Shape)로 강등했습니다.');
        return {
          status: 'demoted',
          initialAffected: report.affectedXias.length,
          remainingOrphans: outcome.remainingOrphans,
          outcome,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast('warning', `강등 실패: ${msg}`);
      }
    }
  }

  // Manual fallback (default for ESC/backdrop/no-resolver).
  showToast('warning', `수동 수정 필요: ${reason}`);
  return {
    status: 'manual',
    initialAffected: report.affectedXias.length,
    remainingOrphans: outcome.remainingOrphans,
    outcome,
  };
}
