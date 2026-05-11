# ADR-050 — Shape / Xia Type Split + Phase 1 Promote API

**Status**: **Accepted (Phase 1 P-1 ~ P-7 모두 closure, 2026-05-06)**
**Date**: 2026-05-03 (P-7 closure: 2026-05-06)
**Anchor**: ADR-049 §4 Q1+Q3+Q4 final lock (사용자 결정), v3.2 명제 4
**Related**: ADR-049 (Two-Layer Citizenship Model), ADR-051 (P7 canonical
— 함께 진행, manifold 검증의 prerequisite), ADR-019 (Line is Truth — Shape
계층 anchor), v3.2 spec §3 시민권 § 12 강등

---

## 0. Summary (4 lines)

> 현 엔진의 단일 `Xia` type 을 두 type 으로 분리: **`Shape`** (형태 계층,
> 재질 없음, 0 차원 자유) 와 **`Xia`** (특성 계층, v3.2 strict — 재질 +
> 부피 + 닫힘 + manifold). 모든 Draw 도구는 Shape 를 만들고, 사용자가
> 명시적으로 재질 부여 시 promote API 가 4조건 검증 후 Xia 승격.

---

## 1. Context

### 1.1 사용자 결정 (ADR-049 Q1+Q3+Q4)

```
Q1: 승격 트리거 = 재질 부여 (유일). 검증 4조건: 재질, 부피>0 strict,
    watertight, manifold
Q3: 명명 분리 — Shape (형태) / Xia (특성)
Q4: default_material 폐지. Shape = material 없음 / Xia = primary +
    face-level override
```

### 1.2 현 엔진 상태

```
모든 Draw 도구 (DrawLine / DrawCircle / DrawRect / Push-Pull / etc.)
  → 단일 Xia 생성
  → default_material 자동 부여
  → 재질 / 부피 / 닫힘 / manifold 검증 없음

문제:
  - "Line XIA" 가 v3.2 의 "Linear XIA" (특성) 와 같은 단어 → 혼선
  - 모든 결과가 XIA 라 "이것이 부재인가 임시 형태인가" 구분 불가
  - 사용자가 만든 wireframe 도 "XIA" 로 표시 → 부재인 줄 오인
```

### 1.3 본 ADR 의 자리

ADR-049 의 Two-Layer 모델을 **type 시스템에 인코딩**. ADR-051 (P7 canonical)
의 manifold 보장이 본 ADR 의 promote API 검증을 의미 있게 만듦.

---

## 2. Decision

### 2.1 새 type 구조

#### 2.1.1 `Shape` (형태 계층, 신규)

```rust
// crates/axia-core/src/shape.rs (신규 모듈)

pub struct ShapeId(u32);

pub struct Shape {
    pub id: ShapeId,
    pub name: String,                    // 사용자 표시 (예: "사각형")
    pub face_ids: Vec<FaceId>,           // 소유 face 들 (0 개 가능)
    pub standalone_edge_id: Option<EdgeId>, // line tool 결과
    pub position: DVec3,                 // 대표 위치
    pub surface_normal: Option<DVec3>,   // 평면 hint
    
    // ❌ material 필드 없음 — 형태 계층 의미상 부재
    // ❌ 부피 / 부재 정체성 메타데이터 없음
}

impl Shape {
    pub fn geometry_state(&self) -> GeometryState {
        // 0 face = Point/Line / 1+ face = Face/Volume
    }
}
```

**핵심**: `material` 필드 자체 없음. 형태 = 재질 개념 부재.

#### 2.1.2 `Xia` (특성 계층, redefine)

```rust
// crates/axia-core/src/xia.rs (기존 → redefine)

pub struct XiaId(u32);

pub struct Xia {
    pub id: XiaId,
    pub shape_id: ShapeId,                // 어느 형태에서 승격됐는지
    pub primary_material: Material,       // v3.2: 부재 단위 대표 재질
    pub face_materials: HashMap<FaceId, Material>, // override (다중 마감)
    pub kind: XiaKind,                    // Volumetric / Linear
    pub properties: XiaProperties,        // v3.2 §7.5: 기하/물리/시각/경제
    
    // ✅ 4조건 충족 시점에만 생성됨 — invariant by construction
}

pub enum XiaKind {
    Volumetric { volume: f64 },           // > 0 strict
    Linear     { length: f64, cross_section_area: f64 }, // 둘 다 > 0
}

pub struct XiaProperties {
    pub physical: PhysicalProps,          // 밀도/강도/...
    pub visual: VisualProps,              // 색/텍스처/...
    pub economic: EconomicProps,          // 단가/...
}
```

