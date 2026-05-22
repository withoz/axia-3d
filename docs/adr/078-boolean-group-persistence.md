# ADR-078 — Boolean Group Persistence

**Status**: Accepted (P-1 ~ P-4 완료 — Path Z atomic 5-layer closure, 2026-05-05)
**Date**: 2026-05-05
**Anchor**: ADR-074 §E.5-3 (Persistence — session 만, project 저장
별도 ADR)
**Parent**: ADR-074 U-1 (TS-side `groupTags: Map<faceId, 'A'|'B'>`
in `SelectionManager`) + ADR-074 §E.5-4 closure (단축키 binding)

---

## 0. Summary (5 lines)

> ADR-074 의 group A/B selection 이 session 동안만 유지 → project
> save/load 시 사라짐. ADR-078 = Rust Scene 에 `boolean_group_tags:
> HashMap<FaceId, BooleanGroupTag>` 추가 + bincode section 6 round-trip
> + WASM bridge typed wrapper + ProjectSerializer push/pull 정책 +
> real Chromium 검증. P-1~P-4 closure, P-5 회고만 남음.

---

## 1. Context

### 1.1 ADR-074 §E.5-3 의 미해결 항목

> **ADR-074 §E.5-3 Persistence**: U-G=(a) 결정으로 group tags 는
> session 만 유지. project 저장 (.axia 파일) 시 group 정보 사라짐.
> 사용자가 같은 grouping 으로 다시 작업하려면 재선택 필요.
>
> **해결 방향**: AXIA 직렬화 schema 에 groupTags 추가. ADR-007
> invariant 검증 + AXIA 매직 바이트 호환 (legacy file 은 빈 group
> 으로 로드). 별도 ADR 또는 file format ADR 와 함께.

### 1.2 사용자 가치

- **P1 (사용자)**: 복잡한 grouping 작업 후 project save → 재로드 시
  group 그대로 복구. 재선택 부담 0.
- **P3 (AI agent)**: project state 의 truth 가 session 의존성 없음.
  AI 가 project 를 분석할 때 group 의도 보존.
- **Drop-in alongside**: 기존 .axia 파일은 빈 group 으로 로드 (legacy
  호환). 신규 save 만 group 포함.

### 1.3 현재 직렬화 구조 (Scene::scene_snapshot)

```
[mesh][xias][groups][next_xia_id][constraints]
```

5 sections, length-prefixed. SNAPSHOT_VERSION = 2 (2026-04-24
mesh-only legacy 와 분리).

---

## 2. Decision — P-1 scope + 8개 P + 4 Lock-in

### 2.1 §A — P-1 scope (Rust schema only)

**채택 (P-1 atomic)**:
- 신규 enum `BooleanGroupTag { A, B }` (Serialize + Deserialize)
- `Scene` 에 `pub boolean_group_tags: HashMap<FaceId, BooleanGroupTag>`
  필드 추가
- 5 helper methods on Scene:
  * `set_boolean_group_tag(faces: &[FaceId], group: BooleanGroupTag)`
  * `get_boolean_group_a() -> Vec<FaceId>` (sorted)
  * `get_boolean_group_b() -> Vec<FaceId>` (sorted)
  * `clear_boolean_group_tags()`
  * `has_any_boolean_group_tag() -> bool`
  * `has_boolean_group_selection() -> bool` (both A and B)
