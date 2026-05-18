# ADR-130 — Pillar 1 (Discoverability) Audit (LOCKED #X Priority #1 α spec)

| Field | Value |
|---|---|
| Status | **Proposed (α spec only — γ sub-step lock-in pending 사용자 결재)** |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결재 2026-05-17 — "권장 진행 승인합니다" Q1=(a) + Q2=(a) audit-first 5번째 적용) |
| Anchor | LOCKED #43 successor track (ADR-129) Priority #1 — ADR-046 P31 Pillar 1 (Discoverability) "가장 시급" |
| Parent | ADR-129 (priority track spec — Pillar 1 우선순위), ADR-046 P31 Pillar 1 (Discoverability principle), ADR-045 D1 (ActionCatalog SSOT) + D3 (CapabilityExplorer spec) |
| Cross-cut | ADR-118 / ADR-120 / ADR-122 / ADR-123 / ADR-129 답습 패턴 (α spec → β implementation atomic), ADR-046 P31 #4 additive only, LOCKED #44 Complete Meaning per Merge |

---

## 0. Summary

> ADR-129 priority track 의 Priority #1 (Pillar 1 Discoverability) audit-first canonical 5번째 적용. 현재 state 측정 → β implementation 진입 전 architectural reality 확인. CapabilityExplorerPanel (742 LOC scaffold) + ActionCatalog (95 actions SSOT) + Cmd-K palette (미구현) 의 현재 통합 상태 + Cmd-K library options 매트릭스 + γ sub-step 분할 결재 매트릭스.

---

## 1. Canonical Anchor

ADR-129 결재 (2026-05-17, 권장 default 채택):
> "권장 진행 승인합니다" (Q1=(a) 4-priority track, Q2=(a) audit-first 5번째 적용)

