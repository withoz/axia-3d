# ADR-052 — NURBS Kernel Completion + Path D Integration Roadmap

**Status**: Accepted (Master roadmap — Phase 별 child ADR 가 구현 spec)
**Date**: 2026-05-04
**Author**: AXiA team (사용자 결정 + Claude spec)
**Anchor**: ADR-027 (NURBS Kernel Initiative), ADR-019 (Line is Truth),
ADR-049 (Two-Layer Citizenship), 메타-원칙 #13 (One Source, Two Views)
**Related**: ADR-028~036 (kernel Phase A~G), ADR-050/051 (Phase 1)
**Supersedes**: 없음 (additive — 기존 모든 ADR 보존, kernel completion 의 상위 계획)

---

## 0. Summary (4 lines)

> 현재 ADR-027~036 의 NURBS kernel 은 **수학적 완성도 100%** 지만 **도구 통합
> 30%**. 본 ADR 은 9-Phase (H~Q, ~9-12개월) 로드맵으로 kernel completeness
> 채우기 + Path D (Smart Half-Edge: Curve/Surface Mandatory) 통합 마무리.
> 결과: Mesh 의 가벼움 + NURBS 의 정밀도 동시 보유 — 산업 CAD 대치 가능.

---

## 1. Context

### 1.1 사용자 통찰 (2026-05-04)

```
> "두 가지 모두를 해결하는 자체 엔진 개발 방법은?"
> → "ADR-027~036 NURBS Kernel 자체 구현을 더욱 완벽하게 발전시켜봅시다"

핵심 사실:
  - "Line 은 차수 1 의 NURBS" — 수학적으로 모든 curve 는 동일 객체
  - 현재 Edge.curve: Option<AnalyticCurve> 의 Option 이 충돌의 원천
  - Option 제거 → 모든 edge/face 가 parametric 보유 → 11개 충돌 중 9개 해소
```

### 1.2 현 엔진의 11개 식별된 충돌 (Hybrid 모델 한계)

| # | 충돌 | 심각도 | Path D 통합 후 |
|---|---|---|---|
| 1 | Two Sources of Truth at promotion boundary | 본질적 | ✅ 해소 |
| 2 | Tolerance layer 충돌 (1.5μm vs 1e-3 mm) | 본질적 | ✅ 해소 |
| 3 | Trim loops vs DCEL outer loop sync | 본질적 | ⚠ 부분 해소 |
| 4 | Tessellation normal vs analytic normal | ADR-038 해결 | ✅ |
| 5 | Hover polyline gap | ADR-040 해결 | ✅ |
| 6 | Pick owner-ID drift | ADR-037/039 해결 | ✅ |
| 7 | STEP/IGES 6 failure cases | 진행 중 | Phase Q |
| 8 | NURBS Boolean MVP 한계 | 진행 중 | Phase J |
| 9 | NURBS-aware 도구 부재 | ❌ 미해결 | Phase O |
| 10 | intersect_faces_inner 244/249 (ADR-051) | ❌ deferred | Phase N |
| 11 | Reference 시민권 미분리 | ❌ ADR-053 deferred | 별개 작업 |

### 1.3 기존 NURBS Kernel 자산 (ADR-027~036)

```
Phase A (ADR-028)  Line/Circle/Arc + CurveOps trait     ✅ 100%
Phase B (ADR-029)  Bezier/B-spline (de Casteljau/Boor)  ✅ 100%
Phase C (ADR-030)  NURBS curves + CCI                   ✅ 100%
Phase D (ADR-031)  Surface primitives (Plane~Torus)     ✅ 100%
Phase D' (ADR-032) Auto-attach DrawArc/Bezier           ✅ 100%
Phase E (ADR-033)  Bezier patch / B-spline / NURBS srf  ✅ 100%
Phase F (ADR-034)  Surface-Surface Intersection (4 stg) ✅ MVP
Phase G1-3         NURBS Boolean                         ✅ MVP
Phase G4 (035/036) STEP/IGES (OCCT.js)                   🔄 진행 중
```

### 1.4 본 ADR 의 자리

ADR-027 의 사상적 후속. 새 phase 들 (H~Q) 의 상위 계획. 각 Phase 는 별도
child ADR (ADR-053~062) 로 구현 spec 작성.

---

## 2. Decision — 9-Phase Roadmap

### 2.1 Phase 개요

