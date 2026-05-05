# ADR-078 — Boolean Group Persistence

**Status**: P-1 진입 (Path Z atomic, 사용자 결정 2026-05-05)
**Date**: 2026-05-05
**Anchor**: ADR-074 §E.5-3 (Persistence — session 만, project 저장
별도 ADR)
**Parent**: ADR-074 U-1 (TS-side `groupTags: Map<faceId, 'A'|'B'>`
in `SelectionManager`) + ADR-074 §E.5-4 closure (단축키 binding)

---

## 0. Summary (4 lines)

> ADR-074 의 group A/B selection 이 session 동안만 유지 → project
> save/load 시 사라짐. 사용자가 재선택 부담. ADR-078 = Rust Scene
> 에 `boolean_group_tags: HashMap<FaceId, BooleanGroupTag>` 추가
> + serialize round-trip. P-1 = Rust schema atomic. P-2~P-4 별도.

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

## 4. Future Steps (별도 sub-step)

| Sub-step | 영역 | 회귀 (예상) |
|----------|------|------------|
| P-1 | Rust Scene 필드 + helpers + snapshot | 5-6 |
| P-2 | WASM bridge + TS typed wrapper | 4-5 |
| P-3 | SelectionManager ↔ Scene 동기화 (load 시 setGroupTag 호출) | 3 |
| P-4 | Round-trip E2E (Playwright save/load real-runtime) | 2 |
| P-5 | 회고 / docs | 0 |
| **합계 (예상)** | — | **~14-16** |

---

## 5. References

- ADR-074 §E.5-3 (Persistence — 별도 ADR 미해결 항목)
- ADR-074 U-1 (TS-side `groupTags: Map<faceId, 'A'|'B'>`)
- `Scene::scene_snapshot()` (기존 5-section length-prefixed format)
- `SNAPSHOT_VERSION = 2` (2026-04-24 — additive 정책 답습)

---

*Author*: AXiA team (사용자 결정 2026-05-05)
*Status*: P-1 implementation 진행 중
