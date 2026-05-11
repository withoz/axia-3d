/**
 * HistoryPanel — Tier 3B Phase 1 MVP (OperationLog UI).
 *
 * Shows the last N parameter-driven operations (fillet/chamfer/thicken/
 * array-linear/array-radial/subdivide) with a "재실행…" button that
 * pre-fills the original prompt value. Users can quickly tweak a radius
 * or count without re-selecting geometry from scratch.
 *
 * This is NOT a full parametric feature tree — there's no
 * auto-propagation of upstream changes. It's a "clipboard of last
 * parameter sets" convenience layer.
 *
 * Toggle: toolbar button / 보기 메뉴 → 작업 기록 패널.
 */

import { getOperationLog, OperationEntry, OperationKind } from '../core/OperationLog';
import { Toast } from './Toast';

export interface HistoryPanelCallbacks {
  /** Re-run a logged operation with a (possibly edited) params string.
   *  Returns true on success. The panel will refresh afterward. */
  rerun: (kind: OperationKind, params: string) => boolean;
}

const KIND_ICON: Record<OperationKind, string> = {
  'fillet-edge': '◠',
  'chamfer-edge': '╱',
  'thicken-faces': '🧱',
  'array-linear': '▦',
  'array-radial': '◎',
  'subdivide': '◈',
  'bend-selection': '⌒',
  'twist-selection': '⟲',
  'taper-selection': '△',
};

export class HistoryPanel {
  private container: HTMLElement;
  private callbacks: HistoryPanelCallbacks;
  private panelEl: HTMLElement;
  private listEl: HTMLElement;
  private visible = false;
  private unsubscribe: (() => void) | null = null;

  constructor(container: HTMLElement, callbacks: HistoryPanelCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.panelEl = document.createElement('div');
    this.panelEl.id = 'history-panel';
    this.panelEl.className = 'history-panel';
    this.panelEl.innerHTML = `
      <div class="hp-header">
        <span class="hp-title">🕒 작업 기록 (Parametric)</span>
        <div class="hp-actions">
          <button class="hp-btn hp-btn-clear" title="기록 전체 삭제">✕ ALL</button>
        </div>
      </div>
      <div class="hp-hint">
        파라미터 기반 작업만 기록됩니다. 항목을 클릭하면 같은 연산을 새 값으로
        재실행합니다. (예: 모깎기 반경만 변경해 재적용)
      </div>
      <div class="hp-list"></div>
      <div class="hp-empty">기록된 작업이 없습니다.</div>
    `;
    this.panelEl.style.display = 'none';
    container.appendChild(this.panelEl);

    this.listEl = this.panelEl.querySelector('.hp-list') as HTMLElement;

    this.panelEl.querySelector('.hp-btn-clear')?.addEventListener('click', () => {
      if (confirm('작업 기록을 모두 삭제하시겠습니까?')) {
        getOperationLog().clear();
      }
    });

    this.unsubscribe = getOperationLog().onChange(() => {
      if (this.visible) this.refresh();
    });

    this.injectStyles();
  }

  show(): void {
    this.visible = true;
    this.panelEl.style.display = 'block';
    this.refresh();
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

  private refresh(): void {
    const entries = getOperationLog().getAll();
    this.listEl.innerHTML = '';
    const emptyEl = this.panelEl.querySelector('.hp-empty') as HTMLElement;
    if (entries.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    // Newest first
    const ordered = entries.slice().reverse();
    for (const e of ordered) {
      this.listEl.appendChild(this.buildRow(e));
    }
  }

  private buildRow(e: OperationEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'hp-row';
    row.dataset.id = String(e.id);

    const icon = KIND_ICON[e.kind] ?? '•';
    const age = this.formatAge(Date.now() - e.timestamp);

    row.innerHTML = `
      <span class="hp-icon">${icon}</span>
      <span class="hp-name">${this.escape(e.displayName)}</span>
      <span class="hp-age">${age}</span>
      <button class="hp-rerun" title="같은 연산을 새 값으로 재실행">재실행…</button>
    `;
    row.querySelector('.hp-rerun')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.handleRerun(e);
    });
    return row;
  }

