/**
 * CapabilityExplorerPanel — ADR-063 (Phase 1 Path Z) Step 3.
 *
 * Tree view of 95 actions grouped by Tier (0/1/2/3) with search filter.
 * Click an action row to expand its details (description, surfaces,
 * aliases, ADR refs).
 *
 * Per ADR-063 §D #1 lock-in: this is the ONE AND ONLY consumer of
 * `@axia/action-catalog` in `web/src/`.
 *
 * Step 3 scope:
 *   - Render Tier 0/1/2/3 groups with action counts
 *   - Search filter (case-insensitive: id / label / description)
 *   - Click action → expand details inline
 *
 * Step 4 will add: Tier 0 inline form + Tier 1/2 launcher.
 * Step 5 will add: Tier 3 hidden by default + "Show advanced" toggle.
 *
 * @see docs/adr/063-adr-046-phase-1-path-z-capability-explorer-pilot.md
 */

// ADR-063 §D #1 lock-in — single import site for ActionCatalog.
// Regression `capability_explorer_imports_only_capability_explorer_panel`
// asserts no other web/src/ file references `@axia/action-catalog`.
import { ALL_ACTIONS, CATALOG_SIZE, type ActionDef, type Tier } from '@axia/action-catalog';

const TIER_LABELS: Record<Tier, string> = {
  0: 'Tier 0 — Read',
  1: 'Tier 1 — Constructive',
  2: 'Tier 2 — Modificative',
  3: 'Tier 3 — Destructive',
};

const TIER_COLORS: Record<Tier, string> = {
  0: '#7ec8e3', // blue (read)
  1: '#90c878', // green (constructive)
  2: '#f0c060', // amber (modificative)
  3: '#e07878', // red (destructive)
};

/** ADR-063 Step 4 — Result of an action invocation. */
export interface ActionInvokeResult {
  ok: boolean;
  /** Stringified result (JSON / Float64Array summary / etc.). */
  result?: string;
  /** Human-readable error if `ok=false`. */
  error?: string;
}

export interface CapabilityExplorerPanelCallbacks {
  /** ADR-063 Step 4 — Dispatch an action by id with optional args.
   *  Returns the result string for inline display.
   *
   *  Consumer (main.ts) is responsible for:
   *    - Tier 0: invoke read-only WASM endpoint directly
   *    - Tier 1/2: launch existing UI tool OR call WASM with args
   *    - Tier 2/3: confirm dialog already happened in panel
   *    - Argument validation, parsing, error handling
   *  */
  onActionInvoke?: (actionId: string, args: Record<string, unknown>) => Promise<ActionInvokeResult> | ActionInvokeResult;
}

/** ADR-063 Step 4 — Argument schema hint per action.
 *  Maps action id → expected args. Used for inline form prompts.
 *  Best-effort heuristic; complex multi-arg endpoints (e.g., Tier 1
 *  attach-surface-*) display a "args required" hint rather than form. */
const ACTION_ARG_HINTS: Record<string, ReadonlyArray<{ name: string; kind: 'u32' | 'f64' | 'none' }>> = {
  // Tier 0 read endpoints — single ID arg.
  'edge-curve-info':       [{ name: 'edgeId', kind: 'u32' }],
  'face-surface-info':     [{ name: 'faceId', kind: 'u32' }],
  'face-normals-cached':   [{ name: 'faceId', kind: 'u32' }],
  'edge-polyline-cached':  [{ name: 'edgeId', kind: 'u32' }, { name: 'chordTol', kind: 'f64' }],
  // Tier 0 — no args.
  'cache-stats':           [],
  // Tier 2 — no args (state mutation, simple).
  'migrate-curve-surface': [],
  // Tier 2 fillet-dispatch — 3 args.
  'fillet-dispatch':       [{ name: 'edgeId', kind: 'u32' }, { name: 'radius', kind: 'f64' }, { name: 'segments', kind: 'u32' }],
};

