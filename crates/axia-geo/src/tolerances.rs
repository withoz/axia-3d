//! Geometric tolerance constants.
//!
//! Refined from buildragon's tolerances.rs with clearer naming.
//!
//! # 상수 체계 (2026-04-17 정리)
//!
//! ## Tolerance (허용 오차) — 좌표 일치성 판정
//! - `VERTEX_TOLERANCE`: 정점 일치 판정 (1e-7)
//! - `EDGE_TOLERANCE`: 엣지 일치 판정 (1e-7)
//! - `FACE_TOLERANCE`: 평면 위 점 판정 (1e-6)
//! - `COPLANAR_TOLERANCE`: 법선 평행성 (1e-4)
//!
//! ## Epsilon (실효값 하한) — 의미있는 크기 판정 (ADR-003 Geometric Validity)
//! - `EPSILON_LENGTH`: 1D 실효 길이 (1e-6)
//! - `EPSILON_AREA`: 2D 실효 면적 (EPSILON_LENGTH^2)
//! - `EPSILON_VOLUME`: 3D 실효 부피 (EPSILON_LENGTH^3)
//!
//! **Tolerance vs Epsilon 구분**:
//! - Tolerance: "두 좌표가 같다고 볼 것인가" (비교 오차)
//! - Epsilon: "의미있는 크기가 있다고 볼 것인가" (실효 하한)
//!
//! ## Angles (각도 임계값)
//! - `EDGE_VISIBILITY_ANGLE_DEG`: 엣지 숨김 임계 (30.0°)
//! - `SMOOTH_GROUP_ANGLE_DEG`: Smooth group 묶기 (30.1°)
//! - `EXACT_COPLANAR_ANGLE_DEG`: 코플래너 판정 (0.1°)
//!
//! **세 각도의 수학적 관계**:
//! ```text
//! EXACT_COPLANAR (0.1°) <<  EDGE_VISIBILITY (30°)  <=  SMOOTH_GROUP (30.1°)
//!   │                         │                         │
//!   │ 완전 동일 평면            │ 렌더링 엣지 숨김          │ Smooth group BFS
//!   │ = 분할 sibling 제외       │ (hard edge 판정)         │ (0.1° epsilon)
//! ```
//! - EDGE_VISIBILITY ≤ SMOOTH_GROUP: smooth group 묶이는 면들은 반드시 엣지도 숨겨져야 함
//! - EXACT_COPLANAR < EDGE_VISIBILITY: 완전 평행한 면들도 엣지 숨김 대상에 포함
//! - EXACT_COPLANAR 내부에 들면: "split sibling"으로 판정, smooth group에서 제외

// ══════════════════════════════════════════════════════════════════════════
// Tolerance (허용 오차) — 좌표 비교
// ══════════════════════════════════════════════════════════════════════════

/// Vertex coincidence tolerance (positions closer than this are merged).
/// 1e-7 — CAD precision (FreeDesignX/buildragon 동일).
/// Always-on endpoint inference + f64 snap channel이 정확한 좌표를 보장.
pub const VERTEX_TOLERANCE: f64 = 1e-7;

/// Edge coincidence tolerance
pub const EDGE_TOLERANCE: f64 = 1e-7;

/// Face tolerance (점이 평면 위에 있다고 볼 거리)
pub const FACE_TOLERANCE: f64 = 1e-6;

/// Coplanarity test tolerance (dot product threshold).
///
/// **ADR-167 β-3 — DEPRECATED**: use `crate::plane::EPS_PLANE_NORMAL`
/// (the canonical SSOT). Identical value, identical semantic. This
/// alias kept for backward compat; new code MUST use canonical name.
#[deprecated(
    since = "0.1.0",
    note = "Use `crate::plane::EPS_PLANE_NORMAL` (ADR-167 β-3 sunset)"
)]
pub const COPLANAR_TOLERANCE: f64 = crate::plane::EPS_PLANE_NORMAL;

/// Loop planarity enforcement tolerance.
///
/// **ADR-167 β-3 — DEPRECATED**: use `crate::plane::EPS_PLANE_NORMAL`
/// (canonical SSOT). Loop planarity is a normal-parallelism check
/// (all loop vertices must lie in a single plane — equivalent to all
/// triangle normals being parallel to the loop's plane normal).
#[deprecated(
    since = "0.1.0",
    note = "Use `crate::plane::EPS_PLANE_NORMAL` (ADR-167 β-3 sunset)"
)]
pub const LOOP_PLANAR_TOLERANCE: f64 = crate::plane::EPS_PLANE_NORMAL;

/// Minimum face area difference for merge operations
pub const FACE_AREA_TOLERANCE: f64 = 1e-4;

/// Triangle winding order fix tolerance
pub const WINDING_ORDER_TOLERANCE: f64 = 1e-12;

/// Normal computation epsilon (keep at 0 to avoid missing thin faces)
pub const NORMAL_EPSILON: f64 = 0.0;

// ══════════════════════════════════════════════════════════════════════════
// Epsilon (실효값 하한) — Geometric Validity Principle (ADR-003)
// ══════════════════════════════════════════════════════════════════════════

