/**
 * ADR-100 R-δ — MaterialRemovalRecoveryDialog tests (jsdom).
 *
 * ADR-097 TopologyRecoveryDialog.test 1:1 mirror — material-layer variant.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { showMaterialRecoveryDialog } from './MaterialRemovalRecoveryDialog';

describe('MaterialRemovalRecoveryDialog (R-δ)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders modal with reason text and 3 buttons by default', () => {
    void showMaterialRecoveryDialog({ reason: 'Xia 3개 재질 부재' });
    const modal = document.getElementById('axia-material-recovery-dialog');
    expect(modal).not.toBeNull();
    expect(modal!.textContent).toContain('Xia 3개 재질 부재');
    const btns = modal!.querySelectorAll('button');
    expect(btns.length).toBe(3); // 수동수정, 강등, Undo
  });

  it('title differs from topology dialog (재질 vs 위상)', () => {
    void showMaterialRecoveryDialog({ reason: 'x' });
    const modal = document.getElementById('axia-material-recovery-dialog');
    expect(modal!.textContent).toContain('재질 손상');
  });

  it('hides 강등 button when enableDemote=false', () => {
    void showMaterialRecoveryDialog({ reason: 'x', enableDemote: false });
    const btns = document.querySelectorAll('button');
    expect(btns.length).toBe(2);
    const choices = Array.from(btns).map((b) => b.getAttribute('data-choice'));
    expect(choices).not.toContain('demote');
  });

  it('Undo button resolves with "undo"', async () => {
    const p = showMaterialRecoveryDialog({ reason: 'x' });
    document.querySelector<HTMLButtonElement>('[data-choice="undo"]')!.click();
    await expect(p).resolves.toBe('undo');
  });

  it('강등 button resolves with "demote"', async () => {
    const p = showMaterialRecoveryDialog({ reason: 'x' });
    document.querySelector<HTMLButtonElement>('[data-choice="demote"]')!.click();
    await expect(p).resolves.toBe('demote');
  });

  it('수동수정 button resolves with "manual"', async () => {
    const p = showMaterialRecoveryDialog({ reason: 'x' });
    document.querySelector<HTMLButtonElement>('[data-choice="manual"]')!.click();
    await expect(p).resolves.toBe('manual');
  });

  it('ESC key resolves with "manual"', async () => {
    const p = showMaterialRecoveryDialog({ reason: 'x' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(p).resolves.toBe('manual');
  });

  it('backdrop click resolves with "manual"', async () => {
    const p = showMaterialRecoveryDialog({ reason: 'x' });
    const backdrop = document.getElementById('axia-material-recovery-dialog')!;
    backdrop.click();
    await expect(p).resolves.toBe('manual');
  });

  it('cleans up DOM after resolution', async () => {
    const p = showMaterialRecoveryDialog({ reason: 'x' });
    document.querySelector<HTMLButtonElement>('[data-choice="undo"]')!.click();
    await p;
    expect(document.getElementById('axia-material-recovery-dialog')).toBeNull();
  });

  it('second invocation while open resolves with "manual" immediately', async () => {
    const p1 = showMaterialRecoveryDialog({ reason: 'first' });
    const p2 = showMaterialRecoveryDialog({ reason: 'second' });
    await expect(p2).resolves.toBe('manual');
    expect(document.getElementById('axia-material-recovery-dialog')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-choice="manual"]')!.click();
    await p1;
  });
});