export class CapabilityExplorerPanel {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private container: HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private callbacks: CapabilityExplorerPanelCallbacks;
  private panelEl: HTMLElement;
  private bodyEl: HTMLElement;
  private searchEl: HTMLInputElement;
  private visible = false;

  /** Search query (lowercased). Empty string = no filter. */
  private query = '';
  /** ID of the currently expanded action (for inline details). */
  private expandedId: string | null = null;
  /** ADR-063 §D #2 lock-in — Tier 3 hidden by default. Toggle persisted
   *  in localStorage. */
  private showAdvanced = false;

  /** localStorage key for the Tier 3 (advanced) visibility toggle.
   *  Persisted across sessions per §D #2. */
  private static readonly LS_KEY_SHOW_ADVANCED = 'axia.capabilityExplorer.showAdvanced';

  constructor(container: HTMLElement, callbacks: CapabilityExplorerPanelCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    // ADR-063 §D #2 — Read persisted "Show advanced" state.
    try {
      this.showAdvanced = localStorage.getItem(
        CapabilityExplorerPanel.LS_KEY_SHOW_ADVANCED,
      ) === '1';
    } catch {
      // localStorage 접근 실패 (private mode 등) — default false.
      this.showAdvanced = false;
    }

    this.panelEl = document.createElement('div');
    this.panelEl.id = 'capability-explorer';
    this.panelEl.className = 'capability-explorer';
    this.panelEl.innerHTML = `
      <div class="cep-header">
        <span class="cep-title">🧭 Capability Explorer</span>
        <span class="cep-meta" data-role="meta">${CATALOG_SIZE} actions</span>
      </div>
      <div class="cep-search">
        <input class="cep-search-input" type="text" placeholder="검색 (id / label / description)" data-role="search" />
      </div>
      <div class="cep-toolbar">
        <label class="cep-toggle-advanced">
          <input type="checkbox" data-role="toggle-advanced" ${this.showAdvanced ? 'checked' : ''} />
          <span>Show advanced (Tier 3 destructive)</span>
        </label>
      </div>
      <div class="cep-body" data-role="body"></div>
    `;
    this.panelEl.style.display = 'none';
    container.appendChild(this.panelEl);

    this.bodyEl = this.panelEl.querySelector('[data-role="body"]') as HTMLElement;
    this.searchEl = this.panelEl.querySelector('[data-role="search"]') as HTMLInputElement;

    this.searchEl.addEventListener('input', () => {
      this.query = this.searchEl.value.trim().toLowerCase();
      this.renderTree();
    });

    const toggleEl = this.panelEl.querySelector('[data-role="toggle-advanced"]') as HTMLInputElement;
    toggleEl.addEventListener('change', () => {
      this.showAdvanced = toggleEl.checked;
      try {
        localStorage.setItem(
          CapabilityExplorerPanel.LS_KEY_SHOW_ADVANCED,
          this.showAdvanced ? '1' : '0',
        );
      } catch {
        // localStorage write 실패 — silent.
      }
      this.renderTree();
    });

    this.injectStyles();
    this.renderTree();
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

  /** ADR-063 Step 2 — exposes catalog size for telemetry. */
  static getCatalogSize(): number {
    return CATALOG_SIZE;
  }

  /** ADR-063 Step 2 — exposes the underlying catalog. Internal-only;
   *  external callers must NOT import `@axia/action-catalog` directly
   *  (§D #1 lock-in). */
  static getAllActions(): typeof ALL_ACTIONS {
    return ALL_ACTIONS;
  }

  /** ADR-063 Step 3 — apply current search filter and return matching
   *  actions. Exposed for tests + future Step 4 usage. */
  filterActions(query: string = this.query): readonly ActionDef[] {
    if (!query) return ALL_ACTIONS;
    const q = query.toLowerCase();
    return ALL_ACTIONS.filter((a) =>
      a.id.toLowerCase().includes(q)
      || a.label.toLowerCase().includes(q)
      || a.description.toLowerCase().includes(q)
    );
  }

  private renderTree(): void {
    const filtered = this.filterActions();
    this.bodyEl.innerHTML = '';

    // Update meta count.
    const metaEl = this.panelEl.querySelector('[data-role="meta"]');
    if (metaEl) {
      const total = CATALOG_SIZE;
      metaEl.textContent = filtered.length === total
        ? `${total} actions`
        : `${filtered.length} / ${total} actions`;
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cep-empty';
      empty.textContent = '검색 결과가 없습니다.';
      this.bodyEl.appendChild(empty);
      return;
    }

    // Group by tier.
    const byTier = new Map<Tier, ActionDef[]>();
    for (const a of filtered) {
      const arr = byTier.get(a.tier) ?? [];
      arr.push(a);
      byTier.set(a.tier, arr);
    }

    // Render tiers in order 0 → 3.
    // ADR-063 §D #2 lock-in — Tier 3 (destructive) hidden unless
    // `showAdvanced` toggle is on.
    for (const tier of [0, 1, 2, 3] as Tier[]) {
      if (tier === 3 && !this.showAdvanced) continue;
      const acts = byTier.get(tier);
      if (!acts || acts.length === 0) continue;
      this.bodyEl.appendChild(this.buildTierGroup(tier, acts));
    }
  }

  /** ADR-063 §D #2 — Test/telemetry accessor for Tier 3 visibility state. */
  isAdvancedVisible(): boolean {
    return this.showAdvanced;
  }

  private buildTierGroup(tier: Tier, actions: ActionDef[]): HTMLElement {
    const group = document.createElement('div');
    group.className = 'cep-tier-group';
    group.dataset.tier = String(tier);

    const header = document.createElement('div');
    header.className = 'cep-tier-header';
    header.innerHTML = `
      <span class="cep-tier-dot" style="background:${TIER_COLORS[tier]}"></span>
      <span class="cep-tier-label">${TIER_LABELS[tier]}</span>
      <span class="cep-tier-count">(${actions.length})</span>
    `;
    group.appendChild(header);

    const list = document.createElement('div');
    list.className = 'cep-tier-list';
    for (const a of actions) {
      list.appendChild(this.buildActionRow(a));
    }
    group.appendChild(list);

    return group;
  }

  private buildActionRow(action: ActionDef): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cep-action-row';
    row.dataset.actionId = action.id;
    if (action.status && action.status !== 'ok') {
      row.dataset.status = action.status;
    }

    const head = document.createElement('div');
    head.className = 'cep-action-head';
    head.innerHTML = `
      <span class="cep-action-id">${this.escape(action.id)}</span>
      <span class="cep-action-label">${this.escape(action.label)}</span>
    `;
    if (action.status && action.status !== 'ok') {
      const badge = document.createElement('span');
      badge.className = 'cep-action-status';
      badge.textContent = action.status;
      head.appendChild(badge);
    }
    head.addEventListener('click', () => {
      this.expandedId = this.expandedId === action.id ? null : action.id;
      this.renderTree();
    });
    row.appendChild(head);

    if (this.expandedId === action.id) {
      row.appendChild(this.buildActionDetails(action));
    }

    return row;
  }

