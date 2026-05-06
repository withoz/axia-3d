# ADR-079 — Create Solid (Surface-Native Solid Generation)

**Status**: **Accepted** (Q1~Q7 모두 lock-in 2026-05-06, spec 정합 완성 —
W-1~W-4 별도 commit 으로 구현)
**Date**: 2026-05-06
**Author**: AXiA team (사용자 결정 + Claude spec)
**Anchor**: 사용자 architectural 결정 (2026-05-06):
> "이전 mesh-era push/pull = analytic surface kernel 과 호환 불가.
> 모든 solid 생성 = surface-aware extrusion 또는 NURBS-native solid
> primitive 패턴으로 reformulate"
**Parent**: ADR-027 (NURBS Kernel Initiative), ADR-049 (Two-Layer
Citizenship), ADR-052 (NURBS Roadmap §Phase R), ADR-059 (Phase N —
Curve/Surface Mandatory), ADR-067 (Press-Pull Engine)
**Supersedes**: ADR-067 Step 2~5 (본 ADR 이 흡수 + 확장 — Step 1
auto-merge 는 보존)
**Related**: ADR-031 (analytic surface primitives), ADR-035/036
(STEP/IGES surface mapping), ADR-050 (Two-Layer Phase 1, Shape
ownership integration), ADR-053 (Phase H surface transform)

---

## 0. Summary (6 lines)

> mesh-era `Mesh::push_pull` (polygonal extrusion + 사후 surface attach)
> 을 surface-native **`Mesh::create_solid(profile, mode)`** 으로
> reformulate. Single user-facing command + `CreateSolidMode` enum
> (Extrude / Revolve / Sweep / Loft). Extrude mode 내부에서 surface
> kind + boundary 별 smart routing (Plane → Box, Plane(circle) →
> Cylinder, Cylinder/Sphere panel → smooth group offset, NURBS → general
> sweep). 다른 mode 는 기존 `Mesh::revolve` / `sweep` / `loft` direct
> dispatch. Primitive direct path (DrawBox/Cylinder/etc.) 와 별개 트랙.
> ADR-067 Step 2~5 흡수, Phase 1 Shape ownership Gap 2 자연 해소.
> 4-step Path Z atomic 롤아웃.

---

## 1. Context

### 1.1 사용자 architectural 결정 (2026-05-06)

> "이전 pushpull 방식은 안돼고, 곡면관련 extrud방식이나, 다른 솔리드
> 입체 형상을 만드는 방식으로 변경되어야 합니다"

**핵심**: NURBS kernel 의 ADR-059 Phase N ("Curve & Surface Mandatory")
는 Edge.curve / Face.surface 를 mandatory 로 만든 architectural shift.
이 환경에서 mesh-era polygonal push/pull 은 **근본적 부정합**.

### 1.2 현 mesh-era push_pull 의 한계 (분석)

`Mesh::push_pull` (axia-geo/src/operations/push_pull.rs:204-300):

| 단계 | 동작 | NURBS-era 정합? |
|------|------|----------------|
| 1. is_move_only 판정 | mesh face normal 평행성 검사 | ⚠️ face.normal() 은 mesh-averaged, surface-aware 아님 |
| 2. MoveOnly 모드 | 정점만 이동 | ⚠️ surface 가 따라오지 않음 (별도 transform 필요) |
| 3. CreateFace 모드 | quad 측면벽 생성 (polygonal) | ❌ side wall = Plane 으로만 표현 가능. Cylinder profile 의 sweep 표현 불가 |
| 4. ADR-060 Step 3 사후 attach | Plane surface 를 top + sides 에 attach | ⚠️ 반쪽 — mesh 는 polygonal 그대로, surface 만 추가됨 |
| 5. ADR-067 Step 1 auto-merge | 인접 coplanar face 자동 merge | ✅ 보존 (본 ADR 이 흡수) |

**근본 문제**:
1. **Truth 불일치**: ADR-059 의 "surface = truth, mesh = view" 정합 불가
   — mesh 가 먼저 만들어지고 surface 는 사후 첨부
2. **곡면 profile 부적합**: Cylinder side panel 을 push 시 panel 만 평행
   이동 → 진정한 cylinder offset 아님 (smooth group 부재)
3. **곡선 boundary 부적합**: Bezier/NURBS curve 가 boundary 인 face 의
   side wall = polygonal strips (curve continuity 깨짐)
4. **Phase 1 Shape ownership gap (Gap 2)**: face_to_xia 만 갱신,
   Shape ownership 미반영 — 새 face 들 orphan

### 1.3 Phase N transition 상태

ADR-059 Phase N 의 현 진행:
- Step 1 (Shadow field) ✅ 완료
- Step 2 (Dual-path) 🟡 prep 완료
- Step 3 (Mandatory) 🔜 pending
- Step 4 (Migration) 🔜 pending

**현재 = surface attach 부분 가능 + mesh 가 still truth 인 dual mode**.
ADR-079 의 implementation 은 Phase N Step 3 mandatory 와 **상호 의존**.

### 1.4 ADR-067 Press-Pull Engine 과의 관계

ADR-067 (2026-05-04) 의 5-Step 설계:
- Step 1 (auto-merge after push_pull) — ✅ 완료, 보존
- Step 2~5 (smart push/pull, surface-aware) — 🔜 미구현