본 ADR 은 **세션 audit-first canonical 5번째 적용** (ADR-125 α-1 / ADR-126 α-2 / ADR-127 α-4 / ADR-128 priority #4 / ADR-130 Pillar 1 답습). Priority track 의 첫 β implementation 진입 전 audit.

ADR-046 P31 §8 evidence: Pillar 1 (Discoverability) = "가장 시급" + Phase 2 (Discoverability) 1-3개월 explicit gate. ADR-045 D1 (ActionCatalog SSOT) policy 잠겼고, D3 (CapabilityExplorer spec) Step 3/5 closure 도달.

---

## 2. Current State Audit

### 2.1 CapabilityExplorerPanel inventory

`web/src/ui/CapabilityExplorerPanel.ts` (742 lines, functional scaffold):

| 영역 | Lines | Status |
|---|---|---|
| Constructor | 103-163 | ✅ DOM setup, search input, Tier 3 toggle, localStorage persistence |
| Lifecycle methods | 165-181 | ✅ show / hide / toggle / isVisible / dispose |
| Filter | 197-205 | ✅ `filterActions(query)` — case-insensitive substring on id/label/description |
| Tree render | 207-245 | ✅ Tier group, Tier 3 hidden by toggle |
| Tier group | 252-274 | ✅ Color dots per tier |
| Action row | 276-307 | ✅ Expandable rows, click handler |
| Action details | 309-332 | ✅ Description / surfaces / aliases / ADRs |
| Action form | 343-398 | ✅ Tier 0 inline args |
| Invocation | 402-457 | ⚠ Tier 0 working, Tier 1/2/3 confirm dialog stubbed (60% complete per ADR-063 Step 4) |

**Integration sites**: CapabilityExplorerPanel.ts 가 web/src 의 **유일한** ActionCatalog import site (regression test `capability_explorer_imports_only_capability_explorer_panel` 으로 보장). NOT wired in main.ts / ToolManager / MenuBar / KeyboardShortcuts yet.

### 2.2 ActionCatalog SSOT inventory

`packages/axia-action-catalog/` (95 actions registered):

| Tier | Count | Description |
|---|---|---|
| Tier 0 (read) | 12 | get_scene_summary / list_xias / get_face_info / ... |
| Tier 1 (constructive) | 29 | draw_rect / draw_circle / draw_line / export_axia / ... |
| Tier 2 (modificative) | 54 | push_pull / boolean_subtract / fillet_edge / move_xia / ... |
| Tier 3 (destructive) | 0 | (reserved — ADR-046 Phase 2 will add) |

**Per-action metadata**: id (kebab) / label (Korean) / description / tier / surfaces[] / aliases (bridge/wasm/mcp/legacy) / status / adrs[].

**Surface coverage**:
| Surface | Count |
|---|---|
| menu | 69 |
| keyboard | 32 |
| context | 23 |
| context-only | 12 |
| palette | 13 |
| mcp | 14 |

**Lookup API**: Built-once indices (`BY_ID`, `BY_BRIDGE`, `BY_WASM`, `BY_MCP`, `BY_LEGACY`); 4 alias channels supported. Duplicate detection on load.

### 2.3 ActionCatalog binding gaps

ADR-045 D1 SSOT policy 잠겼으나 UI binding 미완:

| Site | Hardcoded actions | ActionCatalog 통합 |
|---|---|---|
| MenuBar.ts | 121 menu leaves | ❌ 모두 hardcoded |
| KeyboardShortcuts.ts | 36 keyboard handlers | ❌ 모두 hardcoded |
| ShortcutHelpModal.ts | 50+ help rows | ❌ 모두 hardcoded |
| ToolManager dispatch | string literals | ❌ ActionCatalog lookup 미사용 |

**Drift vector**: MenuBar Korean 라벨이 ActionCatalog labels 와 일치 (sample: '선형 배열' for `array-linear`) — 즉 *수동 동기화* 의존. Phase 2 integration 이 이 drift vector 자동 해소.

### 2.4 Cmd-K palette 현재 state

`web/src/ui/KeyboardShortcuts.ts` (lines 40-514):
- Static keyMap, no Cmd-K handler
- F1 → ShortcutHelpModal toggle (line 113-116)
- **Cmd-K NOT implemented**

**Fuzzy search**: NO library imported (package.json 확인 — fuse / fuzzysort / minisearch 모두 부재). CapabilityExplorerPanel.ts 는 native `String.toLowerCase().includes()` 사용.

### 2.5 i18n 인프라

**Status**: NO i18n infrastructure. Korean strings hardcoded throughout.

Samples:
- CapabilityExplorerPanel:26-32 — `'Tier 0 — Read'` English only
- KeyboardShortcuts:24-38 — tool names English
- ShortcutHelpModal:20-100 — SECTIONS Korean (도구, 편집, etc.)
- MenuBar — Mixed English structure + Korean comments
- Toast.info('XIA가 선택되지 않았습니다') — Korean injected directly

**Language detection**: 없음. `navigator.language` check 없음.

ADR-046 Q7 (Korean + English) 는 Phase 2 explicit gate — 본 ADR-130 scope 외.

### 2.6 Prerequisites assessment

| Blocker | Status | Phase 2 impact |
|---|---|---|
| ActionCatalog API completeness | ✅ Ready | Cmd-K queries operational |
| CapabilityExplorer Step 4 (dispatch) | ⚠ 60% | Palette action invoke requires completion |
| MenuBar ActionCatalog binding | ❌ Not started | Phase 2 automates help generation |
| KeyboardShortcuts ActionCatalog binding | ❌ Not started | Phase 2 surfaces keyboard actions in palette |
| i18n infrastructure | ❌ Not started | ADR-046 Q7 defers to Phase 2 |
| Fuzzy search library | ❌ Not selected | Cmd-K depends on it |

---

## 3. Cmd-K Library Options Matrix

AxiA architecture = **vanilla TS** (no React/Vue/Solid — 확인). 따라서 React-based libraries (`cmdk`, `kbar`) 부적합.

| Library | Type | Size | Pros | Cons | AxiA fit |
|---|---|---|---|---|---|
| **Native (no lib)** | Vanilla TS | 0 deps | Full control, minimal bundle | Fuzzy search DIY, DOM boilerplate | ✅ Good (vanilla TS + jsdom tests ready) |
| **cmdk** (Vercel) | React | ~10KB | Accessible, dark-mode, live-search | React-only | ❌ Incompatible |
| **kbar** | React | ~8KB | Palette + history | React-only | ❌ Incompatible |
| **fuse.js** | Vanilla | 6KB gzipped | Mature fuzzy search, weighted scoring | Add-on to custom DOM | ✅ Good (pair with native DOM) |
| **fuzzysort** | Vanilla | 1.5KB gzipped | Faster than fuse, smaller | Fewer features (no weight) | ✅ **Excellent (minimal, fast)** |
| **Custom + regexp** | Vanilla | 0 deps | Exact control | Simple fuzzy only | ✅ Acceptable (quick bootstrap) |

### 3.1 권장: Native DOM + fuzzysort

근거:
- AxiA vanilla TS 정합 (React 사용 안 함, 확인 완료)
- 1.5KB gzipped → ADR-035 P20.C #2 (initial bundle 0MB strict) 위반 무관 (lazy chunk 가능)
- substring matching 으로 시작 → fuzzysort upgrade 후 (γ-2 보강 또는 별도 ADR)
- 200 lines native DOM + 1 lib dep = minimum risk

---

## 4. γ Sub-step 분할 매트릭스

ADR-129 권장 Q3 (single PR per priority) 정합으로 Pillar 1 implementation 을 sub-step 분할:

| γ sub-step | Scope | LoC | 시간 | risk |
|---|---|---|---|---|
| **γ-1** | **Cmd-K entry point + empty modal** — KeyboardShortcuts.ts `Cmd-K` handler + CommandPalette.ts empty modal, no actions | ~150 LoC + 5 회귀 | 1-2일 | Low |
| **γ-2** | **Palette listing + substring search** — CommandPalette uses ActionCatalog `listActions()` + native substring filter, click → CapabilityExplorerPanel invoke | ~200 LoC + 7 회귀 | 2-3일 | Low-Medium |
| **γ-3** | **CapabilityExplorer Step 4 completion** — Tier 1/2/3 dispatch logic + main.ts wiring (handleInvoke callback). Pre-existing 60% → 100% | ~250 LoC + 8 회귀 | 2-3일 | Medium (engine binding) |
| **γ-4** | **Fuzzy search upgrade** — replace native substring with fuzzysort, weighted ranking | ~100 LoC + 4 회귀 | 1일 | Low |
| **γ-5** | **MenuBar ActionCatalog binding** — 121 menu leaves → ActionCatalog lookup. Phase 2 prep | ~400 LoC + 15 회귀 | 3-5일 | Medium (drift 자동 해소) |
| **γ-6** | **KeyboardShortcuts ActionCatalog binding + ShortcutHelp auto-gen** — 36 handlers + 50+ help rows | ~500 LoC + 20 회귀 | 4-6일 | Medium (i18n strings) |

### 4.1 추천 분할 (priority order)

| 순위 | Sub-step | 근거 |
|---|---|---|
| **1st (γ-1)** | Cmd-K entry point + empty modal | 가장 단순/신속, 사용자 가시 가치 즉시 (Cmd-K 누름 → modal 등장) |
| **2nd (γ-2)** | Palette listing + click | γ-1 + ActionCatalog 표시 (사용자 가치 = 모든 95 actions 검색 가능) |
| **3rd (γ-3)** | CapabilityExplorer Step 4 completion | invoke 가능 → Cmd-K 의 *완전한 가치* 활성 |
| **4th (γ-4)** | Fuzzy search upgrade | 사용자 facing 정밀도 향상 |
| **5th (γ-5)** | MenuBar binding | Phase 2 drift 자동 해소 (architectural value) |
| **6th (γ-6)** | KeyboardShortcuts + ShortcutHelp auto-gen | Phase 2 auto-generation |

**Total: ~10일 atomic sub-steps** (각자 별도 atomic PR per LOCKED #44). ~2주 estimated for Pillar 1 closure (γ-1 ~ γ-3 핵심).

---

## 5. 결재 트리거 (사용자 명시 선택 필요)

### 5.1 Q1 — γ-1 진입 방식

- **(a) γ-1 단독 atomic PR** (1-2일) — Cmd-K entry point + empty modal, ActionCatalog 통합 미포함
- **(b) γ-1 + γ-2 묶음** (3-5일) — Cmd-K + palette listing 동시 (사용자 가치 극대화)
- **(c) γ-1 + γ-2 + γ-3 묶음** (5-8일) — 완전한 Cmd-K (invoke 포함) atomic
- **(d) γ-3 단독 우선** (2-3일) — CapabilityExplorer Step 4 완료 먼저 (기존 60% 보강), Cmd-K 다음

### 5.2 Q2 — Cmd-K library

- **(a) Native DOM + fuzzysort** (권장) — vanilla TS 정합, 1.5KB gzipped, atomic 가능
- **(b) Native DOM + substring only** — γ-2 까지는 substring, γ-4 에서 fuzzysort 추가
- **(c) fuse.js** — 6KB, 더 풍부한 feature
- **(d) Custom + regexp** — 0 deps, simple fuzzy

### 5.3 Q3 — γ-5 / γ-6 진입 시점

- **(a) Pillar 1 closure 의 일부** — γ-1 ~ γ-6 모두 Pillar 1 closure 전까지
- **(b) Pillar 1 closure (γ-1~γ-4) 후 별도 Phase 2 ADR** — 사용자 시연 evidence 후 진입
- **(c) Phase 2 trigger 시점에 별도 ADR-131 (가칭)** — 본 Pillar 1 ADR 은 γ-1~γ-3 closure 까지만

### 5.4 권장 default

- **Q1 (a) γ-1 단독 atomic** — 단순/신속/정확, ADR-046 P31 #4 additive only 정합
- **Q2 (a) Native DOM + fuzzysort** — 권장 library (vanilla TS + 최소)
- **Q3 (c) γ-5/γ-6 별도 ADR-131** — Pillar 1 closure = γ-1~γ-3 (γ-4 fuzzy upgrade 선택), γ-5/γ-6 = Phase 2 architectural trigger

대안: **Q1 (b) γ-1 + γ-2 묶음** — 빠른 사용자 가치 (palette listing 까지).

---

## 6. Lock-ins (canonical, L-130-1 ~ L-130-9)

- **L-130-1** ADR-129 Priority #1 anchor — Pillar 1 (Discoverability) "가장 시급" per ADR-046 §8
- **L-130-2** ADR-045 D1 (ActionCatalog SSOT) policy 잠김 + D3 (CapabilityExplorer spec) Step 3/5 closure — γ-3 가 Step 4 완료
- **L-130-3** AxiA vanilla TS 정합 — React-based libraries (cmdk / kbar) 거부, native DOM + fuzzysort 권장
- **L-130-4** ADR-046 P31 #4 additive only — Cmd-K 는 *추가* shortcut, 기존 menu / KeyboardShortcuts 변경 없음 (γ-1 ~ γ-4)
- **L-130-5** γ-5 (MenuBar binding) + γ-6 (KeyboardShortcuts auto-gen) = ActionCatalog drift 자동 해소 — 별도 ADR-131 (가칭) trigger
- **L-130-6** i18n (ADR-046 Q7 Korean + English) Phase 2 explicit gate — 본 ADR-130 scope 외 (별도 i18n ADR future)
- **L-130-7** ADR-035 P20.C #2 (initial bundle 0MB strict) 정합 — fuzzysort 는 lazy chunk 가능 (CommandPalette dynamic import)
- **L-130-8** ADR-087 K-ζ 사용자 시연 게이트 — 각 γ sub-step closure 후 즉시 사용자 manual 시연 (Cmd-K 사용 가능 확인)
- **L-130-9** 절대 #[ignore] 금지

---

## 7. Out of Scope (별도 ADR per LOCKED #44)

- **γ-5 MenuBar ActionCatalog binding** (~3-5일, 121 menu leaves migration) — 별도 ADR-131 (가칭)
- **γ-6 KeyboardShortcuts ActionCatalog binding + ShortcutHelp auto-gen** (~4-6일) — 별도 ADR-132 (가칭)
- **i18n infrastructure** (ADR-046 Q7 Korean + English) — 별도 i18n architectural ADR
- **Tier 3 destructive actions content** (ADR-045 D3 reserved) — 별도 ADR (Phase 2+ trigger)
- **Visual baseline regenerate for new Cmd-K modal** — ADR-129 Priority #2 (ADR-077 V-4) 별도 진행

---

## 8. Cross-link

- **ADR-129** — priority track spec (Pillar 1 = Priority #1)
- **ADR-046 P31** — UI/UX long-term strategy (Pillar 1 anchor)
- **ADR-045 D1** — ActionCatalog SSOT (95 actions, BY_ID/BY_MCP/BY_LEGACY 4 channels)
- **ADR-045 D3** — CapabilityExplorer spec (Step 3 closure, Step 4 partial, Step 5 closure)
- **ADR-063** — Capability Explorer panel (existing scaffold reference)
- **ADR-074 D-3** — ActionCatalog ↔ MCP integration (Pillar 4 AI Seam)
- **ADR-118 / ADR-120 / ADR-122 / ADR-123 / ADR-129** — α spec → β implementation atomic pattern source
- **ADR-035 P20.C #2** — initial bundle 0MB strict (L-130-7)
- **ADR-046 P31 #4** — additive only (L-130-4)
- **ADR-087 K-ζ** — 사용자 시연 게이트 canonical (L-130-8)
- **LOCKED #43** — 직전 priority track (100% closure milestone)
- **LOCKED #44** — Complete Meaning per Merge (γ-1~γ-6 sub-step 별 atomic PR)
- **LOCKED #58** — ADR-128 직전 closure (priority #4)

---

## 9. 결재 요청

본 spec only PR (α). 사용자 결재 후 채택된 γ sub-step 만 별도 atomic sub-step PR 진행.

**Q1 γ-1 진입 방식 선택** + Q2-Q3 default 채택 여부 명시 부탁드립니다.

**권장 default 요약**:
- **Q1 (a) γ-1 단독 atomic** — Cmd-K entry point + empty modal, 1-2일
- **Q2 (a) Native DOM + fuzzysort** — vanilla TS 정합, 1.5KB lazy chunk
- **Q3 (c) γ-5/γ-6 별도 ADR-131/132** — Pillar 1 closure = γ-1~γ-3 (γ-4 옵션)
- **Q4** 각 γ sub-step closure 후 즉시 사용자 시연 (ADR-087 K-ζ)

**대안**:
- **Q1 (b) γ-1 + γ-2 묶음** — Cmd-K + palette listing 동시, 빠른 사용자 가치
- **Q1 (c) γ-1+γ-2+γ-3 묶음** — 완전한 Cmd-K atomic, 5-8일
- **Q1 (d) γ-3 단독 우선** — CapabilityExplorer Step 4 완료 먼저
