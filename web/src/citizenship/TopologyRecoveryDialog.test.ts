/**
 * ADR-097 T-δ — TopologyRecoveryDialog tests (jsdom).
 *
 * Verifies modal renders, button clicks resolve correct choice,
 * ESC + backdrop dismiss as 'manual', and only one modal at a time.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { showTopologyRecoveryDialog } from './TopologyRecoveryDialog';

describe('TopologyRecoveryDialog (T-δ)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders modal with reason text and 3 buttons by default', () => {
    void showTopologyRecoveryDialog({ reason: '면 3개 손상' });
    const modal = document.getElementById('axia-topology-recovery-dialog');
    expect(modal).not.toBeNull();
    expect(modal!.textContent).toContain('면 3개 손상');
    const btns = modal!.querySelectorAll('button');
    expect(btns.length).toBe(3); // 수동수정, 강등, Undo
  });

  it('hides 강등 button when enableDemote=false', () => {
    void showTopologyRecoveryDialog({ reason: 'x', enableDemote: false });
    const btns = document.querySelectorAll('button');
    expect(btns.length).toBe(2);
    const choices = Array.from(btns).map((b) => b.getAttribute('data-choice'));
    expect(choices).not.toContain('demote');
  });

  it('Undo button resolves with "undo"', async () => {
    const p = showTopologyRecoveryDialog({ reason: 'x' });
    document.querySelector<HTMLButtonElement>('[data-choice="undo"]')!.click();
    await expect(p).resolves.toBe('undo');
  });

  it('강등 button resolves with "demote"', async () => {
    const p = showTopologyRecoveryDialog({ reason: 'x' });
    document.querySelector<HTMLButtonElement>('[data-choice="demote"]')!.click();
    await expect(p).resolves.toBe('demote');
  });

  it('수동수정 button resolves with "manual"', async () => {
    const p = showTopologyRecoveryDialog({ reason: 'x' });
    document.querySelector<HTMLButtonElement>('[data-choice="manual"]')!.click();
    await expect(p).resolves.toBe('manual');
  });

  it('ESC key resolves with "manual"', async () => {
    const p = showTopologyRecoveryDialog({ reason: 'x' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(p).resolves.toBe('manual');
  });

  it('backdrop click resolves with "manual"', async () => {
    const p = showTopologyRecoveryDialog({ reason: 'x' });
    const backdrop = document.getElementById('axia-topology-recovery-dialog')!;
    backdrop.click(); // event.target === backdrop
    await expect(p).resolves.toBe('manual');
  });

  it('cleans up DOM after resolution', async () => {
    const p = showTopologyRecoveryDialog({ reason: 'x' });
    document.querySelector<HTMLButtonElement>('[data-choice="undo"]')!.click();
    await p;
    expect(document.getElementById('axia-topology-recovery-dialog')).toBeNull();
  });

  it('second invocation while open resolves with "manual" immediately', async () => {
    const p1 = showTopologyRecoveryDialog({ reason: 'first' });
    const p2 = showTopologyRecoveryDialog({ reason: 'second' });
    await expect(p2).resolves.toBe('manual');
    // first dialog still open
    expect(document.getElementById('axia-topology-recovery-dialog')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-choice="manual"]')!.click();
    await p1;
  });

});