/// 1D 실효 길이 하한. 이보다 짧은 거리는 "실질적으로 0"으로 간주.
///
/// 이 값 미만의 Push/Pull distance, edge length, scale factor는 degenerate
/// 기하를 생성하므로 해당 연산은 거부된다 (ADR-003).
///
/// 단위는 프로젝트의 내부 길이 단위(mm 가정). 단위 변경 시 이 값도 함께 변환 필요.
pub const EPSILON_LENGTH: f64 = 1e-6;

/// 2D 실효 면적 하한 (EPSILON_LENGTH^2).
/// 삼각형 면적이 이보다 작으면 degenerate face로 판정.
pub const EPSILON_AREA: f64 = EPSILON_LENGTH * EPSILON_LENGTH;

/// 3D 실효 부피 하한 (EPSILON_LENGTH^3).
/// 솔리드의 부피가 이보다 작으면 degenerate volume으로 판정.
pub const EPSILON_VOLUME: f64 = EPSILON_LENGTH * EPSILON_LENGTH * EPSILON_LENGTH;

/// 각도 비교 epsilon (도 단위). 각도 차이가 이보다 작으면 동일 각도로 간주.
pub const EPSILON_ANGLE_DEG: f64 = 0.01;

// ══════════════════════════════════════════════════════════════════════════
// Angles (각도 임계값) — 렌더링 및 그룹핑
// ══════════════════════════════════════════════════════════════════════════

/// 엣지 가시성 임계 각도 (도). 인접 면 사이의 법선 각도가 이보다 작으면
/// 엣지를 숨긴다(soft edge / coplanar 취급).
///
/// 2026-04-22 (1차): 30° → 15°. 형태감 살림.
/// 2026-04-22 (2차, 최종): 15° → 20.1°. 15°는 18-seg revolve(각 20°/segment)의
/// 모든 segment 경계를 노출시켜 실린더·cone이 세로줄 stripe로 보임.
/// 20.1°는 다음 trade-off 의 sweet spot:
///   - 18-seg revolve (20°/segment) → 매끈하게 숨김
///   - 24-seg revolve (15°/segment) → 표시 안 됨 (상위 모델엔 문제 안 됨)
///   - 30°+ 건축 코너 → 당연히 표시 (벽·매스의 90° 모서리 등)
/// 사용자가 StylePanel의 "각도 임계" 슬라이더로 모델별 fine-tune 가능.
pub const EDGE_VISIBILITY_ANGLE_DEG: f64 = 20.1;

/// Smooth group 그룹핑 임계 각도 (도). BFS로 인접 면을 묶을 때 이보다
/// 작은 각도 차이를 가진 면들을 하나의 곡면 그룹으로 취급.
///
/// 값: `EDGE_VISIBILITY_ANGLE_DEG + 0.1°` (저분할 원통/원뿔 경계 안정화를 위한 epsilon)
pub const SMOOTH_GROUP_ANGLE_DEG: f64 = 30.1;

/// 완전 코플래너 판정 임계 각도 (도). 두 면의 법선 각도 차이가 이보다
/// 작으면 "완전히 같은 평면"으로 간주 — 즉 분할된 sibling face로 판정.
///
/// Smooth group에서 이 범위의 이웃은 **제외**된다 (split sibling을 곡면으로
/// 오해하지 않기 위함 — 2026-04-17 분할 face push/pull 버그 수정).
pub const EXACT_COPLANAR_ANGLE_DEG: f64 = 0.1;

/// ADR-061 Phase P-narrow §B — Z.2 Curve Hover Cache chord tolerance.
///
/// Default chord-tol used by `Mesh::edge_cached_polyline_or_compute`.
/// 0.01mm = 10μm — fine enough that hover Newton seed (closest polyline
/// point → curve.evaluate refinement) converges in ≤2 iterations for
/// typical edge curves (arcs / Bezier / B-spline).
///
/// LOCKED #5 정합: 1.5μm spatial-hash dedup 보다 큼 → polyline 점 사이
/// vertex collapse 위험 없음.
pub const HOVER_CHORD_TOL: f64 = 0.01;

/// ADR-062 Phase L₂ Path Z — Default tolerance for
/// `Mesh::attach_surface_validated` boundary-fit check.
///
/// 1μm absolute (mm). Above LOCKED #5 1.5μm dedup floor — drift below
/// this threshold is geometrically indistinguishable from numerical
/// noise. Caller can override per-call (positive value); WASM endpoints
/// treat `tol ≤ 0` as "use this default".
pub const ATTACH_VALIDATE_TOL: f64 = 1e-3;

/// 도 → 라디안 변환 (런타임, `f64::cos`는 const가 아님)
#[inline]
pub fn deg_to_rad(deg: f64) -> f64 {
    deg * std::f64::consts::PI / 180.0
}

/// 각도(도) → cosine 값 (내적 비교용). 상수 문맥에서는 `deg_to_rad(x).cos()` 대신
/// 이 함수를 한 번 호출한 결과를 `let` 바인딩으로 캐시해서 사용 권장.
#[inline]
pub fn deg_to_cos(deg: f64) -> f64 {
    deg_to_rad(deg).cos()
}
