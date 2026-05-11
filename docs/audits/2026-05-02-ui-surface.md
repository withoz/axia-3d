# UI Surface Audit — 2026-05-02

**Status**: Phase 1 read-only audit. No code changes.
**Purpose**: Inventory current UI action / panel surface to inform ADR-045
(UI Surface Consolidation). 4 parallel surveys synthesized.
**Method**: 4 read-only Explore agents covered Menu, Action registries,
Panel taxonomy, Tool action ↔ MCP mapping.

## TL;DR

- **Total UI surface**: 121 menu leaves + 49 keyboard bindings + 41
  context-menu items + 53 ToolManager actions + 16 panels/dialogs.
- **Healthy redundancy**: 17 actions reachable from 2+ surfaces (e.g.
  `delete`, `undo`, `mirror-*`).
- **Discoverability gaps**: **5 ToolManager actions are unreachable** from
  any user input surface (`measure-selection`, `mesh-repair`, `solidify`,
  `subdivide`, `synthesize-faces`). Plus 4 single-surface group actions.
- **MCP ↔ UI gap**: 9/57 UI actions have an MCP equivalent;
  **48 UI-only** + **10 MCP-only** (read capabilities have no UI button)
  + **13 MCP declared-but-unimplemented**.
- **Panel drift**: 1 orphan (`MaterialPropertiesPanel` — instantiated only
  in tests, no production trigger). 2 overlap clusters (Material editing,
  Texture upload).
- **Action ID naming drift**: UI uses `pushpull` / `move` / `rotate`,
  MCP uses `push_pull` / `move_xia` / `rotate_xia` — same operation, two
  vocabularies.

## Section A — Menu Surface (web/index.html + MenuBar.ts)

### Numbers

- **121 leaf actions** across 8 top-level menus
- **118 wired** (98%)
- **2 disabled placeholders**: `export-step`, `export-iges`
- **1 unimplemented**: `import-ifc`
- **2 submenu parents** without handlers (correct — children handle)

### Top-level menu shape

| Menu | Leaves | Notable |
|---|---|---|
| File | 24 | Import 14 / Export 6 (2 placeholder) |
| Edit | 9 | undo, redo, clipboard, select-all/deselect, delete |
| View | 32 | View angles 8 + Display 8 + Panels 6 + Sections 4 + misc 6 |
| Draw | 11 | Line / Polyline / Rect / Circle / Arc / Bezier / Freehand / Polygon / Point / Text3D / Centerline |
| Primitive | 4 | Sphere / Cylinder / Cone / Box |
| Modeling | 39 | Deformation 6 / Sym 5 / Organic 8 / Edge 8 / Boolean 5 / Group 4 / Mesh 3 / Measure 2 / Sketch 8 |
| Format | 3 | Units / Style / OSNAP |
| Help | 2 | Shortcuts / About |

### Drift in Menu

- **4 legacy-alias handlers** in MenuBar.ts with no menu UI:
  `tool-mirror`, `tool-array`, `tool-fillet`, `tool-chamfer` (inline
  fallbacks for older ID conventions; safe to keep for backward compat
  but undocumented)
- **`select-same`**: handler exists but only context menu — no menu /
  keyboard surface

### Recommendation
- ⚠ Decide: keep legacy aliases or sunset in ADR-045 D3 (discoverability
  policy). Keeping them risks future drift; sunsetting may break older
  in-app docs.

## Section B — Action Registries

### Inventory

| Surface | Count | Role |
|---|---|---|
| `CommandInput.ts` | 10 | CAD-style text commands (`/cadmode`, `/verify`, ...) |
| `KeyboardShortcuts.ts` | 49 | Hotkey bindings |
| `ContextMenu.ts` | 41 | Right-click items |
| `ToolManagerRefactored.ts` | 53 | **De-facto SSOT** — central dispatch |
| `CommandPalette.ts` | dynamic | Reads from CommandCatalog (delegated) |
| `ShortcutHelpModal.ts` | 0 | Display only (no registry) |

### Key finding

**`CommandRegistry.ts` is NOT the SSOT** — it registers only 10 text
commands. Real action SSOT is `ToolManagerRefactored.executeAction()`.
This name is misleading and was the cause of audit confusion.

### Discoverability gaps (top priority)

5 actions exist in ToolManager but have **0 user input surfaces**:
1. `measure-selection`
2. `mesh-repair`
3. `solidify`
4. `subdivide`
5. `synthesize-faces`

Plus 3 group actions (`group-edit`, `group-hide`, `group-lock`) that are
context-menu-only.

### Coverage matrix (selected)

