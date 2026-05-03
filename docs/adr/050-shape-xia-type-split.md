# ADR-050 — Shape / Xia Type Split + Phase 1 Promote API

**Status**: Accepted (Phase 1 spec — implementation pending)
**Date**: 2026-05-03
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
- [ ] **구현 (C3 chunk)** — 별도 commit
- [ ] LOCKED #26 update — Phase 1 완료 표시 (구현 commit 와 함께)

---

## 7. References

- ADR-049 §4 Q1+Q3+Q4 — 사용자 결정 lock
- ADR-051 — P7 canonical (manifold 검증의 prerequisite)
- ADR-019 — Line is Truth (Shape 계층 anchor)
- v3.2 spec §3 시민권 / §7 XIA / §12 강등
- ADR-008 — 직렬화 (사용자 데이터 호환성, 별도 검토 필요)

---

*Author*: AXiA team (사용자 결정 + Claude spec) | *Status*: Phase 1 spec
— ADR-051 와 함께 implementation, 본 PR 은 spec 만 (코드 변경 0)
