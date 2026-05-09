/**
 * AssetLibraryPanel — ADR-098 S-δ.
 *
 * 3-Tier 자산 라이브러리 UI (System / Project / User).
 * ComponentPanel (그룹 outliner) 답습 패턴 — DOM 직접 구성, optional
 * stylesheet 주입, refresh-on-demand.
 *
 * Lock-ins applied:
 * - S-F UI 진입점 — 신규 panel + Inspector dropdown 확장 (별도 모듈)
 * - S-G Material 삭제 — User tier 만 (System/Project 거부 surface)
 * - ADR-046 P31 #4 — additive only (메뉴 추가만, 기존 UI UNCHANGED)
 * - ADR-091 §E L4 — UI orchestration helper 분리 (panel = pure view,
 *   bridge calls 직접 위임)
 *
 * Out of scope (별도 sub-step / ADR):
 * - User tier 활성 토글 (S-ε Settings flag)
 * - Material drag-drop / reorder (별도 ADR)
 * - Texture upload (TextureUploadDialog 기존 자산 활용)
 * - Project ↔ User 이동 (현재는 add 만; move 는 future)
 */

import type { WasmBridge, ScopedMaterialInfo, MaterialTier } from '../bridge/WasmBridge';
import { Toast } from './Toast';

export interface AssetLibraryPanelCallbacks {
  /** 재질 추가/삭제 후 host 가 후속 동작 (Inspector refresh 등). */
  onChange?: () => void;
  /** 재질 클릭 시 (e.g. 적용 대상 face 가 있으면 host 가 처리). */
  onMaterialClick?: (info: ScopedMaterialInfo) => void;
}

const TIER_LABEL: Record<MaterialTier, string> = {
  System: '시스템',
  Project: '프로젝트',
  User: '사용자',
};

export class AssetLibraryPanel {
  private container: HTMLElement;
  private bridge: WasmBridge;
  private callbacks: AssetLibraryPanelCallbacks;
  private panelEl: HTMLElement;
  private listEl: HTMLElement;
  private visible = false;

