/**
 * CapabilityExplorerPanel — ADR-063 (Phase 1 Path Z) Step 2 scaffold.
 *
 * Single source of truth for ActionCatalog visibility in the AxiA UI.
 * Per ADR-063 §D #1 lock-in: this is the ONE AND ONLY consumer of
 * `@axia/action-catalog` in `web/src/`. Other dispatch sites (379
 * scattered case statements) must NOT import the catalog package.
 *
 * Step 2 scope: empty panel scaffold.
 *   - Panel id: 'capability-explorer'
 *   - DraggablePanelManager-compatible (HistoryPanel pattern mirror)
 *   - Toggle via menu item (not keyboard shortcut — deferred to Step 5)
 *   - Catalog import lives here so future regressions can grep for
 *     this single import site.
 *
 * Step 3+ will populate:
 *   - 95 actions tree view (Tier-grouped)
 *   - Search filter
 *   - Tier 0 inline form / Tier 1-2 launcher
 *   - Tier 3 hidden by default + "Show advanced" toggle
 *
 * @see docs/adr/063-adr-046-phase-1-path-z-capability-explorer-pilot.md
 */

// ADR-063 §D #1 lock-in — single import site for ActionCatalog.
// Regression `capability_explorer_imports_only_capability_explorer_panel`
// asserts no other web/src/ file references `@axia/action-catalog`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ALL_ACTIONS, CATALOG_SIZE } from '@axia/action-catalog';

export interface CapabilityExplorerPanelCallbacks {
  /** Future: dispatch a Tier 0/1/2 action (Step 4). Step 2 scaffold
   *  does not invoke any actions yet. */
  onActionInvoke?: (actionId: string) => void;
}

export class CapabilityExplorerPanel {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private container: HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private callbacks: CapabilityExplorerPanelCallbacks;
  private panelEl: HTMLElement;
  private visible = false;

  constructor(container: HTMLElement, callbacks: CapabilityExplorerPanelCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    this.panelEl = document.createElement('div');
    this.panelEl.id = 'capability-explorer';
    this.panelEl.className = 'capability-explorer';
    this.panelEl.innerHTML = `
      <div class="cep-header">
        <span class="cep-title">🧭 Capability Explorer</span>
        <span class="cep-meta">${CATALOG_SIZE} actions</span>
      </div>
      <div class="cep-hint">
        ActionCatalog 의 모든 작업을 한곳에서 발견하고 호출할 수 있습니다.
        <br>
        <em>Step 2 scaffold — 작업 트리는 Step 3 부터 표시됩니다.</em>
      </div>
      <div class="cep-body">
        <div class="cep-placeholder">
          (Step 3: ${CATALOG_SIZE} actions Tier 별 그룹 + 검색 필터 추가 예정)
        </div>
      </div>
    `;
    this.panelEl.style.display = 'none';
    container.appendChild(this.panelEl);

    this.injectStyles();
  }

  show(): void {
    this.visible = true;
    this.panelEl.style.display = 'block';
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

  /** ADR-063 Step 2 — exposes catalog size for telemetry / Capability
   *  Explorer Tier 0 inline read (Step 3+ will use this surface). */
  static getCatalogSize(): number {
    return CATALOG_SIZE;
  }

  /** ADR-063 Step 2 — exposes the underlying catalog. Internal-only;
   *  external callers must NOT import `@axia/action-catalog` directly
   *  (§D #1 lock-in). Step 3+ tree view will iterate this. */
  static getAllActions(): typeof ALL_ACTIONS {
    return ALL_ACTIONS;
  }

  private injectStyles(): void {
    const styleId = 'capability-explorer-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .capability-explorer {
        position: fixed;
        top: 60px;
        right: 16px;
        width: 380px;
        max-height: 60vh;
        background: rgba(28, 28, 32, 0.96);
        color: #e8e8e8;
        border: 1px solid #444;
        border-radius: 6px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
        font-family: -apple-system, system-ui, sans-serif;
        font-size: 13px;
        z-index: 1000;
        display: flex;
        flex-direction: column;
      }
      .capability-explorer .cep-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        border-bottom: 1px solid #444;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 6px 6px 0 0;
      }
      .capability-explorer .cep-title {
        font-weight: 600;
      }
      .capability-explorer .cep-meta {
        font-size: 11px;
        color: #aaa;
        font-variant-numeric: tabular-nums;
      }
      .capability-explorer .cep-hint {
        padding: 8px 12px;
        font-size: 11px;
        color: #aaa;
        border-bottom: 1px solid #333;
        line-height: 1.5;
      }
      .capability-explorer .cep-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }
      .capability-explorer .cep-placeholder {
        color: #888;
        font-style: italic;
        text-align: center;
        padding: 24px 0;
      }
    `;
    document.head.appendChild(style);
  }
}
