# ADR-059 — Phase N: Curve & Surface Mandatory (Path D 진입점)

**Status**: Accepted (Phase N spec — 사용자 review 4-step + 5 lock-in 사전 적용)
**Date**: 2026-05-04
**Anchor**: ADR-052 master roadmap (Phase N, 4주, 위험: **고**)
**Parent**: ADR-052 §2.3 Phase N
**Prerequisites**: Phase H/I/J/K/L/M 모두 완료 (각각 ADR-053~058)
**Related**: ADR-019 (Line is Truth — Path D 의 사상적 anchor),
ADR-027 (NURBS Kernel Initiative), ADR-060 (Phase O Tools NURBS-aware),
ADR-061 (Phase P Tessellation Cache)

---

## 0. Summary (4 lines)

> `Edge.curve: Option<AnalyticCurve>` → `Edge.curve: AnalyticCurve` (mandatory).
> `Face.surface: Option<AnalyticSurface>` → mandatory. 4-step incremental
> (Shadow / Dual / Mandatory / Migration) — big-bang 변경 금지. 메모리
> ≤ 100 bytes per enum (Box NURBS variants). Path D (Smart Half-Edge) 영구 전환.

---

## 1. Context

### 1.1 9-Phase 로드맵의 분기점

```
Phase A~L:  Optional NURBS attachment 가능 (Edge/Face 가 curve/surface 보유 가능)
Phase N:   Mandatory NURBS attachment (모든 edge/face 가 curve/surface 보유 강제)
Phase O+:  도구가 mandatory state 활용 (NURBS-aware operations)
```

이 단계 후 AxiA 는 **Path D (Smart Half-Edge)** 모델로 영구 전환.

### 1.2 현재 상태

```rust
// crates/axia-geo/src/entities/edge.rs (line 56)
pub struct Edge {
    v_small, v_large, tolerance, any_he, active, flags, class,
    #[serde(default)]
    curve: Option<AnalyticCurve>,   // ← Phase N 가 격상 대상
}

// crates/axia-geo/src/entities/face.rs (line 40)
pub struct Face {
    outer, inners, tolerance, normal, parent, material, double_sided,
    active, visible, flags,
    #[serde(default)]
    surface: Option<AnalyticSurface>,   // ← Phase N 가 격상 대상
}
```

대부분의 edge/face 가 현재 `None`. Phase N 후 모두 mandatory.

### 1.3 Phase N 의 5 위험 (사용자 review 2026-05-04)

1. **Construction call sites 폭발** — ~120개 add_edge / add_face 호출 site
2. **split_edge parent curve 분할** — Line/Circle/Bezier/NURBS 별 정책
3. **merge_faces_by_edge surface 통합** — Plane+Plane / Cylinder+Cylinder / 거부
4. **메모리 폭발** — Box 처리 없으면 +2.5MB / 10K faces
5. **Phase N→O gap stale state** — Migration sanity check 강제

---

## 2. Decision

### 2.1 §A — 4-Step Incremental 강제 (Big-bang 금지)

| Step | 영역 | 기간 | LOC | 회귀 |
|---|---|---|---|---|
| 1 | Shadow field + Box variants + Synthesizer | 1주 | ~400 | 4 |
| 2 | Dual-path (Phase L hotspots use mandatory) | 1주 | ~200 | 6 |
| 3 | Option 제거 + Mandatory 강제 | 1주 | ~300 | 4 |
| 4 | v3→v4 Migration + Drift sanity | 1주 | ~250 | 6 |
| **합계** | — | **4주** | ~1150 | **20** |

### 2.2 §B — Synthesizer Default (Line / Plane fallback)

