# ADR-079 — Solid Extrusion (Surface-Native Push/Pull Reformulation)

**Status**: Proposed (사용자 결정 anchor 2026-05-06, spec only — 4-step
구현 별도 atomic)
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

## 0. Summary (5 lines)

> mesh-era `Mesh::push_pull` (polygonal extrusion + 사후 surface attach)
> 을 surface-native `solid_extrude` 로 reformulate. Profile face 의
> AnalyticSurface 종류에 따라 smart routing — Plane → Box, Plane(circle
> boundary) → Cylinder, Cylinder/Sphere/Cone panel → smooth group offset,
> Bezier/NURBS profile → general sweep. ADR-067 Step 2~5 vision 흡수,
> Phase 1 Shape ownership Gap 2 자연 해소. 4-step Path Z atomic 롤아웃.

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

## 2. Decision — Surface-Native Solid Extrusion (Option C: Smart Routing)

### 2.1 Primary entry point

```rust
// axia-geo/src/operations/solid_extrude.rs (NEW)
impl Mesh {
    /// ADR-079 — Surface-native solid extrusion.
    ///
    /// Profile face 의 AnalyticSurface 종류에 따라 smart routing.
    /// 결과는 모든 face 가 analytic surface 로 정의된 solid.
    pub fn solid_extrude(
        &mut self,
        profile_face: FaceId,
        dist: f64,
        material: MaterialId,
    ) -> Result<SolidExtrudeResult> {
        let surface = self.faces[profile_face].surface()
            .ok_or(SolidError::NoProfileSurface)?;
        let direction = surface.normal_at(0.0, 0.0)?; // analytic normal

        match surface {
            // Planar profiles
            AnalyticSurface::Plane { .. } => {
                let boundary_kind = self.classify_boundary_curves(profile_face)?;
                match boundary_kind {
                    BoundaryKind::AllLinear      => self.extrude_planar_box(profile_face, dist, material),
                    BoundaryKind::CircularOnly   => self.extrude_planar_cylinder(profile_face, dist, material),
                    BoundaryKind::Mixed          => self.extrude_planar_sweep(profile_face, dist, material),
                }
            }
            // Curved profiles (smooth group)
            AnalyticSurface::Cylinder { .. } => self.extrude_smooth_group(profile_face, dist, material),
            AnalyticSurface::Sphere { .. }   => self.extrude_smooth_group(profile_face, dist, material),
            AnalyticSurface::Cone { .. }     => self.extrude_smooth_group(profile_face, dist, material),
            AnalyticSurface::Torus { .. }    => self.extrude_smooth_group(profile_face, dist, material),
            // NURBS profile
            AnalyticSurface::BezierPatch { .. }
            | AnalyticSurface::BSplineSurface { .. }
            | AnalyticSurface::NURBSSurface { .. } => {
                self.extrude_general_sweep(profile_face, dist, material)
            }
        }
    }
}
```

### 2.2 Result type

```rust
#[derive(Clone, Debug)]
pub struct SolidExtrudeResult {
    pub profile_face:   FaceId,         // 입력 (보존 OR 변형)
    pub top_face:       FaceId,         // 상부면 (translated profile)
    pub side_faces:     Vec<FaceId>,    // 측벽 (analytic surface 정의)
    pub solid_kind:     SolidKind,      // smart routing 결과
    pub mesh_view:      Option<MeshView>, // tessellation cache
    pub adjacent_splits: usize,          // ADR-067 Step 1 auto-merge 결과
    pub split_debug:    Vec<String>,
}

pub enum SolidKind {
    Box,                  // 모든 boundary linear → 6 Plane surfaces
    Cylinder,             // circular boundary → 1 Cylinder + 2 Plane caps
    SmoothGroupOffset,    // curved profile → group 일관 변형
    GeneralSweep,         // mixed/NURBS → NURBSSurface walls
}
```

### 2.3 8 surface variants × extrusion behavior matrix

| Profile surface | Boundary 종류 | 결과 solid | Side walls | 비고 |
|-----------------|--------------|-----------|-----------|------|
| Plane | All Line | **Box** (existing `Mesh::create_box` 활용) | 4+ Planes | W-1 scope |
| Plane | All Circle/Arc | **Cylinder** (existing `create_cylinder` 활용) | 1 Cylinder + 2 Plane caps | W-1 scope |
| Plane | Mixed (Line + Curve) | **General Sweep** | NURBSSurface (extruded ribbons) | W-3 scope |
| Cylinder (panel) | (smooth group context) | **Smooth Group Offset** | adjacent panels coordinated | W-2 scope |
| Sphere (panel) | (smooth group) | **Smooth Group Offset** | sphere offset ≠ trivial — local approximation | W-2 scope |
| Cone (panel) | (smooth group) | **Smooth Group Offset** | linear interpolation along axis | W-2 scope |
| Torus (panel) | (smooth group) | **Smooth Group Offset** | minor radius offset | W-2 scope |
| BezierPatch / BSplineSurface / NURBSSurface | (general) | **General Sweep** | NURBSSurface walls (Phase L 의 fitting) | W-3 scope |

### 2.4 Shape ownership integration (Gap 2 자연 해소)