| Phase | ADR | 영역 | 기간 | 위험 |
|---|---|---|---|---|
| **H** | 053 | Curve/Surface Transform & Continuity | 3주 | 낮음 |
| **I** | 054 | Knot Insertion & Curve Refinement | 2주 | 낮음 |
| **J** | 055 | Robust NURBS Boolean | 4주 | 중 |
| **K** | 056 | Curve/Surface Fitting & Construction | 3주 | 낮음 |
| **L** | 057 | Advanced Surface Operations | 4주 | 중 |
| **M** | 058 | Robust Geometric Predicates | 3주 | 낮음 |
| **N** ⭐ | 059 | Curve & Surface Mandatory (Path D 1+2) | 4주 | **고** |
| **O** ⭐ | 060 | Tools NURBS-aware (Path D 3) | 8주 | **매우 고** |
| **P** | 061 | Tessellation as Cache (Path D 4) | 3주 | 낮음 |
| **Q** | 062 | STEP/IGES Production-Grade | 4주 | 중 |
| **합계** | — | — | **38주 (9개월)** | — |

### 2.2 Dependency Graph

```
H (transform)         3w  ─┐
I (knot)              2w  ─┤
                            ├─→  J (Boolean)            4w  ─┐
M (predicates)        3w  ─┘                                  │
                                                              │
                            K (fitting)            3w  ─┐    │
                            L (advanced surfaces)  4w  ─┤    │
                                                        ├─→ N (mandatory)  4w
                                                        │                   │
                                                        │                   ├─→ O (tools)  8w
                                                        │                   │              │
                                                        │                   │              ├─→ P (cache)  3w
                                                        │                   │              │
                                                        │                   │              └─→ Q (STEP)   4w
                                                        └───────────────────┘
```

**Critical path**: H → I → J → N → O → P + Q (sequential = 12개월)
**Parallel path**: H/I/M 동시 → J + K/L 동시 → N → O → P/Q 동시 (= 9개월)

### 2.3 Phase 별 핵심 정의

#### Phase H — Transform & Continuity (ADR-053)

**목표**: 모든 curve/surface 가 transform 후에도 정확한 표현 유지.

```rust
impl CurveOps for AnalyticCurve {
    fn transform(&self, m: &DMat4) -> AnalyticCurve {
        // Rigid: kind 보존
        // Uniform scale: kind 보존
        // Non-uniform: 자동 promote (Circle → Ellipse via NURBS)
    }

    fn tangent_at(&self, t: f64) -> DVec3;
    fn curvature_at(&self, t: f64) -> f64;
    fn is_g1_to(&self, other: &AnalyticCurve, tol: f64) -> bool;
    fn is_g2_to(&self, other: &AnalyticCurve, tol: f64) -> bool;
}
```

**회귀 추가**: 24개. **Acceptance**: 변환 round-trip 1e-9.

#### Phase I — Knot Insertion (ADR-054)

**목표**: B-spline / NURBS / Surface 의 knot insertion / refinement /
degree elevation. Piegl Algorithm A5.1 / 5.5 / 5.6 / 5.9 정합.

**회귀 추가**: 18개. **의존**: Phase J (Boolean) prerequisite.

#### Phase J — Robust NURBS Boolean (ADR-055)

**목표**: Phase G3 MVP → production-grade.

```rust
pub fn nurbs_boolean(
    op: BooleanOp,
    a: &[NURBSSurface],
    b: &[NURBSSurface],
    tol: BooleanTolerance,
) -> Result<Vec<TrimmedNURBSSurface>>;
```

**포함**: Trim loop arithmetic (Greiner-Hormann 곡선 인지) / Robust SSI →
trim curve / Multi-loop intersection / Tolerance unification.

**회귀 추가**: 30개 (Boolean 11개 의미 재정의). **Acceptance**: NIST
Boolean 코퍼스 50/50.

#### Phase K — Fitting & Construction (ADR-056)

```rust
pub fn loft_surface(curves: &[AnalyticCurve], degree_v: usize)
    -> Result<NURBSSurface>;
pub fn sweep_surface(profile: &Curve, rail: &Curve)
    -> Result<NURBSSurface>;
pub fn network_surface(u_curves: &[Curve], v_curves: &[Curve])
    -> Result<NURBSSurface>;
pub fn fit_nurbs_curve(points: &[DVec3], degree: usize, tol: f64)
    -> Result<NURBSCurve>;
pub fn fit_nurbs_surface_grid(grid: &Array2<DVec3>, du: usize, dv: usize)
    -> Result<NURBSSurface>;
```

**회귀 추가**: 20개.

#### Phase L — Advanced Surface Operations (ADR-057)

- Variable-radius fillet (BRep level)
- Profile chamfer
- Hollow / shell
- Draft (사출 각도)
- Robust offset surface