```rust
// crates/axia-geo/src/entities/edge.rs
impl Edge {
    /// Synthesizer 기본값 — Line from vertex pair.
    /// 모든 add_edge 의 default — 명시적 curve 없이 호출 시 자동.
    pub fn synthesize_line_curve(v_small: VertId, v_large: VertId) -> AnalyticCurve {
        AnalyticCurve::Line { start: v_small, end: v_large }
    }
}

// crates/axia-geo/src/entities/face.rs
impl Face {
    /// Synthesizer 기본값 — best-fit Plane from outer loop.
    /// Newell normal + centroid origin + orthogonal basis_u.
    pub fn synthesize_plane_surface(outer_verts: &[DVec3]) -> AnalyticSurface {
        let normal = newell_normal(outer_verts).normalize_or_zero();
        let origin = outer_verts.iter().sum::<DVec3>() / outer_verts.len() as f64;
        let basis_u = compute_orthogonal_basis(normal);
        AnalyticSurface::Plane {
            origin, normal, basis_u,
            u_range: (-1e6, 1e6),
            v_range: (-1e6, 1e6),
        }
    }
}
```

### 2.3 §C — 무거운 variant Box (≤ 100 bytes enum)

```rust
pub enum AnalyticSurface {
    // Inline (small primitives, ≤ 96 bytes each)
    Plane(Plane),
    Cylinder(Cylinder),
    Sphere(Sphere),
    Cone(Cone),
    Torus(Torus),
    // Boxed (8-byte pointer + heap allocation)
    BezierPatch(Box<BezierPatch>),
    BSplineSurface(Box<BSplineSurface>),
    NURBSSurface(Box<NURBSSurface>),
}
```

회귀: `analytic_surface_size_within_budget` (compile-time `mem::size_of` 체크).

### 2.4 §D — Phase N / O / P 명확한 경계

| 기능 | Phase | 본 ADR scope |
|---|---|---|
| `Edge.curve` mandatory data layer | **N** | ✅ |
| `Face.surface` mandatory data layer | **N** | ✅ |
| `synthesize_line_curve` / `_plane_surface` | **N** | ✅ |
| `split_at` curve inheritance | **N** | ✅ |
| Surface merge policy | **N** | ✅ |
| v3→v4 serialization migration | **N** | ✅ |
| `translate_verts` → `curve.transform()` | **O** | ❌ (out of scope) |
| Push/Pull NURBS-aware | **O** | ❌ |
| Boolean default = NURBS path | **O** | ❌ |
| Tessellation lazy / cache | **P** | ❌ |
| WASM bridge surface change | **O** | ❌ |

**lock-in**: Phase N 은 **데이터 layer 만**. Tools / Lazy / WASM 은 후속 phase.

### 2.5 §E — Migration Drift Sanity (drift > LOCKED #5 → Line 강등)

```rust
pub struct MigrationReport {
    pub edges_promoted_with_curve:    usize,
    pub edges_synthesized_as_line:    usize,
    pub edges_demoted_due_to_drift:   usize,  // ← Phase O 까지 안전
    pub faces_promoted_with_surface:  usize,
    pub faces_synthesized_as_plane:   usize,
    pub faces_demoted_due_to_drift:   usize,
}

impl Mesh {
    /// v3 → v4 마이그레이션 + drift sanity.
    /// 로드된 curve.evaluate(0) 가 v_small 에서 1.5μm (LOCKED #5) 이상
    /// 떨어져 있으면 Line 으로 강등 — Phase O 진입 전까지 stale 차단.
    pub fn migrate_v3_to_v4_with_sanity(&mut self) -> MigrationReport;
}
```

### 2.6 §F — §X.5 영구 Lock-in (5 항목)

```
1. 4-Step incremental 강제 (Big-bang 금지)
   각 step = 별도 commit + 회귀 검증 prerequisite

2. Synthesizer 정책 (Line / Plane fallback)
   변경 시 새 amendment + 모든 add_edge/add_face 호출 site 재검증

3. 무거운 variant Box (≤ 100 bytes enum)
   변경 시 메모리 budget 재측정 + 회귀 size_of_check

4. Phase N = 데이터 layer 만 (Tools=O / Lazy=P / WASM=O)
   범위 위반 시 새 ADR

5. Migration drift→Line 강등 (drift > LOCKED #5)
   변경 시 새 amendment + Phase O 진입 안전성 재검증
```

---

## 3. 회귀 테스트 spec (20개)

