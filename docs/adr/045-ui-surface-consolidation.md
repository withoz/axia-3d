# ADR-045: UI Surface Consolidation + ActionCatalog SSOT

**Status**: **Accepted** (2026-05-02) — LOCKED 정책 #23
**Initiative**: AxiA UI maturity — from "engine-driven" to "user-driven"
**Builds on**: ADR-014 메타-원칙 #4 (SSOT), ADR-041 P26 (MCP Surface),
ADR-042 P27 (Capability Policy), ADR-043 P28 (Scaffold), ADR-044 P29
(Release Process)
**Audit**: `docs/audits/2026-05-02-ui-surface.md`

## Context

ADR-018~044 의 22 LOCKED 정책으로 엔진 / MCP / scaffold / release
인프라가 stable 상태에 도달. 13 working capabilities + 회귀 0. 그러나
2026-05-02 UI surface audit (4 parallel surveys) 가 6 finding 노출:

1. **Action ID 명명 drift** — UI `kebab-case` (`pushpull`, `fillet-edge`)
   vs MCP `snake_case` (`push_pull`, `fillet_edge`). 같은 operation 두
   vocabulary.
2. **ToolManager.executeAction() 가 implicit SSOT** — 53 actions, 명시
   적 `ActionCatalog` 부재. CommandRegistry 는 이름과 달리 SSOT 아님
   (10 text command 만).
3. **5 actions 메뉴-only** — KB / context 미바인딩 (`subdivide`,
   `solidify`, `mesh-repair`, `synthesize-faces`, `measure-selection`).
4. **`MaterialPropertiesPanel` = 248 LOC dead code** — 테스트 외 production
   instantiation 0.
5. **Read capabilities (Tier 0) UI 미노출** — `get_scene_summary`,
   `list_xias`, `list_groups`, `get_face_info`, `get_edge_info` 모두
   MCP-only. 사람 사용자 query 경로 부재.
6. **Export 명명 불일치** — UI `export-obj` vs MCP `export_obj` (선언만).

핵심 인사이트: **"기능을 더 만드는 국면" → "기존 기능을 사람이 쓰게
만드는 국면"**. 엔진 리스크 거의 없음, UI 리스크는 구성 (configuration)
리스크. 이는 정책 결정으로 풀린다.

## Decision

> **5개 결정 (D1~D5) 을 동시에 채택한다. 각 결정은 독립 PR 가능. 본
> ADR 은 정책 고정 + Phase 2 단계적 구현 가이드.**

### D1 — ActionCatalog SSOT (명시적 catalog + 양방향 alias)

> **ActionCatalog is the single source of truth for action identity
> across UI and MCP.**

선택: Audit Section F 의 Option **B** (Adapter / Force-rename 거부).

#### 정책

- 새 workspace package `packages/axia-action-catalog/` (web/ + axia-mcp-server/
  공동 import). Workspace root SSOT.
- 각 action 의 `ActionDef`:
  ```typescript
  interface ActionDef {
    id: string;              // canonical kebab-case (UI 친화)
    aliases: {
      mcp?: string;          // snake_case alias for MCP capability
      legacy?: string[];     // sunset 대상, console warn
    };
    tier: 0 | 1 | 2 | 3;
    label: string;           // i18n 가능 (현재 한국어)
    description: string;
    surfaces: ('menu' | 'keyboard' | 'context' | 'mcp' | 'palette')[];
    handler: (ctx, input) => Promise<unknown>;  // 단일 dispatch
  }
  ```
- 양방향 lookup:
  - `getActionById(id)` — UI 측
  - `getActionByMcpAlias(snake)` — MCP 측
  - `getCanonicalId(alias)` — 모든 alias → canonical 매핑

#### 회귀 invariant

- `action_catalog_alias_bidirectional` — 모든 ActionDef 에 대해
  `getActionByMcpAlias(def.aliases.mcp) === def`
