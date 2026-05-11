// ADR-045 D1 — ActionCatalog SSOT types.
//
// Single source of truth for action identity across UI / Bridge / WASM
// / MCP. Every action has ONE canonical id (UI kebab-case) and an
// alias map for the other surfaces.

/**
 * Tier classification — matches ADR-041 P26.1 capability tiers.
 *   0 = read-only (always-on)
 *   1 = constructive (default-on)
 *   2 = modificative (opt-in)
 *   3 = destructive (Debug-only, ADR-045 D5)
 */
export type Tier = 0 | 1 | 2 | 3;

/**
 * UI surfaces that may dispatch an action. Matches Phase 1 audit
 * Layer 4 inventory.
 */
export type Surface =
  | 'menu'
  | 'keyboard'
  | 'context'
  | 'palette'
  | 'mcp'
  | 'context-only'
  | 'inline-tool';

/**
 * Aliases: alternate names for the same operation across layers.
 * - `bridge`: TypeScript WasmBridge method (camelCase)
 * - `wasm`: WASM export name (snake_case or wasm-bindgen js_name)
 * - `mcp`: MCP capability id (snake_case + semantic suffix)
 * - `legacy`: deprecated former IDs (sunset-tracked, console warn)
 */
export interface ActionAliases {
  bridge?: string;
  wasm?: string;
  mcp?: string;
  legacy?: readonly string[];
}

/**
 * Single action definition. The catalog is a `Map<id, ActionDef>`.
 */
export interface ActionDef {
  /** Canonical id — UI kebab-case (e.g. "tool-pushpull", "fillet-edge"). */
  id: string;
  /** Human-readable display label (i18n-able via future enhancement). */
  label: string;
  /** One-sentence description, useful for Capability Explorer + tooltips. */
  description: string;
  /** Tier classification. */
  tier: Tier;
  /** Surfaces that expose this action. */
  surfaces: readonly Surface[];
  /** Cross-layer aliases. */
  aliases: ActionAliases;
  /**
   * Status from integrity audit. Defaults to "ok" if omitted.
   * - "ok": fully wired with direct bridge/wasm aliases
   * - "stub": menu shows but tool/handler unregistered (Toast warning)
   * - "placeholder": intentionally disabled (e.g. export-step Stage 5)
   * - "scaffold": Stage 4-A scaffolding only (e.g. import-step)
   * - "redirect": menu redirects to a different panel (e.g. view-materials)
   * - "ui-only": UI state, no engine call
   * - "delegated": wired via a higher-level TS handler module (e.g.
   *   ConstraintCommands, MergeActions) that internally calls multiple
   *   bridge methods. The catalog does not enumerate the internal
   *   bridge calls — those handler modules are the SSOT for that detail.
   */
  status?: 'ok' | 'stub' | 'placeholder' | 'scaffold' | 'redirect' | 'ui-only' | 'delegated';
  /** ADR references that govern this action's invariants. */
  adrs?: readonly string[];
}

/**
 * Possible denial reason when looking up an action by an unknown id /
 * legacy id / wrong vocabulary. The catalog's `lookup()` returns a
 * tagged result so callers can distinguish "not found" from "found
 * via legacy alias" (which deserves a deprecation warning).
 */
export type LookupResult =
  | { kind: 'found'; def: ActionDef; via: 'canonical' | 'bridge' | 'wasm' | 'mcp' }
  | { kind: 'found-legacy'; def: ActionDef; legacy_alias: string }
  | { kind: 'not-found'; query: string };