### Step 1 — Shadow field (4)
1. `edge_curve_mandatory_synthesizes_line_by_default`
2. `face_surface_mandatory_synthesizes_plane_by_default`
3. `analytic_surface_size_within_budget` (≤ 100 bytes via Box)
4. `synthesize_plane_uses_newell_normal_and_centroid`

### Step 2 — Dual-path (6)
5. `split_at_line_produces_two_lines`
6. `split_at_circle_produces_two_arcs`
7. `split_at_bezier_uses_phase_h_de_casteljau`
8. `split_at_bspline_uses_phase_i_knot_insertion`
9. `phase_l_hotspot_uses_curve_mandatory_path`
10. `dual_path_option_and_mandatory_agree_on_test_corpus`

### Step 3 — Mandatory (4)
11. `option_curve_field_removed_compile_time`
12. `merge_faces_same_plane_succeeds`
13. `merge_faces_kind_mismatch_returns_rejection`
14. `merge_faces_normal_mismatch_returns_rejection`

### Step 4 — Migration (6)
15. `migration_v3_file_loads_with_synthesized_lines`
16. `migration_v4_save_load_roundtrip_preserves_curves`
17. `migration_drift_detect_demotes_to_line`
18. `migration_clean_v4_zero_drift_preserves_curves`
19. `migration_report_counts_match_actual`
20. `migration_no_existing_test_breaks` (818 → 818 + 19 = 837 모두 통과)

---

## 4. Acceptance + 위험 완화

### 4.1 Acceptance

- [ ] 4 step 모두 별도 commit + 회귀 검증
- [ ] `mem::size_of::<AnalyticSurface>()` ≤ 100 bytes (Box NURBS)
- [ ] `mem::size_of::<AnalyticCurve>()` ≤ 96 bytes
- [ ] migrate_v3_to_v4_with_sanity 모든 v3 .axia 파일 로드
- [ ] 818 기존 회귀 모두 통과 + 20 신규 = 838
- [ ] Memory delta hot path ≤ 10% (Box NURBS 효과)
- [ ] Performance delta ≤ 5% (synthesize 호출 비용)

### 4.2 위험 + 완화

| 위험 | 완화 |
|---|---|
| Big-bang 변경 → 800+ 회귀 깨짐 | 4-step + 각 step 별 commit + Pre/Post baseline |
| 메모리 폭발 | Box NURBS variants + size_of 회귀 |
| Phase O 미완료 시 stale curve | migrate_v3_to_v4_with_sanity drift→Line 강등 |
| Synthesizer 호출 폭주 (성능) | Phase P 의 lazy cache 까지 hot path 유지 |
| 호출 site ~120개 누락 | Step 1 Shadow field 가 자동 채움 — 명시적 변경 불필요 |

---

## 5. References

- ADR-052 master roadmap §2.3 Phase N (Path D 진입점)
- ADR-019 Line is Truth (사상적 anchor)
- 사용자 review 2026-05-04 (4-step + 5 lock-in)
- ADR-053~058 (Phase H/I/J/K/L/M 모두 prerequisite)
- ADR-060 Phase O (후속 Tools NURBS-aware)
- ADR-061 Phase P (후속 Tessellation Cache)

---

*Author*: AXiA team (사용자 review 2026-05-04 + Claude spec)
*Status*: Phase N spec accepted — Step 1 부터 incremental 구현

---

## Amendment 1 — Step 1.5 / Step 2 진입 lock-in (2026-05-04)

**컨텍스트**: Step 1 완료 (commits ca069ac, f2ffc28) 후 사용자 사전 검토 결과,
§C target (100/96 bytes) 가 비현실적임이 측정으로 확인됨. 다음 5개 추가
lock-in 적용.

### A1.1 §C 수정 — Size budget 현실화

**원본 §C**:
- AnalyticSurface ≤ 100 bytes
- AnalyticCurve ≤ 96 bytes

**수정 §C**:
- AnalyticSurface ≤ **132 bytes** (Plane variant 자연 한계: 3 DVec3 + 2 (f64,f64) + tag + padding)
- AnalyticCurve ≤ **112 bytes**

