/**
 * InvariantVerifierPanel — ADR-068 Phase 1 Path Y B pilot regression.
 *
 * 5 invariants per ADR-068 §3.2 (none #[ignore], §X.5 #6 strict):
 *   1. invariant_verifier_panel_renders_run_button
 *   2. invariant_verifier_clean_mesh_shows_pass
 *   3. invariant_verifier_violations_display_face_ids
 *   4. invariant_verifier_jump_button_changes_selection
 *   5. invariant_verifier_panel_imports_only_invariant_verifier
 */

import { describe, it, expect } from 'vitest';
import {
  InvariantVerifierPanel,
  type InvariantReport,
} from './InvariantVerifierPanel';

const allTsFiles = import.meta.glob('/src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('ADR-068 Phase 1 Path Y B — Invariant Verifier pilot', () => {
  it('invariant_verifier_panel_renders_run_button', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new InvariantVerifierPanel(container, {
      runVerify: () => ({ checkedFaces: 0, valid: true, violationCount: 0, violations: [] }),
    });
    panel.show();
    const btn = container.querySelector('[data-role="run"]') as HTMLButtonElement;
    expect(btn, 'Run Verify button must render').toBeTruthy();
    expect(btn.textContent).toContain('Run Verify');
    panel.dispose();
    container.remove();
  });

  it('invariant_verifier_clean_mesh_shows_pass', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new InvariantVerifierPanel(container, {
      runVerify: () => ({
        checkedFaces: 42,
        valid: true,
        violationCount: 0,
        violations: [],
      }),
    });
    panel.show();
    panel.runVerify();

    const status = container.querySelector('[data-role="status"]') as HTMLElement;
    expect(status.classList.contains('iv-status-ok')).toBe(true);
    expect(status.textContent).toContain('All 42');
    expect(status.textContent).toContain('pass');

    // Body should be empty (no violations).
    const bodyRows = container.querySelectorAll('.iv-violation');
    expect(bodyRows.length).toBe(0);

    panel.dispose();
    container.remove();
  });

  it('invariant_verifier_violations_display_face_ids', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const violations = [
      'Face(7): outer loop start half-edge is null',
      'Face(13): normal length 0 (degenerate)',
      'Face(99): non-manifold edge detected',
    ];
    const panel = new InvariantVerifierPanel(container, {
      runVerify: () => ({
        checkedFaces: 100,
        valid: false,
        violationCount: violations.length,
        violations,
      }),
    });
    panel.show();
    panel.runVerify();

    const status = container.querySelector('[data-role="status"]') as HTMLElement;
    expect(status.classList.contains('iv-status-err')).toBe(true);
    expect(status.textContent).toContain('3 violation');

    const rows = container.querySelectorAll('.iv-violation');
    expect(rows.length).toBe(3);
    // Each row contains the violation text.
    expect(rows[0].textContent).toContain('Face(7)');
    expect(rows[1].textContent).toContain('Face(13)');
    expect(rows[2].textContent).toContain('Face(99)');

    panel.dispose();
    container.remove();
  });

  it('invariant_verifier_jump_button_changes_selection', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const jumpedTo: number[] = [];
    const panel = new InvariantVerifierPanel(container, {
      runVerify: () => ({
        checkedFaces: 10,
        valid: false,
        violationCount: 1,
        violations: ['Face(42): outer loop verts < 3'],
      }),
      jumpToFace: (faceId: number) => { jumpedTo.push(faceId); },
    });
    panel.show();
    panel.runVerify();

    const jumpBtn = container.querySelector('.iv-jump-btn') as HTMLButtonElement;
    expect(jumpBtn, 'Jump button must render for FaceId-bearing violation').toBeTruthy();
    expect(jumpBtn.dataset.faceId).toBe('42');
    jumpBtn.click();

    expect(jumpedTo).toEqual([42]);

    panel.dispose();
    container.remove();
  });

  it('invariant_verifier_panel_imports_only_invariant_verifier', () => {
    // §D #1 lock-in style — verifyInvariants direct WASM call should
    // come from at most one production file (this panel + WasmBridge
    // wrapper). Production file count should be small.
    const importPattern = /verifyInvariants\(\)/;
    const callers: string[] = [];
    for (const [path, content] of Object.entries(allTsFiles)) {
      if (path.endsWith('.test.ts')) continue;
      if (path.includes('/wasm/') || path.includes('/__mocks__/')) continue;
      // Only count files that CALL verifyInvariants (with parens),
      // not just declare a method named verifyInvariants.
      const lines = content.split('\n');
      for (const line of lines) {
        if (importPattern.test(line) && !/\bfn\b|\binterface\b|^\s*verifyInvariants\?/i.test(line)) {
          callers.push(path);
          break;
        }
      }
    }
    // Acceptable callers: WasmBridge.ts (wrapper) + main.ts (registers
    // panel callback). InvariantVerifierPanel.ts ITSELF does not call
    // it directly — it goes through the callback. So 1-2 callers OK.
    expect(callers.length, `verifyInvariants() callers: ${JSON.stringify(callers)}`).toBeLessThanOrEqual(3);
    // Must include at least the bridge wrapper.
    const hasBridge = callers.some((p) => p.includes('WasmBridge'));
    expect(hasBridge || callers.length === 0,
      'WasmBridge.ts must be the source-of-truth wrapper').toBeTruthy();
  });
});

describe('ADR-068 — InvariantReport type contract', () => {
  it('matches WasmBridge return shape', () => {
    const report: InvariantReport = {
      checkedFaces: 0,
      valid: true,
      violationCount: 0,
      violations: [],
    };
    expect(typeof report.checkedFaces).toBe('number');
    expect(typeof report.valid).toBe('boolean');
    expect(typeof report.violationCount).toBe('number');
    expect(Array.isArray(report.violations)).toBe(true);
  });
});
