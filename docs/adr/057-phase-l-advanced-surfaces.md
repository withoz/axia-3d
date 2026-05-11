# ADR-057 — Phase L: Advanced Surface Operations

**Status**: Accepted (Phase L spec — 사용자 review 사전 lock-in 반영)
**Date**: 2026-05-04
**Anchor**: ADR-052 master roadmap (Phase L, 4주, 위험: 중)
**Parent**: ADR-052 §2.3 Phase L
**Prerequisites**: ADR-053 (H Transform), ADR-054 (I Knot), ADR-055 (J Boolean),
ADR-056 (K Fitting)
**Related**: ADR-024 (Mesh chamfer P10), ADR-058 (M Robust Predicates 병행),
ADR-059 (N Curve & Surface Mandatory — Phase L 의 prerequisite)

---

## 0. Summary (4 lines)

> 산업 CAD 의 BRep-level 도구 — Variable-radius Fillet / Profile Chamfer /
> Hollow-Shell / Draft / Robust Offset Surface. Phase J/K 가 검증한
> **MVP 분할 + Detect-only + 명시적 Defer + Cross-Phase Integration +
> Lock-in 보호** 5가지 패턴을 6 step + 3 deferred 로 응용.

---

## 1. Context

### 1.1 산업 CAD 비교

| 도구 | OCCT / CATIA | AxiA 현재 | Phase L 목표 |
|---|---|---|---|
| Constant fillet | ✅ 일상 | ❌ (mesh chamfer만) | ✅ |
| Variable fillet | ✅ | ❌ | ✅ Step 3 |
| Profile chamfer | ✅ | ❌ | ✅ Step 3 |
| Shell / Hollow | ✅ | ❌ | ✅ Step 4 |
| Draft (사출) | ✅ | ❌ | ✅ Step 5 |
| Offset surface | ✅ | MVP | ✅ Step 6 production |
| 3-way corner fillet | ⚠ 부분 | ❌ | **deferred** (별도 ADR) |
| Concave fillet | ✅ | ❌ | **deferred** (Phase L follow-up) |

### 1.2 Mesh fillet (ADR-024) ↔ BRep fillet (Phase L) 충돌 회피

ADR-024 P10 의 mesh chamfer 가 이미 존재. Phase L 는 BRep 수준 — 두 layer 의
dispatch 정책을 명시 lock-in.

### 1.3 Phase N 의 prerequisite

```
Phase L 미완료 → Phase N 진입 시:
  도구 (fillet 등) 가 Mesh fallback 호출 → AnalyticCurve 없음 → panic

Phase L 완료 trigger → Phase N 안전 진입 가능
```

---

## 2. Decision

### 2.1 6-Step 분할 + 3 Deferred 명시 (사용자 review §A lock-in)

| Step | 영역 | 기간 | LOC | 회귀 | 위험 |
|---|---|---|---|---|---|
| 1 | Constant fillet — Convex + Linear edge (Cylinder 직접) | 4d | ~250 | 4 | 낮음 |
| 2 | Constant fillet — Convex + Curved edge (Phase K sweep) | 5d | ~350 | 5 | 중 |
| 3 | Profile chamfer (사용자 정의 cross-section) | 3d | ~250 | 4 | 낮음 |
| 4 | Hollow / Shell (offset + face removal + Subtract) | 5d | ~400 | 5 | **고** |
| 5 | Draft (face tilt about neutral plane) | 3d | ~200 | 4 | 중 |
| 6 | Robust offset surface (current MVP → production) | 4d | ~300 | 5 | 중 |
| **합계** | — | **24d ≈ 4주** | ~1750 | **27** | — |

**3 Deferred (각각 별도 ADR / spec amendment)**:
1. **Concave fillet** — void 생성 + 토폴로지 변화 → Phase L follow-up
2. **3-way corner fillet** — 산업 CAD 도 부분적, ADR-024 패턴으로 명시 defer
3. **Tangent-touch neighbors** — Robust predicates (Phase M) 의존

### 2.2 신규 모듈 구조

