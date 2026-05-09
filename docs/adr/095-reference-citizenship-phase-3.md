# ADR-095: Reference Citizenship (Two-Layer Citizenship Phase 3)

- **Status**: Proposed (Phase 3-α — spec only)
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

### Phase 3-γ ~ 3-ζ (예정)
별도 sub-step 결재 시 commit 진행.
