/**
 * ConstraintPanel — Level 2/3 파라메트릭 제약 목록 UI.
 *
 * 기능:
 * - 현재 Scene의 제약을 목록으로 표시 (id, kind, active, refs)
 * - 개별 활성/비활성 토글 체크박스
 * - 개별 삭제 (✕)
 * - "모두 해결" 버튼 — resolveConstraintsIterative 실행 후 수렴 상태 표시
 * - "모두 삭제" 버튼
 * - Residual 상태 표시
 *
 * 위치: 우측 사이드바 (ComponentPanel 패턴 참고).
 */

import type { WasmBridge } from '../bridge/WasmBridge';
import { Toast } from './Toast';

export interface ConstraintPanelCallbacks {
  /** 제약 변경 후 뷰포트 재렌더 */
  syncMesh?: () => void;
}

interface ConstraintListItem {
  id: number;
  kind: 'parallel' | 'perpendicular' | 'collinear' | 'distance' | string;
  active: boolean;
  value?: number;
  refs: Array<{ edge?: [number, number]; vertex?: number }>;
}

const KIND_ICON: Record<string, string> = {
  parallel: '∥',
  perpendicular: '⊥',
  collinear: '—',
  distance: '↔',
};

const KIND_LABEL: Record<string, string> = {
  parallel: '평행',
  perpendicular: '수직',
  collinear: '동일 선상',
  distance: '거리',
};

export class ConstraintPanel {
  private container: HTMLElement;
  private bridge: WasmBridge;
  private callbacks: ConstraintPanelCallbacks;

  private panelEl: HTMLElement;
  private listEl: HTMLElement;
  private statusEl: HTMLElement;
  private visible = false;

  constructor(
    container: HTMLElement,
    bridge: WasmBridge,
    callbacks: ConstraintPanelCallbacks = {},
  ) {
    this.container = container;
    this.bridge = bridge;
    this.callbacks = callbacks;

    this.panelEl = document.createElement('div');
    this.panelEl.id = 'constraint-panel';
    this.panelEl.className = 'constraint-panel';
    this.panelEl.innerHTML = `
      <div class="cop-header">
        <span class="cop-title">구속 (Constraints)</span>
        <div class="cop-actions">
          <button class="cop-btn cop-btn-solve" title="모든 제약 재해결">⟳</button>
          <button class="cop-btn cop-btn-clear" title="모두 삭제">✕ ALL</button>
        </div>
      </div>
      <div class="cop-status"></div>
      <div class="cop-list"></div>
      <div class="cop-empty">제약이 없습니다</div>
    `;
    this.panelEl.style.display = 'none';
    container.appendChild(this.panelEl);

    this.listEl = this.panelEl.querySelector('.cop-list') as HTMLElement;
    this.statusEl = this.panelEl.querySelector('.cop-status') as HTMLElement;

    this.panelEl.querySelector('.cop-btn-solve')?.addEventListener('click', () => {
      this.solveAll();
    });
    this.panelEl.querySelector('.cop-btn-clear')?.addEventListener('click', () => {
      this.clearAll();
    });

    this.injectStyles();
  }

  /** 패널 열기 */
  show() {
    this.visible = true;
    this.panelEl.style.display = 'block';
    this.refresh();
  }

  /** 패널 닫기 */
  hide() {
    this.visible = false;
    this.panelEl.style.display = 'none';
  }

  /** 표시 토글 */
  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible(): boolean { return this.visible; }

  /** 제약 목록 재조회 + 렌더 */
  refresh() {
    const items = this.bridge.listConstraints() as ConstraintListItem[];
    this.renderList(items);
    this.updateStatus();
  }

