# ADR-025: Closed Edge Cycle MUST Synthesize Face (P11)

**Status**: Accepted (2026-04-29) — Strict invariant; Superseded by ADR-139 (2026-05-18, Q3=a 결재) — *결과 invariant* (메타-원칙 #14 닫힌 경계 → 면) 보존, *자동 trigger* (DrawLine closed loop / Step 4.95 / 4.99 second-pass) 만 supersede. DrawRect / DrawCircle 같은 single explicit op 의 auto-face 는 보존 (Q2=a 결재). LOCKED #12 / LOCKED #64 cross-reference.
**Strengthens**: ADR-021 P7 ("닫힌 라인은 면을 나눈다")
**Supersedes**: 27-RECT 스트레스에서 발견된 sliver 미합성 한계
**Superseded by**: ADR-139 (Boundary Tool + Auto-cycle Deprecation, 2026-05-18, trigger 정책만)
**Related**: ADR-019 ("Line is Truth, Face is Byproduct"), ADR-008 (Axiom 1), ADR-139 (Boundary Tool — supersede trigger)

## Context

ADR-021 P7 는 "닫힌 라인은 면을 나눈다" 라고 선언했지만, 27-RECT 스트레스
(2 large + 얇은 crossing) 에서 일부 sliver region 이 합성되지 않는 한계가
발견됨. 31-48 orphan free edge 발생 — closed cycle 임에도 face 미생성.

사용자 강조 원칙:
> **"닫힌 엣지에는 반드시 면이 생성되어야 한다."**

이는 ADR-019 의 "Line is Truth" + ADR-008 Axiom 1 ("Face = byproduct") 의
가장 강한 형태이며, 시스템 정합성의 기초이다. 위반 시:
- Push/pull, boolean 등 후속 op 가 일부 영역에서 작동 안 함
- 시각적으로 면 누락 (사용자 혼란)
- 토폴로지 검증 실패

## Decision

### P11 — 새 원칙 (기존 P7 의 강화)

> **모든 draw 연산 종료 시점에, mesh 내의 free edge (face=null) 집합으로**
> **형성되는 모든 simple closed cycle 은 정확히 하나의 face 로 합성되어야**
> **한다. 예외 없음 (epoch finalize 후 orphan free edge == 0 보장).**

### P11 세부 규칙

**P11.1 — Final Sweep 의무**
- `run_face_synthesis_postprocess` 의 마지막 단계로 **resolve_planar_free_faces**
  (또는 등가) 호출. M1, Step 4.95 등 이전 단계가 놓친 cycle 모두 mop-up.

**P11.2 — Strict Convergence**
- Final sweep 후 active free edge 가 1 개라도 존재하면 panic / error 로 보고
  (debug build) 또는 fallback hint 출력 (release).
- 회귀 테스트로 강제: `assert!(orphan_count == 0)` after 27-RECT.

**P11.3 — Material 결정**
- Sliver region 의 material 은 ADR-021 P7 정책: 영향 face(s) 의 material
  중 epoch hint → fallback default. 평균 / 우세 룰 추후.

**P11.4 — Winding 일관성 (ADR-007 Invariant 2)**
- 합성된 sliver face 의 normal 도 epoch hint (또는 surface_normal_hint) 와
  positive dot. 위반 시 reverse_loop.

**P11.5 — Manifold 안전**
- Free cycle 합성 시 P9 (vertex pinch) / P10 (corner) 정책 호환.
- 합성 결과 non-manifold edge 발생 시 그 cycle 은 skip + 경고 (extreme corner case).

## Implementation

### 변경 파일
- `crates/axia-core/src/scene.rs`:
  - `run_face_synthesis_postprocess` 의 끝에 final-sweep 단계 추가
  - 호출: `mesh.resolve_planar_free_faces_scoped(material, Some(&touched_verts), None)`
- (필요 시) `crates/axia-geo/src/mesh.rs`:
  - `resolve_planar_free_faces_scoped` 가 sliver 케이스 (multi-component free graph)
    를 정확히 처리하도록 검증

### 회귀 테스트 (절대 #[ignore] 금지)
- `test_p11_27rect_zero_orphan_edges` — HARD assertion
- `test_p11_thin_crossing_in_dense_rings_no_orphans` — sliver 케이스 명시
- `test_p11_drawing_order_independence_zero_orphans`

## Trade-offs

### 채택 이유
- ✅ ADR-019 / ADR-021 P7 정신의 완성
- ✅ 사용자 직관 보장 ("닫힌 도형 = 면")
- ✅ Push/pull / boolean 등 후속 op 안정화
- ✅ Strict invariant → CI 회귀 즉시 감지

### 인지된 비용
- ⚠ Final sweep 추가 비용 (보통 작음 — free edge 가 0 일 때 fast-path)
- ⚠ Edge case (degenerate sliver < ε) 에서 fail 시 명확한 에러 필요

### 기각된 대안
- **Lazy synthesis**: "필요할 때 합성" — 발생 즉시 사용자 인식 안 됨, 직관 위배
- **Tolerance 완화**: 사용자 정책 LOCKED #5 위반

## Migration

기존 코드 영향:
- ADR-021 v1.1 / Phase D limitation 종료
- CLAUDE.md LOCKED #12 추가
- 기존 `run_face_synthesis_postprocess` 의 단계별 동작 그대로, 끝에만 final
  sweep 추가