본 ADR-079 가 Step 2~5 vision 의 정식 구체화 + 확장. ADR-067 의 §A
"SketchUp-style 면 잡고 밀고 당기기" UX 정신 답습.

### 1.5 v3.2 spec 정합

Two-Layer Citizenship (ADR-049 §3) 의 시민권 모델에서:
- **형태 (Shape)**: 0 차원 자유 (face/line/point thickness 0 OK)
- **특성 (Xia)**: 부피/단면 + 재질 + watertight + manifold

본 ADR-079 의 solid_extrude 결과:
- Shape input → form-layer solid (재질 없음, surface-defined geometry)
- 사용자 재질 부여 → promote_shape_to_xia (4-condition 통과 시)
- v3.2 의 **"Linear / Volumetric / Surface" XIA 분류** 자연 매핑

---

## 2. Decision — `create_solid` Command (Surface-Native, Profile-Driven)

### 2.1 Primary entry point — `Mesh::create_solid`

**Single user-facing command** + `CreateSolidMode` enum. Profile face
는 항상 입력 — "어떤 face 에서 시작" 이 의미 명확. Mode 가 "어떻게
solid 를 만드느냐" 결정.

```rust
// axia-geo/src/operations/create_solid.rs (NEW)
impl Mesh {
    /// ADR-079 — Surface-native solid creation from a profile face.
    ///
    /// Profile face 의 AnalyticSurface + boundary curve kinds + mode
    /// → 해당 NURBS-native solid 생성. mesh-era push/pull 의
    /// architectural successor.
    ///
    /// **Note**: profile-driven only. Direct primitive 생성 (DrawBox /
    /// DrawCylinder / etc.) 은 별개 path 유지 — `Mesh::create_box` 등
    /// 기존 함수 그대로 (§2.6 참조).
    pub fn create_solid(
        &mut self,
        profile_face: FaceId,
        mode: CreateSolidMode,
        material: MaterialId,
    ) -> Result<CreateSolidResult>;
}

/// ADR-079 §2.1 — Solid creation mode (profile + mode → solid).
#[derive(Clone, Debug)]
pub enum CreateSolidMode {
    /// Linear extrusion. SketchUp Push/Pull 의 NURBS-native 등가물.
    /// Smart routing (§2.3) 가 surface kind + boundary 별 분기.
    Extrude { distance: f64 },

    /// Rotation around an axis. 기존 `Mesh::revolve` 활용.
    Revolve { axis_origin: DVec3, axis_dir: DVec3, angle_rad: f64 },

    /// Sweep along a path curve. 기존 `Mesh::sweep` 활용.
    Sweep { path: AnalyticCurve },

    /// Loft to another profile face. 기존 `Mesh::loft` 활용.
    Loft { other_profile: FaceId },
}
```

### 2.2 Result type

```rust
#[derive(Clone, Debug)]
pub struct CreateSolidResult {
    pub profile_face:    FaceId,         // 입력 (보존 OR 변형)
    pub mode_used:       CreateSolidMode, // dispatch 기록
    pub solid_kind:      SolidKind,      // routing 결과 분류
    pub top_face:        FaceId,         // Extrude/Sweep 의 종단면
                                         // (Revolve 360° 시 = profile_face,
                                         //  partial revolve 시 = end cap)
    pub side_faces:      Vec<FaceId>,    // 측벽 (analytic surface 정의)
    pub all_solid_faces: Vec<FaceId>,    // form-layer Shape 등록용 종합
    pub adjacent_splits: usize,          // ADR-067 Step 1 auto-merge 결과
    pub split_debug:     Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SolidKind {
    /// Plane all-Line boundary → Box (6 Planes)
    Box,
    /// Plane circular/arc boundary → Cylinder (1 Cylinder + 2 Plane caps)
    Cylinder,
    /// Curved profile (Cylinder/Sphere/Cone/Torus panel) → smooth group
    /// 전체 일관 변형
    SmoothGroupOffset,
    /// Mixed/NURBS profile → general sweep (NURBSSurface walls)
    GeneralSweep,
    /// Revolve mode 결과 (360° 또는 partial)
    RevolutionSolid,
    /// Sweep mode 결과 (path-driven)
    SweptSolid,
    /// Loft mode 결과 (profile-to-profile blend)
    LoftSolid,
}
```

### 2.3 `Extrude` mode 의 Smart Routing — surface variants × boundary matrix

**Smart routing 은 `Extrude` mode 내부에서만 작동**. 다른 mode 는
direct dispatch (§2.5).

| Profile surface | Boundary 종류 | 결과 SolidKind | Side walls | Step |
|-----------------|--------------|---------------|-----------|------|
| Plane | All Line | **Box** (existing `Mesh::create_box` 활용) | 4+ Planes | W-1 scope |
| Plane | All Circle/Arc | **Cylinder** (existing `create_cylinder` 활용) | 1 Cylinder + 2 Plane caps | W-1 scope |
| Plane | Mixed (Line + Curve) | **GeneralSweep** | NURBSSurface (extruded ribbons) | W-3 scope |
| Cylinder (panel) | (smooth group context) | **SmoothGroupOffset** | adjacent panels coordinated | W-2 scope |
| Sphere (panel) | (smooth group) | **SmoothGroupOffset** | sphere offset ≠ trivial — local approximation | W-2 scope |
| Cone (panel) | (smooth group) | **SmoothGroupOffset** | linear interpolation along axis | W-2 scope |
| Torus (panel) | (smooth group) | **SmoothGroupOffset** | minor radius offset | W-2 scope |
| BezierPatch / BSplineSurface / NURBSSurface | (general) | **GeneralSweep** | NURBSSurface walls (Phase L 의 fitting) | W-3 scope |