`Scene::exec_solid_extrude` (Scene wrapper):
```rust
fn exec_solid_extrude(&mut self, face_id: FaceId, dist: f64) -> CommandResult {
    self.transactions.begin();
    self.transactions.set_before_snapshot(self.scene_snapshot());
    
    match self.mesh.solid_extrude(face_id, dist, FORM_MATERIAL) {
        Ok(result) => {
            // ADR-050 P-5e dual ownership lookup
            let owning_xia_id = self.face_to_xia.get(&face_id).copied();
            let owning_shape_id = self.face_to_shape.get(&face_id).copied();
            
            if let Some(xia_id) = owning_xia_id {
                // Xia path (legacy + ADR-050 P-2 promote 후)
                self.update_xia_face_ids_from_extrude(xia_id, &result);
            } else if let Some(shape_id) = owning_shape_id {
                // Shape path (Phase 1 default ON)
                self.update_shape_face_ids_from_extrude(shape_id, &result);
            }
            
            self.transactions.set_after_snapshot(self.scene_snapshot());
            self.transactions.commit();
            CommandResult::SolidCreated { /* ... */ }
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

---

## 3. Sub-Decisions (사용자 결재 항목)

### Q1. Smart Routing (Option C) confirmed?
- (a) Option A: solid_extrude 단일 함수 (smart routing 없음, profile 무조건 sweep)
- (b) Option B: DrawBox / DrawCylinder / etc. 별도 함수만, push/pull 폐기
- **(c) Option C: smart routing — profile surface kind 별 분기** ← 권장
- **Decision**: Q1 Open — 사용자 review 필요

### Q2. ADR-067 Step 2~5 와의 관계
- (a) 흡수 — 본 ADR 이 Step 2~5 의 spec 을 통합 supersede
- (b) 별개 — ADR-067 은 UX layer, ADR-079 는 kernel layer
- **Decision**: Q2 Open — (a) 권장 (단일 트랙)

### Q3. Legacy mesh-era push_pull deprecation timing
- (a) W-1 직후 deprecate (강한 cutover) — backward compat 0
- (b) W-4 deprecate (점진 — Plane → Cylinder → General 단계 별 fallback)
- (c) 영구 보존 (legacy fallback) — 새 solid_extrude 가 default, push_pull 은 internal fallback
- **Decision**: Q3 Open — (b) 또는 (c) 권장

### Q4. P-5e-α default flip 의 영향
- 사용자 review 결과: P-5e-α 는 **유지** 권장. Shape creation 자체는 정상,
  push/pull 만 별도 트랙 — solid_extrude 가 W-1 까지 작동 안 하면 사용자
  Push/Pull 시도 시 어떻게 처리?
  - (a) Push/Pull tool 일시 비활성화 (W-1 까지)
  - (b) Push/Pull 시 Shape 자동 promote → legacy push_pull 사용 (관대)
  - (c) "지원 예정" Toast + no-op (사용자 명시 차단)
- **Decision**: Q4 Open — (c) 권장 (명시 차단)

### Q5. 곡면 profile (Cylinder side panel) push 의 정확한 semantics
- (a) Panel 만 평행 이동 (현 mesh-era 거동) — 절단 발생
- **(b) Smooth group 전체 offset** — Cylinder 가 통째로 외부로 부풀어 오름
- (c) 사용자 명시 — UX 모달에서 "panel 만 / 그룹 전체" 선택
- **Decision**: Q5 Open — (b) SketchUp 표준 거동 권장

### Q6. Sweep solid 의 surface representation
- (a) BezierPatch (3차) — 직선 sweep 경로면 충분, 곡선 sweep 경로엔 부족
- (b) BSplineSurface (가변 차수) — 일반적
- **(c) NURBSSurface (rational)** — 정확한 cylinder/sphere boundary sweep 가능
- **Decision**: Q6 Open — (c) 권장

### Q7. Shape ownership face_to_shape map 도입 시점
- (a) ADR-079 W-1 와 함께 (자연 통합)
- (b) Phase 1 Gap 2 fix 로 별도 atomic (ADR-079 의 prerequisite)
- **Decision**: Q7 Open — (a) 권장 (W-1 의 일부로)

---

## 4. 4-Step Rollout (Path Z atomic)

| Step | Scope | 영역 | 영향 | 회귀 (예상) | 의존 |
|------|-------|------|------|------------|------|
| **W-α** (본 commit) | ADR-079 spec only | docs | 0 | 0 | — |
| **W-1** | solid_extrude_planar_box (Plane all-Line boundary → Box) + face_to_shape map + Scene::exec_solid_extrude + 8 회귀 | axia-geo + axia-core + WASM | Plane Rect/Polygon profile push 정상화 | +20~25 | W-α |
| **W-2** | solid_extrude_planar_cylinder (Plane circular boundary → Cylinder) + smooth group offset (Cylinder/Sphere/Cone/Torus panel) | axia-geo Phase H/I/J 활용 | 곡면 profile 전체 변형 | +30~40 | W-1, Phase N Step 3 |
| **W-3** | solid_extrude_general_sweep (Bezier/BSpline/NURBS profile → NURBSSurface walls) + Phase L sweep generalization | axia-geo Phase L 활용 | 임의 NURBS profile | +25~35 | W-2, Phase L 완료 |
| **W-4** | Legacy push_pull deprecation + UX migration (PushPullTool routing) + ADR-067 Step 1 보존 | TS Tools + WASM bridge | UX 통합 | +10~15 | W-3 |

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

solid_extrude 결과 = form-layer Shape (재질 없음). 사용자 재질 부여 시
ADR-050 P-2 promote 4-condition 통과 → Xia 승격. v3.2 §7 의 Linear /
Volumetric / Surface XIA 분류 자연 매핑.

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
- [ ] **사용자 review Q1~Q7 lock-in** (별도 commit 또는 본 ADR amendment)
- [ ] **W-1 사전 검토 + 구현** (별도 commit, Q1~Q7 lock-in 후)

---

## 9. References

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

---

*Author*: AXiA team (사용자 결정 + Claude spec) | *Status*: Proposed
(spec only, W-1~W-4 별도 commit). Q1~Q7 사용자 review 후 §3 amend.