- `action_catalog_no_id_collision` — `id` + `aliases.mcp` + `aliases.legacy`
  flat union 에 중복 없음
- `action_catalog_drift_with_mcp_tiers` — `axia-mcp-server` 의
  `tiers.ts` 와 catalog 의 `tier` field 가 일치
- `action_catalog_handler_invocable_from_both_surfaces` — UI dispatch +
  MCP dispatch 가 동일 handler 호출

### D2 — Panel taxonomy (4 categories)

> **Panels are organized into Inspect / Tools / Explorer / Debug
> categories. Adding a panel = choosing a category.**

#### 4 카테고리

| 카테고리 | 책임 | 현재 panel |
|---|---|---|
| **Inspect** | 데이터 read-only 표시 | XiaInspector, ComponentPanel, ConstraintPanel, HistoryPanel, ScenesManager |
| **Tools** | 환경 / 정책 설정 | OsnapPanel, StylePanel, SunPanel, SettingsPanel, ShortcutHelpModal |
| **Explorer** (NEW) | Capability 검색 + 실행 (D3) | (없음 → PR-3 에서 추가) |
| **Debug** (NEW) | 진단 / 검증 / Tier 3 (D5) | (없음 → PR-4 에서 추가) |
| **Special** (always-on or ephemeral) | 시스템 surface | StatusBar, DimensionLabel, TextureUploadDialog, ReferenceImage, DraggablePanelManager |

#### 정책

- Panel 추가 시 4 카테고리 중 하나 명시 (별도 카테고리 추가 = 새 ADR)
- `MaterialPropertiesPanel` **삭제** (별도 항목 — D2 의 일부):
  > **Dead panel removed, re-introduction requires a new ADR.**
  - ADR-045 본 commit (PR-1) 에서 즉시 제거
  - .ts + .css + .test.ts 모두
  - 회귀 `material_properties_panel_not_imported` 추가
- 기존 panel category 분류는 사이드바 UI 재구성 시 (PR-3) 적용

### D3 — Capability Explorer = Discoverability SSOT

> **Capability Explorer is the discoverability SSOT; execution
> ergonomics remain tool-based.**

#### Tier 별 노출 정책 (Hybrid)

| Tier | UI 노출 방식 |
|---|---|
| **Tier 0 (read)** | Schema-driven form — input → execute → result panel |
| **Tier 1 (constructive)** | Launcher only — 클릭 시 기존 도구 (DrawRectTool 등) 활성화 |
| **Tier 2 (modificative)** | Launcher + Audit preview (호출 시 audit log 기록 알림) |
| **Tier 3 (destructive)** | **기본 비노출** — Debug "Danger Zone" 토글에서만 (D5) |

#### 정책

- Explorer = 검색 가능한 단일 surface (검색창 + tier badge + tier
  config 인지 표시)
- 새 capability 추가 시 ActionCatalog 등록만으로 Explorer 자동 노출
  (drift 부재)
- 기존 도구 (DrawLineTool 등) UX 변경 0 — Explorer 는 launcher 일 뿐

#### 회귀 invariant

- `explorer_renders_all_tier0_capabilities` — Tier 0 catalog entry 전부
  Explorer 에 표시
- `explorer_tier3_hidden_by_default` — Danger Zone 비활성 시 Tier 3
  capabilities 미노출
- `explorer_search_finds_alias_matches` — `push_pull` 검색이
  `pushpull` (UI canonical) 도 hit

### D4 — Schema-driven form scope = Tier 0 only

> **Tier 0 capabilities use auto-rendered Zod-based forms; Tier 1/2
> retain ergonomic tool-based UX.**

#### 정책

- Tier 0 form: Zod schema → React form (input fields, type-safe).
  Output → JSON pretty-print panel.
- Tier 1/2 launcher: capability 클릭 시 기존 도구 (`DrawRectTool` 등)
  activate. Form rendering 안함.