```
crates/axia-geo/src/operations/
  ├─ fillet_brep.rs          ← Steps 1, 2 (constant + curved)
  ├─ chamfer_brep.rs         ← Step 3 (profile chamfer)
  ├─ shell.rs                ← Step 4 (hollow / shell)
  ├─ draft.rs                ← Step 5 (face tilt)
  └─ offset_surface_robust.rs ← Step 6 (offset hardening)
```

### 2.3 Mesh ↔ BRep Fillet Dispatch (사용자 review §B lock-in)

```rust
/// Phase L Fillet 운영 규칙 (ADR-057 §2.3 lock-in)
///
/// Edge.curve == Some(...) AND adjacent faces have surface
///   → Phase L BRep fillet (Cylinder/Torus surface attach)
/// Edge.curve == None OR mesh-only neighbors
///   → ADR-024 mesh chamfer (existing chamfer_vertex_3way)
///
/// Phase N (Curve Mandatory) 후엔 mesh fallback 불필요 — 모든 edge 가
/// AnalyticCurve 보유 → BRep 경로만 활성.
pub fn dispatch_fillet_or_chamfer(
    mesh: &Mesh, edge: EdgeId, radius: f64,
) -> FilletDispatch;

pub enum FilletDispatch {
    BRep,    // Phase L path
    Mesh,    // ADR-024 fallback (Phase N 까지)
}
```

### 2.4 Detect-only Reporting (사용자 review §C lock-in)

Phase J Step 4 SsiRobustnessReport 패턴 그대로 응용:

```rust
pub struct FilletResult {
    pub created_surface: Option<AnalyticSurface>,
    pub trim_loops: Vec<TrimLoop>,            // Phase J 재사용
    pub skipped: Vec<FilletSkipReason>,
}

pub enum FilletSkipReason {
    ConcaveEdge { edge: EdgeId },             // Step 1-3 deferred
    ThreeWayCorner { vertex: VertId },        // ADR-024 P10 deferred
    TangentNeighbors { tol: f64 },            // Phase M deferred
    RadiusTooSmall { radius: f64, min: f64 }, // < LOCKED #5
    RadiusTooLarge { radius: f64, max: f64 }, // > local curvature × ratio
}
```

**lock-in**: silent wrong result 절대 금지. 모든 skip은 명시 진단.

### 2.5 FilletTolerance (사용자 review §D lock-in)

```rust
/// Phase L Fillet tolerance — LOCKED #5 정합 강제.
pub struct FilletTolerance {
    pub geometric: f64,         // 1e-3 mm = 1 micron (BooleanTolerance default)
    pub min_radius: f64,        // 1.5e-3 mm = LOCKED #5 spatial-hash
    pub max_radius_ratio: f64,  // 1.5 = local curvature radius × 이상 거부
}

impl Default for FilletTolerance {
    fn default() -> Self {
        Self {
            geometric: 1e-3,
            min_radius: 1.5e-3,    // LOCKED #5 absolute floor
            max_radius_ratio: 1.5,
        }
    }
}
```

### 2.6 Phase J / K 자산 재사용 의무 (사용자 review §B lock-in)

| Phase L 영역 | 의무 재사용 |
|---|---|
| Fillet trim region | Phase J `trim_loop_boolean` |
| Fillet swept surface | Phase K `sweep_surface_1_rail` (Bishop frame) |
| Offset self-intersection | Phase J `detect_ssi_pathologies` |
| Shell offset 결과 정리 | Phase J `nurbs_boolean_v2` (Subtract) |
| 모든 변환 | Phase H `transform()` |
| Tolerance 정책 | Phase J `BooleanTolerance` struct |

**lock-in**: Phase L 모듈은 새 helpers 만들지 말고 위 함수들 호출. code review 회귀.

### 2.7 회귀 테스트 (27개 = 6 steps × 4-5 + 3 cross-phase)

#### Step 1 — Constant fillet, Convex, Linear edge (4)
1. `fillet_linear_edge_creates_cylinder_surface`
2. `fillet_radius_below_min_returns_skip`
3. `fillet_concave_edge_returns_skip_reason`
4. `fillet_dispatch_chooses_brep_when_curve_present`

