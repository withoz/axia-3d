# ADR-022: Vertex-Shared Pinch Auto-Promote (Phase 1 v1.1)

**Status**: **Accepted** (2026-04-29) — Phase 1 implemented, ε-doubling unnecessary
**Supersedes**: ADR-021 v1.1 known limitation "Connected Case B"
**Related**: ADR-007 (Face Orientation), ADR-008 (Face = byproduct), ADR-021 (Closed loop divides face)

## Implementation note (v1.1, post-implementation)

원래 제안 (v1) 은 **ε-vertex doubling** 으로 pinch vertex 를 분리하는 것이었다.
구현 중 발견: **단일 vertex 공유 (pinch=1)** 케이스는 vertex doubling 없이도
자연스럽게 manifold 가 보존된다. 이유:
- DCEL 에서 vertex 는 n-valent 가 허용 (manifold 위반 아님)
- Manifold 위반은 **edge 단위** — 한 edge 에 HE 2 개 초과 시 발생
- Single-vertex pinch 에서는 각 edge 마다 HE 정확히 2 개 → invariant 유지
- `Mesh::verify_face_invariants()` 가 0 violations 보고 (회귀 테스트로 검증)

따라서 Phase 1 의 실제 구현은 단순히:
1. Step 4.95 second-pass 의 `simple-only container` 제약 → ring container 도 허용
2. 기존 hole loops 보존 (rebuild 시 누락 방지)
3. P9 safety: 새 hole 과 기존 hole 간 vertex 공유 ≤ 1 만 허용 (pinch). ≥ 2 는 거부.
4. `b1_promote_safe` 의 vertex-overlap 거부 → ≤ 1 (pinch) 허용.

ε-doubling 은 **미래 reserve** — 진짜 non-manifold edge 가 발생하는 경우
(2+ vertex 공유) 에 대비한 대안. 현재 케이스 (1 vertex) 는 doubling 불필요.

---

## Context

ADR-021 v1.1 P7 ("닫힌 라인은 면을 나눈다") 의 known limitation 인 **Connected Case B** —
새 inner face 가 기존 sub-face 와 **vertex 만 공유** 하고 edge 는 공유하지 않을 때
manifold 안전을 위해 promote 를 거부하고 sibling 으로 유지해 왔다.

이 정책은 안전하지만, ADR-021 P7 의 "drawing-order independence" 와
"closed loop divides face" 정신과 충돌한다:
- 사용자는 "내가 닫힌 라인을 그렸으니 면이 나뉘어야 한다" 로 인식
- 같은 결과를 얻기 위해 vertex 를 미세하게 떨어뜨려야 하는 비직관적 우회 발생
- pinch vertex 한 점에서 4 face 가 만나는 non-manifold edge 위험은 실재

## Decision

### P9 — 새 원칙

> **Connectivity 는 edge OR vertex 공유로 판정한다.**
> **단일 vertex 로만 연결된 component 는 ε-doubling 으로 자동 manifold 화한다.**

#### P9 세부 규칙

**P9.1 — Connectivity 정의 확장**
- Edge-shared inners → 1 connected component (기존 P7 동작)
- Vertex-shared inners (edge 공유 없음) → "**pinch-connected**" 로 표시

**P9.2 — Pinch Vertex 자동 분리 (ε-doubling)**
- Pinch-connected component 는 promote 직전에 pinch vertex 를 둘로 분리:
  - `v_orig` → `v_a` (한쪽 sub-face 들이 참조) + `v_b` (다른 쪽 sub-face 들이 참조)
  - `pos(v_b) = pos(v_orig) + ε · n` (ε = 0.5μm, n = 두 sub-face 면적 중심 방향 단위 벡터)
  - ε 는 LOCKED #5 spatial-hash dedup tolerance (1.5μm) **미만** — 시각적 변화 없음
- 분리 후 component 는 vertex-disjoint → 각각 독립 hole 로 promote (multi-hole ring)

**P9.3 — Manifold Invariant 보존**
- ε-doubling 후 모든 vertex 는 정확히 2 face 의 corner 에만 속함 (manifold)
- ADR-007 Invariant 1 (단일 진실) / Invariant 2 (Winding) 무손상
- HE twin 관계 정상 유지 — pinch vertex 의 incident HEs 는 분리된 두 vertex 로 재배선