```rust
match mode {
    CreateSolidMode::Extrude { distance } => {
        // Smart routing — surface kind + boundary kinds 분기
        let surface = self.faces[profile_face].surface()
            .ok_or(SolidError::NoProfileSurface)?;
        match (surface, self.classify_boundary(profile_face)?) {
            (AnalyticSurface::Plane { .. }, BoundaryKind::AllLinear) =>
                self.extrude_planar_box(profile_face, distance, material),
            (AnalyticSurface::Plane { .. }, BoundaryKind::AllCircular) =>
                self.extrude_planar_cylinder(profile_face, distance, material),
            (AnalyticSurface::Plane { .. }, BoundaryKind::Mixed) =>
                self.extrude_planar_sweep(profile_face, distance, material),
            (AnalyticSurface::Cylinder { .. }, _)
            | (AnalyticSurface::Sphere   { .. }, _)
            | (AnalyticSurface::Cone     { .. }, _)
            | (AnalyticSurface::Torus    { .. }, _) =>
                self.extrude_smooth_group(profile_face, distance, material),
            (AnalyticSurface::BezierPatch    { .. }, _)
            | (AnalyticSurface::BSplineSurface { .. }, _)
            | (AnalyticSurface::NURBSSurface   { .. }, _) =>
                self.extrude_general_sweep(profile_face, distance, material),
        }
    }
    CreateSolidMode::Revolve { .. } => self.create_solid_via_revolve(...),
    CreateSolidMode::Sweep   { .. } => self.create_solid_via_sweep(...),
    CreateSolidMode::Loft    { .. } => self.create_solid_via_loft(...),
}
```

### 2.4 Shape ownership integration (Gap 2 자연 해소)

`Scene::exec_create_solid` (Scene wrapper):
```rust
fn exec_create_solid(
    &mut self, face_id: FaceId, mode: CreateSolidMode,
) -> CommandResult {
    self.transactions.begin();
    self.transactions.set_before_snapshot(self.scene_snapshot());
    
    match self.mesh.create_solid(face_id, mode, FORM_MATERIAL) {
        Ok(result) => {
            // ADR-050 P-5e dual ownership lookup
            let owning_xia_id   = self.face_to_xia.get(&face_id).copied();
            let owning_shape_id = self.face_to_shape.get(&face_id).copied();
            
            if let Some(xia_id) = owning_xia_id {
                // Xia path (legacy + ADR-050 P-2 promote 후)
                self.update_xia_face_ids_from_solid(xia_id, &result);
            } else if let Some(shape_id) = owning_shape_id {
                // Shape path (Phase 1 default ON)
                self.update_shape_face_ids_from_solid(shape_id, &result);
            }
            
            self.transactions.set_after_snapshot(self.scene_snapshot());
            self.transactions.commit();
            CommandResult::SolidCreated {
                kind: result.solid_kind,
                face_count: result.all_solid_faces.len(),
            }
        }
        Err(e) => {
            self.transactions.cancel();
            CommandResult::Error(e.to_string())
        }
    }
}
```

`face_to_shape: HashMap<FaceId, ShapeId>` 신규 reverse map (P-1 lock-in
의 자연 확장 — Shape 도 face owner 추적). ADR-050 W-1 (Gap 2 fix) 의
의도였던 face_to_shape 가 ADR-079 의 일부로 자연 통합.

### 2.5 다른 mode (Revolve / Sweep / Loft) — direct dispatch

`Extrude` 외 mode 는 smart routing 없이 단일 method 위임. 각 mode 의
모든 분기는 그 method 내부에서 처리.

```rust
fn create_solid_via_revolve(
    &mut self,
    profile_face: FaceId,
    axis_origin: DVec3, axis_dir: DVec3, angle_rad: f64,
    material: MaterialId,
) -> Result<CreateSolidResult> {
    // 기존 Mesh::revolve (axia-geo/src/operations/revolve.rs:39)
    // 활용. 결과를 CreateSolidResult 로 wrap.
    let revolve_result = self.revolve(profile_face, axis_origin, axis_dir,
                                       angle_rad, material)?;
    // 360° → top_face = profile_face (closed solid)
    // partial → top_face = end-cap face (둘다 Plane attach 가능)
    Ok(CreateSolidResult {
        profile_face,
        mode_used: CreateSolidMode::Revolve { axis_origin, axis_dir, angle_rad },
        solid_kind: SolidKind::RevolutionSolid,
        top_face: revolve_result.end_cap_or_profile,
        side_faces: revolve_result.swept_faces,
        all_solid_faces: revolve_result.all_faces,
        adjacent_splits: 0,
        split_debug: Vec::new(),
    })
}

// Sweep / Loft 동일 패턴 — Mesh::sweep / Mesh::loft 위임
```

기존 `Mesh::revolve` (axia-geo/src/operations/revolve.rs, 313 LoC) /
`Mesh::sweep` (sweep.rs, 229 LoC) / `Mesh::loft` (loft.rs, 220 LoC) 는
**그대로 보존** — `create_solid` 가 이들 위에 thin orchestration layer.

### 2.6 Primitive direct path 와의 관계 (별개 트랙)