**회귀 추가**: 15개 (Mesh fillet 5개 의미 재정의).

#### Phase M — Robust Predicates (ADR-058)

```rust
pub fn orient2d_robust(a: DVec2, b: DVec2, c: DVec2) -> Sign;
pub fn orient3d_robust(a: DVec3, b: DVec3, c: DVec3, d: DVec3) -> Sign;
pub fn in_circle_robust(a: DVec2, b: DVec2, c: DVec2, p: DVec2) -> Sign;
pub fn in_sphere_robust(a: DVec3, b: DVec3, c: DVec3, d: DVec3, p: DVec3) -> Sign;
```

**Shewchuk's adaptive precision**. ADR-007 invariants 검증, M1, Boolean
trim loop 분류 등 모두 신뢰성 향상.

**회귀 추가**: 12개.

#### Phase N ⭐ — Curve & Surface Mandatory (ADR-059) — **Path D 진입**

```rust
pub struct Edge {
    v_small: VertId, v_large: VertId,
    curve: AnalyticCurve,           // ← Option 제거
    parameter_range: (f64, f64),
}

pub struct Face {
    outer: LoopRef, inners: Vec<LoopRef>,
    surface: AnalyticSurface,       // ← Option 제거
    trim_loops_uv: Vec<TrimLoop>,
}
```

**4-step incremental** (회귀 0 유지):
- N.1: `Option` 유지 + 모든 add_edge 가 자동 attach
- N.2: `unwrap_or_else(|| auto_synthesize_*)` fallback
- N.3: `Option` 제거 + invariant 강제
- N.4: 직렬화 v3 → v4 마이그레이션 (legacy edge auto-attach)

**회귀 추가**: 12개 (모든 edge/face 생성 경로). **위험: 고**.

#### Phase O ⭐ — Tools NURBS-aware (ADR-060) — **Path D Phase 3**

| 도구 | 변경 |
|---|---|
| translate_verts | curve.transform(translation) 자동 |
| rotate_verts | surface normal 회전 + curve direction 회전 |
| scale_verts | Uniform 보존 / Non-uniform 자동 promote |
| push_pull | Top = Plane offset / Side = ExtrusionSurface (NURBS) |
| boolean | Phase J NURBS Boolean 기본 경로 |
| fillet_edge | Phase L BRep fillet (Cylinder/Torus surface) |
| chamfer_edge | Phase L Profile chamfer |
| offset | Phase L OffsetSurface |

**8주 incremental** (도구 1주씩). **회귀 추가: 50개**. **위험: 매우 고**.

#### Phase P — Tessellation Cache (ADR-061)

```rust
pub struct Mesh {
    // Truth (parametric)
    verts, hes, edges, faces,
    // Volatile cache
    polyline_cache: HashMap<EdgeId, Vec<DVec3>>,
    tessellation_cache: HashMap<FaceId, Tessellation>,
    bvh_cache: Option<Bvh>,
}
```

**회귀 추가**: 8개. **메모리 ~30% 감소 + 변형 후 재렌더 ~5x 향상**.

#### Phase Q — STEP/IGES Production (ADR-062)

| 영역 | 현재 | Phase Q |
|---|---|---|
| AP242 coverage | 30% | 90% |
| AP203/214 fallback | 0% | 70% |
| Round-trip | 1e-3 mm | **1e-6 mm** |
| Assembly hierarchy | ❌ | ✅ |
| PMI / GD&T 기본 | ❌ | ✅ |
| Material metadata | ❌ | ✅ |
| Bundle | 0KB | 5MB lazy chunk |

**Stage 4-B `axia-foreign` 자체 STEP 파서 시작**. **회귀 추가: 35개**.

---

## 3. 메타-원칙 #14 신설 (제안)

```
#14 — Parametric Truth, Topological Witness

  모든 Edge 는 정확한 곡선 표현 (AnalyticCurve) 을 보유하고,
  모든 Face 는 정확한 표면 표현 (AnalyticSurface) 을 보유한다.
  DCEL 토폴로지는 이 표현들 사이의 인접 관계를 증언 (witness) 할 뿐,
  기하 자체의 truth 는 parametric 측에 있다.
  Polyline / tessellation 은 휘발성 render cache 이며 절대 truth 로
  취급되지 않는다.
```

ADR-019 ("Line is Truth, Face is Byproduct") 의 자연 후속.
Phase N (ADR-059) 부터 강제.

---

## 4. 회귀 영향 + Acceptance