  private buildActionDetails(action: ActionDef): HTMLElement {
    const details = document.createElement('div');
    details.className = 'cep-action-details';
    const aliasParts: string[] = [];
    if (action.aliases.bridge) aliasParts.push(`<b>bridge</b>: ${this.escape(action.aliases.bridge)}`);
    if (action.aliases.wasm) aliasParts.push(`<b>wasm</b>: ${this.escape(action.aliases.wasm)}`);
    if (action.aliases.mcp) aliasParts.push(`<b>mcp</b>: ${this.escape(action.aliases.mcp)}`);
    if (action.aliases.legacy && action.aliases.legacy.length > 0) {
      aliasParts.push(`<b>legacy</b>: ${action.aliases.legacy.map((l) => this.escape(l)).join(', ')}`);
    }
    const surfacesText = action.surfaces.join(', ');
    const adrsText = (action.adrs ?? []).join(', ');

    details.innerHTML = `
      <div class="cep-details-desc">${this.escape(action.description)}</div>
      <div class="cep-details-row"><b>Surfaces:</b> ${this.escape(surfacesText)}</div>
      ${aliasParts.length > 0 ? `<div class="cep-details-row">${aliasParts.join(' · ')}</div>` : ''}
      ${adrsText ? `<div class="cep-details-row"><b>ADRs:</b> ${this.escape(adrsText)}</div>` : ''}
    `;

    // ADR-063 Step 4 — invocation form (Tier 0) or launcher (Tier 1/2/3).
    details.appendChild(this.buildActionForm(action));
    return details;
  }

