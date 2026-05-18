# ADR-133 — Adapter Layer Implementation (ADR-132 Path E β)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — β implementation single atomic PR per LOCKED #44 |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결재 2026-05-17 — "승인합니다" Q1=(a) Path E + Q2=(a) AC 66 entries + Q3=(c) audit-first 7번째) |
| Anchor | ADR-132 §3 Path E (Adapter layer) — ActionCatalog 가 모든 user-facing IDs identity SSOT 회복, CommandCatalog는 UI dispatch SSOT (분리 layer) |
| Parent | ADR-132 (audit ADR — Path E 추천 default), ADR-131 (dual catalog finding 발견), ADR-045 D1 (ActionCatalog SSOT spec — invariant 실측 회복) |
| Cross-cut | ADR-118 / ADR-119 / ADR-124 / ADR-126 / ADR-128 답습 (α spec → β implementation atomic), ADR-046 P31 #4 additive only, LOCKED #44 Complete Meaning per Merge |

---

## 1. Canonical Anchor

ADR-132 audit (PR #96 merged `13ae8f7`) 후 Path E (Adapter layer) β implementation 진입. 사용자 결재:

> "승인합니다" (2026-05-17, Q1=(a) Path E + Q2=(a) AC 66 entries + Q3=(c) audit-first 7번째)

ADR-132 의 6 path matrix 중 **Path E (Adapter layer)** 가 권장 default — 단순/신속/정확 (~100 LoC, low risk), ADR-045 D1 SSOT invariant 실측 회복.

본 ADR 은 ADR-118/119 (STEP timing pre-warm), ADR-124 (WASM SIMD), ADR-126 (STEP Merged BufferGeometry), ADR-128 (Vertex-on-edge fallback) 답습 패턴 — α spec (ADR-132) → β implementation (본 ADR) atomic single PR.

---

## 2. Change Summary

### 2.1 ActionCatalog: 66 new entries (`packages/axia-action-catalog/src/catalog.ts`)

ADR-132 §2.3 inventory의 66 CC-only entries 를 ActionCatalog `ALL_ACTIONS` 에 추가. 카테고리별 분류 (실측 from `web/src/commands/AxiaCommands.ts`):

| 카테고리 | Count | tier | surfaces |
|---|---|---|---|
| Snap state (axis/edge/grid/osnap/snap-override) | 5 | 0 (read) | menu |
| Clash / Repair / Reference (clash-clear/detect/reference-image) | 3 | 2 (modificative) | menu |
| Export format (dxf/gltf/obj/stl) | 4 | 1 (constructive) | menu |
| File I/O (new/open/save/saveas/import/export) | 6 | 1 (constructive) | menu, keyboard |
| Format panels (osnap/style/units) | 3 | 0 (read) | menu |
| Group state (edit/hide/lock) | 3 | 2 (modificative) | menu, context |
| Help (help/about/shortcuts) | 3 | 0 (read) | menu, keyboard |
| Import format (3dm/3ds/all/dae/dwg/dxf/gltf/ifc/obj/ply/stl) | 11 | 1 (constructive) | menu |
| Rename | 1 | 1 (constructive) | menu, keyboard, context |
| Section plane (off/x/y/z) | 4 | 0 (read) | menu |
| Sketch extras (align-up/resume-last/start-face) | 3 | 1 (constructive) | menu, context |
| Solar / heatmap (heatmap/heatmap-off) | 2 | 2 (modificative) | menu |
| Tool modes (explode/select/torus) | 3 | 0~2 | menu, keyboard |
| View commands (3d/top/bottom/front/back/left/right/home/axis/grid/history/scenes/ssao/shadow-pro/sun-panel) | 15 | 0 (read) | menu, keyboard |
| **합계** | **66** | | |

**Metadata pattern**:
- `aliases: {}` — 모든 66 entries 가 MCP alias 없음 (CommandCatalog의 UI dispatch만, engine call 없음)
- `status: 'ui-only'` — UI dispatch SSOT (CommandCatalog) 의 entry, engine bridge call 없음
- `adrs: ['ADR-133', ...]` — 본 ADR 추가 + 관련 ADR (ADR-046 P31 Pillar 1 / ADR-115 등)

**ActionCatalog total**: 95 → **161** (+66 ADR-133 entries, CATALOG_SIZE 자동 갱신).

### 2.2 ActionCatalog dist rebuild

`packages/axia-action-catalog/dist/catalog.js` rebuilt via `npx tsc -p ../packages/axia-action-catalog/tsconfig.json` (from web workspace, npm install required tsc).

dist/catalog.js: 793 → **1659 LoC** (66 entries × ~13 LoC = ~860 added).

### 2.3 Invariant test (`web/src/commands/CatalogConsistency.test.ts`)

**3 tests** verifying ADR-132 §4.3 unification:

1. `every CommandCatalog id exists in ActionCatalog` — CC ⊆ AC 강제. New CC entry without AC counterpart → CI fail.
2. `CommandCatalog count matches expected total (148)` — ADR-132 §2.3 audit 의 inventory snapshot 보호.
3. `ActionCatalog count is at least 161` — ADR-133 entries 보호 (accidental removal 차단).

**Direction note**: AC ⊇ CC (one-way). 13 AC-only entries (`attach-surface-*-validated`, `bool-dispatch`, `cache-stats` 등) 는 MCP/diagnostic-only → CommandCatalog 등록 안 됨, intentional.

### 2.4 No code changes elsewhere

- `web/src/commands/AxiaCommands.ts`: UNCHANGED (148 commands 그대로 등록)
- `web/src/commands/CommandCatalog.ts`: UNCHANGED
- `web/src/ui/CommandPalette.ts`: UNCHANGED (production Cmd-K 보존)
- `web/src/ui/CapabilityExplorerPanel.ts`: UNCHANGED (95 → 161 entries 자동 노출, Tier 3 toggle 정상)

---

## 3. Lock-ins (canonical, L-133-1 ~ L-133-10)

- **L-133-1** ADR-132 Path E β implementation — Adapter layer pattern (CommandCatalog가 ActionCatalog의 view, identity SSOT 회복)
- **L-133-2** New entry pattern — 66 entries 모두 `aliases: {}`, `status: 'ui-only'`, `adrs: ['ADR-133', ...]`. 향후 새 CC entry 추가 시 본 pattern 답습 권장.
- **L-133-3** AC ⊇ CC invariant — CommandCatalog 의 every id must exist in ActionCatalog (one-way subset). `CatalogConsistency.test.ts` 가 CI에서 강제.
- **L-133-4** 13 AC-only entries 보존 — `attach-surface-*-validated` (5), `bool-dispatch`, `cache-stats`, `edge-curve-info`, `edge-polyline-cached`, `face-normals-cached`, `face-surface-info`, `fillet-dispatch`, `migrate-curve-surface`. MCP/diagnostic-only, CommandCatalog 등록 안 함.
- **L-133-5** ActionCatalog tier 정책 정합 (ADR-041 P26.1) — file/import/export = 1 constructive, view/format/snap/help = 0 read, group/clash/solar/repair = 2 modificative.
- **L-133-6** ADR-045 D1 SSOT invariant 실측 회복 — ActionCatalog now contains *all* user-facing IDs (161 = 82 shared + 13 AC-only + 66 ADR-133). 단 dispatch (toolbar/shortcut/execute) 는 CommandCatalog 책임 (분리 layer).
- **L-133-7** ADR-046 P31 #4 additive only — 새 entries 만 추가, production functionality (CommandPalette / CapabilityExplorerPanel) UNCHANGED.
- **L-133-8** dist rebuild required — `packages/axia-action-catalog/dist/` 가 web tests의 import source. catalog.ts 변경 후 `npx tsc -p packages/axia-action-catalog/tsconfig.json` 필수.
- **L-133-9** ADR-132 §6 out-of-scope items 보존 — Path A (Migrate AC → CC), CapabilityExplorer vs CommandPalette UX 중복 해소, i18n infrastructure, ActionCatalog Tier 3 destructive content — 모두 future ADR.
- **L-133-10** 절대 #[ignore] 금지.

---

## 4. 회귀 (실측)

| Layer | Before (LOCKED #59) | After ADR-133 β | Delta |
|---|---|---|---|
| **vitest** (TS) | 1917 / 1 skipped | **1920 / 1 skipped** | **+3** (ADR-133 invariant) |
| `CatalogConsistency.test.ts` | (new) | **3 tests** | +3 |
| ActionCatalog `ALL_ACTIONS` count | 95 | **161** | +66 |
| ActionCatalog dist size | catalog.js 793 LoC | 1659 LoC | +866 |
| axia-geo (cargo) | 1399 | 1399 | UNCHANGED |
| axia-core (cargo) | 302 | 302 | UNCHANGED |
| axia-wasm (cargo) | 0 (cdylib) | 0 | UNCHANGED |
| Playwright E2E | 15+ | 15+ | UNCHANGED |
| ADR-077 V-2 baselines | preserved | preserved | UNCHANGED |
| Initial bundle | 724.99 kB | 724.99 kB | UNCHANGED (P20.C #2) |
| Production CommandPalette | active | active | UNCHANGED |
| CapabilityExplorerPanel display | 95 entries | 161 entries (자동) | additive |

**합계 +3 vitest 회귀** (절대 #[ignore] 금지 3/3 준수).

---

## 5. ADR-045 D1 invariant 실측 회복

| 측면 | Pre-ADR-133 (ADR-131 §A1.2 finding) | Post-ADR-133 |
|---|---|---|
| ActionCatalog total | 95 entries | **161 entries** (82 shared + 13 AC-only + 66 ADR-133 added) |
| CommandCatalog total | 148 entries | 148 entries (UNCHANGED) |
| **AC ⊇ CC invariant** | ❌ Violated (66 CC-only entries) | ✅ **Satisfied** (모든 148 CC IDs ∈ AC) |
| **Identity SSOT** | ❌ Two SSOTs (no SSOT) | ✅ **ActionCatalog = identity SSOT** |
| **Dispatch SSOT** | CommandCatalog (production) | CommandCatalog (UNCHANGED) — *separate concern* |

**ADR-045 D1 SSOT invariant 명시적 회복** + **identity/dispatch 두 layer 명확 분리** = ADR-132 Path E 의 architectural value.

---

## 6. Out of Scope (별도 ADR per LOCKED #44)

- **Path A (Migrate AC → CC)** — ADR-132 §4.1 2nd recommendation. CommandDef 의 9 unique fields (execute/toolbar/shortcut/iconSvg/etc.) 를 ActionDef에 추가하는 long-term migration. Future ADR.
- **CapabilityExplorerPanel vs CommandPalette UX 중복 해소** — 두 different palette 가 161 entries (CapabilityExplorer) + 148 commands (CommandPalette) 표시. ADR-131 §2.5 #2 영역. Future UX ADR.
- **Field-level drift detection** (label/description/shortcut 일치 강제) — 본 ADR은 ID subset만 강제, label/description은 manually synced. ADR-134+ (가칭).
- **i18n infrastructure** (ADR-046 Q7 Korean+English) — Phase 2 explicit gate. Future ADR.
- **ActionCatalog Tier 3 destructive content** (ADR-045 D3 reserved) — 본 ADR-133 0 entries added (Tier 0/1/2 only). Phase 2+.
- **MCP capability extension** (ADR-041 P26) — 66 new entries 의 MCP alias 추가 (현재 `aliases: {}`). Tier 0/1 entries 만 후보 (Tier 2 modificative 는 별도 결재 — ADR-041 P26.1 Tier 2 capability 정책).

---

## 7. Cross-link

- **ADR-132** — α audit spec (Path E 추천 default, 본 ADR 의 직접 trigger)
- **ADR-131** — dual catalog finding 발견 (ADR-131 §A1.2)
- **ADR-130 Amendment 1** — ADR-131 §A1.2 detailed source
- **ADR-045 D1** — ActionCatalog SSOT spec (invariant 실측 회복)
- **ADR-041 P26** — capability tier policy (ActionCatalog tier 필드 source)
- **ADR-046 P31 Pillar 1** — Discoverability anchor (CapabilityExplorerPanel 161 entries 자동 노출)
- **ADR-046 P31 #4** — additive only (L-133-7)
- **ADR-118 / ADR-119 / ADR-124 / ADR-126 / ADR-128** — α spec → β implementation atomic pattern source
- **ADR-115** — Path B Torus primitive (tool-torus entry adrs[] reference)
- **ADR-117** — Cylinder direct dispatch + TorusTool UI bindings (tool-torus entry adrs[] reference)
- **LOCKED #44** — Complete Meaning per Merge (single atomic PR)
- **LOCKED #59** — 직전 closure (ADR-131 + ADR-130 Amendment 1)

---

## D. Acceptance Log

| Sub-step | Status | 산출물 |
|---|---|---|
| Detailed audit (66 CC-only enumeration with metadata) | ✅ | `comm -23 cc_ids ac_ids` = 66 entries |
| Add 66 entries to `packages/axia-action-catalog/src/catalog.ts` ALL_ACTIONS | ✅ | catalog.ts +866 LoC |
| Rebuild dist (`npx tsc -p packages/axia-action-catalog/tsconfig.json`) | ✅ | dist/catalog.js 793 → 1659 LoC |
| Create `web/src/commands/CatalogConsistency.test.ts` (3 invariant tests) | ✅ | CC ⊆ AC + count snapshots |
| Vitest run — `CatalogConsistency.test.ts` | ✅ | 3 passed |
| Vitest run — full suite | ✅ | 1920 passed (+3 ADR-133) / 1 skipped / 0 failed |
| Cargo test — axia-geo + axia-core | ✅ | 1399 + 302 UNCHANGED |
| ADR-133 spec written | ✅ | `docs/adr/133-adapter-layer-implementation.md` (200+ lines) |
| CLAUDE.md LOCKED #60 entry | ✅ | LOCKED #60 |

---

## E. Lessons (canonical for future SSOT unification ADRs)

- **L-133-α-1 — Path E (Adapter layer) 의 architectural simplicity**: 두 system 모두 보존 + 한쪽 (ActionCatalog) 을 identity superset 으로 만드는 unidirectional dependency. 가장 *non-invasive* unification path. 향후 dual system finding 시 default consideration.
- **L-133-α-2 — `status: 'ui-only'` lock-in pattern**: 66 entries 모두 UI dispatch only (engine call 없음) → `aliases: {}` + `status: 'ui-only'` canonical. 향후 새 CC entry 추가 시 본 pattern 답습 (별도 engine binding 시 status 'ok' + bridge/wasm alias 추가).
- **L-133-α-3 — dist rebuild as architectural touch point**: `packages/axia-action-catalog/dist/` 가 web 의 import source — catalog.ts 변경 후 dist rebuild 필수. CI workflow 에서 자동화 권장 (별도 ADR — 현재는 수동 `npx tsc -p ../packages/axia-action-catalog/tsconfig.json`).
- **L-133-α-4 — Identity vs Dispatch layer 분리 canonical**: ADR-045 D1 spec amendment 시점에 명시 — "ActionCatalog = identity SSOT (id/label/description/tier/surfaces/aliases/status/adrs), CommandCatalog = dispatch SSOT (toolbar/shortcut/iconSvg/execute closure/enabled/active)". 두 SSOT 가 *complementary*, not redundant. 향후 ADR-045 D1 amendment 별도 ADR.
- **L-133-α-5 — Single-direction invariant test 의 architectural value**: AC ⊇ CC 강제만 (CC ⊆ AC 자연 도달). 13 AC-only entries (MCP/diagnostic) 는 OK. 향후 unification ADR 도 *one-way subset invariant* 권장 (bidirectional 은 rigidity 과다).
- **L-133-α-6 — α spec → β implementation atomic pattern 6번째 적용**: ADR-118/119 (STEP timing) + ADR-122/124 (SIMD) + ADR-122/126 (STEP merged) + ADR-120/128 (Vertex-on-edge) + ADR-132/133 (Path E) — pattern 정착 강화. ADR-129 priority track 의 architectural anchor.
- **L-133-α-7 — Audit-first canonical 7번째 적용 evidence (메타)**: ADR-132 audit ADR + ADR-133 β implementation 의 분리. Implementation 진입 전 audit 으로 *unification path*/scope/risk 명시 → β 단계는 deterministic execution. 향후 모든 architectural change 의 default pattern.