  private handleRerun(e: OperationEntry): void {
    // Phase 2 — cascade warning: if this op has dependents, warn the user
    // before re-running so they understand downstream geometry will be
    // affected (their original outputs no longer exist after a re-run).
    const dependents = getOperationLog().getCascadeChain(e.id);
    if (dependents.length > 0) {
      const names = dependents.slice(0, 3).map((d: OperationEntry) => d.displayName).join(', ');
      const more = dependents.length > 3 ? ` 외 ${dependents.length - 3}개` : '';
      const ok = window.confirm(
        `⚠️ "${e.displayName}" 재실행 시 ${dependents.length}개 후속 작업이 영향받습니다:\n` +
        `  ${names}${more}\n\n` +
        `Phase 2 MVP는 자동 cascade 재계산을 아직 수행하지 않습니다 — 후속 작업은\n` +
        `별도로 다시 실행해야 합니다. 계속하시겠습니까?`
      );
      if (!ok) return;
    }
    // Unified dialog flow: prompt pre-filled with last params.
    const promptLabel = this.promptLabelFor(e.kind);
    const newParams = window.prompt(promptLabel, e.params);
    if (newParams == null) return;
    const ok = this.callbacks.rerun(e.kind, newParams);
    if (ok) {
      Toast.info(`재실행 완료: ${this.displayKind(e.kind)}`, 2000);
    }
  }

  private promptLabelFor(kind: OperationKind): string {
    switch (kind) {
      case 'fillet-edge':    return '모깎기 반경 (mm) — 현재 선택된 엣지에 적용:';
      case 'chamfer-edge':   return '모따기 거리 (mm) — 현재 선택된 엣지에 적용:';
      case 'thicken-faces':  return '두께 (mm) — 현재 선택된 면에 적용:';
      case 'array-linear':   return '선형 배열 "N, dx, dy, dz":';
      case 'array-radial':   return '원형 배열 "N, axis(x|y|z), 총각도°":';
      case 'subdivide':      return '(subdivide는 파라미터 없음 — Enter로 재실행)';
      case 'bend-selection':
      case 'twist-selection':
      case 'taper-selection':
        return `${this.displayKind(kind)} — 각도/값:`;
    }
  }

  private displayKind(kind: OperationKind): string {
    const map: Record<OperationKind, string> = {
      'fillet-edge': '모깎기',
      'chamfer-edge': '모따기',
      'thicken-faces': '두께 부여',
      'array-linear': '선형 배열',
      'array-radial': '원형 배열',
      'subdivide': 'Catmull-Clark 분할',
      'bend-selection': 'Bend',
      'twist-selection': 'Twist',
      'taper-selection': 'Taper',
    };
    return map[kind] ?? kind;
  }

  private formatAge(ms: number): string {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    return `${hr}h`;
  }

  private escape(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
    ));
  }

  private injectStyles(): void {
    if (document.getElementById('history-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'history-panel-styles';
    style.textContent = `
      .history-panel {
        position: fixed; right: 8px; top: 120px; width: 320px; max-height: 70vh;
        background: rgba(24, 24, 32, 0.95); color: #ddd;
        border: 1px solid #444; border-radius: 6px; padding: 8px;
        font: 13px -apple-system, sans-serif; z-index: 1500;
        overflow-y: auto;
      }
      .hp-header { display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid #333; }
      .hp-title { font-weight: 600; }
      .hp-btn { background: #2a2a36; color: #ccc; border: 1px solid #444;
        padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 11px; }
      .hp-btn:hover { background: #3a3a48; }
      .hp-hint { font-size: 11px; color: #888; margin-bottom: 6px; line-height: 1.4; }
      .hp-list { display: flex; flex-direction: column; gap: 4px; }
      .hp-row { display: grid; grid-template-columns: 20px 1fr auto auto;
        align-items: center; gap: 6px; padding: 6px; background: #1e1e28;
        border-radius: 4px; }
      .hp-row:hover { background: #262636; }
      .hp-icon { text-align: center; color: #ffa500; font-size: 14px; }
      .hp-name { color: #eee; }
      .hp-age { color: #888; font-size: 11px; }
      .hp-rerun { background: #2a5a9e; color: white; border: none;
        padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; }
      .hp-rerun:hover { background: #3a6abe; }
      .hp-empty { padding: 20px; text-align: center; color: #666; font-style: italic; }
    `;
    document.head.appendChild(style);
  }
}