**핵심**: `Xia` 생성 = 4조건 검증 통과 보장 (type 자체가 invariant).

### 2.2 Promote API (v3.2 명제 4 strict)

```rust
// crates/axia-core/src/scene.rs

impl Scene {
    /// Shape → Xia 승격. 4조건 모두 통과 시에만 Xia 생성.
    /// 형태는 보존 (Shape 자체는 그대로). 단, primary_material 이
    /// 사용자에 의해 부여되었으므로 face_materials 도 자동 동기화.
    pub fn promote_shape_to_xia(
        &mut self,
        shape_id: ShapeId,
        material: Material,
    ) -> Result<XiaId, PromoteError> {
        let shape = self.shapes.get(&shape_id)
            .ok_or(PromoteError::ShapeNotFound)?;
        
        // ✓ 검증 1: 재질 부여 (자명 — 인자로 받음)
        
        // ✓ 검증 2: 부피 > 0 (Volumetric) 또는 단면 > 0 (Linear)
        let kind = self.compute_xia_kind(shape)?;
        match kind {
            XiaKind::Volumetric { volume } if volume <= 0.0 =>
                return Err(PromoteError::ZeroVolume),
            XiaKind::Linear { length, cross_section_area }
                if length <= 0.0 || cross_section_area <= 0.0 =>
                return Err(PromoteError::ZeroDimension),
            _ => {}
        }
        
        // ✓ 검증 3: Watertight 닫힘
        if !self.is_shape_watertight(shape_id) {
            return Err(PromoteError::NotWatertight);
        }
        
        // ✓ 검증 4: Manifold 무결성 (ADR-051 P7 후 자동 보장)
        let manifold = self.mesh.verify_face_invariants();
        if !manifold.is_valid() {
            return Err(PromoteError::NotManifold {
                violations: manifold.violations.len(),
            });
        }
        
        // 모두 통과 → Xia 생성
        let xia_id = self.next_xia_id();
        let xia = Xia {
            id: xia_id,
            shape_id,
            primary_material: material.clone(),
            face_materials: shape.face_ids.iter()
                .map(|&f| (f, material.clone()))
                .collect(),
            kind,
            properties: XiaProperties::default_for(&material),
        };
        self.xias.insert(xia_id, xia);
        Ok(xia_id)
    }
}

#[derive(Debug)]
pub enum PromoteError {
    ShapeNotFound,
    ZeroVolume,
    ZeroDimension,
    NotWatertight,
    NotManifold { violations: usize },
}
```

### 2.3 Face-level material override (Q4 정책)

```rust
impl Xia {
    /// 특정 face 의 재질 override (다중 마감 지원).
    /// primary_material 은 부재 대표로 유지.
    pub fn set_face_material(
        &mut self,
        face: FaceId,
        material: Material,
    ) {
        self.face_materials.insert(face, material);
    }
    
    pub fn material_of(&self, face: FaceId) -> &Material {
        self.face_materials.get(&face).unwrap_or(&self.primary_material)
    }
}
```

### 2.4 Demote API (Phase 2 — ADR-052 예정)

본 ADR 은 promote 만 다룸. 강등은 ADR-052 의 spec.

### 2.5 마이그레이션 — 기존 모든 Draw 도구는 Shape 만 생성

```
이전:
  exec_draw_rect → Xia (default_material 자동 부여)
  exec_draw_line → Xia (Line type)

새:
  exec_draw_rect → Shape (재질 없음, name="사각형")
  exec_draw_line → Shape (face_ids=[], standalone_edge_id=Some(...))
  
사용자가 명시적으로:
  scene.promote_shape_to_xia(shape_id, "콘크리트") → 검증 후 Xia 생성
```

### 2.6 UI 표시 (사용자 facing)

```
이전 XIA Inspector:
  XIA-0001 (Rectangle)
  
새 UI:
  형태:     "형태 #0001 (사각형)" — 재질 없음
  특성:     "XIA-0001 (사각형, 콘크리트 벽체)" — 재질 부여 후
```