`Mesh::create_box` / `create_cylinder` / `create_cone` / `create_sphere`
(axia-geo/src/operations/primitives.rs) 는 **직접 primitive 생성 path**:
- 사용자가 profile face 없이 "박스 그리기" → DrawBox tool → `create_box`
- 분리 이유: profile-driven 과 primitive direct 는 다른 UX
- 두 path 모두 결과는 NURBS-native solid (analytic surfaces)

**평행 트랙**:
- DrawBox / DrawCylinder / etc. tools → `Mesh::create_box` etc.
  (primitive direct)
- Push/Pull / Revolve / Sweep / Loft tools → `Mesh::create_solid`
  (profile-driven)

본 ADR 은 **profile-driven path (`create_solid`) 만 다룸**. Primitive
direct 는 기존 함수 그대로 + 별도 ADR (필요 시).

---

## 3. Sub-Decisions (사용자 결재 항목)

### Q1. Smart Routing scope clarification
- (a) 모든 mode 에서 smart routing (Revolve/Sweep/Loft 도 분기)
- **(b) `Extrude` mode 내부에서만 smart routing — 다른 mode 는 direct
  dispatch (single method per mode)** ← 권장 (§2.3 + §2.5)
- (c) 분기 일체 없이 모든 case 를 GeneralSweep 로 처리 (단순화)
- **Decision**: Q1 Open — (b) 권장. 추론 부담 ↓ + 구현 명확성 ↑ +
  향후 확장 용이.

### Q2. ADR-067 Step 2~5 와의 관계
- (a) **흡수** — 본 ADR 이 Step 2~5 의 spec 을 통합 supersede
- (b) 별개 — ADR-067 은 UX layer, ADR-079 는 kernel layer
- **Decision (2026-05-06 lock-in)**: **(a) 흡수**. 단일 트랙 — kernel +
  UX 모두 ADR-079 anchor. ADR-067 의 Step 1 (auto-merge after push_pull)
  만 보존. Step 2~5 의 vision (smart push/pull, surface-aware
  orchestration) 은 본 ADR 의 W-1~W-4 로 통합 구현.

### Q3. Legacy mesh-era push_pull deprecation timing
- (a) W-1 직후 deprecate (강한 cutover) — backward compat 0
- (b) **W-4 deprecate** (점진 — Plane → Cylinder → General 단계 별 fallback)
- (c) 영구 보존 (legacy fallback) — 새 create_solid 가 default,
  push_pull 은 internal fallback
- **Decision (2026-05-06 lock-in)**: **(b) W-4 점진 deprecate**. W-1~W-3
  동안 각 step 이 처리 못하는 케이스 (예: W-1 시점의 Cylinder profile)
  는 legacy `Mesh::push_pull` fallback. W-4 에서 fallback 폐기 + UX
  migration. **L6 (Backward compat) 정합**.

### Q4. P-5e-α default flip 의 영향 (W-1 까지의 임시 처리)
- (a) Push/Pull tool 일시 비활성화 (W-1 까지)
- (b) Push/Pull 시 Shape 자동 promote → legacy push_pull 사용 (관대)
- (c) **"지원 예정" Toast + no-op (사용자 명시 차단)**
- **Decision (2026-05-06 lock-in)**: **(c) 명시 차단 + Toast**. 사용자가
  form mode 에서 Shape 그린 후 Push/Pull 시도 시 Toast 표시:
  > "create_solid W-1 까지 form-mode Push/Pull 지원 예정. 임시 우회 =
  > Settings 패널 의 'form 모드 (실험)' OFF → legacy Xia mode 사용"
- **임시 안내**는 W-1 commit 직후 자동 사라짐 (Push/Pull 정상 작동).

### Q5. 곡면 profile (Cylinder side panel) push 의 정확한 semantics
- (a) Panel 만 평행 이동 (현 mesh-era 거동) — 절단 발생
- (b) **Smooth group 전체 offset** — Cylinder 가 통째로 외부로 부풀어 오름
- (c) 사용자 명시 — UX 모달에서 "panel 만 / 그룹 전체" 선택
- **Decision (2026-05-06 lock-in)**: **(b) Smooth group 전체 offset**.
  SketchUp 표준 거동 답습 — 사용자가 곡면 (Cylinder/Sphere/Cone/Torus)
  의 한 panel 클릭 후 Push 시 그 곡면 전체가 일관 변형. W-2 scope
  의 핵심 알고리즘.

### Q6. Sweep solid 의 surface representation
- (a) BezierPatch (3차) — 직선 sweep 경로면 충분, 곡선 sweep 경로엔 부족
- (b) BSplineSurface (가변 차수) — 일반적
- (c) **NURBSSurface (rational)** — 정확한 cylinder/sphere boundary sweep 가능
- **Decision (2026-05-06 lock-in)**: **(c) NURBSSurface (rational)**.
  Rational NURBS 가 가장 일반적 + STEP/IGES export 호환성 ↑ + Phase L
  (advanced surfaces) 의 fitting 결과 자연 매핑. W-3 scope 의 surface
  type. Bezier/BSpline profile 도 NURBSSurface 로 통합 표현 (rational
  weight 1.0 = 비-rational, 다른 값 = rational).

