# ADR-064 — NURBS Boolean → DCEL Conversion

**Status**: Step 1 Path Z 진입 (사용자 결정 2026-05-04)
**Date**: 2026-05-04
**Anchor**: ADR-052 master roadmap (Phase L₂ Boolean — ADR-067 Step 4 prerequisite)
**Parent**: ADR-060 Step 4 (boolean_dispatch §F lock-in)
**Prerequisites**: Phase J nurbs_boolean_v2 (Phase J/L₁ 완료), ADR-062
(Validated Surface Attach), ADR-063 (Path Z 패턴)
**Related**: ADR-067 (Press-Pull Engine, Step 4 의존), Phase O Step 4

---

## 0. Summary (4 lines)

> ADR-060 Phase O Step 4 의 boolean_dispatch 가 NURBS path 진단만 제공
> 하고 mesh fallback 으로 실제 결과를 만든다 — 사용자가 "Nurbs path
> 성공" 보지만 STEP export 시 정밀도 손실. ADR-064 Path Z Step 1 =
> trim curve → 3D polyline 변환 인프라 (atomic piece). 풀 Steps 2-5
> 는 별도 사인-오프. 5 sub-step / 6 회귀 / 2-3주.

---

## 1. Context — Path Z 채택 이유

### 1.1 사용자 패턴 (8번째 Path Z)

| ADR | Path 선택 |
|-----|----------|
| ADR-061~063, 067 Step 1, 068, 069, 070 | Path Z (모두) |
| **ADR-064** | **Path Z Step 1 only** (인프라 atomic piece) |

### 1.2 ADR-064 Step 1 가 풀 사용자 pain (간접)

**P3 (AI agent)**: NURBS Boolean 호출 시 정확한 DCEL 결과 받기
**STEP/IGES export**: trim curve 정확도 1e-3mm 라운드트립
**Press-Pull Engine (ADR-067 Step 4)**: extrude + Boolean 통합 시 정밀도

본 Step 1 단독으로는 사용자 perceived 가치 작음 (backend 인프라). Steps 2-3 에서 가치 발현.

### 1.3 Phase J nurbs_boolean_v2 산출물 분석

```
nurbs_boolean_v2 returns NurbsBooleanResultV2 {
  intersection: Vec<SurfaceIntersection>,  // SSI chains (3D + uv)
  trim_a: ContainmentTree,                 // surface A 의 trim loops
  trim_b: ContainmentTree,                 // surface B 의 trim loops
  robustness: SsiRobustnessReport,
  is_clean: bool,
}
```

**Step 1 의 목표**: `trim_a` / `trim_b` (TrimLoop 모음) → **3D polyline**
(world-space DVec3 sequence) 변환 인프라.

---

## 2. Decision — Path Z scope + 7개 D + 4 영구 Lock-in

### 2.1 §A — Step 1 scope

**채택 (Step 1 atomic)**:
- TrimCurve2D → 2D polyline sampling (chord_tol 정합)
- TrimLoop → 3D polyline (uv → surface.evaluate(u, v))
- 외부 진입점: `Mesh::trim_loops_to_dcel_polyline(...)` (vertex dedup 활용)
- LOCKED #5 1.5μm dedup 정합

**제외 (Steps 2-5 별도 ADR)**:
- 1×1 face Boolean DCEL 생성 (Step 2)
- Multi-face Boolean (Step 3)
- Tensor surface uv inversion (Step 4)
- mesh fallback 폐지 (Step 5 production cutover)

### 2.2 §B — 7개 D 결정 (확정)