UI 의 한국어 텍스트 / 메뉴 / Toast 광범위 갱신 필요. Phase 1 마이그레이션의
일부.

### 2.7 WASM Bridge

```typescript
// 신규
bridge.createShapeFromRect(...) → ShapeId
bridge.promoteShapeToXia(shapeId, materialName) → XiaId | Error
bridge.setFaceMaterial(xiaId, faceId, materialName)

// 기존 createXia / setXiaMaterial 등은 deprecate → 위 API 로 마이그레이션
```

---

## 3. Migration Strategy

### 3.1 단일 PR (chunk C3)

전체 rename + 새 API 를 한 PR 로:
- `XiaId` → `ShapeId` (대부분 호출 site)
- 새 `XiaId` / `Xia` type 추가
- `promote_shape_to_xia` 신규
- WASM bridge 갱신
- TS 호출 site 갱신
- 회귀 테스트 광범위 갱신

**장점**: 회귀 디버깅이 한 PR 안에서. 중간 상태 없음.
**단점**: PR 크기 큼 (수백 라인 변경)

### 3.2 회귀 테스트 영향

| 카테고리 | 영향 |
|---|---|
| `scene::tests::test_*xia*` (다수) | 의미 재정의 — Shape 생성 후 promote 호출 |
| `scene::tests::test_two_stacked_inner_*` | ADR-051 와 함께 의미 재정의 |
| WASM bridge tests | API 변경에 맞춰 갱신 |
| TS unit tests (XIA Inspector 등) | UI 명명 갱신 |

예상 갱신 테스트 수: 50-100개

### 3.3 사용자 데이터 호환성

기존 `.axia` 저장 파일:
- 모든 객체가 "XIA" 로 저장됨
- 로드 시: 모두 Shape 로 변환 (재질 없는 형태로 deserialize)
- 사용자가 재질 부여 시 promote 가능
- v2 → v3 (또는 v2.5) 형식 마이그레이션 필요

상세는 ADR-008 (직렬화) 와 함께 별도 검토.

---

## 4. Out of Scope

본 ADR 이 다루지 않음:

- **Demote API** (재질 제거 → Shape) — ADR-052 (Phase 2)
- **자동 강등** (위상 손상 → 다이얼로그) — ADR-054 (Phase 4)
- **Reference 시민권 분리** — ADR-053 (Phase 3)
- **Layered material** (벽 = 외부+단열+구조+내부) — ADR-056+ (Phase 5)
- **자산 라이브러리 3계층** — ADR-055 (Phase 5)

---

## 5. Implementation Plan

### 5.1 작업 단위 (4-6h 예상, C3 chunk)

1. `crates/axia-core/src/shape.rs` 신규 모듈 + `Shape` struct
2. `crates/axia-core/src/xia.rs` redefine — `XiaId` 새 type, `Xia` struct
3. `Scene` 에 `shapes: SlotStorage<ShapeId, Shape>` 추가
4. `Scene::promote_shape_to_xia` 구현 (ADR-051 P7 후의 manifold 검증 활용)
5. `exec_draw_*` 도구들 수정 — Shape 생성 (재질 없음)
6. `face_to_xia` → `face_to_shape` + `face_to_xia_overlay` (특성 계층)
7. WASM bridge 갱신 (`createShape*` / `promoteShapeToXia` / `setFaceMaterial`)
8. TS 호출 site 갱신 (XIA Inspector / SelectionManager / etc.)
9. 한국어 UI 텍스트 갱신 (Toast / 메뉴 / Inspector labels)
10. 회귀 테스트 광범위 갱신
11. 새 회귀 테스트 — promote 4조건 검증

### 5.2 전제 조건

- **ADR-051 (P7 canonical) 와 함께 진행 권장** — manifold 검증이 의미 있게
  동작하려면 P7 redesign 이 base 에 있어야
- 어제 18 commits 모두 base 보존

### 5.3 위험

- 광범위 type rename — 컴파일 에러로 누락 site 자동 발견 (Rust 강점)
- TS 측 rename — TS strict mode + 회귀 테스트
- 사용자 데이터 호환 — 별도 마이그레이션 작업 필요

---

## 6. Acceptance Criteria