  constructor(
    container: HTMLElement,
    bridge: WasmBridge,
    callbacks: AssetLibraryPanelCallbacks = {},
  ) {
    this.container = container;
    this.bridge = bridge;
    this.callbacks = callbacks;

    this.panelEl = document.createElement('div');
    this.panelEl.id = 'asset-library-panel';
    this.panelEl.className = 'al-panel';
    this.panelEl.innerHTML = `
      <div class="al-header">
        <span class="al-title">자산 라이브러리</span>
        <div class="al-actions">
          <button class="al-btn al-btn-add-project" title="프로젝트 재질 추가">+ 프로젝트</button>
          <button class="al-btn al-btn-add-user" title="사용자 재질 추가">+ 사용자</button>
          <button class="al-btn al-btn-refresh" title="새로고침">⟳</button>
        </div>
      </div>
      <div class="al-list"></div>
    `;
    this.panelEl.style.display = 'none';
    this.container.appendChild(this.panelEl);
    this.listEl = this.panelEl.querySelector('.al-list') as HTMLElement;

    this.panelEl.querySelector('.al-btn-add-project')?.addEventListener('click', () => {
      this.handleAdd('Project');
    });
    this.panelEl.querySelector('.al-btn-add-user')?.addEventListener('click', () => {
      this.handleAdd('User');
    });
    this.panelEl.querySelector('.al-btn-refresh')?.addEventListener('click', () => {
      this.refresh();
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

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Re-fetch all 3 tiers from bridge and re-render. Idempotent.
   */
  refresh(): void {
    const tiers: MaterialTier[] = ['System', 'Project', 'User'];
    this.listEl.innerHTML = '';

    for (const tier of tiers) {
      const mats = this.bridge.listMaterialsByTier(tier);

      const section = document.createElement('div');
      section.className = `al-section al-section-${tier.toLowerCase()}`;
      section.setAttribute('data-tier', tier);

      const heading = document.createElement('div');
      heading.className = 'al-section-heading';
      heading.textContent = `${TIER_LABEL[tier]} (${mats.length})`;
      section.appendChild(heading);

      if (mats.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'al-empty';
        empty.textContent = '비어 있음';
        section.appendChild(empty);
      } else {
        for (const mat of mats) {
          section.appendChild(this.renderMaterial(mat));
        }
      }

      this.listEl.appendChild(section);
    }
  }

  private renderMaterial(info: ScopedMaterialInfo): HTMLElement {
    const row = document.createElement('div');
    row.className = 'al-row';
    row.setAttribute('data-id', String(info.id));
    row.setAttribute('data-tier', info.tier);

    const swatch = document.createElement('span');
    swatch.className = 'al-swatch';
    swatch.style.background = info.color;
    row.appendChild(swatch);

    const label = document.createElement('span');
    label.className = 'al-label';
    label.textContent = info.name;
    label.title = `${info.nameEn} · id ${info.id}`;
    row.appendChild(label);

    // Removal button — User tier only (S-G).
    if (info.tier === 'User') {
      const btn = document.createElement('button');
      btn.className = 'al-btn al-btn-remove';
      btn.textContent = '✕';
      btn.title = '사용자 재질 제거';
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.handleRemove(info);
      });
      row.appendChild(btn);
    }

    row.addEventListener('click', () => {
      this.callbacks.onMaterialClick?.(info);
    });

    return row;
  }

  private handleAdd(tier: 'Project' | 'User'): void {
    const name = window.prompt(
      `${TIER_LABEL[tier]} 재질 이름`,
      tier === 'Project' ? '프로젝트 재질' : '사용자 재질',
    );
    if (!name) return;
    const colorHex = window.prompt('색상 (hex, 예: #b08040)', '#888888');
    if (!colorHex) return;
    const color = parseHexColor(colorHex);
    if (color === null) {
      Toast.error('잘못된 색상 형식입니다.');
      return;
    }
    const id = tier === 'Project'
      ? this.bridge.addProjectMaterial(name, name, color)
      : this.bridge.addUserMaterial(name, name, color);
    if (id === null) {
      Toast.error('재질 추가 실패 — bridge 미준비');
      return;
    }
    Toast.success(`${TIER_LABEL[tier]} 재질 "${name}" 추가됨`);
    this.refresh();
    this.callbacks.onChange?.();
  }

  private handleRemove(info: ScopedMaterialInfo): void {
    if (!window.confirm(`사용자 재질 "${info.name}" 을 제거하시겠습니까?`)) return;
    const ok = this.bridge.removeUserMaterial(info.id);
    if (!ok) {
      Toast.error('재질 제거 실패 (사용 중이거나 다른 tier).');
      return;
    }
    Toast.success(`재질 "${info.name}" 제거됨`);
    this.refresh();
    this.callbacks.onChange?.();
  }

  private injectStyles(): void {
    if (document.getElementById('al-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'al-panel-styles';
    style.textContent = `
.al-panel {
  background: #1f2030; color: #e8e8ec; padding: 8px 10px;
  border-radius: 4px; font-family: system-ui, sans-serif; font-size: 12px;
  min-width: 240px; max-width: 320px;
}
.al-header { display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 6px; border-bottom: 1px solid #3a3b4a; margin-bottom: 6px; }
.al-title { font-weight: 600; }
.al-actions { display: flex; gap: 4px; }
.al-btn { background: #3a3b4a; color: #e8e8ec; border: none; padding: 3px 8px;
  border-radius: 3px; cursor: pointer; font-size: 11px; }
.al-btn:hover { background: #4a4b5a; }
.al-btn-remove { padding: 1px 6px; margin-left: auto; background: transparent; color: #888; }
.al-btn-remove:hover { background: #5a3030; color: #fff; }
.al-section { margin-bottom: 8px; }
.al-section-heading { font-weight: 500; color: #aaa; padding: 2px 0; font-size: 11px; }
.al-empty { color: #666; font-style: italic; padding: 2px 8px; }
.al-row { display: flex; align-items: center; gap: 6px; padding: 3px 6px;
  cursor: pointer; border-radius: 3px; }
.al-row:hover { background: #2a2b3a; }
.al-swatch { width: 14px; height: 14px; border-radius: 2px; border: 1px solid #555; flex: none; }
.al-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    `;
    document.head.appendChild(style);
  }

  /** Test surface — exposes panel root for assertions. */
  getPanelElement(): HTMLElement {
    return this.panelEl;
  }
}

/**
 * Parse "#rrggbb" or "rrggbb" or "#rgb" to a u32 color. Returns null on
 * invalid input.
 */
function parseHexColor(input: string): number | null {
  const s = input.trim().replace(/^#/, '');
  if (s.length === 3) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return (r << 16) | (g << 8) | b;
  }
  if (s.length === 6) {
    const v = parseInt(s, 16);
    if (Number.isNaN(v)) return null;
    return v;
  }
  return null;
}
