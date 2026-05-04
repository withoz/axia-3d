# ADR-061 — Phase P (Narrow): Hot-Path Tessellation Cache

**Status**: Draft (Path Z 사용자 결정 2026-05-04, sign-off 대기)
**Date**: 2026-05-04
**Anchor**: ADR-052 master roadmap (Phase P, scope 재정의)
**Parent**: ADR-052 §2.x Phase P
**Prerequisites**: ADR-060 Phase O 완료 (87/87 tests + 6 WASM endpoints)
**Related**: ADR-038 P23 (Surface-Aware Normals), ADR-040 P25
(AnalyticCurve Distance Hover), ADR-057 Phase L (양방향 SSOT, 후속)

---

## 0. Summary (4 lines)

> Phase P 의 원래 scope (NURBS surface tessellation cache) 는 캐시 대상
> 호출 경로가 wire-up 안 되어 즉각 효용 0. Path Z 로 재정의 — 진짜
> 핫패스 2개에 좁은 캐시: (Z.1) ADR-038 매 프레임 normal evaluate +
> (Z.2) ADR-040 매 mousemove curve hover. Phase L 호환 보존.

---

## 1. Context — 사전 검토에서 발견한 사실

### 1.1 원래 가정 vs 실제 측정

| 원안 가정 | 실제 코드 측정 |
|----------|---------------|
| 프레임당 NURBS tessellation 비용이 병목 | `tessellate_face_surface` 가 viewport / tools 어디서도 호출 안 됨 (테스트 only) |
| Phase O 가 NURBS face 급증 → 렌더 비용 폭증 | `face.surface` 부착은 늘었으나 `getMeshBuffers` 가 mesh boundary triangulation 만 사용 |
| 100ms/frame 낭비 즉시 제거 | 현재 surface tessellation 으로 인한 낭비 ≈ 0 |

### 1.2 진짜 핫패스 — wire-up 된 evaluate 경로

**핫패스 #1 — Normal evaluate (매 프레임)**
```
Viewport.smoothNormals (Viewport.ts:1426-1485):
  for each face fid:
    if face_has_analytic_surface(fid):  ← 매 프레임 N개 face 체크
      use Rust-computed analytic normal
      ↑ Rust 측 surface.normal(u, v) 호출 (Cylinder/Sphere/Cone trig)
```

**핫패스 #2 — Curve hover (매 mousemove)**
```
EdgeOrFacePicker.pickEdgeAnalytic (ADR-040 P25):
  for each candidate edge:
    if edge.curve.is_some():
      ray_to_curve_distance(ray, curve)  ← Newton iteration
      ↑ Bezier/BSpline/NURBS evaluate 반복
```

이 둘이 캐시 진짜 가치 있는 영역. NURBS surface tessellation 은 Phase L
가 wire-up 한 후에 ADR-062 로 별도 진행.

### 1.3 ADR-052 마스터 로드맵 정합

```
Phase O: NURBS-aware tools                ✓ 완료
Phase P (narrow): Hot-path eval cache    ← 본 ADR
Phase L: Surface-driven face synthesis    후속 (양방향 SSOT)
Phase P+: Surface tessellation cache      Phase L 후 ADR-062
```

---

## 2. Decision — Z.1 + Z.2 두 캐시 + 9개 D 결정

### 2.1 §A — Z.1 Normal Cache (Face-level)

**대상**: `Face.surface.normal(u, v)` 의 매 프레임 호출.

**캐시 위치**:
```rust
struct Face {
    // ... 기존 ...
    surface: Option<AnalyticSurface>,
    // 신규 (Phase P-narrow)
    normal_cache: Option<NormalCacheEntry>,
}

struct NormalCacheEntry {
    surface_version: u64,        // surface mutator 마다 ++
    boundary_version: u64,       // outer/inner loop mutator 마다 ++
    /// Per-vertex normals in outer loop order. Cached evaluate.
    per_vertex_normals: Vec<DVec3>,
}
```