- [x] `Shape` / `Xia` 두 type 정의 (§2.1)
- [x] Promote API spec (§2.2) — 4조건 검증
- [x] Face-level material 정책 spec (§2.3)
- [x] Migration strategy (§3) + 회귀 테스트 영향 식별
- [x] 사용자 facing UI 명명 정책 (§2.6)
- [x] **구현** — Path Z atomic 11+ sub-step (P-1 ~ P-7) closure
- [x] LOCKED #26 update — Phase 1 완료 표시 (P-7 closure 시점)

---

## D. Acceptance Log

Phase 1 = Path Z atomic 11+ sub-step. 각 sub-step 은 좁은 scope + 명시
lock-in + browser-runtime / cargo / vitest 회귀 봉인 + 사용자 결재.

| Sub-step | Commit | 영역 | 회귀 |
|----------|--------|------|------|
| **P-1** | `f399d67` | Shape skeleton (model-only prototype) | axia-core +10 |
| **P-2** | `86b0c29` | Promote API 통합 (4-condition validation) | axia-core +7 |
| **ADR-051 P-1** | `e1f54f1` | verify_p7_manifold 함수 (axia-geo) | axia-geo +5 |
| **ADR-051 P-2** | `0d76083` | Strict lock-in + LOCKED #1 amendment | axia-core +1 |
| **P-3** | `d6eac93` | Snapshot section 7 (Shape persistence) | axia-core +5 |
| **P-4** | `1d32296` | WASM bridge + TS typed wrapper | axia-wasm +4, vitest +9 |
| **P-5a** | `2bd129b` | DrawRectAsShape foundation | axia-core +6 |
| **P-5b** | `980be69` | DrawLine/CircleAsShape | axia-core +7 |
| **P-5c** | `90fba7d` | As-Shape Draw bridge + TS wrapper | axia-wasm +4, vitest +6 |
| **P-5d** | `4850aff` | Tools opt-in flag (DrawRect/Line/CircleTool) | vitest +12 |
| **P-5e-α** | `7703e86` | Default flip (false → true) | vitest 0 (의미 갱신) |
| **P-5e-γ** | `ee0032a` | Undo transaction collapse | axia-transaction +2, axia-core +3 |
| **P-5e-β** | `2a3d87f` | default_material 제거 (Q4 정합) | axia-core +2 |
| **P-6** | `618cc6c` | XiaInspector UI badge label rename | vitest +2 |
| **P-7** (본 commit) | — | 회고 + LOCKED #26 update + Phase 1 closure | 0 (docs only) |

**Phase 1 누적 회귀**:
- axia-core: 124 → 173 (+49) — Shape skeleton + promote + section 7 +
  As-Shape variants + FORM_MATERIAL + UI labels
- axia-geo: 964 → 969 (+5) — verify_p7_manifold module
- axia-wasm: 12 → 24 (+12) — 6 Shape persistence exports + 6 Draw
  As-Shape bridge methods + 4 source-inspection tests
- axia-transaction: 2 → 4 (+2) — replace_last_after_snapshot
- vitest: 1395 → 1472 (+77) — typed wrappers + Tool dispatch + Settings
  flag + UI labels + drift guards
- 합계: **+145 회귀 추가**, 절대 #[ignore] 금지 145/145 준수
- LOCKED 변경: #1 amendment (ADR-051 P-2) 만, #26 본문 unchanged
  (Phase 1 closure 표시 추가)

**Phase 1 Stack 완성**:

```
사용자 클릭 (Default ON, P-5e-α)
  ↓
DrawRect/Line/CircleTool dispatch (P-5d opt-in flag)
  ↓
WasmBridge.drawRect/Line/CircleAsShape (P-5c TS wrapper)
  ↓
draw_rect/line/circle_as_shape (P-5c WASM exports)
  ↓
Command::DrawRect/Line/CircleAsShape (P-5a/b)
  ↓
Scene::exec_draw_*_as_shape (P-5a/b)
  ↓
Phase 1: 기존 exec_draw_* 위임 (mesh + face synthesis)
Phase 2: Xia → Shape 변환 + replace_last_after_snapshot (P-5e-γ)
  ↓
Scene.shapes (P-1 storage) + Snapshot section 7 (P-3 persistence)
  ↓
Inspector "형태 (Shape)" badge (P-6)
  ↓ promote_shape_to_xia (P-2 4-condition validation)
Scene.xias (existing) + shape_to_xia linkage (P-2)
  ↓
Inspector "XIA (특성)" badge (P-6)
```

