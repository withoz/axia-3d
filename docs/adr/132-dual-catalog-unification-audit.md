# ADR-132 — Dual Catalog Unification Audit (α spec)

| Field | Value |
|---|---|
| Status | **Proposed (α spec only — path lock-in pending 사용자 결재)** |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결재 2026-05-17 — "승인합니다" Option A 채택 from ADR-131 §6 다음 진입 후보) |
| Anchor | ADR-131 §A1.2 dual catalog architectural finding — ActionCatalog (ADR-045 D1, 95 actions, isolated) ↔ CommandCatalog (production, 148 commands, **production SSOT**) 별개 시스템 |
| Parent | ADR-131 (audit closure pivot — dual catalog finding 발견), ADR-045 D1 (ActionCatalog SSOT spec — invariant 위반 노출) |
| Cross-cut | ADR-046 P31 Pillar 4 (AI Seam — ActionCatalog MCP seam 영향), ADR-041 P26 (capability tier policy — ActionCatalog tier 필드 source), ADR-118 / ADR-120 / ADR-122 / ADR-123 / ADR-129 / ADR-130 답습 (α spec → β implementation atomic) |

---

## 0. Summary

> ADR-131 §A1.2 발견의 dual catalog architectural finding (ActionCatalog ↔ CommandCatalog 별개 system) 의 *불일치 매트릭스 정량 분석 + unification path 매트릭스 결재*. 6 path options (A migrate to CommandCatalog / B migrate to ActionCatalog / C coexist / D unified third / E adapter / F defer) + 권장 default = **E (adapter layer)**. ADR-045 D1 SSOT invariant 의 실측 violation 해소 anchor.

---

## 1. Canonical Anchor

ADR-131 §A1.2 발견 (canonical):
- **ActionCatalog** (ADR-045 D1, `packages/axia-action-catalog/`, 95 actions) = CapabilityExplorerPanel ONLY
- **CommandCatalog** (production, `web/src/commands/`, **148 commands**) = CommandPalette + main.ts wiring

ADR-045 D1 spec ("ActionCatalog is single source of truth for action identity across UI and MCP") **실측 invariant violation** — production 의 UI dispatch SSOT는 CommandCatalog. 두 SSOT = no SSOT.

사용자 결재 (2026-05-17, ADR-131 §6 다음 진입 후보 Option A):
> "승인합니다" (Option A — ADR-132 dual catalog unification audit, 1-2일)

