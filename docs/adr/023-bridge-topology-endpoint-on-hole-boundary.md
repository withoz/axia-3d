# ADR-023: Bridge Topology — Endpoint Exactly On Hole Boundary

**Status**: **Accepted** (2026-04-29)
**Supersedes**: ADR-021 v1.1 known limitation "Phase G case (c) endpoint-on-hole-boundary"
**Related**: ADR-006 (Multi-loop Face), ADR-019 (Line is Truth), ADR-021 (Closed loop divides face), ADR-022 (P9 vertex-shared pinch)

## Context

ADR-021 v1.1 known limitation:
> **Phase G case (c)**: 절단선의 한쪽 endpoint 가 hole boundary 위에 정확히 닿는 경우 — bridge topology 미구현. 거부.

기존 구현 상태:
- **Phase G2 case (b)**: 절단선이 hole 을 관통 ✅
- **Phase G3 case (c)**: 한쪽 endpoint 가 hole 안에 strictly inside ✅ (bridge with edge split)
- **Phase G4 case (d)** (본 ADR): endpoint 가 hole boundary (vertex 또는 edge) 위에 정확히 위치 ❌

사용자 시나리오: hole 이 있는 면을 자르면서 칼을 hole 모서리/꼭지점에 정확히 멈추는 경우.
스냅 시스템 (osnap) 이 vertex/midpoint 에 자동 정렬하면 자주 발생.

## Decision

### P8 — 새 원칙

> **절단선의 endpoint 가 hole boundary 의 vertex 또는 edge 위에 정확히 닿으면**
> **그 점을 bridge target H 로 사용한다. Edge 위면 split_edge 로 H 를 실현,**
> **vertex 위면 H = 그 vertex (split 불필요).**

### P8 세부 규칙

**P8.1 — Boundary Endpoint Detection**
- 각 endpoint 에 대해 모든 hole 의 boundary 를 strict-tolerance (face_diag * 0.02) 로 검사
- vertex match: `dist(point, hole_vert) < tol` → `BoundaryPoint::ExistingVertex`
- edge match: tight match (`dist(point, edge_proj) < tol`) → `BoundaryPoint::OnEdge`
- loose-fallback (closest snap) 사용 안 함 — strict 만

**P8.2 — Routing**
- 양쪽 endpoint 모두 outer 에 → 표준 split (Phase G case a)
- 한쪽 outer + 한쪽 hole boundary → **Case D (본 ADR)**
- 한쪽 outer + 한쪽 strictly inside hole → Case C (Phase G3, 기존)
- 양쪽 hole boundary → 거부 (zero-length cut in void variant) — 미래 확장
- 양쪽 다른 hole → 거부 — 미래 확장

**P8.3 — Bridge Composition**
- Outer endpoint A: 기존 `find_boundary_point` + `realize_boundary_point` 로 실현
- Hole endpoint H: `BoundaryPoint::ExistingVertex` → 그대로 사용 / `OnEdge` → split_edge
- Bridged loop: outer_walk (A 로 시작 1 cycle) + H + hole_walk[1..] (CW natural) + H
  → make_loop 시 bridge edge A↔H 가 양방향 traverse
- 다른 holes 는 그대로 inner loops 로 보존

**P8.4 — Manifold Invariant 보존**
- ADR-007 Invariants 무손상
- `verify_face_invariants` 위반 0 검증 (회귀 테스트)
- bridge edge 는 1 face 에 attach (양면 모두 같은 새 face)

**P8.5 — Result Shape**
- 단일 면 (split 아님 — fuse 동작)
- inner loops 수 = original_holes - 1 (영향받은 hole 만 제거)
- vertex / edge 수: hole edge 위 endpoint 면 +1 vertex / +1 edge (split), vertex 위 면 +0 / +0

## Implementation

### 변경 파일
- `crates/axia-geo/src/operations/face_split.rs`:
  - `try_find_hole_boundary_point(mesh, point, hole, tol)` — strict, no fallback
  - `detect_case_d(mesh, proj_start, proj_end, saved_holes, tol)` — returns `Option<(hole_idx, InsideEnd, BoundaryPoint)>`
  - `split_face_case_d(...)` — bridge with pre-resolved H
  - `split_face_by_line` 의 dispatch 에 case D 추가 (case C 직후)

### 회귀 테스트 (절대 #[ignore] 금지)
- `phase_g4_bridge_endpoint_on_hole_vertex` — endpoint = hole vertex
- `phase_g4_bridge_endpoint_on_hole_edge` — endpoint = hole edge midpoint
- `phase_g4_manifold_invariant_after_bridge`
- `phase_g4_preserves_other_holes` — 다른 hole 은 그대로 inner 유지

## Trade-offs

### 채택 이유
- ✅ ADR-021 v1.1 known limitation 해결
- ✅ 사용자 직관 일치 (snap 으로 정확히 닿는 케이스)
- ✅ Case C 와 일관된 결과 (bridge fuse)
- ✅ Vertex case 는 split 불필요 → 더 효율적

### 인지된 비용
- ⚠ `find_boundary_point` 의 strict variant 추가 (코드 중복)
- ⚠ Snap 정밀도가 face_diag * 0.02 — 큰 face 에선 관대, 작은 face 에선 엄격

### 기각된 대안
- **Loose-fallback 사용**: 의도하지 않은 endpoint 가 hole boundary 로 잘못 분류될 위험
- **Case C 통합**: 코드 단순성 vs 분기 명확성 trade-off — case D 별도 유지

## Migration

기존 코드 영향:
- ADR-021 v1.1 known limitation 항목 → "Resolved by ADR-023 P8"
- CLAUDE.md LOCKED #10 추가
- 기존 Phase G case (c) 는 endpoint **strictly inside** 만 처리 (변경 없음)

## Future

- 양쪽 endpoint 가 다른 hole boundary → 두 hole 동시 fuse (별도 phase)
- 동일 hole 의 boundary 두 점 사이 cut → hole 을 둘로 분할 (Phase G2 의 변형)
- N-bridge (chain of holes connected by bridges) — 매우 드묾
