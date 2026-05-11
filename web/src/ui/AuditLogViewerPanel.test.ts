/**
 * AuditLogViewerPanel — ADR-069 Phase 1 Path Y A pilot regression.
 *
 * 1 invariant per ADR-069 §3.2:
 *   3. audit_log_viewer_panel_renders_entries
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLogViewerPanel } from './AuditLogViewerPanel';
import {
  AUDIT_LOG_LS_KEY,
  _resetAuditLogForTest,
  getAuditLog,
} from '../core/AuditLog';

beforeEach(() => {
  try { localStorage.removeItem(AUDIT_LOG_LS_KEY); } catch {}
  _resetAuditLogForTest();
});

describe('ADR-069 AuditLogViewerPanel', () => {
  it('audit_log_viewer_panel_renders_entries', () => {
    const log = getAuditLog();
    log.record({ actionId: 'fillet-dispatch', tier: 2, result: 'ok' });
    log.record({ actionId: 'bool-dispatch',   tier: 2, result: 'error', error: 'mesh fallback' });
    log.record({ actionId: 'cache-stats',     tier: 0, result: 'denied' });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new AuditLogViewerPanel(container);
    panel.show();

    const rows = container.querySelectorAll('.alv-row');
    expect(rows.length).toBe(3);

    // Newest first — the cache-stats denied should be first row.
    expect((rows[0] as HTMLElement).dataset.actionId).toBe('cache-stats');
    expect((rows[0] as HTMLElement).dataset.result).toBe('denied');

    // Result badge text inside row.
    expect(rows[0].textContent).toContain('denied');
    expect(rows[1].textContent).toContain('error');
    expect(rows[2].textContent).toContain('ok');

    panel.dispose();
    container.remove();
  });

  it('panel_renders_empty_state_when_no_entries', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new AuditLogViewerPanel(container);
    panel.show();

    const empty = container.querySelector('.alv-empty');
    expect(empty, 'empty state must render when log is empty').toBeTruthy();
    expect(empty!.textContent).toContain('audit');

    panel.dispose();
    container.remove();
  });

  it('panel_re_renders_on_log_change', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new AuditLogViewerPanel(container);
    panel.show();

    expect(container.querySelectorAll('.alv-row').length).toBe(0);

    // Push a new entry → panel should auto-update via onChange subscription.
    getAuditLog().record({ actionId: 'fillet-dispatch', tier: 2, result: 'ok' });

    expect(container.querySelectorAll('.alv-row').length).toBe(1);

    panel.dispose();
    container.remove();
  });

  it('panel_clear_button_clears_log', () => {
    getAuditLog().record({ actionId: 'fillet-dispatch', tier: 2, result: 'ok' });
    expect(getAuditLog().getCount()).toBe(1);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new AuditLogViewerPanel(container);
    panel.show();

    const origConfirm = window.confirm;
    window.confirm = () => true;  // user accepts

    const clearBtn = container.querySelector('[data-role="clear"]') as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
    clearBtn.click();

    expect(getAuditLog().getCount()).toBe(0);
    expect(container.querySelectorAll('.alv-row').length).toBe(0);

    window.confirm = origConfirm;
    panel.dispose();
    container.remove();
  });
});