**무효화 트리거**:
1. `set_face_surface(fid, _)` → `face.surface_version += 1`
2. Outer/inner loop 변경 (split_edge / merge / add_face / 등) → `face.boundary_version += 1`
3. Cache hit 검사: `cache.surface_version == face.surface_version
   && cache.boundary_version == face.boundary_version` → use; else recompute

**캐싱 대상 surface kind** (D6 미세 수정 — "Plane 제외"):
```rust
fn should_cache(s: &AnalyticSurface) -> bool {
    !matches!(s, AnalyticSurface::Plane { .. })
    // Plane: 모든 vertex normal 동일 → cache 메모리 낭비
    // Cylinder/Sphere/Cone/Torus/BezierPatch/BSplineSurface/NURBSSurface: cache
}
```

### 2.2 §B — Z.2 Curve Hover Cache (Edge-level polyline)

**대상**: `ray_to_curve_distance` Newton 반복.

**캐시 위치**:
```rust
struct Edge {
    // ... 기존 ...
    curve: Option<AnalyticCurve>,
    // 신규 (Phase P-narrow)
    polyline_cache: Option<PolylineCacheEntry>,
}

struct PolylineCacheEntry {
    curve_version: u64,
    /// Tessellated polyline at fixed chord_tol (HOVER_CHORD_TOL).
    /// Used as Newton initial-seed grid by ray_to_curve_distance.
    points: Vec<DVec3>,
}
```

**무효화 트리거**:
1. `set_curve(eid, _)` → `edge.curve_version += 1`
2. Edge endpoint 변경 (split_edge 의 sub-edge / endpoint vertex move) → 동일 카운터

**Hover 호출 변경**:
```rust
// Before
ray_to_curve_distance(ray, &edge.curve())  // 매 호출 evaluate 반복

// After
let polyline = edge.cached_polyline_or_compute(HOVER_CHORD_TOL);
ray_to_curve_distance_with_seed(ray, &edge.curve(), &polyline)
//                              ^^^^ Newton seed = 가장 가까운 polyline 점
```

**Plane/Line edge 캐싱 정책** (D6 일관):
```rust
fn should_cache_edge(c: &AnalyticCurve) -> bool {
    !matches!(c, AnalyticCurve::Line { .. })
    // Line: distance = closed-form, cache 불필요
}
```

### 2.3 §C — 9개 D 결정 (사용자 권고 + 미세 수정)

| D | 결정 | 비고 |
|---|------|------|
| **D1** | Path Z (Z.1 + Z.2 narrow) | 사용자 결정 |
| **D2** | 전역 단일 chord_tol — `HOVER_CHORD_TOL = 0.01mm` | 사용자 권고 |
| **D3** | Face/Edge 필드 (derived data 위치) | 사용자 권고. Phase L 호환 |
| **D4** | LOD 없음 | 사용자 권고 |
| **D5 (수정)** | Face 당 1 entry + **별도 byte cap 100MB** | 메타-원칙 #12 strict 강화 |
| **D6 (수정)** | "Plane 제외" / "Line 제외" 명시 | "NURBS만" → 더 정확 |
| **D7 (수정)** | 미직렬화 + **schema_version=1 정의** | 미래 호환 (ADR-060 §D 정합) |
| **D8** | Worker 미사용 | WASM single-thread 정합 |
| **D9** | P-narrow 먼저, Phase L 후속 | Path Z 결정 |

### 2.4 §D — 6 영구 Lock-in

