# ADR-024: 3-Way Corner Patch — MVP Chamfer + Future Spherical

**Status**: **Accepted** (2026-04-29) — Phase 3 MVP (flat chamfer)
**Supersedes**: ADR-021 v1.1 known limitation "Fillet 3-way corner singularity"
**Related**: Existing `Mesh::fillet_edge` (cylindrical sweep), ADR-007 (Face Orientation)

## Context

ADR-021 v1.1 known limitation:
> **Fillet 3-way corner**: 같은 vertex 공유 다중 엣지 — 기하학적 singularity.
> 일반 엣지 fillet 은 잘 됨. 3-way corner 는 실패 시 첫 번째 에러 메시지 + 실패 카운트.

이유:
- `fillet_edge` 는 단일 엣지 cylindrical sweep — 단일 호 (arc) 로 표현 가능
- 3-way vertex 의 corner 자체를 둥글게 하려면 **곡면 패치 (curved patch)** 필요
- 단순한 호 1 개로 표현 안 됨 → 수학적 singularity (한 점에서 N≥3 곡면 만남)

기존 동작:
- 사용자가 큐브 corner 의 3 엣지를 순차 fillet → 첫 엣지는 성공, 후속은 토폴로지 변경으로 실패 가능

## Decision

### P10 — 새 원칙

> **N-way corner (vertex valence ≥ 3) 의 fillet 은 N 개 인접 면에 접하는**
> **곡면 패치를 생성한다. MVP 는 flat triangular chamfer (3-way 만), 향후**
> **spherical tessellation 으로 확장.**

### P10 세부 규칙

**P10.1 — Scope**
- **MVP (Phase 3)**: 3-way (valence==3) vertex 만 처리, flat chamfer 생성
- **Future (Phase 3+)**: spherical tessellation (segments ≥ 2 시 곡률 패치)
- **Future**: 4-way 이상, variable radius

**P10.2 — MVP Algorithm (Flat Chamfer)**
1. Validate: vertex `v` 가 정확히 3 active 인접 면 + 3 incident edges
2. 각 인접 면 F_i 에 대해 **trim point** P_i 계산:
   - F_i 위의 두 incident edge 방향의 bisector 따라 v 에서 distance r 만큼 이동
   - P_i = v + r · bisector_in_face(F_i)
3. 각 F_i 의 outer loop 에서 v 를 P_i 로 교체 (`splice_vertex_replacement` 패턴)
4. 새 face: triangle [P_1, P_2, P_3] 추가
5. v 가 더이상 어떤 face 에도 참조되지 않으면 vertex 제거

**P10.3 — Result Shape**
- 단일 vertex v 제거 (or isolated 처리)
- 3 incident face 들 boundary 가 v → P_i 로 교체
- 새 1 triangular face 추가
- net: face_count + 1, vertex_count + 2 (P_i 3개 추가 - v 1개 제거)

**P10.4 — Manifold Invariant**
- ADR-007 Invariants 무손상
- `verify_face_invariants` 위반 0 검증 (회귀 테스트)

**P10.5 — Sequential Fillet 호환성**
- `chamfer_vertex_3way` 와 `fillet_edge` 는 독립 op
- 둘을 조합하면: 먼저 corner chamfer → 결과적으로 valence==2 가장자리만 남음
  → 이후 fillet_edge 가능 (사용자 시나리오 확장)

**P10.6 — Future Spherical Patch (TBD)**
- segments ≥ 2 일 때 spherical octant tessellation
- 구의 일부 (sphere of radius r centered at C = v - bisector_out * r * sqrt(3))
- 3 trim point P_i 는 구 위에 위치 (C 에서 거리 r)
- 별도 ADR-024 v2 또는 ADR-025

## Implementation

### 변경 파일
- `crates/axia-geo/src/operations/fillet.rs`:
  - `Mesh::chamfer_vertex_3way(v: VertId, radius: f64) -> Result<ChamferResult>`
  - `ChamferResult { trim_face: FaceId, modified_faces: Vec<FaceId> }`
- 기존 `splice_vertex_replacement` 헬퍼 재사용 (arc_verts 대신 single point [P_i])

### 회귀 테스트 (절대 #[ignore] 금지)
- `chamfer_3way_cube_corner_creates_triangle`
- `chamfer_3way_manifold_invariant_after`
- `chamfer_3way_rejects_non_3way` (valence != 3)
- `chamfer_3way_rejects_boundary_vertex` (한 face 만 인접)

## Trade-offs

### 채택 이유
- ✅ ADR-021 v1.1 known limitation 해결 (MVP 수준)
- ✅ 사용자 직관 일치 ("corner 자체를 둥글게")
- ✅ Flat chamfer 는 안전하고 manifold 보장 쉬움
- ✅ Future spherical 확장 위한 토대

### 인지된 비용
- ⚠ MVP 결과는 "flat" — 진짜 둥근 corner 아님 (chamfer 외관)
- ⚠ Spherical 확장은 별도 phase 필요

### 기각된 대안
- **Spherical patch right away**: 1~2 주 추가, MVP 가치 대비 비용 높음
- **Sequential fillet 자동 정합 only**: 새 사용자 액션 없이 기존 fillet 만 견고화 — "3-way corner" 자체는 해결 안 됨

## Migration

기존 코드 영향:
- ADR-021 v1.1 known limitation 항목 → "Resolved (MVP) by ADR-024 P10"
- CLAUDE.md LOCKED #11 추가
- 기존 `fillet_edge` 동작 변경 없음

## Future

- Spherical tessellation (segments 매개변수 활용)
- 4-way / N-way corner
- Variable radius per face
- Material 결정 룰 (3 인접 면의 평균 / 우세 / 사용자 선택)
- UI: "corner round" 도구 신설 (vertex 선택 → radius 입력 → execute)