  /** ADR-063 Step 4 — Build inline argument form + Run / Launch button.
   *
   *  Behavior matrix:
   *    - Tier 0, args known: argument inputs + "Run" button (read-only, no confirm)
   *    - Tier 0, args unknown / multi-arg: "args required" hint
   *    - Tier 1/2: "Launch" button. Tier 2 prompts confirm() before invoking.
   *    - Tier 3: "Launch (advanced)" button + confirm. Step 5 will gate
   *      this behind a global "Show advanced" toggle.
   */
  private buildActionForm(action: ActionDef): HTMLElement {
    const form = document.createElement('div');
    form.className = 'cep-action-form';

    const hint = ACTION_ARG_HINTS[action.id];
    const knownArgs = hint !== undefined;

    // Argument inputs.
    const inputs: HTMLInputElement[] = [];
    if (knownArgs && hint!.length > 0) {
      const argsRow = document.createElement('div');
      argsRow.className = 'cep-form-args';
      for (const arg of hint!) {
        const wrap = document.createElement('label');
        wrap.className = 'cep-form-arg';
        wrap.innerHTML = `<span class="cep-form-arg-label">${arg.name} <em>(${arg.kind})</em></span>`;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cep-form-arg-input';
        input.dataset.argName = arg.name;
        input.dataset.argKind = arg.kind;
        input.placeholder = arg.kind === 'u32' ? '0' : '0.0';
        wrap.appendChild(input);
        argsRow.appendChild(wrap);
        inputs.push(input);
      }
      form.appendChild(argsRow);
    } else if (!knownArgs) {
      // Complex multi-arg endpoint (Tier 1 attach-surface-*-validated).
      const note = document.createElement('div');
      note.className = 'cep-form-note';
      note.textContent =
        action.tier >= 1 && action.aliases.bridge
          ? '기존 UI 도구로 실행 (Launch 버튼 사용).'
          : '복합 인자가 필요합니다. 코드 / MCP 호출 권장. (Capability Explorer pilot 외)';
      form.appendChild(note);
    }

    // Action button.
    const btn = document.createElement('button');
    btn.className = 'cep-form-btn';
    btn.dataset.tier = String(action.tier);
    btn.textContent = action.tier === 0 ? 'Run' : 'Launch';
    if (action.tier >= 2) btn.textContent += ' (변경)';
    if (action.tier === 3) btn.textContent = 'Launch (advanced)';
    btn.addEventListener('click', () => this.handleInvoke(action, inputs));
    form.appendChild(btn);

    // Result display area.
    const resultEl = document.createElement('pre');
    resultEl.className = 'cep-form-result';
    resultEl.style.display = 'none';
    form.appendChild(resultEl);

    return form;
  }

