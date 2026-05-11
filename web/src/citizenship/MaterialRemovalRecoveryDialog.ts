/**
 * ADR-100 R-δ — Material Removal Recovery Dialog (UI helper).
 *
 * ADR-097 TopologyRecoveryDialog 1:1 mirror. Shown when
 * `attemptMaterialRemovalRecovery` returns `PartialFailure` (or when
 * the orchestrator escalates manual review). Modal with three options:
 *   - [Undo]      : revert via `bridge.undo()`
 *   - [강등]      : caller-supplied demote action (XiaId resolver)
 *   - [수동수정] : dismiss + show warning Toast with the reason
 *
 * Pattern lock-in (ADR-097 1:1):
 * - Pure DOM, jsdom-testable
 * - Single-instance defensive guard (one modal at a time)
 * - Backdrop click + ESC dismiss → 'manual' (least destructive)
 * - Reason text humanized by orchestrator (R-H8 / ADR-095 §E L3)
 *
 * Design difference from ADR-097: title color/text reflects "재질 손상"
 * vs "위상 손상". Otherwise structure identical for consistency.
 */

export type MaterialRecoveryChoice = 'undo' | 'demote' | 'manual';

export interface MaterialRecoveryDialogOptions {
  /** Human-friendly reason (Korean), e.g. "Xia 3개 재질 부재". */
  reason: string;
  /** Whether the [강등] button should be enabled. Defaults to true. */
  enableDemote?: boolean;
  /** Override host document — used by tests. */
  doc?: Document;
}

const DIALOG_ID = 'axia-material-recovery-dialog';

/**
 * Render the modal and resolve with the user's choice. Subsequent
 * invocations while a dialog is already open resolve with `'manual'`
 * to avoid stacking modals.
 */
export function showMaterialRecoveryDialog(
  options: MaterialRecoveryDialogOptions,
): Promise<MaterialRecoveryChoice> {
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return Promise.resolve('manual');

  if (doc.getElementById(DIALOG_ID)) return Promise.resolve('manual');

  const enableDemote = options.enableDemote !== false;

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (choice: MaterialRecoveryChoice) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(choice);
    };

    const backdrop = doc.createElement('div');
    backdrop.id = DIALOG_ID;
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.45)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'z-index:10000', 'font-family:system-ui,sans-serif',
    ].join(';');

    const panel = doc.createElement('div');
    panel.style.cssText = [
      'background:#1f2030', 'color:#e8e8ec', 'padding:24px 28px',
      'border-radius:8px', 'min-width:360px', 'max-width:480px',
      'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
    ].join(';');

    const title = doc.createElement('h3');
    title.textContent = '재질 손상 자동 복구 실패';
    title.style.cssText = 'margin:0 0 12px 0;font-size:16px;color:#ffd760';
    panel.appendChild(title);

    const reasonEl = doc.createElement('p');
    reasonEl.textContent = options.reason;
    reasonEl.style.cssText = 'margin:0 0 18px 0;font-size:13px;line-height:1.5';
    reasonEl.setAttribute('data-role', 'reason');
    panel.appendChild(reasonEl);

    const btnRow = doc.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';

    const mkBtn = (label: string, choice: MaterialRecoveryChoice, primary = false) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('data-choice', choice);
      b.style.cssText = [
        'padding:8px 14px', 'border:none', 'border-radius:4px',
        'cursor:pointer', 'font-size:13px',
        primary ? 'background:#5b9bd5;color:#fff' : 'background:#3a3b4a;color:#e8e8ec',
      ].join(';');
      b.addEventListener('click', () => finish(choice));
      return b;
    };

    btnRow.appendChild(mkBtn('수동수정', 'manual'));
    if (enableDemote) {
      btnRow.appendChild(mkBtn('강등', 'demote'));
    }
    btnRow.appendChild(mkBtn('Undo', 'undo', true));
    panel.appendChild(btnRow);

    backdrop.appendChild(panel);
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) finish('manual');
    });

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') finish('manual');
    };
    doc.addEventListener('keydown', onKey);

    const cleanup = () => {
      doc.removeEventListener('keydown', onKey);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    };

    doc.body.appendChild(backdrop);
  });
}