### Q7. Shape ownership face_to_shape map 도입 시점
- (a) **ADR-079 W-1 와 함께 (자연 통합)**
- (b) Phase 1 Gap 2 fix 로 별도 atomic (ADR-079 의 prerequisite)
- **Decision (2026-05-06 lock-in)**: **(a) W-1 와 함께**. W-1 의 일부로
  `face_to_shape: HashMap<FaceId, ShapeId>` reverse map 도입 +
  `Scene::exec_create_solid` 가 양쪽 ownership (Xia + Shape) 분기 처리.
  별도 atomic 분리 시 중간 상태 어색 (Shape ownership map 만 추가하고
  사용처 부재). W-1 단일 atomic 으로 통합.

### Q1~Q7 lock-in 요약 표 (2026-05-06)

| Q | 결정 | 의미 |
|---|------|------|
| Q1 | (b) Extrude 내부만 smart routing | 다른 mode 는 direct dispatch |
| Q2 | (a) ADR-067 Step 2~5 흡수 | 단일 트랙, Step 1 만 보존 |
| Q3 | (b) W-4 점진 deprecate | 각 step 별 legacy fallback |
| Q4 | (c) 명시 차단 + Toast | "지원 예정" 안내, 임시 우회 = legacy mode |
| Q5 | (b) Smooth group 전체 offset | SketchUp 표준 거동 |
| Q6 | (c) NURBSSurface (rational) | 일반적 + 호환성 |
| Q7 | (a) W-1 와 함께 face_to_shape | 자연 통합 |

**모든 Q lock-in 완료 → W-1 사전 검토 진입 가능**.

---

## 4. 4-Step Rollout (Path Z atomic)

| Step | Scope | 영역 | 영향 | 회귀 (예상) | 의존 |
|------|-------|------|------|------------|------|
| **W-α** (본 commit) | ADR-079 spec only | docs | 0 | 0 | — |
| **W-1** | `Mesh::create_solid` skeleton + `CreateSolidMode::Extrude` Plane-all-Line → Box + `face_to_shape` map + `Scene::exec_create_solid` + 8 회귀 | axia-geo + axia-core + WASM | Plane Rect/Polygon profile push 정상화 | +20~25 | W-α |
| **W-2** | Plane-Circular → Cylinder (`extrude_planar_cylinder`) + smooth group offset (Cylinder/Sphere/Cone/Torus panel) | axia-geo Phase H/I/J 활용 | 곡면 profile 전체 변형 | +30~40 | W-1, Phase N Step 3 |
| **W-3** | `extrude_general_sweep` (Bezier/BSpline/NURBS profile → NURBSSurface walls) + `CreateSolidMode::Sweep` / `Loft` direct dispatch (existing `Mesh::sweep` / `Mesh::loft` wrap) | axia-geo Phase L 활용 | 임의 NURBS profile + Sweep/Loft mode | +25~35 | W-2, Phase L 완료 |
| **W-4** | `CreateSolidMode::Revolve` direct dispatch (existing `Mesh::revolve` wrap) + Legacy push_pull deprecation + UX migration (PushPullTool routing) + ADR-067 Step 1 보존 | axia-geo + TS Tools + WASM bridge | 모든 mode 정합 + UX 통합 | +15~20 | W-3 |

**합계 예상**: 4-step 합산 **+85~115 회귀**, 절대 #[ignore] 금지 강제.
LOCKED #1 / ADR-051 / ADR-050 / ADR-074 / ADR-078 모두 PASS 유지.

---

## 5. Architectural Principles (Lock-ins)

### L1 — Surface = truth, Mesh = view (메타-원칙 #13 정합)

solid_extrude 의 결과는 AnalyticSurface 들의 collection 이 truth.
Mesh polygonal representation 은 tessellation cache (자동 재계산).
Phase N Step 3 mandatory 후 enforcement.

### L2 — Smart routing 은 surface kind 만으로 결정 (boundary 또한 분기 키)

profile_face.surface() + boundary curve kinds = **routing key**.
사용자 명시 모달 없음 — kernel 이 자동 선택. 모호 케이스는 GeneralSweep
fallback.

### L3 — 모든 결과 face 는 analytic surface attached

W-1: 6 Planes (Box). W-2: Cylinder + 2 Planes (Cylinder), 또는 smooth
group 의 모든 panel 갱신. W-3: NURBSSurface walls. **Phase N
mandatory 정합** — Option<Surface> 절대 None 으로 두지 않음.

### L4 — Shape ownership 자동 갱신 (Phase 1 Gap 2 자연 해소)

face_to_shape reverse map + Scene::exec_solid_extrude 에서 양쪽 ownership
(Xia + Shape) 분기. P-5d/P-5e-α 의 Phase 1 Shape default 와 정합.

### L5 — ADR-067 Step 1 (auto-merge) 보존

solid_extrude 결과에서도 인접 coplanar face 자동 merge. 사용자가 어떤
operation 을 호출했는지 무관 — UX 일관성.

### L6 — Backward compat (W-4 까지 legacy push_pull 보존)

W-1 ~ W-3 동안 legacy `Mesh::push_pull` 보존 — fallback for unsupported
surface kinds. W-4 에서 legacy → solid_extrude internal routing 으로
교체 (외부 API 유지).

### L7 — v3.2 시민권 모델 정합

`create_solid` 결과 = form-layer Shape (재질 없음). 사용자 재질 부여 시
ADR-050 P-2 promote 4-condition 통과 → Xia 승격. v3.2 §7 의 Linear /
Volumetric / Surface XIA 분류 자연 매핑.

### L8 — `create_solid` profile-driven only — Primitive direct path 와 분리