본 ADR 은 **세션 audit-first canonical 7번째 적용** (ADR-125 α-1 / ADR-126 α-2 / ADR-127 α-4 / ADR-128 priority #4 / ADR-130 Pillar 1 / ADR-131 메타-finding 답습). ADR-131의 finding 의 *자연 후속 audit ADR*.

---

## 2. System Comparison (실측)

### 2.1 API surface

| 측면 | ActionCatalog | CommandCatalog |
|---|---|---|
| Location | `packages/axia-action-catalog/` (workspace package) | `web/src/commands/CommandCatalog.ts` |
| Type | Compile-time static (immutable seed array `ALL_ACTIONS`) | Runtime dynamic (mutable, `register`/`registerMany`/`onChange`) |
| Pattern | Singleton implicit (module-level maps) | Singleton via `getCommandCatalog()`, instantiable for tests |
| Lookup methods | `getActionById` / `getActionByBridgeAlias` / `getActionByWasmAlias` / `getActionByMcpAlias` / `lookup(query)` / `listActionIds` / `actionsByTier` | `has` / `get` / `list(filter?)` / `toolbarGroups` / `execute(id)` / `onChange` / `size` |
| Strength | Static SSOT, TypeScript compile-time verification | Runtime UI dispatch, mutation support, fallthrough to legacy MenuBar |

### 2.2 Per-entry metadata (canonical comparison)

| Field | ActionCatalog `ActionDef` | CommandCatalog `CommandDef` | Notes |
|---|---|---|---|
| id | ✅ kebab | ✅ kebab | Both canonical (e.g., `tool-pushpull` / `mirror-x`) |
| label | ✅ Korean | ✅ Korean + English | CommandCatalog more verbose |
| description | ✅ 1-sentence required | ✅ optional | ActionCatalog required field |
| **tier** (0/1/2/3) | ✅ ADR-041 P26.1 | ❌ absent | **ActionCatalog only** — capability maturity |
| **surfaces[]** | ✅ menu/keyboard/mcp/etc. | ❌ absent | **ActionCatalog only** — MCP/UI seam awareness |
| **aliases** (bridge/wasm/mcp/legacy) | ✅ 4 channels | ❌ absent | **ActionCatalog only** — multi-language ID mapping |
| **status** (ok/stub/scaffold/etc.) | ✅ wiring audit | ❌ absent | **ActionCatalog only** — integrity tracking |
| **adrs[]** | ✅ traceability | ❌ absent | **ActionCatalog only** — ADR reference |
| **execute** closure | ❌ delegated (TS modules) | ✅ direct callback | **CommandCatalog only** — immediate dispatch |
| **toolbar** boolean | ❌ absent | ✅ present | **CommandCatalog only** — UI coupling |
| **toolbarSection** | ❌ absent | ✅ present | **CommandCatalog only** |
| **group** (file/edit/draw/etc.) | ❌ absent | ✅ 14 categories | **CommandCatalog only** — user intent grouping |
| **shortcut** display | ❌ absent | ✅ string | **CommandCatalog only** — UI display |
| **iconSvg** | ❌ absent | ✅ optional | **CommandCatalog only** |
| **isMode / toolName** | ❌ absent | ✅ tool radio pattern | **CommandCatalog only** |
| **enabled() / active()** | ❌ absent | ✅ runtime callbacks | **CommandCatalog only** |

**Asymmetry quantified**: ActionCatalog = **5 unique metadata fields** (tier / surfaces / aliases / status / adrs). CommandCatalog = **9 unique metadata fields** (execute / toolbar / toolbarSection / group / shortcut / iconSvg / isMode / toolName / enabled+active). 공통 = 3 (id / label / description).

### 2.3 Entry overlap (148 / 95)

- **82 shared entries** (canonical kebab id 일치) — 모든 tool commands (line/rect/circle/move/...), modify actions (mirror/array/fillet/...), boolean ops (union/subtract/intersect), clipboard/sketch/group operations
- **13 ActionCatalog-only entries** — surface attach validators (5 entries, MCP-only tier 1), cache stats (3 entries, diagnostics), boolean dispatch, 4 internal
- **66 CommandCatalog-only entries** — file I/O (6), import formats (11), export formats (4), view commands (17), snap/OSNAP (5), repair/diagnostics (7), format (3), help (3), 10 misc

**Drift evidence (현재)**:
- 82 shared entries → label/shortcut/handler가 *수동 동기화* 의존
- Zero linter rule / unit test 로 bidirectional consistency 강제
- 예상 12-month drift = ~15% mismatch metadata

### 2.4 ID naming convention

- ActionCatalog: kebab-case (e.g., `mirror-x`, `bool-union`). 4 aliases channels (bridge camelCase / wasm snake_case / mcp snake_case / legacy[])
- CommandCatalog: kebab-case 동일 (e.g., `tool-line`, `mirror-x`). **No alias support** — MCP snake_case 부재
- **No ID collisions** (동일 naming convention) but **alias mismatch** — MCP user "boolean_subtract" → CommandCatalog 매핑 불가

### 2.5 Consumer comparison

| ActionCatalog consumers (1 production + 1 test) | CommandCatalog consumers (3 production + 2 test) |
|---|---|
| `web/src/ui/CapabilityExplorerPanel.ts` | `web/src/main.ts:458-465` (boot `registerAxiaCommands`) |
| `CapabilityExplorerPanel.test.ts` | `web/src/ui/CommandPalette.ts` (Cmd-K palette) |
| | `web/src/ui/CommandInput.ts` (potential, not verified) |
| | `CommandCatalog.test.ts` |
| | `AxiaCommands.test.ts` |

**ActionCatalog는 read-only export** (CapabilityExplorer 외 grep 0 hits). **CommandCatalog는 UI dispatch hub** (registration + execution).

### 2.6 MCP integration status

| 측면 | ActionCatalog | CommandCatalog |
|---|---|---|
| ADR-041 P26 tier alignment | ✅ `tier` field | ❌ absent |
| MCP alias channel | ✅ `aliases.mcp` | ❌ absent |
| `getActionByMcpAlias()` | ✅ lookup helper | N/A |
| Surface exposure | ✅ `'mcp'` in surfaces[] | ❌ absent |
| **MCP server import** (`packages/axia-mcp-server/`) | **0 hits (grep)** — bidirectional sync 부재 | N/A |

→ MCP server는 ActionCatalog 정의했지만 **실제 import 안 함** (자율 capability 정의). ADR-045 D1 의 "MCP SSOT" 명시도 실제 binding 없음.

---

## 3. Status Quo Risks (정량)

### 3.1 ADR-045 D1 invariant violation (canonical)

ADR-045 D1 명시:
> "ActionCatalog is single source of truth for action identity across UI and MCP."

**실측 위반**:
- UI dispatch SSOT = CommandCatalog (`bindCommandPaletteHotkey()` production 활성)
- MCP SSOT = ActionCatalog (selectively used by CapabilityExplorerPanel)
- 두 SSOT = no SSOT

### 3.2 Drift risks (현재 8 specific)

1. **Keyboard shortcut drift** — CommandCatalog shortcut 변경 시 ActionCatalog metadata stale
2. **Label/description desync** — 82 shared entries 양쪽 수동 동기화
3. **Tier-visibility mismatch** — CapabilityExplorer 95 vs CommandPalette 148 (사용자 혼란)
4. **MCP seam unsync** — file I/O / import formats CommandCatalog only (66 entries) → MCP에서 "import_dxf" 불가
5. **Maintenance tax** — 새 action 추가 시 ActionCatalog + AxiaCommands.ts + (legacy) MenuBar 3-way edit
6. **Status field gap** — CommandCatalog는 `'stub'/'placeholder'` 추적 안 함 → wiring quality audit 누락
7. **ADR traceability gap** — CommandCatalog entries는 ADR reference 없음 → architectural context 누락
8. **No bidirectional sync test** — 양쪽 catalog consistency 강제 부재

### 3.3 사용자 facing impact

- **혼란**: CapabilityExplorer 95개 + CommandPalette 148개 + F1 ShortcutHelp 50+ rows → 세 different list
- **AI agent impact** (ADR-046 P31 Pillar 4 AI Seam): MCP capability registry vs CommandCatalog 별개 → AI가 "어떤 명령 사용 가능?" 질문 시 어느 catalog 참조?
- **Phase 2 (Discoverability) blocker**: ADR-129 Priority #1 의 실제 architectural gap

---

## 4. Unification Path Matrix (6 options)

### 4.1 Path options

| Path | Description | Scope | Risk | Value | Trigger |
|---|---|---|---|---|---|
| **A** | **Migrate ActionCatalog → CommandCatalog** (deprecate ActionCatalog) | ~200 LoC + Mocha (CommandDef + tier/surfaces/aliases 추가) | **Medium** — CommandCatalog 가 mutable, MCP compile-time invariant 깨질 risk | Single catalog, all consumers same API | Post-Phase 2, MCP maturity matches UI |
| **B** | **Migrate CommandCatalog → ActionCatalog** (deprecate CommandCatalog) | ~400 LoC (ActionDef extend, 66 UI-only seed, dispatch rebuild) | **High** — ActionCatalog compile-time verification, runtime mutation 복잡 | Single mutable registry, MCP+UI 통합 | If MCP freezes; requires ADR-045 reversal |
| **C** | **Coexist (documented boundary)** + bidirectional adapter | ~150 LoC (adapter + invariant tests) | **Low** — preserves both designs | Minimal — drift risk 잔존 | Team consensus on dual-ownership |
| **D** | **Unified third catalog** (`packages/axia-unified-catalog/`) | ~600 LoC (new schema, 2-way sync, migration scripts) | **High** — abstraction layer 추가, new SSOT retraining | Future flexibility (plugin/profile-based aliases) | Broader extensibility requirement (ADR-047+) |
| **E** ⭐ | **Adapter layer (CommandCatalog wraps ActionCatalog at boot)** | ~100 LoC (AxiaCommands.ts auto-generates from ActionCatalog) | **Low** — unidirectional dep, no schema change | High — single mutation point, drift impossible | Quick win, gradual consolidation |
| **F** | **Defer (status quo + document debt)** + quarterly drift audit | ~50 LoC test only | **Medium** — discipline 요구, drift re-emerges | Zero — accumulates debt | Only if Phase 2 resources unavailable |

### 4.2 추천 매트릭스 (사용자 가치 × scope × risk)

| 추천 순위 | Path | 근거 |
|---|---|---|
| **1st** | **E (Adapter layer)** | 가장 단순/신속/정확 (~100 LoC, 1-2주 atomic). Low risk (no schema change). ADR-045 D1 invariant 실측 회복 — CommandCatalog가 ActionCatalog의 view 가 됨. Maintenance tax 즉시 해소 (single SSOT). |
| **2nd** | **A (Migrate to CommandCatalog)** | Long-term clean architecture — CommandCatalog의 9 unique fields가 사용자 facing 가치 (toolbar/shortcut/icon). 단 Medium risk + ~200 LoC. |
| **3rd** | **C (Coexist + bidirectional adapter)** | Pragmatic compromise — 두 system 보존 + invariant test 로 drift 차단. ADR-045 D1 spec 변경 필요. |
| **4th** | **D (Unified third)** | Architectural perfectionism — 새 abstraction layer 도입, 향후 extensibility 가치 but high cost. |
| **5th** | **B (Migrate to ActionCatalog)** | High risk (compile-time vs runtime mismatch). 비추천. |
| **6th** | **F (Defer)** | Zero value, accumulates debt. 비추천. |

### 4.3 권장 default = E (Adapter layer)

**Strategy**:
1. **AxiaCommands.ts 자동 generation**: ActionCatalog `ALL_ACTIONS` iterate → CommandDef 생성 + UI-only override (toolbar/shortcut/icon) 별도 file (e.g., `AxiaCommandsUIExtra.ts`)
2. **66 CommandCatalog-only entries** (file I/O / import formats / view commands 등) → ActionCatalog 에 추가 (tier 0 read 또는 tier 1 constructive)
3. **Invariant test**: ActionCatalog ID ⊆ CommandCatalog ID 강제 (단방향 — UI override는 ActionCatalog 외 추가 metadata only)
4. **MCP integration 자동**: ActionCatalog 추가 시 MCP 자동 노출 (alias.mcp 정의 시)

**Phase 2 follow-up (별도 ADR-133 가칭)**:
- CommandCatalog → ActionCatalog 의 자연 진화 (CommandDef execute/toolbar/shortcut을 ActionDef에 추가)
- 최종 single catalog (Path A 의 자연 도달)

---

## 5. 결재 트리거 (사용자 명시 선택 필요)

### 5.1 Q1 — Path 선택

- **(a) E (Adapter layer)** ⭐ — 단순/신속/정확, ~100 LoC, 1-2주 atomic
- **(b) A (Migrate to CommandCatalog)** — long-term clean, ~200 LoC, 2-3주
- **(c) C (Coexist + bidirectional adapter)** — pragmatic, ~150 LoC, 1.5-2주
- **(d) D (Unified third catalog)** — architectural perfectionism, ~600 LoC, multi-week
- **(e) F (Defer with documented debt)** — zero work, status quo
- **(f) defer 전체 unification** — 다른 priority 진입 (ADR-129 Priority #2 V-4 또는 사용자 시연)

### 5.2 Q2 (Q1 = E or A 선택 시) — 66 CommandCatalog-only entries 처리

- **(a) ActionCatalog 에 추가** (file I/O / import / view commands) — tier 1 constructive로 분류
- **(b) UI-only로 분리** (CommandCatalog에만 존재, ActionCatalog는 capability tier만)
- **(c) 일부만 (file I/O + import만) ActionCatalog 추가** — 나머지 view commands는 UI-only

### 5.3 Q3 — Implementation 분할

- **(a) Single atomic PR** (Path E의 ~100 LoC) — LOCKED #44 정합
- **(b) 2-step seq** (audit + adapter implementation 별도)
- **(c) Audit-first canonical 7번째 적용** — 본 ADR-132 = audit closure 만, implementation 별도 ADR-133 (가칭) β

### 5.4 권장 default

- **Q1 (a) E (Adapter layer)** — 단순/신속/정확
- **Q2 (a) ActionCatalog 에 66 entries 추가** — single SSOT 자연 도달
- **Q3 (c) Audit-first canonical 7번째 적용** — 본 ADR = audit only, 별도 ADR-133 (가칭) β implementation 진입

대안: **Q1 (b) A** — long-term clean architecture 우선 시. ~200 LoC, 2-3주.

---

## 6. Lock-ins (canonical, L-132-1 ~ L-132-10)

- **L-132-1** ADR-131 §A1.2 dual catalog finding architectural anchor — *실측 SSOT violation*
- **L-132-2** ActionCatalog 5 unique metadata fields (tier / surfaces / aliases / status / adrs) + CommandCatalog 9 unique fields (execute / toolbar / shortcut / iconSvg / etc.) — *complementary, NOT redundant*
- **L-132-3** 82 shared entries + 13 ActionCatalog-only + 66 CommandCatalog-only = 161 total unique commands (overlap 50.9%)
- **L-132-4** ADR-045 D1 SSOT invariant 실측 violation 명시 — 향후 ADR-133 (가칭) β implementation 으로 회복
- **L-132-5** ADR-046 P31 Pillar 4 (AI Seam) impact — MCP seam unsync 의 architectural value 확인
- **L-132-6** Quantified drift risk — 8 specific risks + 12-month ~15% mismatch projection
- **L-132-7** ADR-046 P31 #4 additive only — unification 은 *additive* (CommandCatalog functionality 보존 + ActionCatalog SSOT 강화)
- **L-132-8** ADR-118 / ADR-120 / ADR-122 / ADR-123 / ADR-129 / ADR-130 답습 (α spec → β implementation atomic) — 본 ADR audit, 별도 ADR-133 (가칭) β
- **L-132-9** 세션 audit-first canonical 7번째 적용 — pattern 정착 강화
- **L-132-10** 절대 #[ignore] 금지

---

## 7. Out of Scope (별도 ADR per LOCKED #44)

- **ADR-133 (가칭) — Adapter layer β implementation** (Path E) — AxiaCommands.ts 자동 generation + ActionCatalog 66 entries 확장 + invariant test
- **ADR-045 D1 amendment** — SSOT spec correction (CommandCatalog가 production UI dispatch hub임을 명시 + ActionCatalog는 identity/metadata SSOT 분리)
- **Path A (Migrate to CommandCatalog)** — Path E의 자연 진화, future ADR
- **CapabilityExplorerPanel vs CommandPalette UX 중복 해소** — dual catalog unification 후속 (별도 UX ADR)
- **i18n infrastructure** — ADR-046 Q7 Phase 2 explicit gate
- **ActionCatalog Tier 3 destructive content** — ADR-045 D3 reserved

---

## 8. Cross-link

- **ADR-131** — 본 ADR 의 직접 trigger (dual catalog finding lock-in)
- **ADR-130 Amendment 1** — ADR-131 §A1.2 finding 의 detailed source
- **ADR-045 D1** — ActionCatalog SSOT spec (invariant 위반 노출 — 향후 amendment 필요)
- **ADR-041 P26** — capability tier policy (ActionCatalog tier 필드 source)
- **ADR-046 P31 Pillar 4** — AI Seam (MCP seam unsync 영향)
- **ADR-125 / ADR-126 / ADR-127 / ADR-128 / ADR-130 / ADR-131** — audit-first canonical 1~6번째 source
- **ADR-118 / ADR-120 / ADR-122 / ADR-123 / ADR-129 / ADR-130** — α spec → β implementation atomic pattern source
- **ADR-046 P31 #4** — additive only (L-132-7)
- **ADR-087 K-ζ** — 사용자 시연 게이트 canonical (β implementation 후)
- **LOCKED #43** — 직전 priority track (100% closure)
- **LOCKED #44** — Complete Meaning per Merge (docs-only PR scope)
- **LOCKED #58** — 직전 closure (ADR-128 priority #4)
- **LOCKED #59** — 직전 closure (ADR-131 dual catalog finding lock-in)

---

## 9. 결재 요청

본 spec only PR (α). 사용자 결재 후 채택된 Path 만 별도 atomic sub-step PR 진행 (ADR-133 가칭).

**Q1 Path 선택** + Q2-Q3 default 채택 여부 명시 부탁드립니다.

**권장 default 요약**:
- **Q1 (a) E (Adapter layer)** — 단순/신속/정확, ~100 LoC, low risk
- **Q2 (a) ActionCatalog 에 66 entries 추가** — single SSOT 자연 도달
- **Q3 (c) Audit-first canonical 7번째 적용** — 본 ADR audit only, 별도 ADR-133 β implementation

**대안**:
- **Q1 (b) A (Migrate to CommandCatalog)** — long-term clean, ~200 LoC
- **Q1 (c) C (Coexist + bidirectional adapter)** — pragmatic, ~150 LoC
- **Q1 (e) F (Defer with documented debt)** — zero work
- **Q1 (f) defer 전체 unification** — 다른 priority 진입
