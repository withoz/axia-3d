/**
 * InvariantVerifierPanel — ADR-068 (Phase 1 Path Y B sub-feature) pilot.
 *
 * UI for ADR-007 invariant verification. Reuses WASM `verifyInvariants`
 * (no new backend code per §D #1 lock-in). Shows:
 *   - "Run Verify" button → invoke + render result
 *   - Empty mesh / valid: green "✓ All N faces pass"
 *   - Violations: red list with FaceId + violation kind
 *   - Each row has a "Jump" button → SelectionManager.selectFaces([fid])
 *
 * Per ADR-068 §D #2 lock-in: this is the ONLY UI consumer of
 * `verifyInvariants` in `web/src/`. Capability Explorer Tier 0 endpoint
 * registration may also surface it via the catalog (ADR-063 §D #1 single
 * import), but the dedicated panel is THIS file.
 *
 * @see docs/adr/068-adr-046-phase-1-path-y-invariant-verifier-pilot.md
 */

export interface InvariantReport {
  checkedFaces: number;
  valid: boolean;
  violationCount: number;
  violations: string[];
}

export interface InvariantVerifierPanelCallbacks {
  /** Invoke WASM verifyInvariants and return parsed report. */
  runVerify: () => InvariantReport;
  /** ADR-068 Step 4 — Jump-to-id: focus on a face by id. */
  jumpToFace?: (faceId: number) => void;
}

export class InvariantVerifierPanel {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private container: HTMLElement;
  private callbacks: InvariantVerifierPanelCallbacks;
  private panelEl: HTMLElement;
  private bodyEl: HTMLElement;
  private statusEl: HTMLElement;
  private visible = false;
  private lastReport: InvariantReport | null = null;
  private lastRunAt: number | null = null;

  constructor(container: HTMLElement, callbacks: InvariantVerifierPanelCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.panelEl = document.createElement('div');
    this.panelEl.id = 'invariant-verifier';
    this.panelEl.className = 'invariant-verifier';
    this.panelEl.innerHTML = `
      <div class="iv-header">
        <span class="iv-title">🛡️ Invariant Verifier (ADR-007)</span>
        <span class="iv-meta" data-role="meta">미실행</span>
      </div>
      <div class="iv-toolbar">
        <button class="iv-btn iv-btn-run" data-role="run">▶ Run Verify</button>
        <span class="iv-hint" data-role="hint">
          ADR-007 invariants (winding / loop / HE / manifold) 검증.
          큰 mesh 에서 비싸므로 명시 실행.
        </span>
      </div>
      <div class="iv-status" data-role="status"></div>
      <div class="iv-body" data-role="body"></div>
    `;
    this.panelEl.style.display = 'none';
    container.appendChild(this.panelEl);

    this.bodyEl = this.panelEl.querySelector('[data-role="body"]') as HTMLElement;
    this.statusEl = this.panelEl.querySelector('[data-role="status"]') as HTMLElement;

    const runBtn = this.panelEl.querySelector('[data-role="run"]') as HTMLButtonElement;
    runBtn.addEventListener('click', () => this.runVerify());

    this.injectStyles();
  }

  show(): void {
    this.visible = true;
    this.panelEl.style.display = 'flex';
  }

  hide(): void {
    this.visible = false;
    this.panelEl.style.display = 'none';
  }

  toggle(): void { this.visible ? this.hide() : this.show(); }

  isVisible(): boolean { return this.visible; }

  dispose(): void {
    this.panelEl.remove();
  }

  /** ADR-068 Step 2 — Invoke verifyInvariants + render result. */
  runVerify(): void {
    let report: InvariantReport;
    try {
      report = this.callbacks.runVerify();
    } catch (e) {
      this.statusEl.className = 'iv-status iv-status-err';
      this.statusEl.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
      this.bodyEl.innerHTML = '';
      return;
    }
    this.lastReport = report;
    this.lastRunAt = Date.now();
    this.renderReport();
  }

  /** Public accessor (test/telemetry). */
  getLastReport(): InvariantReport | null {
    return this.lastReport;
  }

  /** ADR-068 Step 3 — Render Empty (clean) vs Violations branch. */
  private renderReport(): void {
    const r = this.lastReport;
    if (!r) return;

    // Update meta: timestamp + face count.
    const metaEl = this.panelEl.querySelector('[data-role="meta"]');
    if (metaEl && this.lastRunAt) {
      const t = new Date(this.lastRunAt);
      metaEl.textContent = `${t.toLocaleTimeString()} · ${r.checkedFaces} faces`;
    }

    if (r.valid && r.violationCount === 0) {
      // Clean — green status.
      this.statusEl.className = 'iv-status iv-status-ok';
      this.statusEl.textContent = `✓ All ${r.checkedFaces} faces pass invariants.`;
      this.bodyEl.innerHTML = '';
      return;
    }

    // Violations — red status + list.
    this.statusEl.className = 'iv-status iv-status-err';
    this.statusEl.textContent = `✗ ${r.violationCount} violation${r.violationCount === 1 ? '' : 's'} detected.`;

    this.bodyEl.innerHTML = '';
    for (const violation of r.violations) {
      this.bodyEl.appendChild(this.buildViolationRow(violation));
    }
  }