- Tier 3 (Debug): Schema form + `confirm()` modal + audit preview.

#### 이유

- Tier 0 은 "input 적은 query" — form 부담 작음
- Tier 1/2 은 이미 ergonomic UI 존재 — 새 form 으로 교체 = 회귀
- Tier 3 은 사고 방지가 우선 — confirm step 필수

#### 회귀 invariant

- `schema_form_only_for_tier0` — Tier 1/2 ActionDef 가 schema-driven
  rendering 강제 안함
- `tier0_form_input_validates_via_zod` — invalid input → form error
  표시 (engine 호출 안됨)
- `tier3_form_requires_confirmation` — confirm 없이 submit 거부

### D5 — Debug Panel = audit + invariants + analytic hover

> **Debug panel exposes runtime telemetry: audit log viewer, invariant
> verifier, analytic hover overlay, and Tier 3 Danger Zone.**

#### 구성 요소

1. **Audit log viewer** — `~/.axia/mcp-audit-YYYY-MM-DD.log` JSONL →
   페이지네이션 가능한 표 (timestamp / capability / tier / result /
   reason / duration / request_id)
2. **Invariant verifier** — WASM `verifyInvariants()` 호출 → 위반
   목록 표시 + face highlight
3. **Analytic hover overlay** — ADR-040 P25 의 `refineEdgeHoverWithAnalytic`
   결과를 viewport overlay 에 시각화 (debug toggle)
4. **Danger Zone** — Tier 3 capabilities (`erase_face`, `delete_xia`,
   `import_step`, ...) 노출. 기본 비활성, explicit toggle.

#### 정책

- Debug 패널은 dev / power-user 용 — 일반 사용자 mental model 영향 0
- 기본 visibility: hidden, 메뉴 "View > Debug" 또는 단축키 (TBD)
- Tier 3 활성 시 console warn + audit entry 자동 추가

#### 회귀 invariant

- `debug_panel_audit_log_pagination` — 1000+ 엔트리 시 무한 스크롤 / 페이지 분할
- `debug_panel_invariants_lists_violations` — 의도적 winding 깨짐 →
  panel 에 1+ 항목 표시
- `debug_panel_danger_zone_default_off` — 패널 첫 마운트 시 Tier 3
  미노출
- `debug_panel_analytic_overlay_toggleable` — toggle off → overlay
  scene 에 추가된 Three.js object 0

## Implementation Roadmap (Phase 2 PR breakdown)

본 ADR commit (현 commit) 후 **단계적 PR**:

### PR-1 — Delete MaterialPropertiesPanel (이 세션 — 본 ADR commit 직후)

**범위**:
- `web/src/ui/MaterialPropertiesPanel.ts` 삭제
- `web/src/ui/MaterialPropertiesPanel.css` 삭제
- `web/src/ui/MaterialPropertiesPanel.test.ts` 삭제
- import 검사: 다른 파일에서 import 없는지 (audit 결과: 없음)
- 신규 회귀: `material_properties_panel_not_imported` (regex grep test)

### PR-2 — `packages/axia-action-catalog/` workspace package (다음 세션)

- ActionDef interface
- 53 UI actions + 13 MCP capabilities → catalog entry
- web/ 와 axia-mcp-server/ 양쪽 import
- 회귀: D1 invariants 4개

### PR-3 — Capability Explorer panel (PR-2 후)

- Tier 0: schema-driven form
- Tier 1/2: launcher only
- Tier 3: hidden (D5 와 통합)
- 회귀: D3 invariants 3개

### PR-4 — Debug Panel (PR-3 와 병렬 가능)

- Audit log viewer
- Invariant verifier
- Analytic hover overlay
- Danger Zone (Tier 3)
- 회귀: D5 invariants 4개

## Risks & Mitigations

- **R1** — ActionCatalog SSOT 도입 시 53 action 마이그레이션 부담:
  PR-2 단일 PR 에 모든 action 등록 + ToolManager `executeAction` 의
  switch 를 catalog lookup 으로 교체. 회귀 (existing tests) 로 정합 강제.