  /** ADR-063 Step 4 — Parse args + invoke action via callback.
   *  Tier ≥ 2 triggers a `confirm()` dialog (lock-in §D #3). */
  private async handleInvoke(action: ActionDef, inputs: HTMLInputElement[]): Promise<void> {
    // Tier 2/3 confirmation (lock-in §D #3 — explicit user consent).
    if (action.tier >= 2) {
      const tierName = action.tier === 3 ? 'Tier 3 (DESTRUCTIVE)' : 'Tier 2 (modificative)';
      const ok = window.confirm(
        `${tierName} 작업: ${action.label}\n\n${action.description}\n\n실행하시겠습니까?`,
      );
      if (!ok) return;
    }

    // Parse args from inputs.
    const args: Record<string, unknown> = {};
    for (const input of inputs) {
      const name = input.dataset.argName!;
      const kind = input.dataset.argKind!;
      const raw = input.value.trim();
      if (raw === '') {
        // Default zero.
        args[name] = kind === 'u32' ? 0 : 0.0;
        continue;
      }
      if (kind === 'u32') {
        const n = parseInt(raw, 10);
        if (Number.isNaN(n) || n < 0) {
          this.showResult(action.id, { ok: false, error: `${name}: invalid u32 "${raw}"` });
          return;
        }
        args[name] = n;
      } else {
        const n = parseFloat(raw);
        if (Number.isNaN(n)) {
          this.showResult(action.id, { ok: false, error: `${name}: invalid f64 "${raw}"` });
          return;
        }
        args[name] = n;
      }
    }

    // Dispatch via callback.
    if (!this.callbacks.onActionInvoke) {
      this.showResult(action.id, {
        ok: false,
        error: 'onActionInvoke 콜백이 등록되지 않았습니다 (main.ts wire 필요).',
      });
      return;
    }
    try {
      const result = await this.callbacks.onActionInvoke(action.id, args);
      this.showResult(action.id, result);
    } catch (e) {
      this.showResult(action.id, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Show result/error in the inline result element of the expanded
   *  action's form. */
  private showResult(actionId: string, result: ActionInvokeResult): void {
    const row = this.panelEl.querySelector(`.cep-action-row[data-action-id="${actionId}"]`);
    if (!row) return;
    const resultEl = row.querySelector('.cep-form-result') as HTMLElement | null;
    if (!resultEl) return;
    resultEl.style.display = 'block';
    if (result.ok) {
      resultEl.classList.remove('cep-result-err');
      resultEl.classList.add('cep-result-ok');
      resultEl.textContent = result.result ?? '(no result)';
    } else {
      resultEl.classList.remove('cep-result-ok');
      resultEl.classList.add('cep-result-err');
      resultEl.textContent = `Error: ${result.error ?? 'unknown'}`;
    }
  }

  private escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
        width: 420px;
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
      .capability-explorer .cep-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        border-bottom: 1px solid #444;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 6px 6px 0 0;
      }
      .capability-explorer .cep-title { font-weight: 600; font-size: 13px; }
      .capability-explorer .cep-meta {
        font-size: 11px;
        color: #aaa;
        font-variant-numeric: tabular-nums;
      }
      .capability-explorer .cep-search {
        padding: 6px 12px;
        border-bottom: 1px solid #333;
      }
      .capability-explorer .cep-search-input {
        width: 100%;
        background: rgba(0, 0, 0, 0.4);
        color: #e8e8e8;
        border: 1px solid #555;
        border-radius: 3px;
        padding: 4px 8px;
        font-family: inherit;
        font-size: 12px;
        outline: none;
      }
      .capability-explorer .cep-search-input:focus {
        border-color: #7ec8e3;
      }
      .capability-explorer .cep-toolbar {
        padding: 4px 12px;
        border-bottom: 1px solid #333;
      }
      .capability-explorer .cep-toggle-advanced {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: #aaa;
        cursor: pointer;
        user-select: none;
      }
      .capability-explorer .cep-toggle-advanced input[type="checkbox"] {
        accent-color: #e07878;
        cursor: pointer;
      }
      .capability-explorer .cep-toggle-advanced:hover { color: #ccc; }
      .capability-explorer .cep-body {
        flex: 1;
        overflow-y: auto;
        padding: 4px 0;
      }
      .capability-explorer .cep-empty {
        padding: 24px 12px;
        text-align: center;
        color: #888;
        font-style: italic;
      }
      .capability-explorer .cep-tier-group { margin-bottom: 8px; }
      .capability-explorer .cep-tier-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: rgba(255, 255, 255, 0.03);
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .capability-explorer .cep-tier-dot {
        display: inline-block;
        width: 8px; height: 8px;
        border-radius: 50%;
      }
      .capability-explorer .cep-tier-count { color: #aaa; font-weight: 400; }
      .capability-explorer .cep-tier-list { padding: 2px 0; }
      .capability-explorer .cep-action-row {
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      }
      .capability-explorer .cep-action-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 12px 4px 24px;
        cursor: pointer;
        user-select: none;
      }
      .capability-explorer .cep-action-head:hover {
        background: rgba(255, 255, 255, 0.05);
      }
      .capability-explorer .cep-action-id {
        font-family: ui-monospace, monospace;
        color: #88c8a8;
        flex-shrink: 0;
      }
      .capability-explorer .cep-action-label {
        flex: 1;
        color: #cccccc;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .capability-explorer .cep-action-status {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 9px;
        background: #555;
        color: #ddd;
      }
      .capability-explorer .cep-action-row[data-status="stub"] .cep-action-status {
        background: #c87856;
      }
      .capability-explorer .cep-action-details {
        padding: 8px 12px 10px 24px;
        background: rgba(0, 0, 0, 0.25);
        font-size: 11px;
        line-height: 1.5;
      }
      .capability-explorer .cep-details-desc {
        color: #ddd;
        margin-bottom: 6px;
      }
      .capability-explorer .cep-details-row {
        color: #aaa;
        margin-top: 2px;
      }
      .capability-explorer .cep-details-row b {
        color: #ccc;
        font-weight: 600;
      }
      .capability-explorer .cep-details-hint {
        margin-top: 6px;
        color: #888;
        font-style: italic;
        font-size: 10px;
      }
      .capability-explorer .cep-action-form {
        margin-top: 8px;
        padding: 8px;
        background: rgba(255, 255, 255, 0.03);
        border-radius: 4px;
      }
      .capability-explorer .cep-form-args {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 6px;
      }
      .capability-explorer .cep-form-arg {
        display: flex;
        flex-direction: column;
        font-size: 10px;
        color: #aaa;
      }
      .capability-explorer .cep-form-arg-label em {
        color: #7ec8e3;
        font-style: normal;
        font-size: 9px;
      }
      .capability-explorer .cep-form-arg-input {
        width: 100px;
        background: rgba(0, 0, 0, 0.4);
        color: #e8e8e8;
        border: 1px solid #555;
        border-radius: 3px;
        padding: 3px 6px;
        font-family: ui-monospace, monospace;
        font-size: 11px;
        outline: none;
      }
      .capability-explorer .cep-form-arg-input:focus {
        border-color: #7ec8e3;
      }
      .capability-explorer .cep-form-note {
        font-size: 10px;
        color: #aaa;
        font-style: italic;
        margin-bottom: 6px;
      }
      .capability-explorer .cep-form-btn {
        background: #2a5870;
        color: #e8e8e8;
        border: 1px solid #4080a0;
        border-radius: 3px;
        padding: 4px 12px;
        cursor: pointer;
        font-size: 11px;
      }
      .capability-explorer .cep-form-btn:hover {
        background: #3070a0;
      }
      .capability-explorer .cep-form-btn[data-tier="2"] {
        background: #785038;
        border-color: #a06848;
      }
      .capability-explorer .cep-form-btn[data-tier="2"]:hover {
        background: #905848;
      }
      .capability-explorer .cep-form-btn[data-tier="3"] {
        background: #783030;
        border-color: #a04848;
      }
      .capability-explorer .cep-form-btn[data-tier="3"]:hover {
        background: #904040;
      }
      .capability-explorer .cep-form-result {
        margin-top: 6px;
        padding: 6px 8px;
        background: rgba(0, 0, 0, 0.4);
        border-radius: 3px;
        font-family: ui-monospace, monospace;
        font-size: 10px;
        line-height: 1.4;
        max-height: 180px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-all;
      }
      .capability-explorer .cep-form-result.cep-result-ok {
        color: #a8d890;
        border-left: 3px solid #6a9858;
      }
      .capability-explorer .cep-form-result.cep-result-err {
        color: #e0a8a8;
        border-left: 3px solid #985858;
      }
    `;
    document.head.appendChild(style);
  }
}