**P9.4 — Drawing Order 무관성**
- Case A (작은 inner 먼저) → outer 그릴 때 P9 적용
- Case B (outer 먼저) → 큰 inner + 작은 inner 시 P9 적용
- 결과 동일: multi-hole ring + N 개 sub-face

**P9.5 — LOCKED #5 예외 명시**
- LOCKED #5 "1.5μm spatial-hash dedup 만 허용" 에 다음 예외 추가:
  > Pinch vertex 의 ε-doubling 은 manifold 보존을 위한 예외. 분리 거리 ε ≤ 0.5μm,
  > 항상 dedup tolerance 1.5μm 미만 → spatial-hash 결과는 변하지 않음.
- `add_vertex_with_snap` 같은 mesh-level 허용오차 함수 추가 금지 정책은 유효.
  P9 doubling 은 mesh 허용오차 확장이 아닌 **manifold 토폴로지 정합 작업**.

## Implementation

### 변경 파일
- `crates/axia-geo/src/mesh.rs`:
  - `find_inner_components` 확장 → vertex-shared connectivity 추가
  - `find_pinch_vertices_in_component(component)` 신규
  - `split_pinch_vertex(v_orig, comp_a_faces, comp_b_faces, epsilon, normal)` 신규
- `crates/axia-core/src/scene.rs`:
  - Step 4.95 second-pass 에서 component 별 pinch 검사 + doubling 적용
  - `b1_promote_safe` 의 vertex-overlap 거부 → pinch-doubling 으로 우회 가능 시 통과

### Pseudo-code (Step 4.95 확장)
```rust
let raw_components = self.mesh.find_inner_components(inners);
let split_components = self.mesh.split_pinch_components(raw_components, EPSILON);
for component in split_components {
    let perimeter = self.mesh.compute_combined_perimeter(&component)?;
    promote_face_to_hole(container, perimeter)?;
}
```

### 회귀 테스트 (절대 #[ignore] 금지)
- `test_p9_pinch_two_inners_become_two_disjoint_holes`
- `test_p9_pinch_doubling_preserves_face_count`
- `test_p9_pinch_visual_position_within_tolerance`
- `test_p9_drawing_order_independence_with_pinch`
- `test_p9_three_way_pinch_at_corner` (3 inners 한 vertex)
- `test_p9_no_pinch_no_doubling` (negative — disjoint case 변화 없음)
- `test_p9_edge_shared_no_doubling` (negative — edge-connected case 변화 없음)
- `test_p9_manifold_invariant_after_doubling`

## Trade-offs

### 채택 이유
- ✅ ADR-021 P7 의 자연스러운 완성
- ✅ Drawing-order independence 강화
- ✅ 사용자 직관 일치 ("닫힌 라인 = 면 나눠짐")
- ✅ Manifold 안전성 자동 보장
- ✅ ADR-007 Invariant 무손상

### 인지된 비용
- ⚠ Vertex 수 증가 (pinch case 만, 일반적으로 1~2개)
- ⚠ ε direction 결정 heuristic 필요 — sub-face 면적 중심 방향으로 통일 (deterministic)
- ⚠ LOCKED #5 에 명시적 예외 조항 추가 (CLAUDE.md 갱신)

### 기각된 대안
- **Figure-eight loop 통합** (vertex 두 번 방문) — non-manifold pinch 유지, 후속 도구 가드 필요. 복잡도 ↑
- **현재 sibling 유지** (status quo) — ADR-021 P7 정신과 충돌. 사용자 expectation 충족 실패
- **사용자에게 거부 + Toast** — UX 후퇴, drawing-order 의존성 부활

## Migration

기존 코드 영향:
- `b1_promote_safe` 의 vertex-overlap 거부 로직 → pinch-doubling 시도 후 실패 시에만 거부
- ADR-021 v1.1 에 known limitation "Connected Case B" 항목 → "Resolved by ADR-022 P9"
- CLAUDE.md LOCKED #5 에 P9 예외 조항 추가
- CLAUDE.md LOCKED #8 (ADR-019) 에 P9 호환성 노트 추가 (Edge id stability 무손상)

## Future

- P9 의 ε-doubling 패턴은 향후 Boolean 연산의 pinch-edge 처리에도 재사용 가능
- 3D pinch (vertex 가 3D 솔리드 양쪽에서 만나는 경우) 는 별도 ADR (Phase 4+)