---

## E. Lessons (회고)

### E.1 Path Z atomic 11+ sub-step 의 효율성

ADR-050 + ADR-051 합산으로 Phase 1 을 11+ atomic 으로 분할.
각 atomic ~150 LoC + 회귀 ~5~10 + 사용자 결재 1회. 결과:
- **회귀 0** — 회귀 +145 누적, 기존 LOCKED #1 / ADR-051 / ADR-074 /
  ADR-078 모든 invariant PASS 유지
- **사용자 통제** — 각 단계 명시 결재로 의도와 정렬
- **Rollback 가능** — 단일 atomic 만 revert 하면 직전 안정점

### E.2 FORM_MATERIAL sentinel 패턴

`Scene.default_material: MaterialId` field-as-state 폐지 (Q4 정합) +
`pub const FORM_MATERIAL: MaterialId = MaterialId::new(0)` 명시 sentinel.
모든 form-layer face 생성 site 가 같은 상수 참조 → 의미 명확화 + 값
변화 0 + 컴파일러가 누락 자동 catch. **향후 ADR 가이드**: field-as-state
폐지 시 named const sentinel 패턴 권장.

### E.3 replace_last_after_snapshot UX 개선 (P-5e-γ)

P-5a 의 conversion 패턴 (Phase 1 + Phase 2 별도 transaction) 으로
Undo 2회 필요. P-5e-γ 의 `TransactionManager::replace_last_after_snapshot`
API 추가 (10 LoC) 로 단일 frame 화. 사용자 facing 영향 매우 큰 개선
(Undo 1회 = 산업 표준). **향후 ADR 가이드**: conversion 패턴 사용 시
trade-off (UX) 를 별도 atomic 으로 cleanup 권장.

### E.4 form/property layer 명명 정합 (P-6)

ADR-049 §4 Q3 ("재질 없는 단계엔 'XIA' 안 노출") 을 UI badge label 로
정합. "Appearance" → "형태 (Shape)", "XIA (물체)" → "XIA (특성)".
시각 (색상/위치) UNCHANGED, label only — 학습 비용 0. **향후 ADR
가이드**: 사용자 facing 라벨 변경은 시각 invariant 보존 + 라벨만
점진 마이그레이션 권장.

### E.5 사용자 facing 라벨 점진 마이그레이션

Phase 1 의 P-6 은 Inspector badge 만. ID format ("XIA-0001"), Menu
labels, ShortcutHelp, Toast 메시지 등은 future ADR (Phase 2+ 또는
별도). **향후 ADR 가이드**: UI 명명 마이그레이션은 한 번에 모두 하지
말고 핵심 사이트 → 보조 사이트 순서로 분할. 사용자 학습 부담 분산.

### E.6 Browser-runtime + vitest + cargo 3-layer 봉인

각 sub-step 의 회귀가 적절한 layer 에서 검증:
- Rust 의미론 변경 → cargo test (axia-core / axia-geo / axia-wasm /
  axia-transaction)
- TS 의미론 변경 → vitest
- 사용자 facing UI → browser-runtime preview_eval + screenshot
모든 layer 가 PASS 해야 commit. **향후 ADR 가이드**: 변경 영향이 multi
-layer 에 걸치면 모든 layer 의 회귀 강제.

---

## 7. References

- ADR-049 §4 Q1+Q3+Q4 — 사용자 결정 lock
- ADR-051 — P7 canonical (manifold 검증의 prerequisite, 본 ADR 과 함께
  Phase 1 closure)
- ADR-019 — Line is Truth (Shape 계층 anchor)
- v3.2 spec §3 시민권 / §7 XIA / §12 강등
- ADR-008 — 직렬화 (사용자 데이터 호환성, 별도 검토 필요)
- ADR-074/078 — Path Z atomic 11+ sub-step 패턴 선례 (E.1 답습)

---

*Author*: AXiA team (사용자 결정 + Claude implementation) |
*Status*: Phase 1 closure (P-1 ~ P-7 모두 완료, 2026-05-06)