`Mesh::create_solid(profile, mode)` 는 **profile face 입력 필수**.
Direct primitive 생성 (DrawBox / DrawCylinder / DrawCone / DrawSphere /
DrawTorus) 은 **별개 path** — 기존 `Mesh::create_box` 등 함수 그대로
유지 (§2.6 참조).

**근거**: profile-driven (`create_solid`) 와 primitive direct (`create_box`)
는 다른 UX:
- profile-driven: "이 face 에서 시작해 솔리드 생성" — Push/Pull / Revolve /
  Sweep / Loft 의 자연 의미
- primitive direct: "처음부터 박스 그리기" — DrawBox tool 의 단순 의미

두 path 모두 결과는 NURBS-native solid (analytic surfaces). 통합 시 API
복잡도 ↑ + UX 모호 — 분리 유지.

**Future amendment**: primitive direct 를 `create_solid_primitive` 같은
별도 entry 로 통합할지는 별도 ADR 결정.

---

## 6. Out of Scope

본 ADR 은 다음을 다루지 않음:

- **Sketch-based modeling**: 2D 스케치 → 3D 솔리드의 SketchUp/Fusion 식
  workflow. 별도 ADR (Sketch Mode 확장).
- **Boolean ops on resulting solids**: solid_extrude 결과의 Union/Subtract/
  Intersect. ADR-064/066 (NURBS Boolean) 가 이미 다룸.
- **Inset push (SketchUp 의 Press-Pull face split)**: 사용자가 face 안에서
  click 하여 사각형 그리고 push. ADR-067 Step 3~4 별도.
- **Dynamic constraints**: extrude 거리의 parametric 표현. ADR-067
  Step 5 별도.
- **Loft / Sweep general path operations**: 본 ADR 은 linear translation
  extrusion 만. Path-based sweep 은 별도 ADR.
- **Revolve solid creation**: 직접 사용자가 회전 축 지정 → revolve. 별도
  ADR (이미 `Mesh::revolve` 존재).

---

## 7. Open Questions for User Review

W-α (본 ADR commit) 는 spec only. Implementation 시작 전 사용자 review
필요한 7개 결정 (§3 Q1~Q7) 모두 Open. 다음 단계:

1. 사용자 review → Q1~Q7 lock-in
2. lock-in 결과를 §3 에 amend
3. W-1 사전 검토 → 사용자 결재 → 구현
4. W-2/W-3/W-4 동일 패턴

---

## 8. Acceptance Criteria

- [x] 사용자 결정 anchor 명시 (§1.1)
- [x] 현 mesh-era push/pull 한계 분석 (§1.2)
- [x] Phase N transition 상태 정합 (§1.3)
- [x] ADR-067 supersede 명시 (§1.4)
- [x] v3.2 시민권 정합 (§1.5)
- [x] Smart routing primary entry 정의 (§2.1)
- [x] SolidKind enum + result type (§2.2)
- [x] 8 surface variants × behavior matrix (§2.3)
- [x] Shape ownership integration spec (§2.4)
- [x] 7 sub-decisions Q1~Q7 (§3)
- [x] 4-step rollout plan (§4)
- [x] 7 architectural lock-ins L1~L7 (§5)
- [x] Out of scope 명시 (§6)
- [x] **사용자 review Q1~Q7 lock-in** (2026-05-06, §3 amend 완료)
- [ ] **W-1 사전 검토 + 구현** (별도 commit, lock-in 완료 후 진입 가능)

---

## 9. References

### ADR cross-links

- ADR-027 — NURBS Kernel Initiative (Phases A~G master plan)
- ADR-049 — Two-Layer Citizenship Model (form vs property layer)
- ADR-052 — NURBS Kernel Completion Roadmap (§Phase R UX integration)
- ADR-053 — Phase H surface transform (translation under Rigid)
- ADR-059 — Phase N: Curve & Surface Mandatory (4-step incremental)
- ADR-060 — Phase O Tools NURBS-aware (Step 3 surface attach)
- ADR-067 — Press-Pull Engine (Step 1 보존, Step 2~5 흡수)
- ADR-031 — analytic surface primitives (Plane/Cylinder/Sphere/Cone/Torus)
- ADR-050 — Two-Layer Citizenship Phase 1 (Shape ownership integration
  via face_to_shape map)
- v3.2 spec §3 시민권 / §7 XIA / §12 강등

### Existing kernel ops (W-1~W-4 활용)

- `crates/axia-geo/src/operations/push_pull.rs` (1647 LoC) — legacy
  mesh-era push/pull. W-4 까지 보존, W-4 에서 deprecate.
- `crates/axia-geo/src/operations/revolve.rs` (313 LoC) —
  `Mesh::revolve` (W-4 의 `CreateSolidMode::Revolve` direct dispatch
  대상)
- `crates/axia-geo/src/operations/sweep.rs` (229 LoC) —
  `Mesh::sweep` (W-3 의 `CreateSolidMode::Sweep` direct dispatch 대상)
- `crates/axia-geo/src/operations/loft.rs` (220 LoC) —
  `Mesh::loft` (W-3 의 `CreateSolidMode::Loft` direct dispatch 대상)
- `crates/axia-geo/src/operations/primitives.rs` —
  `Mesh::create_box / create_cylinder / create_cone / create_sphere`
  (§2.6 별개 트랙, `create_solid` 와 분리 유지)

---