| D | 결정 | 비고 |
|---|------|------|
| **D-A** | Path Z (Step 1 only) | 사용자 패턴 8번째 Path Z |
| **D-B** | 1×1 only — multi-face deferred | Step 3 별도 |
| **D-C** | Primitives only (Plane/Cyl/Sph/Cone/Torus + tensor 의 BSpline limited) | Step 4 deferred |
| **D-D** | Mesh fallback coexist (drop-in alongside) | mesh path 무변경 |
| **D-E** | chord_tol = HOVER_CHORD_TOL (0.01mm) | 일관성 |
| **D-F** | Vertex dedup = 기존 add_vertex spatial-hash | LOCKED #5 정합 |
| **D-G** | API = 신규 함수 (drop-in alongside) | 기존 boolean.rs 무변경 |

### 2.3 §C — 4 영구 Lock-in

```
1. Step 1 = trim curve → 3D polyline 인프라 only.
   실제 Boolean DCEL 생성 (Step 2) 본 ADR scope 외.
   Steps 2-5 별도 사인-오프 강제.

2. drop-in alongside — 기존 boolean.rs (mesh path) 변경 0.
   §A 패턴 일관 (Phase O Step 3-5 / ADR-061 / ADR-062).

3. LOCKED #5 1.5μm dedup 정합.
   기존 add_vertex spatial-hash 재사용. 신규 dedup 인프라 0.

4. chord_tol = HOVER_CHORD_TOL (0.01mm).
   ADR-061 §B 의 hover polyline tol 와 동일 — single SSOT.
```

---

## 3. Acceptance — 5 sub-step + 6 회귀

### 3.1 Sub-step 분해 (예상 2-3주)

| Sub-step | 영역 | 회귀 |
|----------|------|------|
| 1.1 | `surfaces/ssi/trim_to_polyline.rs` 신규 모듈 | 2 |
| 1.2 | `TrimCurve2D::sample_polyline_2d(chord_tol)` per-variant | 1 |
| 1.3 | `TrimLoop::to_world_polyline(surface, chord_tol)` (uv→3D) | 1 |
| 1.4 | `Mesh::trim_loops_to_dcel_polyline(...)` 외부 진입점 | 1 |
| 1.5 | 종합 + multi-loop hole 회귀 + disjoint case | 1 |
| **합계** | — | **6** |

### 3.2 6 회귀 invariants (절대 #[ignore] 금지)

1. `trim_to_polyline_line_curve_2_points` — Line 변종 = 정확 2 points
2. `trim_to_polyline_arc_chord_tolerance_satisfied` — Arc sagitta ≤ chord_tol
3. `trim_loop_to_world_evaluates_via_surface` — uv → world 정합 (sphere/cylinder)
4. `mesh_trim_loops_to_dcel_polyline_dedups_at_locked_5` — 1.5μm 이내 vertex 합치기
5. `multi_inner_hole_loops_preserved_in_dcel` — outer + N inner loops 모두 변환
6. `trim_polyline_returns_disjoint_when_no_intersection` — empty trim → empty polyline

---

## 4. Future Steps (별도 사인-오프)

| Step | 영역 | 위험 | 기간 |
|------|------|------|------|
| **2** | 1×1 face Boolean DCEL 생성 (primitives) | 중-고 | 3-4주 |
| 3 | Multi-face Boolean dispatch | 고 | 4-6주 |
| 4 | Tensor surface uv inversion (Bezier/B-spline) | **매우 고** | 6-8주 |
| 5 | boolean_dispatch mesh fallback 폐지 (production cutover) | **매우 고** | 2-3주 |

각 Step 진입 시 사용자 명시 사인-오프 + 별도 사전 검토 필요.

---

## 5. References

- ADR-052 master roadmap §Phase L₂
- ADR-060 Step 4 (boolean_dispatch §F lock-in)
- ADR-067 (Press-Pull Engine, Step 4 prerequisite)
- Phase J nurbs_boolean_v2 (`crates/axia-geo/src/surfaces/ssi/boolean.rs`)
- 사용자 사전 검토 + Path Z 채택 (8번째) 2026-05-04

---

*Author*: AXiA team (Path Z 사용자 결정 2026-05-04)
*Status*: Step 1 implementation 진행 중