- **R2** — Capability Explorer 가 12번째 패널 부담:
  D2 의 4 카테고리 사이드바 재구성 (PR-3) 에서 Explorer + Inspect /
  Tools 를 같은 사이드바에 정리. 별 부담 없음.
- **R3** — Tier 3 Danger Zone 사고 방지: confirm() + audit + console
  warn + 기본 비활성. ADR-041 P26.7 와 정합.
- **R4** — Legacy alias 영구 잔존: ADR-046 future 에서 sunset
  trigger (release MAJOR + console warn 누적 N회 후 제거).

## Success Criteria

- ✅ ADR-045 P30 결정 commit
- ✅ **PR-1 완료**: MaterialPropertiesPanel 삭제 + regression guard
- ✅ **PR-2 완료** (이 세션): `packages/axia-action-catalog/` workspace
  package + 82 ActionDef seeded + 4 D1 invariants (23 tests passing).
  ToolManager / axia-mcp-server 마이그레이션은 별도 follow-up PR.
- ⏳ PR-3 완료: Capability Explorer (Tier 0 form + Tier 1/2 launcher)
- ⏳ PR-4 완료: Debug Panel
- ⏳ 5 카테고리 회귀 invariants 모두 통과

## 5 핵심 문장 (사용자 결정 인용)

ADR-045 의 톤을 정의하는 5 문장:

1. **"ActionCatalog is the single source of truth for action identity
   across UI and MCP."**
2. **"MaterialPropertiesPanel is removed as dead code; re-introduction
   requires a new ADR."**
3. **"Capability Explorer is the discoverability SSOT; execution
   ergonomics remain tool-based."**
4. **"Tier 3 capabilities are Debug-only and require explicit Danger
   Zone enablement."**
5. **"Legacy aliases are soft-deprecated and centrally tracked in the
   catalog."**

## References

- `docs/audits/2026-05-02-ui-surface.md` (Phase 1 audit, 4 parallel surveys)
- ADR-041 P26.1 (4-tier capability surface)
- ADR-042 P27 (ALLOW/DENY composition)
- ADR-044 P29 (release lockstep)
- 메타-원칙 #4 (SSOT), #5 (사용자 편의), #11 (latency budget)
- 산업 사례: VS Code Command Palette, Blender F3 search, Fusion 360
  search panel

## 변경 이력

- **2026-05-02 (initial + accepted)**: P30 + LOCKED #23. 5 D 결정 +
  4-stage Phase 2 PR 로드맵 + 14 회귀 invariant.
  - 이 commit: ADR draft 만 (정책 lock)
  - PR-1 (별도 commit, 같은 세션): MaterialPropertiesPanel 삭제
  - PR-2~4: 후속 세션
- 핵심 결정 5 문장 (위 Section "5 핵심 문장") 가 ADR 의 톤을 정의.
- **2026-05-17 — D1 Amendment 1**: identity vs dispatch layer 분리 명시
  (ADR-131/132/133 closure 후, 자세히는 §D1 Amendment 1 참조).

---

## D1 Amendment 1 — Identity vs Dispatch Layer 분리 (2026-05-17, ADR-133 closure)

**상태**: ADR-045 spec 본문 보존. 본 amendment 만 추가.
**Trigger**: ADR-131 §A1.2 dual catalog finding → ADR-132 audit → ADR-133 Path E β implementation closure.
**사용자 결재**: 2026-05-17, "승인합니다" (Option A — small docs cleanup amendment).

### A1.1 D1 spec 원문 정정 (canonical refinement)

D1 spec (위 §D1) + §5 핵심 문장 1:
> "ActionCatalog is the single source of truth for action identity across UI and MCP."

**ADR-133 closure 시점의 architectural 정정**:

이 statement 는 **identity** SSOT 에 한정. *Dispatch* (toolbar 표시 / shortcut binding / execute closure / runtime enabled+active) 는 별도 layer (CommandCatalog, `web/src/commands/`) 책임. 두 SSOT 는 **complementary**, NOT redundant.

### A1.2 Identity vs Dispatch 분리 매트릭스 (canonical, ADR-133 §5)

| Layer | SSOT | Fields | Consumer |
|---|---|---|---|
| **Identity** | **ActionCatalog** (`packages/axia-action-catalog/`) | id / label / description / tier / surfaces / aliases / status / adrs | CapabilityExplorerPanel + MCP server (potential) + 모든 future capability tier policy |
| **Dispatch** | **CommandCatalog** (`web/src/commands/`) | execute closure / toolbar / shortcut / iconSvg / enabled() / active() / group | CommandPalette + main.ts boot wiring + MenuBar (potential) + KeyboardShortcuts (potential) |

**ADR-133 L-133-3 invariant 강제**: **AC ⊇ CC** (every CommandCatalog id MUST exist in ActionCatalog). `web/src/commands/CatalogConsistency.test.ts` 가 CI에서 검증.

### A1.3 두 layer 분리의 architectural value

- **Identity (AC)** 변경 = capability / metadata 변경 (label / description / tier / MCP alias 등)
  - 영향 범위: CapabilityExplorerPanel display, MCP server discovery, ADR traceability
  - 빈도: 낮음 (architectural decisions level)
- **Dispatch (CC)** 변경 = UI 행동 변경 (toolbar 위치 / keyboard shortcut / icon / execute logic 등)
  - 영향 범위: 사용자 UX (즉각 visible)
  - 빈도: 높음 (UX iteration level)

두 layer 의 **변경 빈도 + 영향 범위 분리** = single SSOT 강제 시 churn 충돌 방지.

### A1.4 13 AC-only entries 정합

ADR-133 L-133-4 — 13 AC-only entries (`attach-surface-*-validated` × 5, `bool-dispatch`, `cache-stats`, `edge-curve-info`, `edge-polyline-cached`, `face-normals-cached`, `face-surface-info`, `fillet-dispatch`, `migrate-curve-surface`) 는 **MCP/diagnostic-only** — CommandCatalog 등록 안 됨, intentional.

본 13 entries 는 CapabilityExplorerPanel 의 Tier 1 entries 로 표시되며 (CapabilityExplorer = identity SSOT consumer), MCP server 에서 capability 로 노출 가능 (현재 0 hits, 향후 ADR 시 활성).

### A1.5 핵심 문장 1 refinement (canonical)

§5 핵심 문장 1 의 *additional context* (보존 + 명시 refinement):

> "ActionCatalog is the single source of truth for action **identity** (id/label/tier/surfaces/aliases). CommandCatalog (`web/src/commands/`) is the single source of truth for action **dispatch** (toolbar/shortcut/execute closure). AC ⊇ CC invariant 강제 (every CC id ∈ AC)."

본 refinement 는 *spec 본문 변경 0* — 정확한 의미 명시화 만 추가.

### A1.6 회귀 / 산출물

- 본 amendment: docs only, 회귀 0
- ADR-133 closure 의 자연 documentation
- 14 회귀 invariant 매트릭스 (ADR-045 spec §5) UNCHANGED — 본 amendment 는 *spec refinement*, invariant 변경 없음

### A1.7 Cross-link (Amendment 1)

- **ADR-133** — β implementation (Path E adapter layer, identity vs dispatch 분리 의 architectural origin)
- **ADR-132** — α audit spec (Path E 추천 default)
- **ADR-131** — dual catalog finding 발견 (ADR-131 §A1.2)
- **ADR-130 Amendment 1** — ADR-131 §A1.2 detailed source
- **LOCKED #60** — ADR-133 closure entry
- **LOCKED #61** (본 amendment closure)