#### Step 2 — Constant fillet, Curved edge (5)
5. `fillet_curved_edge_uses_phase_k_sweep`
6. `fillet_curved_preserves_endpoint_continuity`
7. `fillet_3_way_corner_returns_deferred_skip`
8. `fillet_radius_exceeds_local_curvature_returns_skip`
9. `fillet_curved_round_trip_normal_continuity`

#### Step 3 — Profile chamfer (4)
10. `chamfer_45deg_profile_creates_planar_surface`
11. `chamfer_user_profile_orients_along_edge`
12. `chamfer_rejects_self_intersecting_profile`
13. `chamfer_dispatch_chooses_brep_when_curves_present`

#### Step 4 — Shell (5)
14. `shell_box_creates_thin_walled_solid`
15. `shell_thickness_exceeds_curvature_returns_skip`
16. `shell_face_removal_creates_open_boundary`
17. `shell_uses_phase_j_subtract_for_inner_void`
18. `shell_self_intersection_pre_pass_detect`

#### Step 5 — Draft (4)
19. `draft_face_tilts_by_angle_about_neutral_plane`
20. `draft_compound_faces_each_tilted_independently`
21. `draft_zero_angle_is_no_op`
22. `draft_excessive_angle_creates_self_intersection_skip`

#### Step 6 — Robust offset (5)
23. `offset_planar_surface_translates_distance`
24. `offset_cylinder_surface_changes_radius`
25. `offset_self_intersection_detected_via_phase_j`
26. `offset_zero_distance_is_identity`
27. `offset_negative_distance_inverts_normal`

#### Cross-phase integration (별도 +3)
- `fillet_then_boolean_subtract_via_phase_j`
- `shell_then_transform_via_phase_h`
- `chamfer_then_loft_via_phase_k`

---

## 3. Out of Scope (Defer 명시)

### 3.1 Concave Fillet (Phase L follow-up)
- Void 생성 + 토폴로지 변화 → 별도 ADR
- Step 1-3 의 모든 회귀에서 explicit `FilletSkipReason::ConcaveEdge` 반환

### 3.2 3-way Corner Fillet (별도 ADR — Phase L+ 후속)
- ADR-024 P10 chamfer MVP 의 자연 확장
- Step 1-3 회귀에서 `FilletSkipReason::ThreeWayCorner`

### 3.3 Tangent-touch Neighbors (Phase M Robust Predicates 의존)
- Phase M 의 Shewchuk 정확한 predicates 후 검토
- Step 1-6 회귀에서 `FilletSkipReason::TangentNeighbors`

### 3.4 Network/Coons Surface (Phase K Step 5 deferred)
- Phase L Step 7 (선택) 또는 별도 phase 로 진행
- 본 ADR 의 27 회귀에 미포함

---

## 4. 위험 + 완화

| 위험 | 완화 |
|---|---|
| Variable fillet 복잡도 (산업 CAD 도 어려움) | Step 1→2→3 분할 + Step 4 변동 deferred |
| 3-way corner singularity | Step 2 #7 `_returns_deferred_skip` 회귀 강제 |
| Concave fillet void | Step 1 #3 explicit skip + future ADR |
| Self-intersection in shell | Step 4 #18 Phase J pre-pass detect 강제 |
| Mesh ↔ BRep fillet dispatch | §2.3 lock-in + Step 1 #4 회귀 |
| Draft compound face propagation | Step 5 #20 회귀 |
| Offset surface 자기교차 | Step 6 #25 Phase J integration |

---

## 5. References

- ADR-052 master roadmap §2.3 Phase L
- ADR-024 P10 mesh chamfer (dispatch counterpart)
- ADR-053 / 054 / 055 / 056 (prerequisites)
- 사용자 review 2026-05-04 (Phase L 진입점 검토)
- Piegl & Tiller §11 (offset surfaces)
- Hoschek & Lasser §13 (rolling-ball fillet)

---

## 6. Phase L 후속 trigger (Phase N 진입)

```
Phase L 6 step 모두 완료 + 회귀 27개 + cross-phase 3개 = 30개 통과
+ Concave / 3-way / Tangent 명시 deferred
→ Phase M (Robust Predicates) 또는 Phase N (Curve Mandatory) 진입 가능
```

---

*Author*: AXiA team (사용자 review + Claude spec)
*Status*: Phase L spec accepted — Step 1 부터 incremental 구현
