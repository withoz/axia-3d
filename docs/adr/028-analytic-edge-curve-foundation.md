# ADR-028: Analytic Edge Curve Foundation (Phase A)

**Status**: **Accepted** (2026-04-29) — Phase A kickoff
**Plan**: [PLAN-001](../plans/PLAN-001-nurbs-kernel.md) Phase A
**Initiative**: ADR-027 (Accepted)
**Related**: ADR-019 (Line is Truth — curve 1급화의 자연 확장)

## Context

PLAN-001 의 첫 단계. DCEL polygon 위에 **분석적 edge curve** 레이어 추가.
원/호/Bezier 등을 N-segment 직선으로 tessellate 하지 않고, 곡선 정의를
**Edge 의 1급 속성** 으로 보존.

### 현재 한계
- 24-segment 원 → zoom-in 시 N-각형 보임
- DrawCircle 결과가 polyline → edge ID 가 segment 별로 분리
- Tessellation 정밀도가 draw 시점 segment 수에 고정 (재해상도 불가)

### 목표
- `Edge.curve: Option<AnalyticCurve>` — Line 은 None (default), Arc/Circle 은 Some
- Curve evaluation / derivative / tessellation 분리
- Tessellation 은 view-dependent LOD (zoom 시 자동 정밀화)
- 기존 polygon 동작 100% 보존

## Decision

### P13 — 새 원칙

> **Edge 는 두 vertex 사이의 위상적 연결 + 선택적 분석적 곡선 정의를**
> **갖는다. Polyline 은 곡선의 view-dependent cache 일 뿐, 진실은 분석적**
> **정의이다.**

### P13 세부 규칙

**P13.1 — AnalyticCurve enum (Phase A scope)**
```rust
pub enum AnalyticCurve {
    Line     { start: VertId, end: VertId },
    Circle   { center: DVec3, radius: f64, normal: DVec3, basis_u: DVec3 },
    Arc      { center: DVec3, radius: f64, normal: DVec3, basis_u: DVec3,
               start_angle: f64, end_angle: f64 },
}
// Phase B/C 에서 추가: Ellipse, Bezier, BSpline, NURBS
```

**P13.2 — Edge 확장**
```rust
pub struct Edge {
    // ... existing fields ...
    pub curve: Option<AnalyticCurve>,  // None = straight line (default)
}
```
- `curve` field 가 None 이면 기존 직선 동작 (100% backward compatible)
- Some 일 때만 곡선으로 해석

**P13.3 — Curve API (trait)**
```rust
pub trait CurveOps {
    fn evaluate(&self, t: f64, mesh: &Mesh) -> Result<DVec3>;
    fn derivative(&self, t: f64, mesh: &Mesh) -> Result<DVec3>;
    fn tessellate(&self, chord_tol: f64, mesh: &Mesh) -> Result<Vec<DVec3>>;
    fn arc_length(&self, mesh: &Mesh) -> Result<f64>;
    fn parameter_range(&self) -> (f64, f64);
}
```
- `t` ∈ `parameter_range()` (보통 [0, 1] 또는 [start_angle, end_angle])
- `chord_tol`: tessellation 의 최대 chord error (sagitta) — 기본 1e-3 mm

**P13.4 — Tessellation 정책**
- **Default chord_tol**: 1e-3 mm (1 μm) — LOCKED #5 와 일관
- **View-dependent LOD**: TS 측 viewport 가 zoom level 별 chord_tol 동적 결정
- **Cache invalidation**: edge curve 변경 시 tessellation cache invalidate

**P13.5 — Backward Compatibility**
- 기존 모든 도구 (DrawRect, DrawLine, Push/Pull, Boolean) 가 그대로 작동
- `curve.is_none()` edge 는 100% 기존 동작 유지
- `curve.is_some()` edge 는 operation 시 자동 tessellate (Phase F 까지)

**P13.6 — Serialization (AXIA format)**
- 기존 mesh 데이터 + curve enum 추가 (versioned)
- 기존 파일 (curve 없음) load 시 모든 edge.curve = None — 동작 무변동