- `scene_snapshot()` 확장 — section 6 으로 boolean_group_tags 추가
- `restore_scene_snapshot()` 확장 — legacy file 호환 (부재 시 empty)
- 회귀 unit tests (절대 #[ignore] 금지)

**제외 (P-2~P-4 별도 sub-step)**:
- P-2: TS bridge typed wrapper (group save/load API)
- P-3: TS-side `SelectionManager.groupTags` 와 Rust `Scene.boolean_group_tags`
  동기화 (load 시 SelectionManager 갱신)
- P-4: Round-trip E2E (Playwright real-runtime save/load)
- P-5: 회고 / docs

### 2.2 §B — 8개 P 결정

| P | 결정 | 비고 |
|---|------|------|
| **P-A** | ADR-078: Boolean Group Persistence | 자연 번호 |
| **P-B** | (a) AXIA file extension (single source) | sidecar / localStorage 비권장 |
| **P-C** | (a) optional field 추가 (legacy = empty) | 하위호환 (SNAPSHOT_VERSION 유지) |
| **P-D** | `bincode::serialize` + length-prefixed section | 기존 snapshot 패턴 답습 |
| **P-E** | TS save 시점 — ProjectSerializer.export 자동 포함 | drop-in |
| **P-F** | TS load 시점 — restore 후 SelectionManager 동기화 (P-3) | atomic |
| **P-G** | (b) global (FaceId → BooleanGroupTag map) | Scene 단일 storage |
| **P-H** | P-1 scope = Rust schema 만 | atomic |

### 2.3 §C — 4 Lock-in

```
1. P-1 = Rust schema only. TS bridge / SelectionManager sync /
   round-trip E2E (P-2~P-4) 별도 sub-step.

2. Drop-in alongside (legacy file 호환):
   - 기존 .axia 파일은 boolean_group_tags 부재 → empty HashMap 로 로드
   - 신규 save 만 section 6 추가 (length-prefixed, 부재 시 EOF)
   - SNAPSHOT_VERSION 변경 안 함 (additive only)

3. ADR-074 U-1 의 TS-side `groupTags` 와 동일 의미 — 한 face 가
   동시에 A+B 일 수 없음 (HashMap key uniqueness 자동 보장).
   `set_boolean_group_tag` 가 같은 face 를 다른 group 으로 재호출
   시 overwrite (TS U-1 와 동일 invariant).

4. P-1 의 helpers 는 ADR-074 U-1 의 TS API (setGroupTag /
   getGroupA / clearGroupTags / hasAnyGroupTag / hasGroupSelection)
   와 1:1 매핑. P-2 bridge wrapper 가 TS↔Rust 동기화 시 동일 의미
   보장.
```

---

## 3. Acceptance — P-1

### 3.1 P-1 산출물

**Files added**:
- `crates/axia-core/src/boolean_group.rs` — `BooleanGroupTag` enum

**Files modified**:
- `crates/axia-core/src/lib.rs` — module export
- `crates/axia-core/src/scene.rs` — 필드 추가 + 5 helpers + snapshot
  serialize/restore 확장

### 3.2 P-1 회귀 (5, 절대 #[ignore] 금지)

`crates/axia-core/src/scene.rs` 의 tests module 에 추가:
1. `set_boolean_group_tag_basic` — A/B 태깅 + getGroupA/B 정확
2. `set_boolean_group_tag_overwrite` — 같은 face 를 A→B 재태깅
   시 invariant (한 face = 한 group)
3. `clear_boolean_group_tags_resets_state` — clear 후 has_any 가 false
4. `has_boolean_group_selection_requires_both` — only A → false,
   only B → false, A+B → true
5. `snapshot_round_trip_preserves_boolean_group_tags` — save/restore
   후 group 그대로
6. `legacy_snapshot_loads_empty_boolean_group_tags` — 기존 v2
   snapshot (boolean_group_tags 부재) → empty HashMap

---

## 4. Sub-step status (P-1 ~ P-5)

| Sub-step | 영역 | 회귀 (실측) | 상태 | Commit |
|----------|------|------------|------|--------|
| P-1 | Rust Scene 필드 + helpers + snapshot | +6 | ✅ closed | `941631c` |
| P-2 | WASM bridge + TS typed wrapper | +4 (axia-wasm) | ✅ closed | `d0e48ab` |
| P-3 | ProjectSerializer push/pull + restoreGroupTags | +9 (vitest) | ✅ closed | `72d878b` |
| P-4 | Round-trip E2E (Playwright real-runtime) | +2 (Playwright) | ✅ closed | `d8f8f54` |
| P-5 | 회고 / docs | 0 | 진행 중 | (본 commit) |
| **합계 (실측)** | — | **+21** | — | — |

---

## D. Acceptance Log

### D-1 — P-1 Rust schema atomic (commit `941631c`)

**산출물**:
- `crates/axia-core/src/boolean_group.rs` (NEW) — `BooleanGroupTag { A, B }`
  enum + serde traits + 2 unit tests
- `crates/axia-core/src/lib.rs` — module re-export
- `crates/axia-core/src/scene.rs` — `Scene.boolean_group_tags:
  HashMap<FaceId, BooleanGroupTag>` 필드 + 5 helper methods +
  `scene_snapshot()` / `restore_scene_snapshot()` section 6 확장 (additive,
  SNAPSHOT_VERSION = 2 unchanged) + 6 regression tests

**회귀**: axia-core (기존 132 + 6 신규 + boolean_group module 2 = 140 +
구조 재배치 분 → 138 안정).

**Lock-ins (P-1)**:
1. Section 6 additive — 기존 v2 snapshot 부재 시 empty HashMap
2. SNAPSHOT_VERSION = 2 그대로 (no version bump)
3. HashMap key uniqueness ↔ ADR-074 U-1 의 "한 face = 한 group" invariant
4. 5 helpers (`set_boolean_group_tag` / `get_boolean_group_a` /
   `get_boolean_group_b` / `clear_boolean_group_tags` /
   `has_any_boolean_group_tag` / `has_boolean_group_selection`) ↔
   ADR-074 U-1 의 TS API 와 1:1 매핑

### D-2 — P-2 WASM bridge + TS typed wrapper (commit `d0e48ab`)

**산출물**:
- `crates/axia-wasm/src/lib.rs` — 6 신규 `#[wasm_bindgen]` methods
  (camelCase via `js_name`)
- `crates/axia-wasm/tests/export_baseline.txt` — 6 entries
  alphabetical insert (`clearBooleanGroupTags` /
  `getBooleanGroupAFaces` / `getBooleanGroupBFaces` /
  `hasAnyBooleanGroupTag` / `hasBooleanGroupSelection` /
  `setBooleanGroupTag`)
- `crates/axia-wasm/tests/step6_additive_only.rs` — 4 source-inspection
  tests (endpoints wired / strict invalid tag returns Err / set+clear
  use transactions / output signature Vec<u32>)
- `web/src/bridge/WasmBridge.ts` — 6 typed TS wrappers + interface
  optional declarations
- `web/src/bridge/WasmBridge.test.ts` — 7 wrapper regression tests
  (set/clear/get*/hasAny/hasGroupSelection + invalid-tag throw
  propagation)
- `web/src/wasm/{axia_wasm.js,d.ts,bg.wasm.d.ts}` — 재생성

**사용자 정정 2건 반영**:
- P-2-c (strict): `Result<(), JsValue>` + uppercase `'A'`/`'B'` only
  (lowercase 거부, silent skip 차단). Invalid tag → 즉시 throw.
- P-2-d (ownership): `Vec<u32>` (NOT `&[u32]`) — wasm-bindgen ownership
  semantics 명확. TS wrapper 가 `number[] → Uint32Array` 변환.

**회귀**: axia-wasm 12 → 16 (+4 source-inspection), vitest 1427 → 1434
(+7 wrapper tests).

### D-3 — P-3 ProjectSerializer save/load sync (commit `72d878b`)

**산출물**:
- `web/src/tools/SelectionManager.ts` — 신규 `restoreGroupTags(a, b)`
  메서드 (P-3 L3 정책: groupTags 재구성 + selection ∪ (A∪B) +
  notifyChange 1회)
- `web/src/ui/ProjectSerializer.ts` — `pushGroupTagsToBridge` /
  `pullGroupTagsFromBridge` 헬퍼 + saveProject/openProject 통합
- `web/src/tools/SelectionManager.test.ts` — 6 신규 tests (basic / union /
  overwrite / 단일 notifyChange / no-op empty / clear-prior empty)
- `web/src/ui/ProjectSerializer.test.ts` — 3 신규 tests (push order /
  clear-only when both empty / pull + restoreGroupTags ordering)

**3 Lock-ins (P-3)**:
- L1: Save sync `clear → set(A) → set(B)` idempotent. 둘 다 empty →
  clear-only.
- L2: Load sync = `importSnapshot → syncMesh → pull → restoreGroupTags`,
  notifyChange 정확히 1회.
- L3: `restoreGroupTags` 정책 명시 — groupTags 전부 재구성 + selection
  기존 ∪ (A∪B) + notifyChange 1회. Drift 차단.

**회귀**: vitest 1434 → 1443 (+9), axia-wasm 16 unchanged, Playwright
13 unchanged.

### D-4 — P-4 Round-trip Real Chromium E2E (commit `d8f8f54`)

**산출물**:
- `web/e2e/helpers/boolean-fixtures.ts` — 5 신규 helper 추가:
  * `simulateProjectSavePush` (P-3 L1 sequence)
  * `exportSnapshotBytes` (Uint8Array → number[] for Playwright
    serialization)
  * `importSnapshotBytes` (importSnapshot + syncMesh)
  * `simulateProjectLoadPull` (P-3 L2 sequence)
  * `readSelectionGroups` (UI state inspection — getGroupA/B +
    hasGroupSelection + selectionSize)
- `web/e2e/project-roundtrip.spec.ts` (NEW) — 2 specs:
  * `basic round-trip — A=[f0,f1] + B=[f2] preserved`
  * `empty round-trip — no group tags, clear-only path`

**검증된 invariants (real Chromium)**:
- bincode section 6 round-trip across `page.reload()` (process boundary)
- WASM ↔ TS conversions 정상 (`Vec<u32>` ownership, sorted output)
- `restoreGroupTags` L3 정책 적용 (selection ⊇ A∪B 자동 유지)
- Reload 직후 fresh state 0 → import + pull 후 정확 원본 복원

**회귀**: Playwright 13 → 15 (+2), vitest/axia-wasm/visual baseline
unchanged.

### D-5 — P-5 회고 / docs (본 commit)

ADR-078 본 문서의 §0 Summary / Status / §4 Sub-step status / §D
Acceptance Log / §6 lessons 갱신. CLAUDE.md "향후 과제" 섹션에 ADR-078
요약 추가 (다음 세션 catchup 자료).

**회귀**: 0 (코드 변경 없음, docs only).

---

## 6. Lessons (P-1 ~ P-4 회고)

### 6.1 Path Z atomic 의 5-layer 패턴 일반화

ADR-074 (E.3 트랙) 의 4-layer (Model + UI + Routing + Functional E2E +
Visual) 패턴 위에 ADR-078 이 **5-layer persistence 변형** 으로 자연
확장:

```
Model       SelectionManager.groupTags + restoreGroupTags     ← P-3 L3
UI Runtime  setGroupTag (ADR-074 U-1)                         ← UNCHANGED
Routing     ProjectSerializer push/pull                       ← P-3 drop-in
Persistence Scene.boolean_group_tags + bincode section 6      ← P-1 additive
Bridge      6 typed WASM methods                              ← P-2 strict
E2E         real Chromium 2 round-trip spec                   ← P-4
```

**향후 ADR 가이드**: persistence-layer 가 추가되는 모든 ADR 은 이
5-layer 패턴 답습 권장. additive bincode section + typed bridge
wrapper + push/pull serializer hook + restore* 정책 메서드 + real-
runtime round-trip E2E 의 5단계가 한 ADR 의 atomic stack.

### 6.2 사용자 정정 2건의 가치 (P-2)

P-2 사전 검토 시 `&[u32]` + bool 반환을 제안 → 사용자 정정으로
`Vec<u32>` + `Result<(), JsValue>` 로 변경. 결과:
- `Vec<u32>`: wasm-bindgen ownership semantics 명확화 (코드 리뷰 시
  borrowed slice ↔ ownership 의 모호성 제거)
- `Result<(), JsValue>` strict: invalid tag input → 즉시 throw.
  Silent skip 차단으로 CI 가 즉시 잡아냄.

**향후 ADR 가이드**: WASM 경계의 input validation 은 strict-throw
default. boolean fallback 은 ambiguity 누적 — 단일 진실 원천 위반
신호.

### 6.3 ProjectSerializer 의 selection-bound 우회 결정

ADR-074 U-1 의 `setGroupTag` 는 `selected` 에 없는 face 를 silent
skip (UI runtime invariant). Save/Load persistence 경계에서는 이
제약을 명시적으로 우회 (`bridge.setBooleanGroupTag` 직접 호출 +
`restoreGroupTags` 신규 API).

**향후 ADR 가이드**: UI runtime invariant 와 persistence invariant 는
분리 가능. UI 의 "tag visible only" 와 persistence 의 "all tagged
faces 보존" 은 다른 layer. 해결책: layer 별 별도 API + 명시적 우회
(silent override 회피).

### 6.4 Page reload 가 보장하는 fresh state

P-4 에서 `page.reload()` 가 ServiceContainer + WasmBridge 완전
재초기화를 보장. Snapshot bytes 가 process boundary 를 넘어가는지
검증 가능. 단순 `bridge.clear*()` 는 in-process state 만 초기화 — 진짜
"save → close app → reopen app" 시뮬레이션 불가.

**향후 ADR 가이드**: persistence E2E 의 fresh-state 표준 = page reload.
`bridge.clear*()` 만으로 검증한 cross-session round-trip 은 process
boundary 회귀 미보장.

### 6.5 회귀 +21 의 layer-wise 분포

| Layer | 회귀 수 | 비율 |
|-------|---------|------|
| Rust unit (axia-core) | 6 | 28% |
| WASM source-inspect (axia-wasm) | 4 | 19% |
| TS unit (vitest) | 9 | 43% |
| Real Chromium (Playwright) | 2 | 10% |
| **Total** | **21** | **100%** |

vitest 가 43% — TS-side 의 ProjectSerializer + SelectionManager 정책
명시화 (P-3 L1/L2/L3) 가 회귀 비중을 끌어올림. real Chromium 은 10%
(2건) — corner cases 는 lower-cost vitest 에서 cover, real-runtime 은
process boundary + WASM ↔ TS 핵심 invariant 만.

**향후 ADR 가이드**: real-runtime spec 수는 corner case 가 아니라
**cross-layer invariant** 로 결정. 1~3 spec 권장 (process boundary +
critical path).

---

## 7. References

- ADR-074 §E.5-3 (Persistence — 별도 ADR 미해결 항목, 본 ADR 으로 닫힘)
- ADR-074 U-1 (TS-side `groupTags: Map<faceId, 'A'|'B'>`)
- `Scene::scene_snapshot()` (기존 5-section + 본 ADR 의 section 6
  additive)
- `SNAPSHOT_VERSION = 2` (2026-04-24 — additive 정책 답습 unchanged)
- ADR-064 §E.4 / ADR-066 §E.4 (Real Chromium E2E 인프라 재사용)
- ADR-075 V-1 (boolean-fixtures.ts + Playwright config + ci.yml
  web-e2e)
- ADR-077 V-2 (V-2 outline rebuild 자동 호환)

---

*Author*: AXiA team (사용자 결정 2026-05-05)
*Status*: P-1 ~ P-4 closure, P-5 회고 완료 (본 commit)