*Author*: AXiA team (사용자 결정 + Claude spec) | *Status*: **Accepted**
(`create_solid` 명령 + `CreateSolidMode` enum + Q1~Q7 모두 lock-in
2026-05-06, spec 정합 완성). W-1~W-4 별도 commit 으로 구현.

---

## 10. W 트랙 closure 회고 (2026-05-06, W-4-β 직후)

### 10.1 누적 sub-atomic / 회귀 (W-1 ~ W-4)

| Track   | Commit  | SolidKind            | axia-geo | axia-core | axia-wasm | vitest |
|---------|---------|----------------------|----------|-----------|-----------|--------|
| W-α (spec)  | 2920e5e | (decisions only)  | 0        | 0         | 0         | 0      |
| W-1-α   | cad4ed0 | Box                  | +6       | +5        | 0         | 0      |
| W-1-β   | fa24a51 | (bridge)             | 0        | 0         | +4        | +6     |
| W-2-α   | 7ea2723 | Cylinder             | +7       | 0         | 0         | 0      |
| W-2-β   | a424504 | (integration seal)   | 0        | +2        | +1        | 0      |
| W-2-γ-i  | 3869fb2 | SmoothGroupOffset (Cylinder)  | +7  | (-1+1)   | 0   | 0      |
| W-2-γ-ii | 6fcbb04 | SmoothGroupOffset (Sphere)    | +7  | 0         | 0   | 0      |
| W-2-γ-iii | 9d6bc86 | SmoothGroupOffset (Cone)    | +7  | 0         | 0   | 0      |
| W-2-γ-iv  | 88f36db | SmoothGroupOffset (Torus)   | +7  | (-1+1)   | 0   | 0      |
| **W-4-α** | **f37efce** | **RevolutionSolid**  | **+5** | **+1** | **0** | **0** |
| **W-4-β (본)** | **(this)** | (deprecate notice) | **0** | **0** | **0** | **0** |
| **W 트랙 합계** | | 6 SolidKind 활성 | **+53** | **+8** | **+5** | **+6** |

ADR-079 W 트랙 11 atomic commits (포함 본 W-4-β). 6 SolidKind 활성 (Box,
Cylinder, SmoothGroupOffset, RevolutionSolid + 별개 V-β-γ surfaces).
Q3 fallback 의 backing 인 legacy `Mesh::push_pull` 은 deprecation marker
(comment-only) 만 추가, 실제 코드는 보존 (§W4-G-(a) 로 결재).

### 10.2 What worked well (W 트랙)

- **Surface-aware kernel command**: `Mesh::create_solid(face_id, mode,
  material)` 단일 진입점이 mesh-era `push_pull` 의 surface attach 사후
  처리 한계 (NURBS 부정합) 를 처음부터 회피.
- **Smart routing per-curve-on-surface** (W-2-γ): 4 surface kind 별로
  자연 curve 의미론 (Cylinder radius / Sphere center / Cone half_angle /
  Torus major_radius preserve) 활성. 각 sub-atomic 의 결재 매트릭스
  (§W2γ1~4-A~H) 가 ADR-080 V-β-γ 의 dispatch 답습.
- **SolidKind enum + kind-agnostic Scene dispatch**: Scene::exec_create_
  solid 가 Box / Cylinder / SmoothGroupOffset / RevolutionSolid 모두
  동일 ownership 갱신 경로. 새 SolidKind 추가 시 Scene 변경 0.
- **Q3 fallback 패턴**: NotYetSupported 시 자동 legacy push_pull 호출
  (Scene wrapper 가 처리). 사용자 facing 차단 없이 점진 전환 가능.
- **W-4 dispatch via existing op**: `Mesh::revolve` (이미 존재) 위임 +
  validation layer 만 추가. Path Z atomic 의 minimum-changes 원칙.

### 10.3 What we deferred (conscious)

- **W-4 partial angle** (angle_rad ≠ TAU): NotYetSupported. Mesh::revolve
  가 segments 매개변수 만 받음 → partial 지원 시 Mesh::revolve 확장 필요.
  사용자 텔레메트리 후 W-4-γ 로 검토.
- **W-3 Sweep / Loft modes**: NotYetSupported. AnalyticCurve::Path 추출
  + `Mesh::sweep` / `Mesh::loft` 위임 패턴은 W-4-α 답습. 별도 트랙.
- **NURBS-class profiles (BezierPatch / BSplineSurface / NURBSSurface)**:
  W-3 (offset 트랙의 V-β-δ + ADR-079 W-3 cross-cut). 별도 ADR.
- **Legacy push_pull 의 `#[deprecated]` Rust attribute**: §W4-G-(a)
  comment-only 채택. 텔레메트리 후 (b)/(c) 검토.

### 10.4 Path Z atomic 호흡 (W 트랙 최종)