**P13.7 — DrawCircle / DrawArc 동작 변경**
- 이전: N segment 의 DrawLine 반복
- 이후: 각 line segment 의 edge 가 Arc 의 일부로 표시 (curve = Some(Arc { ... 부분 angle 범위 }))
- 시각적 결과 동일하지만 내부적으로 곡선 정보 보존

## Implementation Plan (3 mo)

### Week 1-2 — Foundation
- `crates/axia-geo/src/curves/mod.rs` — module 골격 + `AnalyticCurve` enum
- `curves/line.rs`, `curves/arc.rs`, `curves/circle.rs` — primitive 구현
- `CurveOps` trait + impls
- 기본 테스트 30+

### Week 3-6 — Edge Integration
- `Edge` 구조체 확장 (`curve: Option<AnalyticCurve>`)
- `add_edge_with_curve(v0, v1, curve)` — 신규 API
- 직렬화 확장 (AXIA format version bump)
- 회귀 테스트 (기존 polygon 동작 보존 검증)

### Week 7-10 — Tessellation + LOD
- Adaptive tessellation (chord_tol 기반)
- TS 측 LOD manager (zoom level → chord_tol 매핑)
- View-dependent re-tessellation
- WASM bridge: `getTessellatedEdge(eid, chord_tol)` API

### Week 11-12 — DrawArc / DrawCircle 적용
- 기존 도구가 분석적 curve 생성하도록 마이그레이션
- 시각 검증 (zoom-in 부드러움)
- 회귀 테스트 (사용자 워크플로우 무손상)

## Constraints (Locked)

이 Phase 는 다음을 **준수해야 함**:

1. ✅ ADR-007 Invariants — face 의 normal/winding 무손상
2. ✅ ADR-019 P5/P6 — 곡선 edge 의 erase 도 동일 정책
3. ✅ ADR-021 P7 — 닫힌 곡선 cycle 도 면 분할 (자연 확장)
4. ✅ ADR-025 P11 — 닫힌 곡선 = 반드시 면 (분석적 cycle 검출)
5. ✅ ADR-026 P12 — Cardinal SSOT (curve의 평면 좌표도 snap)
6. ✅ LOCKED #5 — fuzzy snap 금지 (curve 도 exact input)

## Tests (절대 #[ignore] 금지)

### 단위 테스트 (curves/*)
- `line_evaluate_endpoints`
- `line_evaluate_midpoint`
- `line_derivative_constant`
- `arc_evaluate_start_end`
- `arc_evaluate_midpoint_radius`
- `arc_derivative_tangent_perpendicular_radius`
- `arc_tessellate_chord_error_within_tol`
- `arc_arc_length_matches_radius_times_angle`
- `circle_full_2pi_evaluate`
- `circle_tessellate_segment_count_scales_with_radius`
- `circle_arc_length_matches_2pi_r`
- `parameter_range_validity`

### Edge 통합 테스트
- `edge_with_line_curve_default_none`
- `edge_with_arc_curve_some_arc`
- `add_edge_with_curve_creates_link`
- `tessellate_edge_curve_returns_polyline`
- `serialize_edge_with_curve_roundtrip`
- `legacy_axia_file_load_curve_none`

### 회귀 보장 테스트
- `existing_drawrect_polygon_unchanged`
- `existing_pushpull_works_with_polyline_edges`
- `existing_boolean_works_with_polyline_edges`

## Success Criteria (Gate 1)

- ✅ 모든 기존 회귀 테스트 통과 (1637+)
- ✅ Phase A 신규 테스트 30+ 통과
- ✅ DrawCircle 결과가 zoom-in 시 부드럽게 (현재 24-각형 → 적응형)
- ✅ AXIA 파일 양방향 호환 (기존 파일 load OK, 새 파일 with curve 저장 OK)
- ✅ WASM 번들 증가 < 100 KB
- ✅ 회귀 0건

## References

- Piegl & Tiller, *The NURBS Book*, Chapter 1-2 (Analytic curves intro)
- 기존 web/src/curves/Curve.ts (TS 측 curve layer — Rust 측으로 점진 이전)