  /** ADR-068 Step 4 — Build a violation row with Jump-to-id button.
   *
   *  The violation string format is freeform (ADR-007 InvariantReport
   *  emits human-readable lines). We extract the first FaceId-like
   *  number for the jump target — best-effort regex.
   */
  private buildViolationRow(violation: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'iv-violation';

    // Best-effort FaceId extraction: match patterns like "Face(123)",
    // "FaceId(123)", "face 123", "face_id=123".
    const faceIdMatch = violation.match(/[Ff]ace(?:Id)?[\s(=:_]+(\d+)/);
    const faceId = faceIdMatch ? parseInt(faceIdMatch[1], 10) : null;

    const text = document.createElement('span');
    text.className = 'iv-violation-text';
    text.textContent = violation;
    row.appendChild(text);

    if (faceId !== null && this.callbacks.jumpToFace) {
      const jumpBtn = document.createElement('button');
      jumpBtn.className = 'iv-jump-btn';
      jumpBtn.dataset.faceId = String(faceId);
      jumpBtn.textContent = `→ Jump (Face ${faceId})`;
      jumpBtn.addEventListener('click', () => {
        this.callbacks.jumpToFace!(faceId);
      });
      row.appendChild(jumpBtn);
    }

    return row;
  }

  private injectStyles(): void {
    const styleId = 'invariant-verifier-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .invariant-verifier {
        position: fixed;
        top: 60px;
        right: 16px;
        width: 460px;
        max-height: 70vh;
        background: rgba(28, 28, 32, 0.96);
        color: #e8e8e8;
        border: 1px solid #444;
        border-radius: 6px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
        font-family: -apple-system, system-ui, sans-serif;
        font-size: 12px;
        z-index: 1000;
        flex-direction: column;
      }
      .invariant-verifier .iv-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 12px; border-bottom: 1px solid #444;
        background: rgba(0, 0, 0, 0.3); border-radius: 6px 6px 0 0;
      }
      .invariant-verifier .iv-title { font-weight: 600; font-size: 13px; }
      .invariant-verifier .iv-meta {
        font-size: 11px; color: #aaa; font-variant-numeric: tabular-nums;
      }
      .invariant-verifier .iv-toolbar {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 12px; border-bottom: 1px solid #333;
      }
      .invariant-verifier .iv-btn-run {
        background: #2a5870; color: #e8e8e8;
        border: 1px solid #4080a0; border-radius: 3px;
        padding: 5px 14px; cursor: pointer; font-size: 12px;
      }
      .invariant-verifier .iv-btn-run:hover { background: #3070a0; }
      .invariant-verifier .iv-hint {
        font-size: 10px; color: #888; line-height: 1.4;
      }
      .invariant-verifier .iv-status {
        padding: 8px 12px; font-size: 12px;
        border-bottom: 1px solid #333; min-height: 18px;
      }
      .invariant-verifier .iv-status:empty { display: none; }
      .invariant-verifier .iv-status-ok {
        color: #a8d890; background: rgba(108, 168, 88, 0.1);
        border-left: 3px solid #6a9858;
      }
      .invariant-verifier .iv-status-err {
        color: #e0a8a8; background: rgba(168, 88, 88, 0.1);
        border-left: 3px solid #985858;
      }
      .invariant-verifier .iv-body {
        flex: 1; overflow-y: auto; padding: 4px 0;
      }
      .invariant-verifier .iv-violation {
        display: flex; justify-content: space-between; align-items: center;
        gap: 8px; padding: 6px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      }
      .invariant-verifier .iv-violation:hover {
        background: rgba(255, 255, 255, 0.03);
      }
      .invariant-verifier .iv-violation-text {
        flex: 1; font-family: ui-monospace, monospace;
        font-size: 11px; color: #ddd;
        word-break: break-word;
      }
      .invariant-verifier .iv-jump-btn {
        background: #783030; color: #ffd0d0;
        border: 1px solid #a04848; border-radius: 3px;
        padding: 2px 8px; cursor: pointer; font-size: 10px;
        white-space: nowrap;
      }
      .invariant-verifier .iv-jump-btn:hover { background: #904040; }
    `;
    document.head.appendChild(style);
  }
}