**근거**: Plane primitive 단독으로 104 bytes (104 bytes data + 16 alignment padding + 8 tag). Plane 을 box 하면 hot path heap deref → 성능 저하. 자연 한계 수용.

### A1.2 Box 대상 명시 (사용자 review §1)

```
✅ Box 대상 (rare access, large data):
   AnalyticSurface::BezierPatch(Box<BezierPatchData>)
   AnalyticSurface::BSplineSurface(Box<BSplineSurfaceData>)
   AnalyticSurface::NURBSSurface(Box<NURBSSurfaceData>)
   AnalyticCurve::Bezier (변경 없음 — 이미 작음)
   AnalyticCurve::BSpline (변경 없음)
   AnalyticCurve::NURBS (변경 없음 — Vec 들이 이미 indirect)

❌ Inline 유지 (frequent access):
   Plane / Cylinder / Sphere / Cone / Torus / Line / Circle / Arc
```

기대 효과:
- 10K faces × 128 bytes (현재) = 1.28 MB
- 10K faces × 132 bytes (post-boxing) = 1.32 MB
- 메모리 변화 ~0% (실제 NURBS 사용 시에만 heap allocation)

### A1.3 split_edge parameter inversion 정책 (사용자 review §3)

```rust
pub enum SplitParameterError {
    NewtonDiverged { iterations: usize },
    MultipleRoots { count: usize },
    PointOffCurve { distance: f64 },
}

impl AnalyticCurve {
    pub fn parameter_at_3d_point(&self, p: DVec3, mesh: &Mesh)
        -> Result<f64, SplitParameterError>;
}
```

Step 2 MVP scope:
- Line / Arc → closed-form (정확)
- Bezier / BSpline / NURBS → 명시적 Err (Step 2 follow-up)

### A1.4 Surface merge silent reject 금지 (사용자 review §6)

```rust
pub enum SurfaceMergeOutcome {
    Merged(AnalyticSurface),
    Rejected(SurfaceMergeRejection),
}

pub enum SurfaceMergeRejection {
    KindMismatch { left: &'static str, right: &'static str },
    OriginDriftExceedsTol { drift: f64, tol: f64 },
    NormalAngleExceedsTol { angle_deg: f64, tol_deg: f64 },
    BSplineKnotsIncompatible,
}
```

Phase J §7.5 패턴 — silent merge 절대 금지.

### A1.5 Migration = post-deserialize pass (옵션 A, 사용자 review §7)

```rust
impl Mesh {
    pub fn migrate_v3_to_v4_with_sanity(&mut self) -> MigrationReport {
        // Post-deserialize pass:
        //   1. Optional curve = None → synthesize Line
        //   2. Optional curve = Some → drift sanity check
        //   3. Drift > LOCKED #5 → 강등 to Line + report
    }
}
```

Serde from/into wrapper 옵션 B / custom Deserialize 옵션 C 거부 (복잡도 ↑).

### A1.6 Phase L hotspot 통합 = drop-in alongside

Phase M 의 검증된 패턴 그대로:
- production code path UNCHANGED
- `debug_assert!` 또는 별도 통합 test 만 추가
- Phase O 진입 시 production path 변경

→ 기존 회귀 0건 보호.

### A1.7 영구 lock-in 5개 추가 (§X.5)

```
6. Box 대상 = NURBS/BSpline/Bezier patches only (Plane primitives inline)
7. split_edge parameter inversion = Line/Arc closed-form, others Err
8. Surface merge silent reject 금지 (4 reason enum)
9. Migration = post-deserialize pass (옵션 A)
10. Phase L hotspot 통합 = drop-in alongside (Phase M 패턴)
```

각 항목 변경 시 새 amendment + 사용자 동의 + 회귀 검증.

### A1.8 변경 이력

- **2026-05-04 (본 amendment)**: Step 1+2prep 완료 후 사용자 사전 검토 반영.
  Size budget 현실화 (100→132) + 5 추가 lock-in.

*Amendment Author*: AXiA team (사용자 review 2026-05-04 + Claude lock-in)