```
1. Face.normal_cache 위치 = derived data
   Phase L 가 surface 를 SSOT 로 승격 시 캐시 위치 자연 승계.

2. Plane / Line 캐싱 금지
   메모리 낭비 차단. should_cache* 헬퍼로 강제.

3. surface_version / boundary_version / curve_version 카운터
   모든 mutator 호출 시 자동 증가 — silent stale 차단.
   회귀 invariant: cache 사용 전 version 검증 강제.

4. Byte-cap 100MB 강제 (D5 강화)
   초과 시 오래된 entry 제거 (단순 access-time 정렬).
   메타-원칙 #12 strict.

5. 직렬화 제외
   캐시는 휘발 — Scene.snapshot 에 포함 금지.
   schema_version=1 (미래 호환).

6. Phase L 차단 금지
   본 ADR 의 어떤 결정도 Phase L 의 surface SSOT 승격을 막지 않음.
   Phase L 도래 시 cache invariant 만 추가 — 구조 변경 없음.
```

---

## 3. Acceptance — 5-step + 12 회귀 (사용자 사인-오프 후)

### 3.1 Step 분해 (예상 2주)

| Step | 영역 | 회귀 | 위험 |
|------|------|------|------|
| 1 | `Face.normal_cache` 슬롯 + `surface_version` / `boundary_version` 카운터 | 3 | 저 |
| 2 | `set_face_surface` + boundary mutator 들에 version bump 삽입 | 4 | **고** (R1) |
| 3 | Z.1 normal evaluate hot-path 캐시 hit/miss 분기 + WASM `getFaceNormalsCached` endpoint | 3 | 중 |
| 4 | `Edge.polyline_cache` + Z.2 hover 통합 + curve_version mutator | 4 | 중 |
| 5 | Byte-cap eviction + WASM `getCacheStats` (additive only, ADR-060 §D 준수) | 2 | 저 |
| **합계** | — | **16** | — |

### 3.2 핵심 회귀 invariants (절대 #[ignore] 금지)

1. `cache_invalidates_on_set_face_surface` — surface 변경 → 다음 호출에서 miss
2. `cache_invalidates_on_outer_loop_mutation` — split_edge → miss
3. `cache_skips_plane_surface` — Plane face 는 entry 생성 0
4. `cache_skips_line_curve` — Line edge 는 entry 생성 0
5. `cache_hit_returns_identical_data` — 두 번째 호출 결과 == 첫 번째
6. `cache_byte_cap_evicts_oldest` — 100MB 초과 시 LRU 제거
7. `cache_excluded_from_serialization` — Scene.snapshot 에 캐시 데이터 0
8. `cache_normal_matches_uncached` — Z.1 hot-path 결과 == Rust direct evaluate
9. `cache_polyline_matches_uncached` — Z.2 hot-path 결과 == ray_to_curve_distance direct
10. `phase_l_compatibility_face_field_position` — Face.normal_cache 가 face 필드 위치 보존 (Phase L drift 차단)
11. `wasm_export_baseline_unchanged_phase_p` — ADR-060 §D 회귀 (기존 130 export + Step 6 의 5개 = 135개 보존)
12. `cache_stats_json_includes_schema_version` — `getCacheStats` JSON `schemaVersion: 1`

### 3.3 위험 매트릭스

| 위험 | 대책 |
|------|------|
| R1 무효화 누락 → silent stale render | version counter + 회귀 1, 2, 5 강제 |
| R2 Phase L 충돌 | §D #6 lock-in + 회귀 10 |
| R3 메모리 폭주 | §D #4 byte cap 100MB + 회귀 6 |
| R4 SSOT 이중화 | Layer 1 (cache) ↔ Layer 2 (engine cached_*) 명확 분리 |
| R6 Phase O dispatch 결과 stale | Step 2 mutator hook 강제 |

---

## 4. References

- ADR-052 master roadmap §2.x Phase P
- ADR-038 P23 (Surface-Aware Normals — 캐시 대상)
- ADR-040 P25 (AnalyticCurve Distance Hover — 캐시 대상)
- ADR-060 §D additive-only lock-in (WASM endpoint 정합)
- ADR-057 Phase L (Surface SSOT — 후속, 호환성 강제)
- 사용자 사전 검토 + Path Z 결정 2026-05-04

---

*Author*: AXiA team (Path Z 사용자 결정 2026-05-04)
*Status*: Draft — Step 분해 + 12 회귀 사인-오프 대기