11 commits 동안 일관 패턴:
1. 사용자 사전 검토 매트릭스 결재
2. 구현 + 회귀 봉인 (#[ignore] 금지)
3. WASM rebuild (필요 시)
4. vitest + vite build green
5. Dev server (HMR) error 0 verify
6. commit + push origin

각 atomic 의 회귀 +5~9 으로 cognitive load manageable. ADR-080 V-β /
V-δ 트랙과 합산하여 23 atomic commits, axia-geo +96, axia-core +9,
axia-wasm +10, vitest +33 — 전체 #[ignore] 금지 148/148 준수.

### 10.5 Path Z atomic 다음

- **W-3** (NURBS profile + NURBS-class hosts) — ADR-080 V-β-δ cross-cut.
  사전 검토 매트릭스 작성 + 단계적 sub-atomic 분해 권장.

ADR-079 W 트랙 closure. ADR-080 도 V-α / V-β / V-δ closure (V-γ /
V-ε / V-ζ 만 future). 다음 자연 후속 = W-3.

## 11. W-3 트랙 closure addendum (2026-05-06, W-3-δ 직후)

§10 작성 시점 (W-4-β 직후, 2026-05-06) 에서 W-3 트랙은 아직 미해결 이었음.
W-3 4 sub-atomic 추가 closure 후 본 §11 가 ADR-079 의 진짜 final
회고. ADR-079 + ADR-080 cross-cut 마무리.

### 11.1 W-3 누적 sub-atomic / 회귀

| Track  | Commit  | SolidKind / Scope           | axia-geo |
|--------|---------|-----------------------------|----------|
| W-3-α  | 30148da | SweptSolid (Sweep mode)     | +5       |
| W-3-β  | 7efc713 | LoftSolid (Loft mode)       | +5       |
| W-3-γ  | a5aed1f | (ADR-080 V-β-δ NURBS curves on Plane) | +4 |
| W-3-δ  | f9bd24d | GeneralSweep (NURBS-class hosts) | +8 |
| **합계** | | **W-3 트랙 (4 sub-atomic)** | **+22**  |

ADR-079 W 트랙 grand total (W-1~W-4): 15 commits (포함 §10 11 + W-3 4),
axia-geo +75, axia-core +9, axia-wasm +5, vitest +6 (W-1-β 의 +6 외
W-2~W-4 는 0).

### 11.2 SolidKind 7개 모두 활성

| SolidKind            | Activated by | Mode    |
|----------------------|--------------|---------|
| Box                  | W-1-α        | Extrude |
| Cylinder             | W-2-α        | Extrude |
| SmoothGroupOffset    | W-2-γ-i~iv   | Extrude |
| RevolutionSolid      | W-4-α        | Revolve |
| SweptSolid           | W-3-α        | Sweep   |
| LoftSolid            | W-3-β        | Loft    |
| **GeneralSweep**     | **W-3-δ**    | Extrude (NURBS-class profile) |

### 11.3 Cross-cut with ADR-080

- **W-3-γ ↔ ADR-080 V-β-δ**: NURBS-class curves on Plane host.
  Tessellation-based chord offset. Plane host 의 모든 curve types
  (Line / Arc / Circle / Bezier / BSpline / NURBS) 활성.
- **W-3-δ ↔ ADR-080 V-β-γ-5/6/7**: NURBS-class hosts (BezierPatch /
  BSplineSurface / NURBSSurface). Tessellation-based representative
  normal offset. ADR-080 의 8 host kinds 모두 활성.

### 11.4 What worked well (W-3 specific)

- **Path Z 답습 효율**: W-3-α (Sweep) 가 W-4-α (Revolve) 의 패턴 답습 —
  engine 위임 + multi-loop guard + 사용자 facing validation. W-3-β
  (Loft) 도 동일.
- **Tessellation-based approximation 정합성**: W-3-γ (curves) +
  W-3-δ (hosts) 모두 §W3-B-(a) "tessellation 의미론" lock-in 일관 적용.
  Newton fit 미사용 → MVP 단순성 + future enhancement 명확 (W-3-ε).
- **`AnalyticSurface::normal_at_world_pos` 재사용**: 기존 함수 (V-β-γ /
  ADR-038 P23 surface-aware normals) 가 NURBS-class 의 fallback 으로
  자연스럽게 활용. 신규 코드 0.
- **`finish_plane_offset` shared helper (V-β-α/β + V-δ-α + W-3-δ)**:
  4 컨텍스트 (face host / 자유 wire / explicit plane / NURBS-class
  host) 모두 동일 helper 호출 → SSOT.

### 11.5 What we deferred (conscious)

- **Newton-fit curve refit (W-3-ε scope)**: NURBS curve 의 offset 후
  curve metadata 보존 위해 새 NURBS 로 refit 가능 (chord-only 은 lossy).
  사용자 텔레메트리 후 검토.
- **Per-vertex surface normal evaluate (W-3-ε scope)**: 큰 곡률 NURBS
  host 에서 single representative normal 의 approximation error 큼.
  per-vertex normal evaluate 시 결과 surface 가 새 NURBS 로 fit 필요.
- **NURBS-class profile 의 surface metadata 보존**: 현재 GeneralSweep
  의 top cap 은 Plane synthesized. NURBS profile 의 직접 translation
  → 새 NURBS top cap 보존은 W-3-ε 검토.
- **Sweep / Loft frame matching**: Mesh::sweep 의 internal frame
  (world_up 기반) 이 face's basis_u 와 일치 안 할 수 있음. 결과 회전
  가능 — frame matching enhancement 별도 atomic.

### 11.6 Path Z atomic 다음 (ADR-079 + ADR-080 모두 closure)

- ADR-080 V-γ (face semantic 결정) — 별도 ADR
- ADR-080 V-ε / V-ζ (Vertex / Volume dimension) — future ADR
- ADR-079 W-3-ε / W-4-γ (curve refit / partial revolve) — 텔레메트리 후
- 새 ADR (e.g., ADR-081 STEP/IGES NURBS-class import 경로 활성)
