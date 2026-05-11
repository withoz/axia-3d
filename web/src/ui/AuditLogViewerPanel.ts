/**
 * AuditLogViewerPanel — ADR-069 Phase 1 Path Y A pilot.
 *
 * Renders web-side action audit entries (localStorage) as a list
 * with Tier color + result badge + timestamp + optional masked args.
 *
 * Per ADR-069 §D #1 lock-in: audit log = localStorage 'axia.auditLog'.
 * Panel reads via core/AuditLog singleton (single SSOT).
 *
 * Per §D #5 lock-in: audit log volatile (Scene snapshot 미포함). Panel
 * dispose 는 audit data 영향 0.
 *
 * @see docs/adr/069-adr-046-phase-1-path-y-audit-log-viewer-pilot.md
 */

import { getAuditLog, type AuditEntry } from '../core/AuditLog';

const TIER_COLORS: Record<number, string> = {
  0: '#7ec8e3', // blue (read)
  1: '#90c878', // green (constructive)
  2: '#f0c060', // amber (modificative)
  3: '#e07878', // red (destructive)
};

const RESULT_COLORS: Record<string, string> = {
  ok:     '#6a9858',
  error:  '#985858',
  denied: '#785858',
};

export class AuditLogViewerPanel {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private container: HTMLElement;
  private panelEl: HTMLElement;
  private bodyEl: HTMLElement;
  private metaEl: HTMLElement;
  private visible = false;
  private unsubscribe: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.panelEl = document.createElement('div');
    this.panelEl.id = 'audit-log-viewer';
    this.panelEl.className = 'audit-log-viewer';
    this.panelEl.innerHTML = `
      <div class="alv-header">
        <span class="alv-title">📜 Audit Log Viewer (ADR-069)</span>
        <span class="alv-meta" data-role="meta">0 entries</span>
      </div>
      <div class="alv-toolbar">
        <button class="alv-btn alv-btn-clear" data-role="clear">✕ Clear</button>
        <button class="alv-btn alv-btn-refresh" data-role="refresh">↻ Refresh</button>
        <span class="alv-hint">
          Capability Explorer + UI 도구 invocations 자동 기록 (P26.7 정책).
        </span>
      </div>
      <div class="alv-body" data-role="body"></div>
    `;
    this.panelEl.style.display = 'none';
    container.appendChild(this.panelEl);

    this.bodyEl = this.panelEl.querySelector('[data-role="body"]') as HTMLElement;
    this.metaEl = this.panelEl.querySelector('[data-role="meta"]') as HTMLElement;

    const clearBtn = this.panelEl.querySelector('[data-role="clear"]') as HTMLButtonElement;
    clearBtn.addEventListener('click', () => {
      if (window.confirm('Audit log 을 모두 삭제하시겠습니까?')) {
        getAuditLog().clear();
      }
    });

    const refreshBtn = this.panelEl.querySelector('[data-role="refresh"]') as HTMLButtonElement;
    refreshBtn.addEventListener('click', () => this.render());

    // Subscribe to log changes.
    this.unsubscribe = getAuditLog().onChange(() => {
      if (this.visible) this.render();
    });