| Phase | 새 회귀 | 기존 회귀 의미 재정의 | 누적 회귀 |
|---|---|---|---|
| H | +24 | 0 | 866 |
| I | +18 | 0 | 884 |
| J | +30 | 11 | 914 |
| K | +20 | 0 | 934 |
| L | +15 | 5 | 949 |
| M | +12 | 0 | 961 |
| N | +12 | ~30 (edge/face creation) | 973 |
| O | +50 | ~50 (tool semantics) | 1,023 |
| P | +8 | 0 | 1,031 |
| Q | +35 | 0 | 1,066 |
| **합계** | **+224** | **~96** | **1,066** |

**현재 baseline**: 842 회귀 → **9개월 후**: ~1,066 (+27% 회귀 강화).

---

## 5. 위험 + 완화

| 위험 | Phase | 완화 |
|---|---|---|
| Phase N invariant 강제 시 회귀 폭탄 | N | 4-step incremental (Option → fallback → 제거 → migration) |
| Phase O 도구 한 번에 변경 시 충돌 | O | 8주 도구 1주씩, 각 도구 별 별도 PR + Toast 안내 |
| NURBS Boolean trim loop 정확도 | J | Phase H+I+M 의존 — kernel 완성 후 진입 |
| STEP/IGES bundle 크기 증가 | Q | Lazy chunk + 0KB initial 강제 (P20.C #2) |
| 9개월 timeline 슬립 | All | 각 Phase 가 독립 PR — 개별 완료/이월 가능 |

---

## 6. 결재 포인트 (사용자 확인)

| # | 결정 | 옵션 |
|---|---|---|
| 1 | Cadence | (a) 9개월 parallel / (b) 12개월 sequential |
| 2 | Phase O 도구 순서 | (a) 단순→복잡 / (b) 사용자 노출 큰 것 우선 |
| 3 | Phase Q 우선순위 | (a) Stage 4-A 완성 / (b) Stage 4-B 시작 동시 |
| 4 | 메타-원칙 #14 | 채택 / 미채택 |
| 5 | ADR 번호 예약 | 053-062 (확정) |

---

## 7. 진행 방식 (Step-by-Step)

### Step 1 (현재 세션)
- ✅ ADR-052 master roadmap 작성 (본 문서)
- ✅ TodoWrite 로 9-Phase tracking
- 🔄 Phase H (ADR-053) spec + 첫 PoC 시작

### Step 2 (다음)
- Phase H 구현 + 회귀 24개 + 회귀 0건 검증
- LOC / 성능 측정 → 9개월 추정 검증

### Step 3+
- Phase I, M 병렬 진행
- Phase J 진입 (Phase H+I+M 완료 prerequisite)
- ...

각 Phase 는:
1. Child ADR 작성 (spec only)
2. 구현 (별도 commit)
3. 회귀 추가 + 통과 확인
4. CLAUDE.md LOCKED 갱신
5. 사용자 확인 후 다음 Phase

---

## 8. Out of Scope (별도 ADR)

- **Reference 시민권 분리** (ADR-053 placeholder 점유, 본 ADR-052 와 무관) —
  별도 분리 ADR 필요 (Construction Line / Imported Mesh / Point Cloud)
- **Layered material** (벽 = 외부+단열+구조+내부) — Phase 5 (ADR-055+)
  본 ADR 의 fitting 과 별개
- **Sketch constraint solver** advanced — 현재 Level 3 XPBD 충분
- **Plugin / scripting** — 별도 ADR
- **Cloud sync / collaboration** — 별도 ADR

---

## 9. References

- ADR-019 — Line is Truth (Path D 의 사상적 anchor)
- ADR-027 — NURBS Kernel Initiative (Phase A~G 의 시작)
- ADR-028~036 — Phase A~G 구현 ADR
- ADR-049 — Two-Layer Citizenship (Phase N prerequisite)
- ADR-050/051 — Phase 1 (Promote API + P7 manifold)
- 메타-원칙 #11 (Latency Budget), #12 (Memory Budget), #13 (One Source Two Views)
- v3.2 spec §3 시민권 / §7 XIA / §12 강등
- Piegl & Tiller — *The NURBS Book* (Algorithm A5.1, A5.5, A5.6, A5.9, A9.6, A9.7, A10.3)
- Shewchuk — Robust adaptive floating-point predicates (Phase M)
- Greiner-Hormann — Polygon clipping (Phase J trim loop arithmetic)

---

*Author*: AXiA team (사용자 결정 + Claude spec)
*Status*: Master roadmap accepted — 본 PR 은 spec 만, 9-Phase 구현은 후속