  private renderList(items: ConstraintListItem[]) {
    this.listEl.innerHTML = '';
    const emptyEl = this.panelEl.querySelector('.cop-empty') as HTMLElement;
    if (!items || items.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    for (const c of items) {
      const row = document.createElement('div');
      row.className = 'cop-row' + (c.active ? '' : ' cop-inactive');
      row.dataset.id = String(c.id);

      const icon = KIND_ICON[c.kind] ?? '?';
      const label = KIND_LABEL[c.kind] ?? c.kind;
      const refSummary = this.formatRefs(c.refs, c.value);

      row.innerHTML = `
        <input type="checkbox" class="cop-active" ${c.active ? 'checked' : ''} title="활성/비활성">
        <span class="cop-icon">${icon}</span>
        <span class="cop-label">${label}</span>
        <span class="cop-refs">${refSummary}</span>
        <span class="cop-id">#${c.id}</span>
        <button class="cop-del" title="삭제">✕</button>
      `;

      row.querySelector<HTMLInputElement>('.cop-active')!.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        this.bridge.setConstraintActive(c.id, checked);
        // Solver가 이후 transform에서 활성 반영 — 즉시 해결 실행 옵션
        if (checked) {
          this.bridge.resolveAllConstraints?.();
          this.callbacks.syncMesh?.();
        }
        this.refresh();
      });

      row.querySelector('.cop-del')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.bridge.removeConstraint(c.id)) {
          Toast.info(`제약 #${c.id} 삭제됨`, 1500);
          this.refresh();
          this.callbacks.syncMesh?.();
        }
      });

      this.listEl.appendChild(row);
    }
  }

  private formatRefs(refs: ConstraintListItem['refs'], value?: number): string {
    const parts: string[] = [];
    for (const r of refs) {
      if (r.edge) parts.push(`E(v${r.edge[0]},v${r.edge[1]})`);
      else if (r.vertex !== undefined) parts.push(`V${r.vertex}`);
    }
    let text = parts.join(' ↔ ');
    if (value !== undefined) text += ` = ${value.toFixed(2)}`;
    return text;
  }

  private updateStatus() {
    const residual = this.bridge.maxConstraintResidual?.() ?? 0;
    const count = this.bridge.constraintCount?.() ?? 0;
    const satisfied = residual < 1e-4;
    this.statusEl.innerHTML = `
      <span class="cop-count">${count}개</span>
      <span class="cop-residual ${satisfied ? 'cop-ok' : 'cop-bad'}">
        residual: ${residual.toExponential(2)} ${satisfied ? '✓' : '⚠'}
      </span>
    `;
  }

  private solveAll() {
    const result = this.bridge.resolveConstraintsIterative?.(100, 1e-6);
    if (!result) {
      Toast.warning('제약 해결 API를 사용할 수 없습니다', 2000);
      return;
    }
    if (result.converged) {
      Toast.info(`수렴 완료 (${result.iterations} iter, residual=${result.finalResidual.toExponential(2)})`, 2500);
    } else if (result.overConstrained) {
      Toast.warning(`과제약 감지 — 수렴 실패 (residual=${result.finalResidual.toExponential(2)})`, 3500);
    } else {
      Toast.warning(`수렴 실패 (${result.iterations} iter)`, 2500);
    }
    this.callbacks.syncMesh?.();
    this.refresh();
  }

  private clearAll() {
    const items = this.bridge.listConstraints() as ConstraintListItem[];
    if (items.length === 0) return;
    if (!confirm(`${items.length}개 제약을 모두 삭제할까요?`)) return;
    for (const c of items) {
      this.bridge.removeConstraint(c.id);
    }
    Toast.info(`${items.length}개 제약 삭제됨`, 1800);
    this.refresh();
    this.callbacks.syncMesh?.();
  }

  private injectStyles() {
    if (document.getElementById('constraint-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'constraint-panel-styles';
    style.textContent = `
      .constraint-panel {
        position: fixed; right: 12px; top: 200px; width: 320px; max-height: 60vh;
        background: rgba(30, 30, 36, 0.92); color: #dcdde4;
        border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
        font-family: "Pretendard Variable", Pretendard, sans-serif; font-size: 12px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        z-index: 180; overflow: hidden;
        display: flex; flex-direction: column;
      }
      .cop-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 10px; background: rgba(0,0,0,0.3);
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .cop-title { font-weight: 500; font-size: 12px; letter-spacing: 0.3px; }
      .cop-actions { display: flex; gap: 4px; }
      .cop-btn {
        background: rgba(255,255,255,0.06); color: #ddd; border: 0; border-radius: 3px;
        padding: 3px 8px; cursor: pointer; font-size: 11px;
      }
      .cop-btn:hover { background: rgba(255,255,255,0.14); }
      .cop-btn-clear { color: #ff8a8a; }
      .cop-status {
        padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);
        display: flex; justify-content: space-between; font-size: 11px;
      }
      .cop-count { opacity: 0.75; }
      .cop-residual { font-family: monospace; }
      .cop-ok { color: #7be288; }
      .cop-bad { color: #ffb84a; }
      .cop-list { flex: 1; overflow-y: auto; }
      .cop-row {
        display: grid;
        grid-template-columns: 20px 20px 54px 1fr 40px 22px;
        gap: 6px; align-items: center;
        padding: 5px 10px; border-bottom: 1px solid rgba(255,255,255,0.04);
      }
      .cop-row:hover { background: rgba(255,255,255,0.04); }
      .cop-inactive { opacity: 0.45; }
      .cop-icon { font-size: 16px; text-align: center; color: #9ecbff; }
      .cop-label { color: #cfd3dc; }
      .cop-refs { font-family: monospace; font-size: 10px; color: #8b92a0;
                  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cop-id { opacity: 0.5; font-family: monospace; font-size: 10px; text-align: right; }
      .cop-del {
        background: transparent; border: 0; color: #ff6b6b; cursor: pointer;
        padding: 0; font-size: 13px;
      }
      .cop-del:hover { color: #ff4040; }
      .cop-empty {
        padding: 16px; text-align: center; opacity: 0.4; font-style: italic;
      }
    `;
    document.head.appendChild(style);
  }
}
