# ADR-095: Reference Citizenship (Two-Layer Citizenship Phase 3) — **Accepted**

- **Status**: Accepted (Phase 3-α ~ 3-ζ closure 2026-05-09)
- **Date**: 2026-05-09
- **Anchor**: LOCKED #26 의 Phase 3 명시 약속. ADR-049 §4 Phase 3
  ("Reference 시민권 분리 — Construction Line / Imported Mesh /
  Point Cloud") 의 architectural 이행.
- **Parent**: ADR-049 (Two-Layer Citizenship Model)
- **Sibling**: ADR-050 (Phase 1 — Shape/Xia type split, ✅ 2026-05-06),
  ADR-091 (Phase 2 — Material removal demote, ✅ 2026-05-09)
- **Lessons applied**: ADR-091 §E (L1 bincode struct field 금지 — Mesh/
  Scene-level HashMap 답습), ADR-093 §E (L1 ADR-091 L1 canonical 적용),
  ADR-094 §E (L1 additive-first / L4 Engine OFF + Production ON pattern)

## 0. Summary

Form/Property 두 시민권 layer 와 **직교** 하는 *Reference* 시민권 도입.
Construction Line (작도선), Imported Mesh (외부 참조 — STEP/IGES/OBJ
import 결과), Point Cloud (외부 스캔 데이터) 가 form 도 property 도
아닌 *별개 분류*.

**LOCKED #26 메타-원칙 #2 답습**: "외부 참조는 형태/모양만". Reference
시민은:
- 사용자 의도: *수정 안 함* (build 대상 아님)
- 시각: 별도 표시 (현재는 미구분)
- AI agent (P3): build vs reference 명시 구분 → 의도 차이 차단

## 1. Context

### 1.1 v3.2 spec 약속 (LOCKED #26 anchor)

LOCKED #26 의 5-Phase 로드맵:
- Phase 1 ✅ Shape/Xia type split (ADR-050) — 2026-05-06
- Phase 2 ✅ Material removal demote (ADR-091) — 2026-05-09
- **Phase 3 — Reference 시민권 분리** ← 본 ADR
- Phase 4 — 위상 손상 자동 복구 (Q5 사건 2~4)
- Phase 5 — 자산 라이브러리 + Layered material

### 1.2 architectural natural 결합 (5개월 누적)

| 기존 ADR | Reference 시민권 활용 |
|---|---|
| ADR-019 (Line is Truth) | 작도선 (construction line) 의 first-class 시민권 정착 |
| ADR-035~036 (STEP/IGES Hybrid) | Import 결과를 자연 Reference 분류 |
| ADR-081~086 (NURBS-class import) | 외부 CAD 모델을 *수정 안 할 의도* 명시 |
| ADR-093 (surface_owner_id) | Reference group 식별자 패턴 활용 |
| ADR-094 (annulus) | Reference 의 multi-loop 표현 (point cloud bounding) |

### 1.3 사용자 facing 가치

- **P1 (건축/디자인)**: 작도선이 build 결과에서 분리 — print/export 시 자연 제외, 실수로 modify 차단
- **P3 (AI 협업자)**: STEP import 결과를 reference 명시 → AI 가 "이 모델은 수정 대상이 아니다" 명시 인식

## 2. Decision

**Reference enum** 시민권 도입. Form (Shape) / Property (Xia) 와 **직교**.

### 2.1 Reference Categories (3종)

| Category | Geometry | 출처 | 사용자 의도 |
|---|---|---|---|
| **ConstructionLine** | Edge / Wire | DrawCenterline / DrawConstructionLine | 작도 보조선 — final build 미포함 |
| **ImportedMesh** | Face set | STEP/IGES/OBJ/STL import (ADR-035/036/081~086) | 외부 모델 — 수정 안 함 |
| **PointCloud** | Vertex set | LiDAR scan / sensor data | 측정 데이터 — 측정 대상 |

### 2.2 Lock-ins (canonical)

- **L1 — Mesh-level Map storage** (ADR-091 §E L1 / ADR-094 §E L2 답습):
  `Scene.references: HashMap<ReferenceId, Reference>` — bincode legacy
  호환 자연 보존. Form/Property struct UNCHANGED.
- **L2 — 직교 시민권**: Reference 는 Form/Property 와 *별개 namespace*.
  하나의 geometry entity 가 동시에 Reference + Form 일 수 없음 (배타).
  Reference → Form transition 은 explicit "promote to build" 사용자
  의도 액션.
- **L3 — Reference 의 geometry ownership**:
  - ConstructionLine: `edge_ids: Vec<EdgeId>`
  - ImportedMesh: `face_ids: Vec<FaceId>`
  - PointCloud: `vert_ids: Vec<VertId>`
  - Mutually exclusive — geometry id 가 어느 한 Reference 에만 속함
- **L4 — `face_to_reference` / `edge_to_reference` / `vert_to_reference`
  reverse 인덱스** (ADR-079 W-1 face_to_shape 답습): O(1) lookup +
  rebuild on snapshot restore.
- **L5 — additive only (ADR-046 P31 #4)**: Form/Property 회귀 자산
  영향 0. 새 시민권 type 추가만.
- **L6 — Snapshot persistence**: section 8 (additive after section 7
  Shape) — A-μ forward-compat reject 답습 + V2 호환.
- **L7 — Boolean / Push-Pull / Offset 정책**: Reference geometry 는
  default 로 op operand 거부 (사용자 의도: 수정 안 함). Promote to
  Form 후 op 적용. ADR-046 P31 메타-원칙 #2.
- **L8 — Render: 미구현 deferred**: 시각 구분 (작도선 = dashed,
  imported mesh = ghost, point cloud = dots) 은 별도 sub-step 또는
  별도 ADR. Phase 3 의 *engine layer* 만 본 ADR scope.
- **L9 — STEP/IGES import 통합**: ADR-081~086 의 import 결과가 자연
  ImportedMesh Reference 로 분류. Phase 3 closure 후 import path 가
  Reference scene 추가.

### 2.3 Reference struct 설계

```rust
pub type ReferenceId = u32;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Reference {
    pub id: ReferenceId,
    pub name: String,
    pub category: ReferenceCategory,
    pub visible: bool,
    pub locked: bool, // Reference 의 modification protection
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ReferenceCategory {
    ConstructionLine { edge_ids: Vec<EdgeId> },
    ImportedMesh { face_ids: Vec<FaceId>, source_path: Option<String> },
    PointCloud { vert_ids: Vec<VertId> },
}
```

## 3. Path Z atomic decomposition (6 sub-step)

| sub-step | 영역 | 회귀 예상 |
|---|---|---|
| **Phase 3-α** (spec only) | 본 ADR | 0 |
| **Phase 3-β** | Rust core — Reference / Scene.references / `face_to_reference` 등 reverse 인덱스 + create/get/list/remove API | axia-core +5~8 |
| **Phase 3-γ** | WASM bridge + TS wrapper (CRUD endpoints) | axia-wasm +2~3, vitest +3~5 |
| **Phase 3-δ** | Inspector / Tool 통합 — explicit "Mark as Reference" 액션, ADR-046 P31 #4 (additive only) | vitest +5~8 |
| **Phase 3-ε** | Snapshot section 8 (additive — A-μ forward-compat 답습) | axia-core +2~3 |
| **Phase 3-ζ** | Real Chromium 시연 + closure | Playwright +2~3 |

**누적 예상**: +19~30 회귀, **8-12일 (1.5-2주)**.

## 4. Decision Matrix

| ID | 결정 | 채택 |
|----|------|------|
| **R-A** | Reference type | Mesh/Scene-level HashMap (L1, ADR-091 §E L1 답습) |
| **R-B** | 시민권 직교성 | Form/Property 와 mutually exclusive geometry ownership |
| **R-C** | 3 categories | ConstructionLine / ImportedMesh / PointCloud (v3.2 spec 약속) |
| **R-D** | Reverse index | face_to_reference / edge_to_reference / vert_to_reference (O(1)) |
| **R-E** | Op operand 정책 | Reference 거부 default — promote to Form 후 op (사용자 명시 의도) |
| **R-F** | Render 시각 구분 | deferred — 별도 sub-step / ADR (engine layer 우선) |
| **R-G** | STEP/IGES import 통합 | ADR-081~086 path 가 closure 후 Reference scene 추가 |
| **R-H** | Snapshot persistence | section 8 additive (A-μ forward-compat 답습) |

## 5. ADR-046 P31 정합

- #1 (P1+P3 가치): ✅ — 두 페르소나 모두 first-class
- #2 (외부 참조는 형태/모양만): ✅ — Reference 시민권의 architectural 정착
- #4 (additive only): ✅ — 메뉴/단축키/툴바 외부 ID UNCHANGED. 새 시민권 type 만 추가.

## 6. 위험 분석

- **L1 (낮음)**: ADR-091 §E L1 canonical 직접 답습 — bincode 호환
  자연 보존. ADR-094 의 multi-week atomic 패턴이 이미 검증됨.
- **L2 (낮음)**: Reference vs Form/Property 의 직교성 — 새 namespace,
  mutex 강제. 기존 회귀 자산 영향 0.
- **L3 (중간)**: STEP/IGES import path 통합 시점 — Phase 3 closure
  *후* import path 가 Reference 추가. 현재 import 는 Form 으로 분류 →
  Phase 3 closure 후 마이그레이션 필요. 별도 sub-step 또는 후속 ADR.
- **L4 (낮음)**: Inspector display 분류 추가 — UI 영향 minor.

## 7. Lessons applied (5개월 누적)

| ADR | Lesson | 본 ADR 적용 |
|---|---|---|
| ADR-091 §E L1 | bincode struct field 금지 → Mesh-level HashMap | R-A: Scene.references HashMap |
| ADR-091 §E L2 | Path Z atomic 사전 검토 가치 | 본 ADR Phase 3-α 진입 사전 검토 |
| ADR-093 §E L1 | ADR-091 L1 canonical 첫 명시 적용 | R-A 직접 답습 |
| ADR-094 §E L1 | Additive-first 위험 격리 | additive coexist (Reference vs Form/Property) |
| ADR-094 §E L4 | Engine OFF + Production ON pattern | (Phase 3 자체는 default OFF — UI 진입점 explicit) |
| ADR-049 P-5e-α | Default flip with localStorage OFF preference | (Phase 3 future flip 시 답습 가능) |

## 8. Out of Scope (별도 ADR 또는 후속 sub-step)

- **Render 시각 구분** (Construction Line dashed / Imported Mesh ghost
  / Point Cloud dots) — Phase 3-δ 의 후속 또는 별도 ADR
- **STEP/IGES import 의 자동 Reference 분류** — Phase 3 closure 후
  retro-migration ADR
- **Reference → Form promote (사용자 명시 액션)** — Phase 3 closure
  후 follow-up
- **Reference layer / visibility group** — Phase 5 (자산 라이브러리)
  와 cross-cut

## 9. 사용자 multi-gate (각 sub-step 결재)

본 ADR 은 plan only. 각 sub-step 진입 시 사용자 결재 + Path Z atomic.

## D. Acceptance Log

### Phase 3-α (본 commit)
- **사용자 결재**: 2026-05-09, "🅱 ADR-049 Phase 3 진입 결재" 승인.
- **변경**: 본 ADR 작성. LOCKED #26 Phase 3 progress 갱신 anchor.
- **회귀**: +0 (docs only).

### Phase 3-β (본 commit)
- **사용자 결재**: 2026-05-09, "승인" — Rust core 진입.
- **변경**:
  * `crates/axia-core/src/reference.rs` (신규):
    - `pub struct ReferenceId(u32)` newtype (XiaId/ShapeId 와 type-distinct,
      ADR-050 §2.1.1 답습)
    - `pub enum ReferenceCategory { ConstructionLine{edge_ids},
      ImportedMesh{face_ids,source_path}, PointCloud{vert_ids} }`
    - `pub struct Reference { id, name, category, visible, locked }`
    - 4 unit tests (ReferenceId roundtrip / Reference::new defaults /
      category labels / serde roundtrip — ADR-095 Phase 3-ε 준비)
  * `crates/axia-core/src/lib.rs` — `pub mod reference;` + re-export
  * `crates/axia-core/src/scene.rs`:
    - `Scene.references: HashMap<ReferenceId, Reference>` (R-A,
      Mesh-level map)
    - `Scene.next_reference_id: u32` (start at 1)
    - `Scene.face_to_reference / edge_to_reference / vert_to_reference`
      (R-D, O(1) reverse 인덱스)
    - `Scene::new()` 초기화
    - `pub enum ReferenceCreateError` (5 variants — Edge/Face/Vert
      Already / Face owned by Xia / Shape)
    - CRUD API: `create_reference / get_reference /
      list_reference_ids / delete_reference / set_reference_visible /
      set_reference_locked`
    - **R-B mutually exclusive enforcement**: create_reference 가 등록
      직전 reverse 인덱스 + face_to_xia + face_to_shape 충돌 검사 +
      atomic rollback 보장
- **회귀** (axia-core 217 → 230, +13):
  * **reference.rs unit tests +4**:
    - `reference_id_roundtrip`
    - `reference_new_starts_visible_unlocked`
    - `category_label_3_categories`
    - `reference_serde_roundtrip` (Phase 3-ε 준비)
  * **scene.rs Reference tests +9**:
    - `create_reference_construction_line`
    - `create_reference_imported_mesh`
    - `create_reference_point_cloud`
    - `mutually_exclusive_face_owned_by_xia` (R-B critical anchor)
    - `mutually_exclusive_face_owned_by_shape` (R-B critical anchor)
    - `double_register_same_edge_rejected`
    - `delete_reference_cleans_reverse_indices` (re-register 가능)
    - `list_reference_ids_sorted`
    - `visibility_locked_toggles`
  * 합계 **+13**, 절대 #[ignore] 금지 13/13 준수.
- **누적** (Phase 3-α ~ 3-β): axia-core +13.
- **위험 격리 검증**: axia-core 230 + axia-geo 1245 모두 PASS. 245+
  Form/Property 회귀 자산 영향 0 (additive coexist).

### Phase 3-γ (본 commit)
- **사용자 결재**: 2026-05-09, "승인" — WASM bridge + TS wrapper 진입.
- **변경**:
  * `crates/axia-wasm/src/lib.rs` — 9 신규 exports (camelCase via
    wasm-bindgen):
    - `createReferenceConstructionLine(name: String, edge_ids: Vec<u32>)
      -> Result<u32, JsValue>` (strict throw on R-B violation)
    - `createReferenceImportedMesh(name: String, face_ids: Vec<u32>,
      source_path: Option<String>) -> Result<u32, JsValue>`
    - `createReferencePointCloud(name: String, vert_ids: Vec<u32>)
      -> Result<u32, JsValue>`
    - `getReferenceIds() -> Vec<u32>` (sorted)
    - `getReferenceJson(id: u32) -> String` — `{ id, name, category,
      visible, locked }` 형태, missing 시 empty string. category JSON
      shape: `{kind, edge_ids|face_ids|vert_ids, source_path?}`
    - `deleteReference(id: u32) -> bool`
    - `setReferenceVisible(id: u32, visible: bool) -> bool`
    - `setReferenceLocked(id: u32, locked: bool) -> bool`
    - `getFaceReferenceId(face_id: u32) -> i32` (-1 sentinel)
  * `crates/axia-wasm/tests/export_baseline.txt` — 9 entries 추가
  * `crates/axia-wasm/tests/step6_additive_only.rs` — 2 wiring tests
    (9 endpoints + Result<u32, JsValue> strict throw signature)
  * `web/src/bridge/WasmBridge.ts`:
    - `AxiaEngineExtended` interface 에 9 exports 추가
    - typed wrappers: 3 create (strict throw on R-B + endpoint missing),
      `getReference()` (JSON parse → tagged union 형태), graceful
      fallback for getReferenceIds / delete / set / getFaceReferenceId
- **회귀**:
  * axia-wasm 38 → 40 (+2 wiring tests)
  * vitest WasmBridge.test 147 → 156 (+9 wrapper tests:
    create 3 categories + R-B throw + JSON parse + graceful fallback
    for missing endpoint)
  * 합계 **+11**, 절대 #[ignore] 금지 11/11 준수.
- **누적** (Phase 3-α ~ 3-γ): axia-core +13, axia-wasm baseline +9,
  vitest +9 = **+31**.

### Phase 3-δ (본 commit)
- **사용자 결재**: 2026-05-09, "승인" — UI orchestration 진입.
- **사전 검토 architectural 정정**: scope 를 *helper module + 단위
  테스트* 로 한정 — Inspector / ContextMenu DOM 통합은 future
  sub-step 또는 별도 ADR. 이유: ADR-091 §E L4 (UI orchestration 분리)
  답습 — helper SSOT 가 다중 trigger point 보장 + jsdom 격리 단위
  테스트 가능.
- **변경**:
  * `web/src/citizenship/MarkAsReference.ts` (신규):
    - `markFacesAsReference(bridge, faceIds, name?, sourcePath?)` →
      ImportedMesh
    - `markEdgesAsReference(bridge, edgeIds, name?)` → ConstructionLine
    - `markVertsAsReference(bridge, vertIds, name?)` → PointCloud
    - `MarkResult { ok, refId?, reason? }` 반환 — Toast / UI 직접 활용
    - `humanizeRBViolation()` — engine 메시지 → 사용자 facing 한국어
      변환 (Xia owned / Shape owned / already Reference / endpoint
      missing 4 가지)
  * Default names: "Imported Mesh" / "Construction Line" / "Point Cloud"
- **회귀** (vitest +11):
  * `markFacesAsReference` 5 tests:
    - 성공 시 refId 반환
    - 빈 배열 → 거부
    - R-B Xia owned → 한국어
    - R-B Shape owned → 한국어
    - endpoint missing → 새로고침 안내
  * `markEdgesAsReference` 3 tests (성공 / 빈 배열 / 이미 Reference)
  * `markVertsAsReference` 3 tests (성공 / default name / 빈 배열)
  * 합계 **+11**, 절대 #[ignore] 금지 11/11 준수
- **누적** (Phase 3-α ~ 3-δ): axia-core +13, axia-wasm baseline +9,
  vitest +20 = **+42**.
- **Out of scope (future)**:
  * Inspector / ContextMenu UI 통합 — DOM-driven trigger
  * "Promote Reference to Form" inverse 액션
  * Render visual 구분 (작도선 dashed 등) — ADR-095 §8 참조

### Phase 3-ε (본 commit)
- **사용자 결재**: 2026-05-09, "승인" — Snapshot 영속화 진입.
- **변경**:
  * `crates/axia-core/src/scene.rs`:
    - `scene_snapshot()` → section 8 추가 (additive after 7d):
      `[references_len:u64][references_data][next_reference_id:u64]`
    - `restore_scene_snapshot()` 갱신 — section 8 detected 시 restore,
      미detected (legacy V2 / pre-Phase 3) 시 empty + next_id=1 default.
      Reverse 인덱스 (face/edge/vert_to_reference) rebuild via 신규
      `rebuild_reference_reverse_indexes()` helper (face_to_shape 패턴
      답습)
    - `analyze_snapshot` (A-μ) — section 8 인식 (references +
      next_reference_id 두 sub-section)
    - `SnapshotSections.references / next_reference_id` 필드 추가
- **사후 정정** (existing test): `adr091_d_epsilon_legacy_v2_without_
  section_7d_loads_empty_map` — snapshot trailing 이 section 8 추가로
  변경됨. 테스트의 strip 길이를 (8 + refs + 8 + 7d) 로 갱신.
- **회귀** (axia-core 230 → 234, +4):
  * `references_roundtrip_v2` — Reference 등록 → snapshot → import →
    references state + reverse 인덱스 정합 검증
  * `next_reference_id_roundtrip` — counter 보존 (3 → restore → next
    create = 4)
  * `legacy_v2_without_section_8_loads_empty` — pre-Phase 3 호환 (empty
    + default 1, Shape state 보존)
  * `reverse_index_rebuilt_after_restore` — 3 categories 모두 face/
    edge/vert_to_reference 정합
  * 합계 **+4**, 절대 #[ignore] 금지 4/4 준수.
- **누적** (Phase 3-α ~ 3-ε): axia-core +17, axia-wasm baseline +9,
  vitest +20 = **+46**.

### Phase 3-ζ (본 commit — 사용자 시연 + closure)
- **사용자 결재**: 2026-05-09, "승인" — 사용자 시연 + closure.
- **사용자 시연 PASS** (real Chromium 4/4):
  - Scenario 1: 3 categories CRUD (CL/PC create + getReferenceIds list +
    getReference JSON parse 검증)
  - Scenario 2: R-B violation (Path B cylinder 의 Shape-owned face 를
    Reference 등록 시도 → engine throw + bridge propagate)
  - Scenario 3: Snapshot round-trip (export/import → references 보존)
  - Scenario 4: getReference JSON parse → tagged union
    (`category.kind === 'ConstructionLine'`)
- **변경**:
  * `web/e2e/adr-095-demo.spec.ts` (신규) — Real Chromium 4 specs
  * `CLAUDE.md` LOCKED #26 — Phase 3 closure entry
  * `docs/adr/README.md` — ADR-095 status `Proposed` → `Accepted`
  * 본 ADR §E Lessons 추가
- **회귀** (Playwright +4): 4 scenarios 모두 PASS in real Chromium.
  합계 **+4**, 절대 #[ignore] 금지 4/4 준수.
- **누적 회귀** (Phase 3-α ~ 3-ζ): axia-core +17, axia-wasm baseline
  +9, vitest +20, Playwright +4 = **+50**.

## E. Lessons

### L1 — additive coexist 다층 적용 (5 sub-step zero regression)

**관찰**: ADR-095 의 5 sub-step 모두 *additive coexist* 패턴으로 진행.
245+ Form/Property 회귀 자산 영향 0 + 새 시민권 type 자연 도입.

**Architectural lesson**: ADR-094 §E L1 (Path B-full additive-first)
의 메타 패턴이 시민권 모델 확장에서도 자연 답습. 새 직교 시민권
도입은 항상 additive coexist 가능 — Form/Property 와 mutually
exclusive 만 강제.

### L2 — Mesh-level Map (ADR-091 §E L1) 더 깊은 적용

**관찰**: Reference 의 모든 데이터 (`Scene.references` /
`face_to_reference` / `edge_to_reference` / `vert_to_reference`)
가 Mesh/Scene-level HashMap 으로 도입. 어떤 entity (Face / Edge /
Vert) struct 도 변경 안 됨. Bincode legacy 호환 자연 보존.

**향후 ADR 가이드** — 직교 시민권 추가 시 항상 Scene-level reverse
인덱스 + HashMap 패턴. struct field 추가 금지 canonical (ADR-091
§E L1).

### L3 — 사용자 facing 한국어 변환 (humanizeRBViolation)

**관찰**: Engine layer 의 영문 error message ("face FaceId(7) is
owned by a Xia") 가 사용자 facing 으로 부적절. UI orchestration
helper (`MarkAsReference.ts::humanizeRBViolation`) 가 4 가지 case
한국어 변환 → Toast 직접 활용.

**향후 ADR 가이드** — 사용자 facing 액션의 engine throw → UI
orchestration helper 가 한국어 변환 SSOT. ADR-091 §E L4 (UI
orchestration 분리) 의 자연 확장.

### L4 — Three-Layer Citizenship Model 활성

**Architectural milestone**: LOCKED #26 의 Two-Layer Citizenship
Model 이 본 ADR 으로 *three-layer* 로 확장:
- **Form** (Shape) — 기하 추상, no material
- **Property** (Xia) — 부재 정체성, with material
- **Reference** (NEW) — 외부/작도, *수정 안 함*

3 시민권 모두 Mutually Exclusive geometry ownership — 한 face / edge
/ vert 가 동시에 둘 이상 시민권에 속할 수 없음. ADR-091 D-β /
ADR-091 D-ε 의 Form ↔ Property transition (promote / demote) 위에
Reference 의 *직교* 시민권이 추가.

**메타-원칙 #2 ("외부 참조는 형태/모양만") architectural 정착** —
LOCKED #26 의 5-Phase 로드맵 중 Phase 3 closure. STEP/IGES import
(ADR-081~086) 결과를 Reference 로 자연 분류 가능 (future Phase
3 후속 작업).

### L5 — 5개월 누적 architectural quality 자연 결합 (5번째)

본 ADR 의 모든 sub-step 이 *기존 framework 와 자연 결합*:
- ADR-091 §E L1 (Mesh-level map) → Phase 3-β 직접 답습
- A-μ forward-compat reject → Phase 3-ε 직접 답습
- ADR-091 D-ε section 7d 패턴 → Phase 3-ε section 8 답습
- ADR-091 §E L4 (UI orchestration) → Phase 3-δ 답습

ADR-094 §E L3 의 "자연 결합" pattern 이 ADR-095 에서도 직접 답습 —
multi-week atomic 트랙뿐 아니라 시민권 모델 확장에서도 5개월 누적
quality 의 자연 leverage 입증.