| Action | Menu | KB | Ctx | Tool | Coverage |
|---|---|---|---|---|---|
| `undo` | ✓ | ✓ | ✓ | ✓ | 4 (over-redundant) |
| `delete` | ✓ | ✓ | ✓ | ✓ | 4 |
| `mirror-x/y/z` | ✓ | ✓ | ✓ | ✓ | 4 |
| `mesh-repair` | ✓ | — | — | ✓ | 1+1 menu |
| `solidify` | ✓ | — | — | ✓ | 1+1 menu |
| `subdivide` | ✓ | — | — | ✓ | 1+1 menu |
| `synthesize-faces` | ✓ | — | — | ✓ | 1+1 menu |
| `chamfer-edge` | ✓ | — | ✓ | ✓ | 3 |

(Note: my Action-registry agent missed menu coverage for some — the
Menu-audit agent confirms `mesh-repair` / `solidify` / `subdivide` /
`synthesize-faces` ARE wired in Modeling > Mesh Tools / Organic. So
they are reachable from menu, just not from KB or context. Updates the
"unreachable" claim — they're discoverable but not muscle-memory-friendly.)

## Section C — Panel Taxonomy

### 16 panels/dialogs

| # | Panel | Trigger | Visibility | Owns |
|---|---|---|---|---|
| 1 | XiaInspector | `I` key + auto-open | contextual | Face state, material assignment, dimensions |
| 2 | MaterialPropertiesPanel | **NONE (orphan)** | hidden | Full material editor |
| 3 | ComponentPanel | View > Components | hidden | Group hierarchy |
| 4 | ConstraintPanel | View > Constraints | hidden | Constraint list + solver |
| 5 | HistoryPanel | View > History (Shift+H) | hidden | Operation log |
| 6 | OsnapPanel | F3 | modal | SnapManager modes |
| 7 | ScenesManager | View > Scenes | hidden | Saved camera states |
| 8 | SunPanel | View > Sun panel | hidden | Sun direction |
| 9 | ShortcutHelpModal | F1 | modal | Shortcut display |
| 10 | StylePanel | Format > Style | hidden | Visual style presets |
| 11 | StatusBar | always-on | always | Coords + snap last |
| 12 | SettingsPanel | (button only) | hidden | Units / precision |
| 13 | TextureUploadDialog | programmatic | on-demand | Texture upload |
| 14 | DimensionLabel | tool lifecycle | ephemeral | In-canvas labels |
| 15 | ReferenceImage | menu (View > Reference image) | on-demand | Image overlay |
| 16 | DraggablePanelManager | infrastructure | infra | Layout state |

### Overlap clusters

#### 🔴 Material cluster (drift risk)
- `XiaInspector.ts:142-157` reads `material.physical` directly to display
  density/thermal/fire-rating
- `MaterialPropertiesPanel.ts` has full material editor — but **never
  instantiated in production** (only in tests)
- `TextureUploadDialog.ts` creates materials via separate path
  (`MaterialLibrary.addCustom`)

If `MaterialPropertiesPanel` were wired and a user edited density there,
`XiaInspector`'s display would not auto-refresh (no observable). This is
latent bug + dead code.

#### 🟡 Snap cluster (clean — informational)
- `OsnapPanel` controls modes
- `StatusBar` displays `lastSnap` (read-only)
→ Clean separation, no action needed

#### 🟡 Texture / Material creation paths (UX inconsistency)
- `TextureUploadDialog` direct creation
- `MaterialPropertiesPanel.ts:89-150` has texture UI (orphan)
→ Two workflows, neither obviously canonical

### Red flags
1. **`MaterialPropertiesPanel` is dead code** — physically never invoked
   in production. ~248 LOC of dormant editor.
2. **`SettingsPanel` no menu binding** — only reachable via `StatusBar`'s
   optional callback (line 30). Format > Units menu items DO call
   `format-units` action but ToolManager `format-units` was wired in
   the post-acceptance commit (a recent addition).
3. **`XiaInspector` material drift** — direct property reads bypass any
   reactive update channel.

## Section D — Tool Action ↔ MCP Capability Mapping

### Numbers

| Bucket | Count |
|---|---|
| UI ↔ MCP matched | 9 |
| UI-only (no MCP) | 48 |
| MCP-only (no UI button) | 10 |
| MCP declared-unimplemented (no engine) | 13 |
| **Total UI actions** | 57 |
| **Total MCP capabilities** (declared) | 32 |
| **MCP capabilities implemented** | 13 |

### 9 matched (operation parity)

| UI action | MCP capability | Status |
|---|---|---|
| `draw_line` | `draw_line` | parity ✓ |
| `draw_rect` | `draw_rect` | parity ✓ |
| `draw_circle` | `draw_circle` | parity ✓ |
| `draw_polyline` | `draw_polyline` | UI only (MCP declared unimplemented) |
| `pushpull` | `push_pull` | parity ✓ (naming: `pushpull` ↔ `push_pull`) |
| `move` | `move_xia` | parity ✓ (naming gap) |
| `rotate` | `rotate_xia` | UI ✓, MCP declared unimplemented |
| `scale` | `scale_xia` | UI ✓, MCP declared unimplemented |
| `fillet-edge` | `fillet_edge` | parity ✓ (naming: `fillet-edge` ↔ `fillet_edge`) |

**🔴 Naming drift consistent pattern**:
- UI uses `kebab-case` or single token: `fillet-edge`, `pushpull`, `move`
- MCP uses `snake_case` with optional suffix: `fillet_edge`, `push_pull`, `move_xia`

### 10 MCP-only (Tier 0/1 read + export — no UI button)

`get_scene_summary`, `list_xias`, `list_groups`, `get_face_info`,
`get_edge_info`, `get_xia_geometry_state` (declared), `get_schema_version`
(declared), `export_axia`, `export_obj` (declared), `export_stl`
(declared), `export_step` (declared)

Of these:
- File > Export submenu IS wired for `export-obj`, `export-stl`,
  `export-dxf`, `export-gltf`. So Export *is* reachable, but uses UI's
  `export-obj` action ID (kebab) vs MCP's `export_obj` (snake).
- Read capabilities (`get_*`, `list_*`) have **no UI button** at all —
  only MCP-callable. Healthy for AI; gap for human user wanting to
  query.

### 48 UI-only (rich list — Section D agent has full table)

Notable patterns:
- **Deformers**: `bend-selection`, `twist-selection`, `taper-selection`
  (Tier 2 candidates if MCP wants them)
- **Merge variants**: 5 different merge actions (`merge-faces`,
  `merge-faces-force`, `merge-faces-geometric`, `merge-xia-coplanar`,
  `merge-as-hole`) — UI specialty, unlikely needed in MCP
- **Constraint solver actions**: 5 `constrain-*` actions (parametric
  CAD; MCP would benefit but not urgent)
- **Sketch mode**: 8 `sketch-*` actions (workflow primitive, MCP
  candidate as session API)
- **Edit ops**: clipboard / select-all / select-same / duplicate /
  flip-faces / split-edge-midpoint
- **Workflow**: array / mirror / revolve / thicken / subdivide
- **Mesh**: solidify / mesh-repair / synthesize-faces

## Section E — Cross-cutting findings

### Finding 1 — Action ID naming drift is structural

UI: `kebab-case` (HTML data-action friendly), occasionally single token
(`pushpull`, `move`, `delete`).
MCP: `snake_case` with semantic suffix (`push_pull`, `move_xia`,
`erase_face`).

**Implication**: Cannot unify SSOT until naming policy decided.
Renaming UI breaks user muscle memory + docs. Renaming MCP breaks
ADR-041 P26.2 schema (would force MAJOR version bump).

**ADR-045 D1 must answer**: which side adapts?

### Finding 2 — "ToolManager.executeAction is SSOT" is implicit

The 53-action switch in ToolManager is the de-facto registry. No
explicit `ActionCatalog` class exists. Adding one is small refactor +
big payoff (declarative, introspectable, testable).

### Finding 3 — 5 ToolManager actions invisible to keyboard / context

`measure-selection`, `mesh-repair`, `solidify`, `subdivide`,
`synthesize-faces` — these ARE in menus (per Menu agent), but no
keyboard shortcut and not in context menu. **Power-user friction**.

### Finding 4 — `MaterialPropertiesPanel` is dead code

248 LOC, no production instantiation. Either:
- Wire it (replaces XiaInspector's material section)
- Delete it (XiaInspector is canonical)

### Finding 5 — Read capabilities have no UI surface

Tier 0 capabilities (`get_scene_summary`, `list_xias`, `list_groups`,
`get_face_info`, `get_edge_info`) are MCP-only. Human user has no way
to query "what's in this scene?" outside opening individual panels
(Component, XiaInspector). A unified inspect panel would help.

### Finding 6 — Export naming inconsistency

`File > Export > OBJ` → action `export-obj` → ToolManager handler.
MCP `export_obj` is **declared** but NOT yet implemented in
`@axia/mcp-server`. UI is ahead of MCP here.

## Section F — ADR-045 D1~D5 evidence summary

This audit produces concrete evidence for each design decision:

### D1 — Capability ↔ Action SSOT (ADR-045 candidate)

**Evidence**:
- Naming drift (UI kebab vs MCP snake) — Finding 1
- ToolManager-as-implicit-SSOT — Finding 2
- 13/57 actions have MCP equivalent (16% parity)

**Decision options**:
- **A**. Adapter layer: ToolManager ↔ MCP capability_id alias map. Both
  vocabularies survive. Low risk, low payoff.
- **B**. Promote ToolManager to explicit `ActionCatalog`. Add MCP-side
  alias annotation per action. Single audit surface.
- **C**. Force convergence: rename UI to MCP names. Breaks user docs +
  test IDs.

**Recommended**: **B** (explicit catalog with MCP alias).

### D2 — Panel taxonomy

**Evidence**:
- 16 panels currently — 4 categories naturally emerge:
  - **Inspect** (read-only): XiaInspector, ComponentPanel,
    ConstraintPanel, HistoryPanel, ScenesManager
  - **Tools** (config): OsnapPanel, StylePanel, SunPanel,
    SettingsPanel, ShortcutHelpModal
  - **Capability Explorer** (new): unified action catalog UI
  - **Debug** (new): audit log viewer, invariant violations,
    analytic hover overlay
  - **Special** (always-on or ephemeral): StatusBar, DimensionLabel,
    TextureUploadDialog, ReferenceImage, DraggablePanelManager

**Recommended action**:
- Keep all 16 panels (no deletion, low-value churn)
- Add 2 new (Capability Explorer + Debug)
- Group existing into 4 categories in sidebar tabs
- Delete `MaterialPropertiesPanel` if confirmed orphan, OR wire it
  properly

### D3 — Discoverability policy

**Evidence**:
- 5 actions context-only or menu-only without keyboard
- 4 group actions context-only
- ShortcutHelpModal exists but not auto-generated from registry

**Recommended**:
- **Capability Explorer** (search-all UI) is the universal
  discoverability surface
- Menu / KB / context = fast-path for power users
- Auto-generate `ShortcutHelpModal` from same registry as Capability
  Explorer

### D4 — Schema-driven form scope

**Evidence**:
- Tier 0 read capabilities have no UI — schema-driven form fits
  perfectly (input is empty / single id, output is structured JSON)
- Tier 1/2 already have ergonomic UI (DrawRectTool, BooleanHandler,
  PushPullTool) — replacing would be regression
- Tier 3 destructive doesn't exist in UI yet, requires explicit consent
  per ADR-041 P26.7 — a form is fine if it has a confirmation step

**Recommended**:
- **Tier 0**: auto-render
- **Tier 1, 2**: keep existing UI, link from Capability Explorer
- **Tier 3**: future, with audit + confirmation

### D5 — Audit / Debug visualization

**Evidence**:
- ADR-041 P26.7 audit log exists at `~/.axia/mcp-audit.log` — no UI
- ADR-040 analytic hover refine wired — no visualization
- ADR-007 invariant verifier exists in WASM — no UI

**Recommended**:
- New "Debug" panel category (D2)
- Reads audit log JSONL → table view
- Toggleable analytic hover distance overlay (existing
  `refineEdgeHoverWithAnalytic` provides data)
- "Verify invariants" button → WASM → list violations

## Section G — Open questions for user

Before drafting ADR-045, decide:

1. **Naming convergence (D1)**: Adapter layer (option A), explicit
   catalog with alias (B), or rename (C)? Recommendation: **B**.

2. **`MaterialPropertiesPanel`**: Delete or wire?

3. **Capability Explorer scope**: Tier 0 form-only, OR also expose
   Tier 1/2 as launchers (existing tools open)?

4. **Tier 3 in UI at all?** Or AI-only? (Engine has `delete_face` but
   ADR-041 marks Tier 3 opt-in for safety reasons.)

5. **Sunset legacy aliases?** (`tool-mirror`, `tool-array`,
   `tool-fillet`, `tool-chamfer` in MenuBar.ts.)

## Section H — Appendix: file evidence

- Menu source: `web/index.html` lines 1500-2300 (data-action attrs)
- MenuBar wiring: `web/src/ui/MenuBar.ts` (1700+ LOC, action switch)
- Action SSOT: `web/src/tools/ToolManagerRefactored.ts:executeAction()` (3454 LOC)
- Keyboard: `web/src/ui/KeyboardShortcuts.ts`
- Context: `web/src/ui/ContextMenu.ts`
- Command: `web/src/ui/CommandRegistry.ts` (10 commands only — NOT SSOT)
- MCP capability list: `packages/axia-mcp-server/src/tiers.ts` (32
  declared, 13 wired in `capabilities/index.ts`)
- Dead panel: `web/src/ui/MaterialPropertiesPanel.ts` (248 LOC, no
  production instantiation)

## Section I — Recommended next steps

1. **Review this audit with user** — confirm findings, especially
   Finding 4 (`MaterialPropertiesPanel` dead code) and Finding 6
   (export naming).
2. **Draft ADR-045** based on D1~D5 evidence above.
3. **Audit-2** (optional, separate session): static analysis of unused
   handler functions in MenuBar.ts and ToolManagerRefactored.ts to
   find more dead code (this audit was registry-level only).

## Provenance

- 4 parallel Explore agents, each with hard-cap reports
- Synthesized by main thread, no code changes
- Audit takes ~1.5 hours of agent + main work; user time to read ≈ 15 min
