/**
 * ADR-097 T-δ — Topology Recovery Orchestrator.
 *
 * Centralizes Phase 4 (위상 손상 자동 복구) flow:
 *   1. `bridge.detectTopologyDamage()` — assess current state.
 *   2. If clean → `NoOp`, return immediately.
 *   3. Otherwise call `bridge.attemptAutoRecovery()`.
 *   4. On `Recovered` → success Toast, return.
 *   5. On `PartialFailure` → escalate to dialog.
 *      - [Undo]    → `bridge.undo()`
 *      - [강등]   → demote chosen Xia (caller-supplied resolver)
 *      - [수동수정] → warning Toast with humanized reason.
 *
 * Lock-ins applied (ADR-097):
 *   - T-A=a: orchestrator is the SSOT entry point — Settings + Inspector
 *     + Tools all funnel here.
 *   - T-G=a: escalation only on `PartialFailure`. `Recovered` and
 *     `NoOp` never show a dialog.
 *   - T-H=b: humanize reason text (Korean) before passing to dialog;
 *     engine labels stay English for telemetry.
 *
 * Out of scope (별도 sub-step):
 *   - T-ε Settings flag (`axia:auto-topology-recovery`) — Settings
 *     module wires this orchestrator to a localStorage toggle.
 *   - T-ζ Real Chromium 시연.
 */

import type { WasmBridge, TopologyDamageReport, TopologyDamageKind, RecoveryOutcome } from '../bridge/WasmBridge';
import { Toast } from '../ui/Toast';
import { showTopologyRecoveryDialog, type TopologyRecoveryChoice } from './TopologyRecoveryDialog';

export interface OrchestratorResult {
  /** Final disposition of the run. */
  status: 'clean' | 'recovered' | 'undone' | 'demoted' | 'manual' | 'unavailable';
  /** Damage count BEFORE recovery (0 when clean). */
  initialDamages: number;
  /** Damage count remaining AFTER recovery (0 when clean/recovered/undone). */
  remainingDamages: number;
  /** Engine outcome for telemetry. Undefined when bridge endpoints absent. */
  outcome?: RecoveryOutcome;
}

/**
 * Caller hook to resolve a XiaId for the [강등] button when the
 * orchestrator escalates. Receives the damage report so the host UI
 * can pick a sensible target (e.g., the Xia owning the most damaged
 * faces). Return `null` to skip demote and treat as manual.
 */
export type DemoteResolver = (
  bridge: WasmBridge,
  report: TopologyDamageReport,
) => number | null;

export interface OrchestratorOptions {
  /** Resolver for the [강등] button. Required when enableDemote=true. */
  demoteResolver?: DemoteResolver;
  /** Toast facade override — used by tests. */
  toast?: typeof Toast;
  /** Document override — passed to dialog (jsdom support). */
  doc?: Document;
  /** Skip Toast surfaces (silent mode for tests). */
  silent?: boolean;
}

/**
 * Convert engine damage labels into a Korean summary for the dialog.
 * Lock-in T-H=b — humanize at the orchestrator boundary.
 */
export function humanizeDamageReport(report: TopologyDamageReport): string {
  if (report.damages.length === 0) return '손상 없음';
  const counts = { boundary: 0, nonManifold: 0, degenerate: 0, orphan: 0 };
  for (const d of report.damages) {
    switch (d.kind) {
      case 'BoundaryEdge': counts.boundary += 1; break;
      case 'NonManifold': counts.nonManifold += 1; break;
      case 'Degenerate': counts.degenerate += 1; break;
      case 'Orphan': counts.orphan += 1; break;
    }
  }
  const parts: string[] = [];
  if (counts.degenerate > 0) parts.push(`${counts.degenerate}개 면 degenerate`);
  if (counts.nonManifold > 0) parts.push(`${counts.nonManifold}개 엣지 non-manifold`);
  if (counts.boundary > 0) parts.push(`${counts.boundary}개 boundary edge`);
  if (counts.orphan > 0) parts.push(`${counts.orphan}개 orphan face`);
  return parts.join(', ');
}

/**
 * Run the full Phase 4 flow. Idempotent — calling on a clean scene is
 * a no-op (NoOp + status='clean').
 */
export async function attemptRecoveryWithDialog(
  bridge: WasmBridge,
  options: OrchestratorOptions = {},
): Promise<OrchestratorResult> {
  const toast = options.toast ?? Toast;
  const showToast = (fn: 'success' | 'warning' | 'info', msg: string) => {
    if (!options.silent) toast[fn](msg);
  };

  // Step 1 — assess.
  const report = bridge.detectTopologyDamage();
  if (!report) {
    return { status: 'unavailable', initialDamages: 0, remainingDamages: 0 };
  }
  if (report.damages.length === 0) {
    return { status: 'clean', initialDamages: 0, remainingDamages: 0 };
  }

  // Step 2 — auto-recovery.
  const outcome = bridge.attemptAutoRecovery();
  if (!outcome) {
    return {
      status: 'unavailable',
      initialDamages: report.damages.length,
      remainingDamages: report.damages.length,
    };
  }

  if (outcome.kind === 'NoOp') {
    return {
      status: 'clean',
      initialDamages: 0,
      remainingDamages: 0,
      outcome,
    };
  }

  if (outcome.kind === 'Recovered') {
    showToast('success', `위상 손상 ${outcome.initialDamages}건 자동 복구 완료`);
    return {
      status: 'recovered',
      initialDamages: outcome.initialDamages,
      remainingDamages: 0,
      outcome,
    };
  }

  // PartialFailure — escalate.
  const reason = humanizeDamageReport(report);
  const enableDemote = !!options.demoteResolver;
  const choice: TopologyRecoveryChoice = await showTopologyRecoveryDialog({
    reason: `자동 복구 ${outcome.fixesApplied}건 적용 — 잔존 ${outcome.remainingCount}건. (${reason})`,
    enableDemote,
    doc: options.doc,
  });

  if (choice === 'undo') {
    bridge.undo();
    showToast('info', '위상 복구를 되돌렸습니다.');
    return {
      status: 'undone',
      initialDamages: report.damages.length,
      remainingDamages: 0,
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
          initialDamages: report.damages.length,
          remainingDamages: outcome.remainingCount,
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
    initialDamages: report.damages.length,
    remainingDamages: outcome.remainingCount,
    outcome,
  };
}