    this.injectStyles();
    this.render();
  }

  show(): void {
    this.visible = true;
    this.panelEl.style.display = 'flex';
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.panelEl.style.display = 'none';
  }

  toggle(): void { this.visible ? this.hide() : this.show(); }

  isVisible(): boolean { return this.visible; }

  dispose(): void {
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    this.panelEl.remove();
  }

  /** ADR-069 Step 3+4 — render entries list with Tier color + result badge. */
  private render(): void {
    const log = getAuditLog();
    const entries = log.getAll();
    this.metaEl.textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (cap 1000)`;

    this.bodyEl.innerHTML = '';
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'alv-empty';
      empty.textContent = '기록된 audit 항목이 없습니다.';
      this.bodyEl.appendChild(empty);
      return;
    }

    // Render newest first.
    const ordered = entries.slice().reverse();
    for (const e of ordered) {
      this.bodyEl.appendChild(this.buildRow(e));
    }
  }

  private buildRow(entry: AuditEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'alv-row';
    row.dataset.actionId = entry.actionId;
    row.dataset.tier = String(entry.tier);
    row.dataset.result = entry.result;

    const t = new Date(entry.timestamp);
    const timeStr = t.toLocaleTimeString();

    row.innerHTML = `
      <span class="alv-tier-dot" style="background:${TIER_COLORS[entry.tier]}"></span>
      <span class="alv-time">${timeStr}</span>
      <span class="alv-action-id">${this.escape(entry.actionId)}</span>
      <span class="alv-tier-label">T${entry.tier}</span>
      <span class="alv-result" style="background:${RESULT_COLORS[entry.result]}">${entry.result}</span>
    `;

    if (entry.error || entry.args) {
      const details = document.createElement('div');
      details.className = 'alv-details';
      const parts: string[] = [];
      if (entry.error) parts.push(`<b>error</b>: ${this.escape(entry.error)}`);
      if (entry.args && Object.keys(entry.args).length > 0) {
        const argStr = JSON.stringify(entry.args);
        parts.push(`<b>args</b>: ${this.escape(argStr)}`);
      }
      details.innerHTML = parts.join(' · ');
      row.appendChild(details);
    }

    return row;
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private injectStyles(): void {
    const styleId = 'audit-log-viewer-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .audit-log-viewer {
        position: fixed; top: 60px; right: 16px;
        width: 480px; max-height: 70vh;
        background: rgba(28, 28, 32, 0.96); color: #e8e8e8;
        border: 1px solid #444; border-radius: 6px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
        font-family: -apple-system, system-ui, sans-serif;
        font-size: 12px; z-index: 1000;
        flex-direction: column;
      }
      .audit-log-viewer .alv-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 12px; border-bottom: 1px solid #444;
        background: rgba(0, 0, 0, 0.3); border-radius: 6px 6px 0 0;
      }
      .audit-log-viewer .alv-title { font-weight: 600; font-size: 13px; }
      .audit-log-viewer .alv-meta {
        font-size: 11px; color: #aaa; font-variant-numeric: tabular-nums;
      }
      .audit-log-viewer .alv-toolbar {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 12px; border-bottom: 1px solid #333;
        flex-wrap: wrap;
      }
      .audit-log-viewer .alv-btn {
        background: rgba(255, 255, 255, 0.08); color: #ccc;
        border: 1px solid #555; border-radius: 3px;
        padding: 3px 10px; cursor: pointer; font-size: 11px;
      }
      .audit-log-viewer .alv-btn:hover { background: rgba(255, 255, 255, 0.15); }
      .audit-log-viewer .alv-btn-clear { color: #e08080; }
      .audit-log-viewer .alv-hint {
        font-size: 10px; color: #888;
      }
      .audit-log-viewer .alv-body {
        flex: 1; overflow-y: auto; padding: 4px 0;
      }
      .audit-log-viewer .alv-empty {
        padding: 24px 12px; text-align: center;
        color: #888; font-style: italic;
      }
      .audit-log-viewer .alv-row {
        padding: 4px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        display: grid;
        grid-template-columns: 8px 70px 1fr 30px 60px;
        gap: 6px; align-items: center;
      }
      .audit-log-viewer .alv-tier-dot {
        width: 8px; height: 8px; border-radius: 50%;
      }
      .audit-log-viewer .alv-time {
        font-family: ui-monospace, monospace;
        font-size: 10px; color: #aaa;
      }
      .audit-log-viewer .alv-action-id {
        font-family: ui-monospace, monospace;
        color: #88c8a8;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .audit-log-viewer .alv-tier-label {
        font-size: 10px; color: #aaa; text-align: center;
      }
      .audit-log-viewer .alv-result {
        font-size: 10px; padding: 1px 6px;
        border-radius: 9px; color: #fff;
        text-align: center; text-transform: uppercase;
      }
      .audit-log-viewer .alv-details {
        grid-column: 1 / -1;
        padding-left: 80px; margin-top: 2px;
        font-size: 10px; color: #aaa; line-height: 1.4;
        font-family: ui-monospace, monospace;
        word-break: break-all;
      }
      .audit-log-viewer .alv-details b { color: #ccc; font-weight: 600; }
    `;
    document.head.appendChild(style);
  }
}
